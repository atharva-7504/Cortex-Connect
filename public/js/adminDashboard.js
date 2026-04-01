(function () {
  "use strict";

  const panel = document.querySelector("[data-resource-forecast-panel]");
  if (!panel) {
    return;
  }

  const form = panel.querySelector("[data-forecast-form]");
  const daysSelect = panel.querySelector("[data-forecast-days]");
  const thresholdInput = panel.querySelector("[data-forecast-threshold]");
  const statusBox = panel.querySelector("[data-forecast-status]");
  const emptyState = panel.querySelector("[data-forecast-empty]");
  const results = panel.querySelector("[data-forecast-results]");
  const submitButton = panel.querySelector("[data-forecast-submit]");
  const resetButton = panel.querySelector("[data-forecast-reset]");
  const ratioBadge = panel.querySelector("[data-forecast-ratio]");
  const summaryList = panel.querySelector("[data-forecast-summary]");
  const tableBody = panel.querySelector("[data-forecast-table]");
  const generatedLabel = panel.querySelector("[data-forecast-generated]");
  const overallCanvas = panel.querySelector("[data-forecast-overall-chart]");
  const breakdownCanvas = panel.querySelector("[data-forecast-breakdown-chart]");

  if (typeof Chart === "undefined") {
    if (statusBox) {
      statusBox.className = "alert alert-warning mt-4 mb-0";
      statusBox.textContent = "Chart.js did not load, so the forecast charts cannot be rendered.";
    }
    return;
  }

  if (
    !form ||
    !daysSelect ||
    !thresholdInput ||
    !statusBox ||
    !emptyState ||
    !results ||
    !submitButton ||
    !resetButton ||
    !ratioBadge ||
    !summaryList ||
    !tableBody ||
    !generatedLabel ||
    !overallCanvas ||
    !breakdownCanvas
  ) {
    return;
  }

  let overallChart = null;
  let breakdownChart = null;

  const formatPct = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return "0%";
    }

    return `${num.toFixed(1).replace(/\.0$/, "")}%`;
  };

  const setStatus = (message, tone = "info") => {
    statusBox.className = `alert alert-${tone} mt-4 mb-0`;
    statusBox.textContent = message;
  };

  const setLoading = (isLoading) => {
    submitButton.disabled = isLoading;
    resetButton.disabled = isLoading;
    submitButton.textContent = isLoading ? "Generating..." : "Generate forecast";
  };

  const destroyCharts = () => {
    if (overallChart) {
      overallChart.destroy();
      overallChart = null;
    }

    if (breakdownChart) {
      breakdownChart.destroy();
      breakdownChart = null;
    }
  };

  const clearRenderedForecast = () => {
    destroyCharts();
    summaryList.replaceChildren();
    tableBody.replaceChildren();
    ratioBadge.textContent = "0%";
    generatedLabel.textContent = "";
  };

  const riskBadgeClass = (riskLevel) => {
    const normalized = String(riskLevel || "").toLowerCase();
    if (normalized === "critical") return "danger";
    if (normalized === "high") return "warning";
    if (normalized === "medium") return "info";
    return "success";
  };

  const renderSummary = (summary) => {
    summaryList.replaceChildren();

    const items = [
      {
        label: "Risk level",
        value: summary.risk_level || "low",
        tone: riskBadgeClass(summary.risk_level)
      },
      {
        label: "Peak day",
        value: summary.peak_day || "-",
        tone: "light"
      },
      {
        label: "Peak load",
        value: formatPct(summary.peak_load_pct || 0),
        tone: "light"
      },
      {
        label: "Recommended action",
        value: summary.recommended_action || "-",
        tone: "light"
      }
    ];

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "list-group-item px-0";

      const label = document.createElement("div");
      label.className = "small text-muted";
      label.textContent = item.label;

      const value = document.createElement("div");
      value.className = "fw-semibold";
      value.textContent = item.value;

      if (item.label === "Risk level") {
        const badge = document.createElement("span");
        badge.className = `badge text-bg-${item.tone} text-uppercase`;
        badge.textContent = String(item.value).toUpperCase();
        value.textContent = "";
        value.appendChild(badge);
      }

      row.appendChild(label);
      row.appendChild(value);
      summaryList.appendChild(row);
    });
  };

  const renderTable = (forecast) => {
    tableBody.replaceChildren();

    forecast.forEach((day) => {
      const row = document.createElement("tr");
      const cells = [
        day.date,
        formatPct(day.overall_load_pct),
        formatPct(day.bed_load_pct),
        formatPct(day.staff_load_pct),
        formatPct(day.appointment_load_pct)
      ];

      cells.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      const thresholdCell = document.createElement("td");
      const thresholdBadge = document.createElement("span");
      thresholdBadge.className = `badge text-bg-${day.threshold_exceeded ? "danger" : "success"} text-uppercase`;
      thresholdBadge.textContent = day.threshold_exceeded ? "Exceeded" : "Safe";
      thresholdCell.appendChild(thresholdBadge);
      row.appendChild(thresholdCell);

      const confidenceCell = document.createElement("td");
      const confidenceBadge = document.createElement("span");
      confidenceBadge.className = "badge text-bg-light border text-uppercase";
      confidenceBadge.textContent = day.confidence || "medium";
      confidenceCell.appendChild(confidenceBadge);
      row.appendChild(confidenceCell);

      const noteCell = document.createElement("td");
      noteCell.className = "text-muted small";
      noteCell.textContent = day.note || "-";
      row.appendChild(noteCell);

      tableBody.appendChild(row);
    });
  };

  const renderCharts = (payload) => {
    destroyCharts();

    const labels = (payload.forecast || []).map((item) => item.date);
    const thresholdPct = Number(payload.thresholdPct || 0);
    const overallValues = (payload.forecast || []).map((item) => Number(item.overall_load_pct || 0));
    const bedValues = (payload.forecast || []).map((item) => Number(item.bed_load_pct || 0));
    const staffValues = (payload.forecast || []).map((item) => Number(item.staff_load_pct || 0));
    const appointmentValues = (payload.forecast || []).map((item) => Number(item.appointment_load_pct || 0));

    overallChart = new Chart(overallCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Overall load",
            data: overallValues,
            borderColor: "#0d6efd",
            backgroundColor: "rgba(13, 110, 253, 0.12)",
            fill: true,
            tension: 0.35,
            pointRadius: 4
          },
          {
            label: `Threshold ${thresholdPct}%`,
            data: labels.map(() => thresholdPct),
            borderColor: "#dc3545",
            borderDash: [8, 6],
            borderWidth: 2,
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom"
          },
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.dataset.label}: ${formatPct(context.parsed.y)}`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              callback(value) {
                return `${value}%`;
              }
            }
          }
        }
      }
    });

    breakdownChart = new Chart(breakdownCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Bed load",
            data: bedValues,
            borderColor: "#198754",
            backgroundColor: "rgba(25, 135, 84, 0.12)",
            tension: 0.35,
            fill: false,
            pointRadius: 3
          },
          {
            label: "Staff load",
            data: staffValues,
            borderColor: "#fd7e14",
            backgroundColor: "rgba(253, 126, 20, 0.12)",
            tension: 0.35,
            fill: false,
            pointRadius: 3
          },
          {
            label: "Appointment pressure",
            data: appointmentValues,
            borderColor: "#6f42c1",
            backgroundColor: "rgba(111, 66, 193, 0.12)",
            tension: 0.35,
            fill: false,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom"
          },
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.dataset.label}: ${formatPct(context.parsed.y)}`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              callback(value) {
                return `${value}%`;
              }
            }
          }
        }
      }
    });

    ratioBadge.textContent = `Peak ${formatPct(payload.summary?.peak_load_pct || 0)}`;
  };

  const renderForecast = (payload) => {
    results.hidden = false;
    emptyState.hidden = true;
    generatedLabel.textContent = payload.generatedAt ? new Date(payload.generatedAt).toLocaleString() : "";
    renderSummary(payload.summary || {});
    renderCharts(payload);
    renderTable(payload.forecast || []);
  };

  const resetForm = () => {
    form.reset();
    daysSelect.value = "7";
    thresholdInput.value = "80";
    clearRenderedForecast();
    results.hidden = true;
    emptyState.hidden = false;
    setStatus("Set the horizon and threshold, then generate a live OpenAI forecast.", "info");
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const horizonDays = Number(daysSelect.value);
    const thresholdPct = Number(thresholdInput.value);

    if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 7) {
      setStatus("Forecast horizon must be between 1 and 7 days.", "warning");
      return;
    }

    if (!Number.isInteger(thresholdPct) || thresholdPct < 1 || thresholdPct > 100) {
      setStatus("Threshold must be between 1 and 100.", "warning");
      return;
    }

    setLoading(true);
    setStatus("Generating the forecast with OpenAI...", "info");

    try {
      const response = await fetch(form.dataset.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          horizonDays,
          thresholdPct
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Unable to generate the forecast.");
      }

      renderForecast(payload);
      setStatus("Forecast generated successfully.", "success");
    } catch (error) {
      clearRenderedForecast();
      results.hidden = true;
      emptyState.hidden = false;
      setStatus(error.message || "Unable to generate the forecast.", "danger");
    } finally {
      setLoading(false);
    }
  });

  resetButton.addEventListener("click", resetForm);

  resetForm();
})();
