"""FastAPI entry point for Uvicorn and Vercel Python Functions."""
from collections import defaultdict, deque
from datetime import datetime, timezone
import json
import os
import sys
from pathlib import Path
import threading
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ml.dataset import read_dataset, MAX_UPLOAD_BYTES
from ml.features import extract_features
from ml.model import ProductionModel, run_experiment
from ml.scanner import scan_url

app = FastAPI(title="UMMU URL GUARD", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
origins = [s.strip() for s in os.getenv("ALLOWED_ORIGINS", "").split(",") if s.strip() and s.strip() != "*"]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"], allow_credentials=False)
production = ProductionModel()
TRAIN_SLOT = threading.BoundedSemaphore(1)
RATE_LOCK = threading.Lock()
RATE_BUCKETS = defaultdict(deque)
BODY_LIMIT = MAX_UPLOAD_BYTES + 65536


class ResourceGuard:
    """Bound incoming body size even for chunked/misreported Content-Length requests."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        limit = BODY_LIMIT if path in ("/api/train", "/api/dataset/analyze", "/api/experiment") else (4 * 1024 * 1024 if path == "/api/evaluate" else 16384)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > limit:
                await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json")]})
                await send({"type": "http.response.body", "body": b'{"detail":"Request body exceeds the endpoint limit."}'})
                return
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
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with RATE_LOCK:
        for old in list(RATE_BUCKETS):
            if not RATE_BUCKETS[old] or RATE_BUCKETS[old][-1] < now - 60:
                del RATE_BUCKETS[old]
        if len(RATE_BUCKETS) >= 2048 and key not in RATE_BUCKETS:
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Server rate-limit capacity reached."}, status_code=429, headers={"Retry-After": "60"})
        bucket = RATE_BUCKETS[key]
        while bucket and bucket[0] < now - 60:
            bucket.popleft()
        if len(bucket) >= 30:
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Limit: 30 requests per minute per client/process."}, status_code=429, headers={"Retry-After": "60"})
        bucket.append(now)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


class URLRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096)


class EvaluationRequest(BaseModel):
    # Experiments are returned to the browser, never assumed to persist on Vercel.
    # Re-evaluation takes raw predictions, not client-supplied metric claims.
    actual: list[int] = Field(min_length=2, max_length=1000)
    predicted: list[int] = Field(min_length=2, max_length=1000)
    phishing_scores: list[float] = Field(min_length=2, max_length=1000)


def extraction_or_error(value):
    try:
        return extract_features(value)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.get("/api/health")
def health():
    return {"status": "ok", "model_available": production.model is not None, "model_version": production.metadata.get("version"),
            "model_reason": production.reason, "model_metrics": production.metadata.get("metrics"),
            "online_scan_enabled": os.getenv("ONLINE_SCAN_ENABLED", "1") == "1", "dataset_storage": "request-only"}


@app.post("/api/features")
def features(body: URLRequest):
    return extraction_or_error(body.url)


@app.post("/api/predict")
def predict(body: URLRequest):
    result = extraction_or_error(body.url)
    return {**result, **production.predict(result)}


@app.post("/api/scan")
async def scan(body: URLRequest):
    result = extraction_or_error(body.url)
    prediction = production.predict(result)
    online = await run_in_threadpool(scan_url, result["url"]) if os.getenv("ONLINE_SCAN_ENABLED", "1") == "1" else {"status": "disabled", "reason": "Online checking is disabled by environment configuration.", "redirect_count": 0}
    return {**result, **prediction, "online": online, "id": str(uuid.uuid4()), "timestamp": datetime.now(timezone.utc).isoformat(),
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
