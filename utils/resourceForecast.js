const Joi = require("joi");

const AppointmentDetail = require("../models/appointmentDetail");
const BedAdmission = require("../models/bedAdmission");
const Doctor = require("../models/doctor");
const StaffRecord = require("../models/staffRecord");

const OPENAI_API_URL = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
const OPENAI_PREDICTION_MODEL = process.env.OPENAI_PREDICTION_MODEL || "gpt-4o-mini";

const resourceForecastRequestSchema = Joi.object({
  horizonDays: Joi.number().integer().min(1).max(7).required(),
  thresholdPct: Joi.number().integer().min(1).max(100).required()
}).required();

const forecastSchema = {
  type: "object",
  additionalProperties: false, 
  properties: {
    horizon_days: {
      type: "integer",
      minimum: 1,
      maximum: 7
    },
    threshold_pct: {
      type: "number"
    },
    generated_at: {
      type: "string"
    },
    summary: {
      type: "object",
      additionalProperties: false,
      properties: {
        risk_level: {
          type: "string",
          enum: ["low", "medium", "high", "critical"]
        },
        peak_day: {
          type: "string"
        },
        peak_load_pct: {
          type: "number"
        },
        recommended_action: {
          type: "string"
        }
      },
      required: ["risk_level", "peak_day", "peak_load_pct", "recommended_action"]
    },
    forecast: {
      type: "array",
      minItems: 1,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: {
            type: "string"
          },
          overall_load_pct: {
            type: "number"
          },
          bed_load_pct: {
            type: "number"
          },
          staff_load_pct: {
            type: "number"
          },
          appointment_load_pct: {
            type: "number"
          },
          threshold_exceeded: {
            type: "boolean"
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"]
          },
          note: {
            type: "string"
          }
        },
        required: [
          "date",
          "overall_load_pct",
          "bed_load_pct",
          "staff_load_pct",
          "appointment_load_pct",
          "threshold_exceeded",
          "confidence",
          "note"
        ]
      }
    }
  },
  required: ["horizon_days", "threshold_pct", "generated_at", "summary", "forecast"]
};

const clamp = (value, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.min(Math.max(num, min), max);
};

const roundOneDecimal = (value) => Math.round(Number(value || 0) * 10) / 10;

const getTodayDateString = () => new Date().toISOString().slice(0, 10);

const toDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
};

const shiftDateString = (dateString, offsetDays) => {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const sortByDateKey = (records, key) => [...records].sort((left, right) => String(left[key] || "").localeCompare(String(right[key] || "")));

const buildAppointmentHistory = (records) => {
  const byDay = new Map();

  records.forEach((record) => {
    const dateKey = toDateKey(record.createdAt);
    if (!dateKey) {
      return;
    }

    const current = byDay.get(dateKey) || {
      date: dateKey,
      total: 0,
      pending: 0,
      accepted: 0,
      rejected: 0
    };

    current.total += 1;

    const status = String(record.status || "").toLowerCase();
    if (status === "pending") {
      current.pending += 1;
    } else if (status === "accepted") {
      current.accepted += 1;
    } else if (status === "rejected") {
      current.rejected += 1;
    }

    byDay.set(dateKey, current);
  });

  return sortByDateKey([...byDay.values()], "date");
};

const buildLatestSnapshotHistory = (records, dateField, mapper) => {
  const latestByDay = new Map();

  records.forEach((record) => {
    const dateKey = String(record[dateField] || "").trim();
    if (!dateKey) {
      return;
    }

    latestByDay.set(dateKey, record);
  });

  return sortByDateKey(
    [...latestByDay.entries()].map(([date, record]) => mapper(record, date)),
    "date"
  );
};

const buildBedHistory = (records) =>
  buildLatestSnapshotHistory(records, "admission_date", (record, date) => {
    const totalBeds = clamp(record.total_beds, 0, 10000);
    const occupiedBeds = clamp(record.occupied_beds, 0, totalBeds);
    const freeBeds = Math.max(totalBeds - occupiedBeds, 0);

    return {
      date,
      total_beds: totalBeds,
      occupied_beds: occupiedBeds,
      free_beds: freeBeds,
      occupancy_pct: totalBeds ? roundOneDecimal((occupiedBeds / totalBeds) * 100) : 0,
      admissions_today: clamp(record.admissions_today, 0, 10000),
      discharges_today: clamp(record.discharges_today, 0, 10000),
      expected_discharges_next_days: clamp(record.expected_discharges_next_days, 0, 10000),
      category: String(record.bed_category || ""),
      urgency_level: String(record.urgency_level || "")
    };
  });

const buildStaffHistory = (records) =>
  buildLatestSnapshotHistory(records, "effective_date", (record, date) => {
    const totalStaff = clamp(record.total_staff, 0, 10000);
    const activeStaff = clamp(record.active_staff, 0, totalStaff);
    const requiredStaff = clamp(record.required_staff, 0, 10000);

    return {
      date,
      total_staff: totalStaff,
      active_staff: activeStaff,
      required_staff: requiredStaff,
      coverage_pct: requiredStaff ? roundOneDecimal((activeStaff / requiredStaff) * 100) : 0,
      shift: String(record.shift || ""),
      status: String(record.status || "")
    };
  });

const buildUpcomingAppointmentPressure = (records) => {
  const byDay = new Map();

  records.forEach((record) => {
    const dateKey = String(record.appointment_date || "").trim();
    if (!dateKey) {
      return;
    }

    const current = byDay.get(dateKey) || {
      date: dateKey,
      total: 0,
      pending: 0,
      accepted: 0
    };

    current.total += 1;
    const status = String(record.status || "").toLowerCase();
    if (status === "pending") {
      current.pending += 1;
    } else if (status === "accepted") {
      current.accepted += 1;
    }

    byDay.set(dateKey, current);
  });

  return sortByDateKey([...byDay.values()], "date");
};

const buildCurrentSnapshot = async () => {
  const today = getTodayDateString();
  const windowEnd = shiftDateString(today, 14);
  const historyStart = shiftDateString(today, -29);

  const [
    totalAppointments,
    pendingAppointments,
    acceptedAppointments,
    rejectedAppointments,
    activeDoctors,
    totalDoctors,
    latestBedAdmission,
    latestStaffRecord,
    appointmentHistoryDocs,
    bedHistoryDocs,
    staffHistoryDocs,
    upcomingAppointmentDocs
  ] = await Promise.all([
    AppointmentDetail.countDocuments({}),
    AppointmentDetail.countDocuments({ status: "Pending" }),
    AppointmentDetail.countDocuments({ status: "Accepted" }),
    AppointmentDetail.countDocuments({ status: "Rejected" }),
    Doctor.countDocuments({ active: true }),
    Doctor.countDocuments({}),
    BedAdmission.findOne().sort({ createdAt: -1 }).lean(),
    StaffRecord.findOne().sort({ createdAt: -1 }).lean(),
    AppointmentDetail.find({ createdAt: { $gte: new Date(`${historyStart}T00:00:00.000Z`) } })
      .sort({ createdAt: 1 })
      .select("createdAt status appointment_date")
      .lean(),
    BedAdmission.find({ createdAt: { $gte: new Date(`${historyStart}T00:00:00.000Z`) } })
      .sort({ createdAt: 1 })
      .select("createdAt admission_date total_beds occupied_beds admissions_today discharges_today expected_discharges_next_days bed_category urgency_level")
      .lean(),
    StaffRecord.find({ createdAt: { $gte: new Date(`${historyStart}T00:00:00.000Z`) } })
      .sort({ createdAt: 1 })
      .select("createdAt effective_date total_staff active_staff required_staff shift status")
      .lean(),
    AppointmentDetail.find({
      appointment_date: { $gte: today, $lte: windowEnd },
      status: { $in: ["Pending", "Accepted"] }
    })
      .sort({ appointment_date: 1 })
      .select("appointment_date status")
      .lean()
  ]);

  const appointmentHistory = buildAppointmentHistory(appointmentHistoryDocs);
  const bedHistory = buildBedHistory(bedHistoryDocs);
  const staffHistory = buildStaffHistory(staffHistoryDocs);
  const upcomingAppointmentPressure = buildUpcomingAppointmentPressure(upcomingAppointmentDocs);

  const latestBedTotal = clamp(latestBedAdmission?.total_beds, 0, 10000);
  const latestBedOccupied = clamp(latestBedAdmission?.occupied_beds, 0, latestBedTotal);
  const latestBedFree = Math.max(latestBedTotal - latestBedOccupied, 0);

  const latestStaffTotal = clamp(latestStaffRecord?.total_staff, 0, 10000);
  const latestStaffActive = clamp(latestStaffRecord?.active_staff, 0, latestStaffTotal);
  const latestStaffRequired = clamp(latestStaffRecord?.required_staff, 0, 10000);

  return {
    generatedAt: new Date().toISOString(),
    currentSnapshot: {
      today,
      appointments: {
        total: totalAppointments,
        pending: pendingAppointments,
        accepted: acceptedAppointments,
        rejected: rejectedAppointments
      },
      doctors: {
        total: totalDoctors,
        active: activeDoctors
      },
      beds: latestBedAdmission
        ? {
            date: latestBedAdmission.admission_date || null,
            total_beds: latestBedTotal,
            occupied_beds: latestBedOccupied,
            free_beds: latestBedFree,
            occupancy_pct: latestBedTotal ? roundOneDecimal((latestBedOccupied / latestBedTotal) * 100) : 0,
            bed_category: String(latestBedAdmission.bed_category || ""),
            admissions_today: clamp(latestBedAdmission.admissions_today, 0, 10000),
            discharges_today: clamp(latestBedAdmission.discharges_today, 0, 10000),
            expected_discharges_next_days: clamp(latestBedAdmission.expected_discharges_next_days, 0, 10000)
          }
        : null,
      staff: latestStaffRecord
        ? {
            date: latestStaffRecord.effective_date || null,
            total_staff: latestStaffTotal,
            active_staff: latestStaffActive,
            required_staff: latestStaffRequired,
            coverage_pct: latestStaffRequired ? roundOneDecimal((latestStaffActive / latestStaffRequired) * 100) : 0,
            shift: String(latestStaffRecord.shift || ""),
            status: String(latestStaffRecord.status || "")
          }
        : null
    },
    historicalSeries: {
      appointmentHistory,
      bedHistory,
      staffHistory,
      upcomingAppointmentPressure
    }
  };
};

const buildForecastPrompt = ({ horizonDays, thresholdPct, forecastDates, payload }) => ({
  model: OPENAI_PREDICTION_MODEL,
  temperature: 0.2,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "hospital_resource_forecast",
      strict: true,
      schema: forecastSchema
    }
  },
  messages: [
    {
      role: "system",
      content: [
        "You are a hospital operations forecasting engine.",
        "Use the provided JSON as the only source of truth.",
        "Forecast the next day-wise resource load for up to 7 days.",
        "Overall load must be a 0-100 number that reflects hospital pressure.",
        "Bed, staff, and appointment load must also be 0-100 numbers.",
        "threshold_exceeded must be true when overall_load_pct is greater than or equal to the threshold.",
        "Return JSON only. Do not include markdown or prose."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          horizon_days: horizonDays,
          threshold_pct: thresholdPct,
          forecast_dates: forecastDates,
          hospital_data: payload
        },
        null,
        2
      )
    }
  ]
});

const normalizeForecast = (forecastResponse, { horizonDays, thresholdPct, forecastDates }) => {
  const rawItems = Array.isArray(forecastResponse?.forecast) ? forecastResponse.forecast : [];
  const cleanedForecast = forecastDates.map((date, index) => {
    const item = rawItems[index] || rawItems.find((entry) => String(entry?.date || "") === date) || {};
    const overallLoadPct = normalizeLoadValue(item.overall_load_pct);
    const bedLoadPct = normalizeLoadValue(item.bed_load_pct);
    const staffLoadPct = normalizeLoadValue(item.staff_load_pct);
    const appointmentLoadPct = normalizeLoadValue(item.appointment_load_pct);

    return {
      date,
      overall_load_pct: overallLoadPct,
      bed_load_pct: bedLoadPct,
      staff_load_pct: staffLoadPct,
      appointment_load_pct: appointmentLoadPct,
      threshold_exceeded: Boolean(item.threshold_exceeded ?? overallLoadPct >= thresholdPct),
      confidence: ["low", "medium", "high"].includes(String(item.confidence || "").toLowerCase())
        ? String(item.confidence).toLowerCase()
        : "medium",
      note: String(item.note || "").trim() || "No note provided."
    };
  });

  const peakDay = cleanedForecast.reduce((best, item) => {
    if (!best || item.overall_load_pct > best.overall_load_pct) {
      return item;
    }
    return best;
  }, null);

  const summary = forecastResponse?.summary && typeof forecastResponse.summary === "object"
    ? forecastResponse.summary
    : {};

  const riskLevel = ["low", "medium", "high", "critical"].includes(String(summary.risk_level || "").toLowerCase())
    ? String(summary.risk_level).toLowerCase()
    : (() => {
        const peakLoad = peakDay ? peakDay.overall_load_pct : 0;
        if (peakLoad >= 90) return "critical";
        if (peakLoad >= 80) return "high";
        if (peakLoad >= 60) return "medium";
        return "low";
      })();

  return {
    horizon_days: horizonDays,
    threshold_pct: thresholdPct,
    generated_at: String(forecastResponse?.generated_at || new Date().toISOString()),
    summary: {
      risk_level: riskLevel,
      peak_day: String(summary.peak_day || peakDay?.date || forecastDates[forecastDates.length - 1] || getTodayDateString()),
      peak_load_pct: normalizeLoadValue(summary.peak_load_pct ?? peakDay?.overall_load_pct ?? 0),
      recommended_action: String(summary.recommended_action || "").trim() || "Review the highest-load day and prepare extra capacity."
    },
    forecast: cleanedForecast
  };
};

const generateResourceForecast = async ({ horizonDays, thresholdPct }) => {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const httpFetch = typeof fetch === "function" ? fetch : globalThis.fetch;
  if (typeof httpFetch !== "function") {
    throw new Error("This runtime does not support fetch().");
  }

  const context = await buildCurrentSnapshot();
  const today = context.currentSnapshot.today;
  const forecastDates = Array.from({ length: horizonDays }, (_, index) => shiftDateString(today, index + 1));
  const requestBody = buildForecastPrompt({
    horizonDays,
    thresholdPct,
    forecastDates,
    payload: context
  });

  const response = await httpFetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const rawResponseText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}): ${rawResponseText}`);
  }

  let parsedResponse;
  try {
    parsedResponse = JSON.parse(rawResponseText);
  } catch (error) {
    throw new Error("OpenAI returned an invalid JSON envelope.");
  }

  const content = parsedResponse?.choices?.[0]?.message?.content;
  if (!content) {
    const refusal = parsedResponse?.choices?.[0]?.message?.refusal;
    if (refusal) {
      throw new Error(refusal);
    }
    throw new Error("OpenAI returned an empty prediction payload.");
  }

  let parsedForecast;
  try {
    parsedForecast = JSON.parse(content);
  } catch (error) {
    throw new Error("OpenAI returned a malformed forecast JSON body.");
  }

  const normalizedForecast = normalizeForecast(parsedForecast, {
    horizonDays,
    thresholdPct,
    forecastDates
  });

  return {
    model: OPENAI_PREDICTION_MODEL,
    generatedAt: context.generatedAt,
    currentSnapshot: context.currentSnapshot,
    forecast: normalizedForecast.forecast,
    summary: normalizedForecast.summary,
    horizonDays: normalizedForecast.horizon_days,
    thresholdPct: normalizedForecast.threshold_pct
  };
};

module.exports = {
  generateResourceForecast,
  resourceForecastRequestSchema
};
