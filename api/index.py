"""FastAPI entry point for Uvicorn and Vercel Python Functions."""
from collections import defaultdict, deque
from datetime import datetime, timezone
import os
import sys
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ml.browser_training import MAX_BROWSER_TRAINING_BYTES, train_browser_experiment
from ml.dataset import read_dataset, MAX_UPLOAD_BYTES
from ml.features import (
    BASIC_FEATURES, FEATURE_NAMES, MAX_URL_LENGTH, PSL_VERSION, REFERENCE_VERSION,
    SCHEMA_VERSION, SHORTENER_VERSION, extract_features, normalize_url, registered_domain,
    related_url_key, shortener_provider,
)
from ml.model import ProductionModel, run_experiment
from ml.scanner import resolution_result, scan_url

app = FastAPI(title="UMMU URL GUARD", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
origins = [s.strip() for s in os.getenv("ALLOWED_ORIGINS", "").split(",") if s.strip() and s.strip() != "*"]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"], allow_credentials=False)
production = ProductionModel()
TRAIN_SLOT = threading.BoundedSemaphore(1)
FEATURE_BATCH_SLOTS = threading.BoundedSemaphore(2)
RATE_LOCK = threading.Lock()
RATE_BUCKETS = defaultdict(deque)
BODY_LIMIT = MAX_UPLOAD_BYTES + 65536
FEATURE_BATCH_ROWS = 2500
FEATURE_BATCH_BYTES = 1_500_000
RESEARCH_RESPONSE_BYTES = 3_950_000
RESEARCH_FEATURE_PATH = "/api/research/features"
RESEARCH_TRAIN_PATH = "/api/research/train/"
REDIRECT_PATH = "/api/resolve-url"
SCAN_PATH = "/api/scan"
RATE_LIMITS = {"default": 30, "research_features": 100, "research_train": 12, "url_scan": 30}


def path_scope(path):
    if path == RESEARCH_FEATURE_PATH:
        return "research_features"
    if path.startswith(RESEARCH_TRAIN_PATH):
        return "research_train"
    if path in (REDIRECT_PATH, SCAN_PATH):
        return "url_scan"
    return "default"


def request_byte_limit(path):
    scope = path_scope(path)
    if scope == "research_features":
        return FEATURE_BATCH_BYTES
    if scope == "research_train":
        return MAX_BROWSER_TRAINING_BYTES
    if path in ("/api/train", "/api/dataset/analyze", "/api/experiment"):
        return BODY_LIMIT
    if path == "/api/evaluate":
        return 4 * 1024 * 1024
    return 16384


class ResourceGuard:
    """Bound incoming body size even for chunked/misreported Content-Length requests."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = request_byte_limit(scope.get("path", ""))
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > limit:
                await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json")]})
                await send({"type": "http.response.body", "body": b'{"detail":"Request body exceeds the endpoint limit."}'})
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        sent = False
        async def bounded_receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()
        await self.app(scope, bounded_receive, send)


app.add_middleware(ResourceGuard)


@app.middleware("http")
async def guard(request: Request, call_next):
    # Deliberately do not trust user-controlled X-Forwarded-For headers.
    # This is per-process protection; deploy a platform firewall rate limit for public traffic.
    scope = path_scope(request.url.path)
    key = (request.client.host if request.client else "unknown", scope)
    limit = RATE_LIMITS[scope]
    now = time.monotonic()
    with RATE_LOCK:
        for old in list(RATE_BUCKETS):
            if not RATE_BUCKETS[old] or RATE_BUCKETS[old][-1] < now - 60:
                del RATE_BUCKETS[old]
        if len(RATE_BUCKETS) >= 2048 and key not in RATE_BUCKETS:
            return JSONResponse({"detail": "Server rate-limit capacity reached."}, status_code=429, headers={"Retry-After": "60"})
        bucket = RATE_BUCKETS[key]
        while bucket and bucket[0] < now - 60:
            bucket.popleft()
        if len(bucket) >= limit:
            return JSONResponse({"detail": f"Limit: {limit} requests per minute per client/process."}, status_code=429, headers={"Retry-After": "60"})
        bucket.append(now)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


class URLRequest(BaseModel):
    url: str = Field(min_length=1, max_length=MAX_URL_LENGTH)


class ScanRequest(URLRequest):
    check_redirect: bool = Field(default=False, strict=True)


class ResolutionRequest(BaseModel):
    # The body guard limits size. Semantic URL errors use the resolver's response shape.
    url: str


class EvaluationRequest(BaseModel):
    # Experiments are returned to the browser, never assumed to persist on Vercel.
    # Re-evaluation takes raw predictions, not client-supplied metric claims.
    actual: list[int] = Field(min_length=2, max_length=1000)
    predicted: list[int] = Field(min_length=2, max_length=1000)
    phishing_scores: list[float] = Field(min_length=2, max_length=1000)


def extraction_or_error(value):
    try:
        return extract_features(value, max_length=MAX_URL_LENGTH)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


def online_scan_enabled():
    return os.getenv("ONLINE_SCAN_ENABLED", "0") == "1"


async def redirect_result(original_url, normalized_url, *, requested):
    enabled = online_scan_enabled()
    if enabled and requested:
        return await run_in_threadpool(scan_url, original_url)

    parsed = urlsplit(normalized_url)
    status, reason = (
        ("NOT_REQUESTED", "Redirect check was not requested.")
        if enabled else ("DISABLED", "Online checking is disabled by environment configuration.")
    )
    return resolution_result(
        original_url, status, original_domain=registered_domain(parsed.hostname),
        is_short_url=bool(shortener_provider(parsed.hostname, parsed.path)), error_message=reason,
    )


@app.get("/api/health")
def health():
    return {"status": "ok", "model_available": production.model is not None, "model_version": production.metadata.get("version"),
            "model_reason": production.reason, "model_metrics": production.metadata.get("metrics"),
            "online_scan_enabled": online_scan_enabled(), "dataset_storage": "request-only"}


@app.post("/api/features")
def features(body: URLRequest):
    return extraction_or_error(body.url)


def research_json(content):
    response = JSONResponse(content)
    if len(response.body) > RESEARCH_RESPONSE_BYTES:
        raise HTTPException(413, "Hasil melebihi batas respons penelitian.")
    return response


def require_content_type(request, expected):
    actual = request.headers.get("content-type", "").split(";", maxsplit=1)[0].strip().lower()
    if actual != expected:
        raise HTTPException(415, f"Gunakan Content-Type {expected}.")


def extract_feature_batch(urls):
    rows = []
    for url in urls:
        try:
            result = extract_features(url)
        except ValueError:
            rows.append(None)
            continue
        rows.append({
            "normalized": result["url"],
            "related": related_url_key(result["url"]),
            "domain": result["registered_domain"],
            "features": [result["features"][name] for name in FEATURE_NAMES],
            "provider": result["shortener_provider"],
            "brand": result["typosquatting"]["indicator"],
        })
    return research_json({
        "schema_version": SCHEMA_VERSION,
        "reference_version": REFERENCE_VERSION,
        "shortener_version": SHORTENER_VERSION,
        "psl_version": PSL_VERSION,
        "feature_names": FEATURE_NAMES,
        "basic_features": BASIC_FEATURES,
        "rows": rows,
    })


@app.post(RESEARCH_FEATURE_PATH)
async def research_features(request: Request):
    require_content_type(request, "application/json")
    try:
        body = await request.json()
    except (ValueError, RecursionError):
        raise HTTPException(422, "Kirim objek JSON dengan daftar URL.") from None
    urls = body.get("urls") if isinstance(body, dict) else None
    if not isinstance(urls, list) or not urls:
        raise HTTPException(422, "Kirim objek JSON dengan daftar URL.")
    if len(urls) > FEATURE_BATCH_ROWS:
        raise HTTPException(413, f"Batch maksimal {FEATURE_BATCH_ROWS} URL.")
    if not FEATURE_BATCH_SLOTS.acquire(blocking=False):
        raise HTTPException(429, "Kapasitas ekstraksi fitur sedang sibuk.", headers={"Retry-After": "1"})
    try:
        return await run_in_threadpool(extract_feature_batch, urls)
    finally:
        FEATURE_BATCH_SLOTS.release()


@app.post(RESEARCH_TRAIN_PATH + "{config}")
async def research_train(config: str, request: Request):
    require_content_type(request, "application/octet-stream")
    if not TRAIN_SLOT.acquire(blocking=False):
        raise HTTPException(429, "Pelatihan sedang berjalan pada proses ini.", headers={"Retry-After": "1"})
    try:
        result = await run_in_threadpool(train_browser_experiment, config, await request.body())
        return research_json(result)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    finally:
        TRAIN_SLOT.release()


@app.post("/api/predict")
def predict(body: URLRequest):
    result = extraction_or_error(body.url)
    return {**result, **production.predict(result)}


@app.post(REDIRECT_PATH)
async def resolve_redirect(body: ResolutionRequest):
    try:
        normalized_url = normalize_url(body.url)
    except ValueError:
        result = resolution_result(None, "INVALID_URL", error_message="Invalid HTTP or HTTPS URL.")
        return JSONResponse(result, status_code=422)
    return await redirect_result(body.url, normalized_url, requested=True)


@app.post(SCAN_PATH)
async def scan(body: ScanRequest):
    initial = extraction_or_error(body.url)
    is_short_link = bool(initial["shortener_provider"])
    online = await redirect_result(body.url, initial["url"], requested=body.check_redirect)
    destination = None
    prediction_target = None
    reason = "Check the redirect destination before predicting a short link." if is_short_link else online.get("reason")
    prediction = {"available": False, "prediction": None, "probability": None, "model_version": None, "reason": reason}
    if online.get("destination_confirmed") is True:
        end = extraction_or_error(online["final_url"])
        destination = {**end, **production.predict(end)}
        prediction_target = "destination"
        prediction["reason"] = "The prediction is attached to the confirmed redirect destination."
    elif not is_short_link and online.get("resolution_status") in ("NOT_REQUESTED", "DISABLED", "NO_REDIRECT"):
        prediction = production.predict(initial)
        prediction_target = "initial"
    return {**initial, **prediction, "initial_url": body.url, "basic_features": BASIC_FEATURES,
            "prediction_target": prediction_target,
            "destination": destination, "online": online, "id": str(uuid.uuid4()), "timestamp": datetime.now(timezone.utc).isoformat(),
            "disclaimer": "Machine learning prediction is an indicator, not a guarantee of website safety."}


async def dataset_file(upload):
    try:
        content = await upload.read(MAX_UPLOAD_BYTES + 1)
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "CSV exceeds 2 MiB; use local training.")
        return read_dataset(content)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    finally:
        await upload.close()


@app.post("/api/dataset/analyze")
async def analyze(file: UploadFile = File(...)):
    _, summary = await dataset_file(file)
    return summary


async def train_upload(file, feature_sets):
    if not TRAIN_SLOT.acquire(blocking=False):
        raise HTTPException(429, "An experiment is already running in this process.")
    try:
        df, summary = await dataset_file(file)
        if summary["has_research_metadata"]:
            raise HTTPException(422, "Research metadata requires the local audited pipeline.")
        try:
            report, _ = await run_in_threadpool(run_experiment, df, summary, file.filename or "uploaded.csv", feature_sets)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        return report
    finally:
        TRAIN_SLOT.release()


@app.post("/api/train")
async def train(file: UploadFile = File(...)):
    return await train_upload(file, ("extended",))


@app.post("/api/experiment")
async def experiment(file: UploadFile = File(...)):
    return await train_upload(file, ("basic", "extended"))


@app.post("/api/evaluate")
def evaluation(body: EvaluationRequest):
    import math
    from ml.evaluation import evaluate
    if not len(body.actual) == len(body.predicted) == len(body.phishing_scores):
        raise HTTPException(422, "Prediction arrays must have equal lengths.")
    if any(v not in (0, 1) for v in body.actual + body.predicted) or any(not math.isfinite(v) or not 0 <= v <= 1 for v in body.phishing_scores):
        raise HTTPException(422, "Labels must be 0/1 and scores must be finite values in [0,1].")
    return {"source": "User-supplied held-out predictions; provenance must be verified by the researcher.", "metrics": evaluate(body.actual, body.predicted, body.phishing_scores)}
