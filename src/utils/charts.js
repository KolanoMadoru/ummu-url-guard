import Chart from "chart.js/auto";
const active = [];
export function clearCharts() {
  active.splice(0).forEach((chart) => chart.destroy());
}
export function chart(id, type, labels, values, label = "Jumlah Data") {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  active.push(
    new Chart(canvas, {
      type,
      data: {
        labels,
        datasets: [
          {
            label,
            data: values,
            backgroundColor: [
              "#2563eb",
              "#dc2626",
              "#16a34a",
              "#d97706",
              "#64748b",
              "#1e3a8a",
            ],
            borderColor: "#2563eb",
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: type === "doughnut", position: "bottom" },
        },
        scales: type === "doughnut" ? {} : { y: { beginAtZero: true } },
      },
    }),
  );
}
export function curve(id, data, label) {
  if (!data) return;
  const canvas = document.getElementById(id);
  if (!canvas) return;
  active.push(
    new Chart(canvas, {
      type: "scatter",
      data: {
        datasets: [
          {
            label,
            data: data.x.map((x, i) => ({ x, y: data.y[i] })),
            showLine: true,
            borderColor: "#2563eb",
            pointRadius: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            min: 0,
            max: 1,
            title: {
              display: true,
              text: label === "ROC" ? "Tingkat positif palsu" : "Recall",
            },
          },
          y: {
            min: 0,
            max: 1,
            title: {
              display: true,
              text: label === "ROC" ? "Tingkat positif benar" : "Presisi",
            },
          },
        },
      },
    }),
  );
}
export const plot = (id, title) =>
  `<section class="card"><h3>${title}</h3><div class="plot"><canvas id="${id}" role="img" aria-label="${title}"></canvas></div></section>`;
