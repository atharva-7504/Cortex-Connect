require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const ejsMate = require("ejs-mate");
const path = require("path");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");

const User = require("./models/users");
const Doctor = require("./models/doctor");
const AppointmentDetail = require("./models/appointmentDetail");
const AppointmentNotification = require("./models/appointmentNotification");
const BedAdmission = require("./models/bedAdmission");
const BedRequest = require("./models/bedRequest");
const { connectDatabase } = require("./config/database");
const initializePassport = require("./config/passport");
const { createAuthMiddleware } = require("./middlewares/auth");
const { seedBedAdmissions } = require("./init/bed_admissions_index");
const { buildAppointmentReceiptPdf, buildAppointmentReceiptFilename } = require("./utils/pdfReceipt");
const createControllers = require("./controllers");
const {
  objectIdPattern,
  signupSchema,
  loginSchema,
  appointmentSchema,
  bedAdmissionSchema,
  bedRequestSchema,
  doctorRosterSchema
} = require("./utils/validation");

const app = express();
const port = process.env.PORT || 3000;

const authRoleOptions = [
  { value: "admin", label: "Admin" },
  { value: "doctor", label: "Doctor" },
  { value: "user", label: "Patient" }
];

const specializationOptions = [
  { value: "cardiology", label: "Cardiology" },
  { value: "orthopedic", label: "Orthopedic" },
  { value: "general_physician", label: "General Physician" }
];

const weekdayOptions = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
];

const urgencyOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];

const specializationLabels = {
  cardiology: "Cardiology",
  orthopedic: "Orthopedic",
  general_physician: "General Physician"
};

const roleLabels = {
  admin: "Admin",
  doctor: "Doctor",
  user: "Patient"
};

const bedCategoryLabels = {
  normal: "Normal Ward",
  critical: "Critical Care",
  icu: "ICU"
};

const bedCategoryPrefixes = {
  normal: "GW",
  critical: "CCU",
  icu: "ICU"
};

const staffRoleLabels = {
  admin: "Admin",
  doctor: "Doctor"
};

const staffStatusLabels = {
  active: "Active",
  inactive: "Inactive"
};

const requestStatusLabels = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected"
};

const flashTypes = new Set(["success", "danger", "warning", "info"]);

const adminSignupCode = String(process.env.ADMIN_SIGNUP_CODE || "").trim();

const defaultDoctors = [
  {
    name: "Dr. Meera Shah",
    specialization: "cardiology",
    department: "Cardiology",
    hospital_start_time: "09:00",
    hospital_end_time: "13:00",
    slot_duration_minutes: 30,
    availability_days: ["Monday", "Wednesday", "Friday"],
    time_slots: ["09:00 AM", "10:00 AM", "11:30 AM", "03:00 PM"]
  },
  {
    name: "Dr. Arjun Patel",
    specialization: "orthopedic",
    department: "Orthopedic",
    hospital_start_time: "10:00",
    hospital_end_time: "16:00",
    slot_duration_minutes: 30,
    availability_days: ["Tuesday", "Thursday", "Saturday"],
    time_slots: ["10:00 AM", "11:00 AM", "01:00 PM", "04:00 PM"]
  },
  {
    name: "Dr. Sana Khan",
    specialization: "general_physician",
    department: "General Medicine",
    hospital_start_time: "09:30",
    hospital_end_time: "17:30",
    slot_duration_minutes: 30,
    availability_days: ["Monday", "Tuesday", "Thursday", "Friday"],
    time_slots: ["09:30 AM", "12:00 PM", "02:30 PM", "05:00 PM"]
  }
];

const doctorFallbackConfigBySpecialization = {
  cardiology: {
    department: "Cardiology",
    hospital_start_time: "09:00",
    hospital_end_time: "13:00",
    availability_days: ["Monday", "Wednesday", "Friday"]
  },
  orthopedic: {
    department: "Orthopedic",
    hospital_start_time: "10:00",
    hospital_end_time: "16:00",
    availability_days: ["Tuesday", "Thursday", "Saturday"]
  },
  general_physician: {
    department: "General Medicine",
    hospital_start_time: "09:30",
    hospital_end_time: "17:30",
    availability_days: ["Monday", "Tuesday", "Thursday", "Friday"]
  }
};

const getUserFullName = (user) => {
  if (!user) return "";
  const firstName = String(user.first_name || "").trim();
  const lastName = String(user.last_name || "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  return String(user.username || "").trim();
};

const normalizeRole = (role) => {
  const normalized = String(role || "").trim().toLowerCase();
  return roleLabels[normalized] ? normalized : "user";
};

const normalizeFlashType = (type) => {
  const normalized = String(type || "").trim().toLowerCase();
  return flashTypes.has(normalized) ? normalized : "info";
};

const addFlash = (req, type, message) => {
  if (!req?.session) return;

  const text = String(message || "").trim();
  if (!text) return;

  const flashType = normalizeFlashType(type);
  req.session.flashMessages = req.session.flashMessages || {};
  req.session.flashMessages[flashType] = req.session.flashMessages[flashType] || [];
  req.session.flashMessages[flashType].push(text);
};

const flashError = (req, message) => addFlash(req, "danger", message);
const flashSuccess = (req, message) => addFlash(req, "success", message);
const flashWarning = (req, message) => addFlash(req, "warning", message);

const redirectWithFlash = (req, res, url, type, message) => {
  addFlash(req, type, message);
  return res.redirect(url);
};

const { ensureAuthenticated, ensureRole } = createAuthMiddleware({ redirectWithFlash });

const getMongooseErrorMessage = (err, fallback) => {
  if (!err) return fallback;

  if (err.name === "ValidationError") {
    const firstError = Object.values(err.errors || {})[0];
    return firstError?.message || fallback;
  }

  if (err.code === 11000) {
    const keyName = Object.keys(err.keyPattern || {})[0];
    if (keyName === "email" || keyName === "username") {
      return "Username or email already exists.";
    }
    return "Duplicate record found.";
  }

  return err.message || fallback;
};

const isDuplicateAppointmentSlotError = (err) => {
  if (!err || err.code !== 11000) return false;

  const keyPattern = err.keyPattern || {};
  return Boolean(
    keyPattern.doctor_id &&
    keyPattern.appointment_date &&
    keyPattern.time_slot
  );
};

const getValidationMessage = (error, fallback) => {
  if (error?.details?.length) {
    return error.details[0].message;
  }

  return fallback;
};

const toSafeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const getTodayDateString = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseTimeToMinutes = (value) => {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
};

const formatMinutesToTimeLabel = (minutes) => {
  const totalMinutes = ((minutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const displayHours = hours24 % 12 || 12;

  return `${String(displayHours).padStart(2, "0")}:${String(mins).padStart(2, "0")} ${period}`;
};

const buildTimeSlots = (startTime, endTime, intervalMinutes = 30) => {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);

  if (start === null || end === null || end <= start) {
    return [];
  }

  const slots = [];
  for (let current = start; current < end; current += intervalMinutes) {
    slots.push(formatMinutesToTimeLabel(current));
  }

  return slots;
};

const getAppointmentStatusLabel = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "accepted") return "Approved";
  if (normalized === "pending") return "Pending approval";
  if (normalized === "rejected") return "Rejected";
  return String(status || "-");
};

const getAppointmentStatusBadgeClass = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "accepted") return "success";
  if (normalized === "rejected") return "danger";
  return "warning";
};

const getUrgencyLabel = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "-";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const buildAppointmentCode = (appointmentDate = "") => {
  const datePart = String(appointmentDate || getTodayDateString()).replace(/-/g, "");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `APT-${datePart}-${suffix}`;
};

const getStartOfWeek = (date = new Date()) => {
  const weekStart = new Date(date);
  const currentDay = weekStart.getDay();
  const diff = currentDay === 0 ? -6 : 1 - currentDay;
  weekStart.setDate(weekStart.getDate() + diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
};

const buildWeeklyDoctorSchedule = (doctor) => {
  if (!doctor) {
    return [];
  }

  const weeklySlots = buildTimeSlots(doctor.hospital_start_time, doctor.hospital_end_time, doctor.slot_duration_minutes || 30);
  const weekStart = getStartOfWeek();

  return weekdayOptions.map((day, index) => {
    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + index);
    const isAvailable = Boolean(doctor.active && doctor.availability_days?.includes(day));
    return {
      day,
      dateLabel: dayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      timeWindow: isAvailable ? `${doctor.hospital_start_time || "-"} to ${doctor.hospital_end_time || "-"}` : "-",
      slots: isAvailable ? weeklySlots : [],
      available: isAvailable
    };
  });
};

const createAppointmentNotification = async ({
  recipientRole,
  recipientUserId = null,
  appointmentId,
  kind,
  title,
  message,
  link
}) => {
  if (!appointmentId || !recipientRole || !kind || !title || !message || !link) {
    return null;
  }

  try {
    return await AppointmentNotification.create({
      recipient_role: recipientRole,
      recipient_user_id: recipientUserId || undefined,
      appointment_id: appointmentId,
      kind,
      title,
      message,
      link
    });
  } catch (err) {
    console.error("Unable to store appointment notification:", err);
    return null;
  }
};

const sendAppointmentDecisionNotifications = async (appointment, decision) => {
  if (!appointment) {
    return;
  }

  const normalizedDecision = String(decision || "").trim().toLowerCase() === "rejected" ? "rejected" : "approved";
  const doctorUserId = appointment.doctor_id?.user_id ? String(appointment.doctor_id.user_id) : "";
  const patientUserId = appointment.user_id?._id ? String(appointment.user_id._id) : "";
  const appointmentLabel = `${appointment.appointment_date || "the selected date"} at ${appointment.time_slot || "the selected time"}`;
  const title = normalizedDecision === "approved" ? "Appointment approved" : "Appointment rejected";
  const doctorMessage = `${appointment.full_name || "A patient"} appointment for ${appointmentLabel} was ${normalizedDecision}.`;
  const patientMessage = `Your appointment request for ${appointmentLabel} was ${normalizedDecision}.`;
  const doctorLink = "/dashboard";

  await Promise.all([
    createAppointmentNotification({
      recipientRole: "doctor",
      recipientUserId: doctorUserId || null,
      appointmentId: appointment._id,
      kind: normalizedDecision === "approved" ? "request_approved" : "request_rejected",
      title,
      message: doctorMessage,
      link: doctorLink
    }),
    createAppointmentNotification({
      recipientRole: "user",
      recipientUserId: patientUserId || null,
      appointmentId: appointment._id,
      kind: normalizedDecision === "approved" ? "request_approved" : "request_rejected",
      title,
      message: patientMessage,
      link: "/check-status"
    })
  ]);
};

const buildAppointmentReceiptDocument = (appointment, { issuedAt = new Date() } = {}) => {
  const doctor = appointment?.doctor_id && appointment.doctor_id.name ? appointment.doctor_id : null;
  const patient = appointment?.user_id && appointment.user_id.first_name ? appointment.user_id : null;
  const statusLabel = getAppointmentStatusLabel(appointment?.status);
  const approvedByName = appointment?.approved_by && appointment.approved_by.first_name
    ? getUserFullName(appointment.approved_by)
    : "System Admin";
  const patientName = appointment?.full_name || (patient ? getUserFullName(patient) : "-");

  return {
    brand: "CortexConnect",
    title: "Appointment Receipt",
    subtitle: appointment?.status === "Pending"
      ? "Appointment request receipt pending admin approval"
      : appointment?.status === "Rejected"
        ? "Appointment request receipt with admin rejection"
        : "Confirmed appointment details",
    referenceNumber: appointment?.appointment_code || String(appointment?._id || "-"),
    statusLabel,
    issuedAt: issuedAt.toLocaleString(),
    sections: [
      {
        heading: "Patient Details",
        fields: [
          { label: "Name", value: patientName },
          { label: "Email", value: appointment?.email || patient?.email || "-" },
          { label: "Phone", value: appointment?.phone || "-" },
          { label: "Patient Type", value: appointment?.patient_type || "existing" }
        ]
      },
      {
        heading: "Doctor Details",
        fields: [
          { label: "Doctor", value: appointment?.doctor_name || doctor?.name || "-" },
          { label: "Specialization", value: getSpecializationLabel(appointment?.specialization || doctor?.specialization) },
          { label: "Department", value: doctor?.department || "-" }
        ]
      },
      {
        heading: "Appointment Details",
        fields: [
          { label: "Date", value: appointment?.appointment_date || "-" },
          { label: "Time", value: appointment?.time_slot || "-" },
          { label: "Urgency", value: getUrgencyLabel(appointment?.urgency_level || "medium") },
          { label: "Status", value: statusLabel },
          { label: "Submitted On", value: appointment?.createdAt ? new Date(appointment.createdAt).toLocaleString() : "-" },
          { label: "Reviewed By", value: appointment?.approved_by ? approvedByName : "-" },
          { label: "Reviewed At", value: appointment?.approved_at ? new Date(appointment.approved_at).toLocaleString() : "-" },
          { label: "Symptoms", value: appointment?.symptoms || "-" }
        ]
      }
    ],
    footer: "This receipt is system generated. Keep it for hospital records and follow the admin approval status before visiting."
  };
};

const buildBedSummary = (records) => {
  if (!records || !records.length) {
    return null;
  }

  const latest = records[0];
  const totalBeds = toSafeNumber(latest.total_beds);
  const occupiedBeds = toSafeNumber(latest.occupied_beds);
  const freeBeds = Math.max(totalBeds - occupiedBeds, 0);
  const occupancyPct = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;
  const criticalBeds = records.reduce((sum, record) => sum + toSafeNumber(record.bed_category === "critical" ? record.bed_required : 0), 0);
  const icuBeds = records.reduce((sum, record) => sum + toSafeNumber(record.bed_category === "icu" ? record.bed_required : 0), 0);
  const normalBeds = records.reduce((sum, record) => sum + toSafeNumber(record.bed_category === "normal" ? record.bed_required : 0), 0);

  return {
    totalBeds,
    occupiedBeds,
    freeBeds,
    occupancyPct,
    criticalBeds,
    icuBeds,
    normalBeds,
    admissionsToday: toSafeNumber(latest.admissions_today),
    dischargesToday: toSafeNumber(latest.discharges_today),
    expectedDischarges: toSafeNumber(latest.expected_discharges_next_days),
    latestDate: latest.admission_date
  };
};

const buildStaffSummary = (records) => {
  if (!records || !records.length) {
    return null;
  }

  const totalStaff = records.length;
  const activeStaff = records.filter((record) => {
    if (typeof record.active === "boolean") {
      return record.active;
    }

    return String(record.status || "").toLowerCase() === "active";
  }).length;
  const requiredStaff = totalStaff;
  const coveragePct = requiredStaff > 0 ? Math.round((activeStaff / requiredStaff) * 100) : 0;

  return {
    totalStaff,
    activeStaff,
    requiredStaff,
    coveragePct,
    addedStaff: 0,
    leftStaff: Math.max(totalStaff - activeStaff, 0),
    shift: records[0]?.shift || "-",
    latestDate: records[0]?.latestDate || records[0]?.effective_date || null
  };
};

const normalizeBedCategory = (value, fallback = "icu") => {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(bedCategoryLabels, normalized) ? normalized : fallback;
};

const normalizeSearchTerm = (value) => String(value || "").trim().toLowerCase();

const buildSearchText = (...values) => values
  .flat()
  .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
  .map((value) => String(value).toLowerCase())
  .join(" ");

const getSpecializationLabel = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "-";
  return specializationLabels[normalized] || normalized.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
};

const getStaffStatusLabel = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "-";
  return staffStatusLabels[normalized] || normalized.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
};

const getRequestStatusLabel = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "-";
  return requestStatusLabels[normalized] || normalized.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
};

const getBedCategoryPrefix = (value) => {
  const normalized = normalizeBedCategory(value, "icu");
  return bedCategoryPrefixes[normalized] || "BED";
};

const getBedCategoryLabel = (value) => bedCategoryLabels[normalizeBedCategory(value, "icu")] || "ICU";

const buildBedAssignmentLabel = (bedCategory, startIndex, count = 1) => {
  const prefix = getBedCategoryPrefix(bedCategory);
  const firstLabel = `${prefix}-${String(Math.max(startIndex, 1)).padStart(3, "0")}`;
  if (count <= 1) {
    return firstLabel;
  }

  const lastLabel = `${prefix}-${String(Math.max(startIndex + count - 1, 1)).padStart(3, "0")}`;
  return `${firstLabel} to ${lastLabel}`;
};

const buildBedRequestSummary = (records) => {
  if (!records || !records.length) {
    return null;
  }

  const summary = records.reduce((accumulator, record) => {
    const status = String(record.status || "pending").toLowerCase();
    if (status === "pending") accumulator.pending += 1;
    if (status === "approved") accumulator.approved += 1;
    if (status === "rejected") accumulator.rejected += 1;
    return accumulator;
  }, { pending: 0, approved: 0, rejected: 0 });

  return {
    totalRequests: records.length,
    ...summary
  };
};

const buildDoctorRosterRows = (staffUsers, doctorProfiles) => {
  const doctorMap = new Map();

  (doctorProfiles || []).forEach((doctor) => {
    const userId = doctor?.user_id?._id || doctor?.user_id || doctor?.userId || null;
    if (userId) {
      doctorMap.set(String(userId), doctor);
    }
  });

  return (staffUsers || []).map((user) => {
    const userId = String(user._id);
    const doctor = doctorMap.get(userId) || null;
    const isAdmin = user.role === "admin";
    const displayName = doctor?.name || getUserFullName(user);
    const status = isAdmin ? "active" : doctor?.active ? "active" : "inactive";
    const department = isAdmin ? "Administration" : doctor?.department || "-";
    const startTime = isAdmin ? "-" : doctor?.hospital_start_time || "-";
    const endTime = isAdmin ? "-" : doctor?.hospital_end_time || "-";
    const availabilityDays = isAdmin ? [] : doctor?.availability_days || [];

    return {
      id: isAdmin ? userId : String(doctor?._id || userId),
      doctor_id: isAdmin ? "" : String(doctor?._id || ""),
      user_id: userId,
      staff_name: displayName,
      staff_role: user.role,
      role_label: staffRoleLabels[user.role] || getSpecializationLabel(user.role),
      specialization: isAdmin ? "administration" : doctor?.specialization || "general_physician",
      specialization_label: isAdmin ? "Administration" : getSpecializationLabel(doctor?.specialization),
      department,
      status,
      status_label: getStaffStatusLabel(status),
      active: status === "active",
      hospital_start_time: startTime,
      hospital_end_time: endTime,
      hours_label: isAdmin ? "-" : `${startTime} to ${endTime}`,
      availability_days: availabilityDays,
      availability_label: availabilityDays.length ? availabilityDays.join(", ") : "-",
      doctor_bio: isAdmin ? "" : doctor?.doctor_bio || "",
      effective_date: doctor?.updatedAt || user.updatedAt || user.createdAt || null,
      latestDate: doctor?.updatedAt || user.updatedAt || user.createdAt || null
    };
  }).sort((a, b) => {
    if (a.staff_role !== b.staff_role) {
      return a.staff_role === "admin" ? -1 : 1;
    }

    return a.staff_name.localeCompare(b.staff_name);
  });
};

const buildBedRequestFormData = ({ selectedAppointment, selectedDoctor, latestRequest }) => ({
  appointment_id: selectedAppointment ? String(selectedAppointment._id) : "",
  bed_category: String(latestRequest?.bed_category || ""),
  urgency_level: String(latestRequest?.urgency_level || selectedAppointment?.urgency_level || "medium"),
  department: String(latestRequest?.department || selectedAppointment?.department || selectedDoctor?.department || ""),
  notes: String(latestRequest?.notes || selectedAppointment?.symptoms || "")
});

const buildDoctorRosterFormData = (selectedDoctor) => ({
  doctor_id: selectedDoctor?.doctor_id ? String(selectedDoctor.doctor_id) : "",
  active: selectedDoctor && selectedDoctor.status === "active" ? "true" : "false",
  department: String(selectedDoctor?.department || ""),
  hospital_start_time: String(selectedDoctor?.hospital_start_time || ""),
  hospital_end_time: String(selectedDoctor?.hospital_end_time || ""),
  availability_days: selectedDoctor?.availability_days || [],
  doctor_bio: String(selectedDoctor?.doctor_bio || "")
});

const getLatestBedAdmissionSnapshot = async (bedCategory) => {
  const normalizedCategory = normalizeBedCategory(bedCategory, "icu");
  return BedAdmission.findOne({ bed_category: normalizedCategory })
    .sort({ admission_date: -1, createdAt: -1 })
    .lean();
};

const buildAdmissionPayloadFromRequest = (requestRecord, latestAdmission, approvedById) => {
  if (!requestRecord) {
    return null;
  }

  const bedCategory = normalizeBedCategory(requestRecord.bed_category, "icu");
  const totalBeds = toSafeNumber(latestAdmission?.total_beds, 50);
  const occupiedBeds = toSafeNumber(latestAdmission?.occupied_beds, 0);
  const bedRequired = Math.max(toSafeNumber(requestRecord.bed_required, 1), 1);
  const freeBeds = Math.max(totalBeds - occupiedBeds, 0);

  if (bedRequired > freeBeds) {
    return {
      error: `Only ${freeBeds} ${getBedCategoryLabel(bedCategory)} bed${freeBeds === 1 ? "" : "s"} are currently free.`
    };
  }

  return {
    patient_user_id: requestRecord.patient_user_id?._id || requestRecord.patient_user_id,
    patient_name: requestRecord.patient_name,
    patient_email: requestRecord.patient_email,
    patient_phone: requestRecord.patient_phone,
    bed_category: bedCategory,
    bed_required: bedRequired,
    bed_assigned: buildBedAssignmentLabel(bedCategory, occupiedBeds + 1, bedRequired),
    total_beds: totalBeds,
    occupied_beds: occupiedBeds + bedRequired,
    admissions_today: toSafeNumber(latestAdmission?.admissions_today, 0) + 1,
    discharges_today: toSafeNumber(latestAdmission?.discharges_today, 0),
    expected_discharges_next_days: toSafeNumber(latestAdmission?.expected_discharges_next_days, 0),
    admission_date: getTodayDateString(),
    status: "admitted",
    urgency_level: requestRecord.urgency_level || "medium",
    department: requestRecord.department || getBedCategoryLabel(bedCategory),
    notes: requestRecord.notes || undefined,
    recorded_by: approvedById,
    source_request_id: requestRecord._id,
    approved_by: approvedById,
    approved_at: new Date()
  };
};

const loadDoctorBedRequestContext = async ({ userId, appointmentId = "" }) => {
  const doctorProfile = await findDoctorByUserId(userId);
  if (!doctorProfile) {
    return {
      doctorProfile: null,
      acceptedAppointments: [],
      requestRows: [],
      selectedAppointment: null,
      latestRequest: null,
      formData: buildBedRequestFormData({})
    };
  }

  const [acceptedAppointments, requestRows] = await Promise.all([
    AppointmentDetail.find({ doctor_id: doctorProfile._id, status: "Accepted" })
      .sort({ createdAt: -1 })
      .populate("user_id doctor_id")
      .lean(),
    BedRequest.find({ requested_by: userId })
      .sort({ createdAt: -1 })
      .populate("appointment_id patient_user_id doctor_id requested_by resolved_by")
      .lean()
  ]);

  const selectedAppointment = acceptedAppointments.find((record) => String(record._id) === String(appointmentId))
    || acceptedAppointments[0]
    || null;

  const latestRequest = selectedAppointment
    ? requestRows.find((record) => String(record.appointment_id?._id || record.appointment_id) === String(selectedAppointment._id)) || null
    : requestRows[0] || null;

  return {
    doctorProfile,
    acceptedAppointments,
    requestRows,
    selectedAppointment,
    latestRequest,
    formData: buildBedRequestFormData({
      selectedAppointment,
      selectedDoctor: doctorProfile,
      latestRequest
    }),
    requestSummary: buildBedRequestSummary(requestRows)
  };
};

const loadStaffRosterContext = async ({ doctorId = "", search = "" } = {}) => {
  const [staffUsers, doctorProfiles] = await Promise.all([
    User.find({ role: { $in: ["admin", "doctor"] } })
      .sort({ first_name: 1, last_name: 1 })
      .lean(),
    Doctor.find({})
      .populate("user_id")
      .sort({ name: 1 })
      .lean()
  ]);

  const rosterRows = buildDoctorRosterRows(staffUsers, doctorProfiles);
  const normalizedSearch = normalizeSearchTerm(search);
  const filteredRoster = normalizedSearch
    ? rosterRows.filter((record) => {
      const searchableText = buildSearchText(
        record.staff_name,
        record.staff_role,
        record.department,
        record.specialization_label,
        record.status_label,
        record.hours_label,
        record.availability_label
      );
      return searchableText.includes(normalizedSearch);
    })
    : rosterRows;

  const doctorRows = rosterRows.filter((record) => record.staff_role === "doctor");
  const selectedDoctorRow = doctorRows.find((record) => String(record.doctor_id) === String(doctorId))
    || doctorRows[0]
    || null;

  return {
    rosterRows,
    filteredRoster,
    doctorRows,
    selectedDoctorRow,
    formData: buildDoctorRosterFormData(selectedDoctorRow),
    staffSummary: buildStaffSummary(rosterRows),
    matchingCount: filteredRoster.length
  };
};

const findUserById = async (userId) => {
  if (!mongoose.isValidObjectId(userId)) {
    return null;
  }

  return User.findById(userId).lean();
};

const findDoctorByUserId = async (userId) => {
  if (!mongoose.isValidObjectId(userId)) {
    return null;
  }

  return Doctor.findOne({ user_id: userId }).lean();
};

const canReviewAppointment = async (user, appointment) => {
  if (!user || user.role !== "doctor") {
    return { allowed: true };
  }

  const doctorProfile = await findDoctorByUserId(user._id);
  if (!doctorProfile) {
    return { allowed: false, message: "Doctor profile not found." };
  }

  const appointmentDoctorId = String(appointment?.doctor_id?._id || appointment?.doctor_id || "");
  if (appointmentDoctorId !== String(doctorProfile._id)) {
    return { allowed: false, message: "You can only review appointments assigned to you." };
  }

  return { allowed: true, doctorProfile };
};

const buildBedAdmissionFormData = ({ selectedPatient, latestAdmission, patientPhone = "" }) => ({
  patient_user_id: selectedPatient?._id ? String(selectedPatient._id) : "",
  patient_name: selectedPatient ? getUserFullName(selectedPatient) : String(latestAdmission?.patient_name || ""),
  patient_email: selectedPatient ? String(selectedPatient.email || "") : String(latestAdmission?.patient_email || ""),
  patient_phone: String(patientPhone || latestAdmission?.patient_phone || ""),
  bed_category: String(latestAdmission?.bed_category || "normal"),
  bed_required: String(latestAdmission?.bed_required || 1),
  bed_assigned: String(latestAdmission?.bed_assigned || ""),
  total_beds: String(latestAdmission?.total_beds || 50),
  occupied_beds: String(latestAdmission?.occupied_beds || 0),
  admissions_today: String(latestAdmission?.admissions_today || 1),
  discharges_today: String(latestAdmission?.discharges_today || 0),
  expected_discharges_next_days: String(latestAdmission?.expected_discharges_next_days || 0),
  admission_date: String(latestAdmission?.admission_date || getTodayDateString()),
  discharge_date: String(latestAdmission?.discharge_date || ""),
  status: String(latestAdmission?.status || "admitted"),
  urgency_level: String(latestAdmission?.urgency_level || "medium"),
  department: String(latestAdmission?.department || ""),
  notes: String(latestAdmission?.notes || "")
});

const getWeekdayName = (dateString) => {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { weekday: "long" });
};

const appointmentBlockingStatuses = ["Pending", "Accepted"];

const getAvailableSlots = async (doctorId, appointmentDate) => {
  const doctor = await Doctor.findById(doctorId).lean();
  if (!doctor || doctor.active === false) return [];

  const baseSlots = doctor.hospital_start_time && doctor.hospital_end_time
    ? buildTimeSlots(doctor.hospital_start_time, doctor.hospital_end_time, doctor.slot_duration_minutes || 30)
    : doctor.time_slots || [];

  if (!appointmentDate) {
    return baseSlots;
  }

  const weekday = getWeekdayName(appointmentDate);
  if (doctor.availability_days?.length && !doctor.availability_days.includes(weekday)) {
    return [];
  }

  const bookedAppointments = await AppointmentDetail.find({
    doctor_id: String(doctorId),
    appointment_date: appointmentDate,
    status: { $in: appointmentBlockingStatuses }
  }).select("time_slot").lean();

  const bookedSlots = new Set(bookedAppointments.map((record) => record.time_slot));
  return baseSlots.filter((slot) => !bookedSlots.has(slot));
};

const seedDoctors = async () => {
  const count = await Doctor.countDocuments();
  if (count > 0) return;
  await Doctor.insertMany(defaultDoctors);
};

const migrateDoctorProfiles = async () => {
  const doctors = await Doctor.find({});

  for (const doctor of doctors) {
    const fallback = doctorFallbackConfigBySpecialization[doctor.specialization] || doctorFallbackConfigBySpecialization.general_physician;
    let changed = false;

    if (!doctor.department && fallback.department) {
      doctor.department = fallback.department;
      changed = true;
    }

    if (!doctor.hospital_start_time && fallback.hospital_start_time) {
      doctor.hospital_start_time = fallback.hospital_start_time;
      changed = true;
    }

    if (!doctor.hospital_end_time && fallback.hospital_end_time) {
      doctor.hospital_end_time = fallback.hospital_end_time;
      changed = true;
    }

    if (!doctor.availability_days || doctor.availability_days.length === 0) {
      doctor.availability_days = fallback.availability_days || [];
      changed = true;
    }

    if ((!doctor.time_slots || doctor.time_slots.length === 0) && doctor.hospital_start_time && doctor.hospital_end_time) {
      doctor.time_slots = buildTimeSlots(doctor.hospital_start_time, doctor.hospital_end_time, doctor.slot_duration_minutes || 30);
      changed = true;
    }

    if (!doctor.slot_duration_minutes) {
      doctor.slot_duration_minutes = 30;
      changed = true;
    }

    if (changed) {
      await doctor.save();
    }
  }
};

const migrateAppointmentReferences = async () => {
  const appointments = await AppointmentDetail.find({});

  let changed = false;
  for (const appointment of appointments) {
    if (typeof appointment.user_id === "string" && mongoose.isValidObjectId(appointment.user_id)) {
      appointment.user_id = new mongoose.Types.ObjectId(appointment.user_id);
      changed = true;
    }

    if (typeof appointment.doctor_id === "string" && mongoose.isValidObjectId(appointment.doctor_id)) {
      appointment.doctor_id = new mongoose.Types.ObjectId(appointment.doctor_id);
      changed = true;
    }

    if (changed) {
      await appointment.save();
      changed = false;
    }
  }
};

const ensureAppointmentSlotIndex = async () => {
  const indexName = "doctor_id_1_appointment_date_1_time_slot_1";
  const indexes = await AppointmentDetail.collection.indexes();
  const staleUserIndex = indexes.find((index) => index.name === "user_id_1" && index.unique);

  if (staleUserIndex) {
    await AppointmentDetail.collection.dropIndex("user_id_1");
  }

  const slotIndex = indexes.find((index) => index.name === indexName);
  const hasPartialStatusFilter = Boolean(slotIndex?.partialFilterExpression?.status?.$in);

  if (slotIndex && !hasPartialStatusFilter) {
    await AppointmentDetail.collection.dropIndex(indexName);
  }

  await AppointmentDetail.collection.createIndex(
    { doctor_id: 1, appointment_date: 1, time_slot: 1 },
    {
      name: indexName,
      unique: true,
      partialFilterExpression: {
        status: { $in: appointmentBlockingStatuses }
      }
    }
  );
};

const controllerDeps = {
  auth: {
    passport,
    googleConfigured: false,
    ensureAuthenticated,
    ensureRole
  },
  helpers: {
    getUserFullName,
    normalizeRole,
    normalizeFlashType,
    addFlash,
    flashError,
    flashSuccess,
    flashWarning,
    redirectWithFlash,
    getMongooseErrorMessage,
    getValidationMessage,
    toSafeNumber,
    getTodayDateString,
    parseTimeToMinutes,
    formatMinutesToTimeLabel,
    buildTimeSlots,
    getAppointmentStatusLabel,
    getAppointmentStatusBadgeClass,
    getUrgencyLabel,
    buildAppointmentCode,
    getStartOfWeek,
    buildWeeklyDoctorSchedule,
    createAppointmentNotification,
    sendAppointmentDecisionNotifications,
    buildAppointmentReceiptDocument,
    buildBedSummary,
    buildStaffSummary,
    normalizeBedCategory,
    normalizeSearchTerm,
    buildSearchText,
    getSpecializationLabel,
    getStaffStatusLabel,
    getRequestStatusLabel,
    getBedCategoryPrefix,
    getBedCategoryLabel,
    buildBedAssignmentLabel,
    buildBedRequestSummary,
    buildDoctorRosterRows,
    buildBedRequestFormData,
    buildDoctorRosterFormData,
    getLatestBedAdmissionSnapshot,
    buildAdmissionPayloadFromRequest,
    loadDoctorBedRequestContext,
    findUserById,
    findDoctorByUserId,
    canReviewAppointment,
    buildBedAdmissionFormData,
    getWeekdayName,
    appointmentBlockingStatuses,
    getAvailableSlots,
    loadStaffRosterContext,
    isDuplicateAppointmentSlotError
  },
  schemas: {
    objectIdPattern,
    signupSchema,
    loginSchema,
    appointmentSchema,
    bedAdmissionSchema,
    bedRequestSchema,
    doctorRosterSchema
  },
  options: {
    authRoleOptions,
    specializationOptions,
    specializationLabels,
    weekdayOptions,
    urgencyOptions,
    roleLabels,
    bedCategoryLabels,
    bedCategoryPrefixes,
    staffRoleLabels,
    staffStatusLabels,
    requestStatusLabels
  },
  services: {
    buildAppointmentReceiptPdf,
    buildAppointmentReceiptFilename,
    seedDoctors,
    migrateDoctorProfiles,
    migrateAppointmentReferences,
    ensureAppointmentSlotIndex,
    seedBedAdmissions
  },
  env: {
    adminSignupCode
  }
};

app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "cortexconnect-session",
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.flashMessages = req.session?.flashMessages || {};
  if (req.session) {
    req.session.flashMessages = {};
  }
  next();
});

const { googleConfigured } = initializePassport(passport, User);

controllerDeps.auth.googleConfigured = googleConfigured;
const controllers = createControllers(controllerDeps);

app.use("/", controllers.public);
app.use("/", controllers.appointment);
app.use("/", controllers.bed);
app.use("/", controllers.staff);
app.use("/", controllers.dashboard);

/*
app.get("/", async (req, res, next) => {
  try {
    const doctorProfile = req.user?.role === "doctor"
      ? await findDoctorByUserId(req.user._id)
      : null;

    res.render("main/index", {
      title: "Home",
      message: String(req.query.message || ""),
      profile: req.user
        ? {
            id: String(req.user._id),
            fullName: getUserFullName(req.user),
            username: String(req.user.username || ""),
            firstName: String(req.user.first_name || ""),
            lastName: String(req.user.last_name || ""),
            email: String(req.user.email || ""),
            role: String(req.user.role || "user"),
            roleLabel: roleLabels[req.user.role] || "Patient",
            provider: String(req.user.provider || "local")
          }
        : null,
      doctorProfile
    });
  } catch (err) {
    next(err);
  }
});

app.get("/profile", ensureAuthenticated, async (req, res, next) => {
  try {
    const doctorProfile = req.user.role === "doctor"
      ? await findDoctorByUserId(req.user._id)
      : null;
    const recentAppointments = req.user.role === "doctor" && doctorProfile
      ? await AppointmentDetail.find({ doctor_id: doctorProfile._id, status: "Accepted" })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("user_id doctor_id")
        .lean()
      : req.user.role === "admin"
        ? await AppointmentDetail.find({})
          .sort({ createdAt: -1 })
          .limit(5)
          .populate("user_id doctor_id")
          .lean()
        : await AppointmentDetail.find({ user_id: req.user._id })
          .sort({ createdAt: -1 })
          .limit(5)
          .populate("doctor_id")
          .lean();

    const profile = {
      id: String(req.user._id),
      fullName: getUserFullName(req.user),
      firstName: String(req.user.first_name || ""),
      lastName: String(req.user.last_name || ""),
      username: String(req.user.username || ""),
      email: String(req.user.email || ""),
      role: String(req.user.role || "user"),
      roleLabel: roleLabels[req.user.role] || "Patient",
      provider: String(req.user.provider || "local"),
      createdAt: req.user.createdAt ? new Date(req.user.createdAt).toLocaleString() : "-"
    };

    res.render("main/profile", {
      title: "Profile",
      profile,
      doctorProfile,
      recentAppointments
    });
  } catch (err) {
    next(err);
  }
});

app.get("/login", (req, res) => {
  renderAuthPage(res, "auth/login", "Login", {}, String(req.query.message || ""));
});

app.post("/login", (req, res, next) => {
  const formData = {
    username: String(req.body.username || "").trim(),
    password: String(req.body.password || "")
  };

  const validation = loginSchema.validate(formData, { abortEarly: true, stripUnknown: true });
  if (validation.error) {
    return res.status(400).render("auth/login", {
      title: "Login",
      authRoleOptions,
      formData,
      message: getValidationMessage(validation.error, "Please enter a valid username and password.")
    });
  }

  passport.authenticate("local", async (err, user, info) => {
    if (err) {
      return next(err);
    }

    if (!user) {
      return res.status(401).render("auth/login", {
        title: "Login",
        authRoleOptions,
        formData,
        message: info?.message || "No matching user found."
      });
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return next(loginErr);
      }

      flashSuccess(req, `Welcome back, ${getUserFullName(user)}.`);
      res.redirect("/");
    });
  })(req, res, next);
});

app.get("/signup", (req, res) => {
  renderAuthPage(res, "auth/signup", "Signup", {}, String(req.query.message || ""));
});

app.post("/signup", async (req, res, next) => {
  const requestedRole = normalizeRole(String(req.body.role || "user"));
  const rawAvailabilityDays = req.body.availability_days;
  const formData = {
    first_name: String(req.body.first_name || "").trim(),
    last_name: String(req.body.last_name || "").trim(),
    username: String(req.body.username || "").trim(),
    email: String(req.body.email || "").trim(),
    password: String(req.body.password || ""),
    role: requestedRole,
    admin_code: requestedRole === "admin" ? String(req.body.admin_code || "").trim() : "",
    doctor_specialization: requestedRole === "doctor" ? String(req.body.doctor_specialization || "").trim() : "",
    doctor_department: requestedRole === "doctor" ? String(req.body.doctor_department || "").trim() : "",
    hospital_start_time: requestedRole === "doctor" ? String(req.body.hospital_start_time || "").trim() : "",
    hospital_end_time: requestedRole === "doctor" ? String(req.body.hospital_end_time || "").trim() : "",
    availability_days: requestedRole === "doctor"
      ? Array.isArray(rawAvailabilityDays)
        ? rawAvailabilityDays.map((day) => String(day).trim()).filter(Boolean)
        : rawAvailabilityDays
          ? [String(rawAvailabilityDays).trim()].filter(Boolean)
          : []
      : [],
    doctor_bio: requestedRole === "doctor" ? String(req.body.doctor_bio || "").trim() : ""
  };

  try {
    const validationPayload = {
      first_name: formData.first_name,
      last_name: formData.last_name,
      username: formData.username,
      email: formData.email,
      password: formData.password,
      role: formData.role
    };

    if (formData.role === "admin") {
      validationPayload.admin_code = formData.admin_code;
    }

    if (formData.role === "doctor") {
      validationPayload.doctor_specialization = formData.doctor_specialization;
      validationPayload.doctor_department = formData.doctor_department;
      validationPayload.hospital_start_time = formData.hospital_start_time;
      validationPayload.hospital_end_time = formData.hospital_end_time;
      validationPayload.availability_days = formData.availability_days;
      validationPayload.doctor_bio = formData.doctor_bio;
    }

    const validation = signupSchema.validate(validationPayload, { abortEarly: true, stripUnknown: true });
    if (validation.error) {
      return res.status(400).render("auth/signup", {
        title: "Signup",
        authRoleOptions,
        specializationOptions,
        weekdayOptions,
        adminSignupCodeConfigured: Boolean(adminSignupCode),
        formData,
        message: getValidationMessage(validation.error, "Please fill in all required fields.")
      });
    }

    const sanitized = validation.value;
    sanitized.role = normalizeRole(sanitized.role);

    if (sanitized.role === "admin") {
      if (!adminSignupCode) {
        return res.status(400).render("auth/signup", {
          title: "Signup",
          authRoleOptions,
          specializationOptions,
          weekdayOptions,
          adminSignupCodeConfigured: Boolean(adminSignupCode),
          formData: sanitized,
          message: "Admin signup code is not configured."
        });
      }

      if (sanitized.admin_code !== adminSignupCode) {
        return res.status(400).render("auth/signup", {
          title: "Signup",
          authRoleOptions,
          specializationOptions,
          weekdayOptions,
          adminSignupCodeConfigured: Boolean(adminSignupCode),
          formData: sanitized,
          message: "Invalid admin code."
        });
      }
    }

    const existingUser = await User.findOne({
      $or: [
        { email: sanitized.email },
        { username: sanitized.username }
      ]
    }).lean();

    if (existingUser) {
      return res.status(400).render("auth/signup", {
        title: "Signup",
        authRoleOptions,
        specializationOptions,
        weekdayOptions,
        adminSignupCodeConfigured: Boolean(adminSignupCode),
        formData: sanitized,
        message: "Username or email already exists."
      });
    }

    const newUser = new User({
      first_name: sanitized.first_name,
      last_name: sanitized.last_name,
      username: sanitized.username,
      email: sanitized.email,
      role: sanitized.role,
      provider: "local"
    });
    const registeredUser = await User.register(newUser, sanitized.password);

    if (sanitized.role === "doctor") {
      const generatedTimeSlots = buildTimeSlots(sanitized.hospital_start_time, sanitized.hospital_end_time);
      if (!generatedTimeSlots.length) {
        await User.findByIdAndDelete(registeredUser._id);
        return res.status(400).render("auth/signup", {
          title: "Signup",
          authRoleOptions,
          specializationOptions,
          weekdayOptions,
          adminSignupCodeConfigured: Boolean(adminSignupCode),
          formData: sanitized,
          message: "Doctor hospital end time must be after the start time."
        });
      }

      try {
        await Doctor.create({
          user_id: registeredUser._id,
          name: getUserFullName(registeredUser),
          specialization: sanitized.doctor_specialization,
          department: sanitized.doctor_department,
          availability_days: sanitized.availability_days,
          hospital_start_time: sanitized.hospital_start_time,
          hospital_end_time: sanitized.hospital_end_time,
          slot_duration_minutes: 30,
          time_slots: generatedTimeSlots,
          doctor_bio: sanitized.doctor_bio || undefined,
          active: true
        });
      } catch (doctorErr) {
        await User.findByIdAndDelete(registeredUser._id);
        return res.status(400).render("auth/signup", {
          title: "Signup",
          authRoleOptions,
          specializationOptions,
          weekdayOptions,
          adminSignupCodeConfigured: Boolean(adminSignupCode),
          formData: sanitized,
          message: getMongooseErrorMessage(doctorErr, "Unable to save doctor profile.")
        });
      }
    }

    req.logIn(registeredUser, (loginErr) => {
      if (loginErr) {
        return next(loginErr);
      }

      flashSuccess(req, "Your account has been created successfully.");
      res.redirect("/");
    });
  } catch (err) {
    if (err?.name === "UserExistsError" || err?.code === 11000) {
      return res.status(400).render("auth/signup", {
        title: "Signup",
        authRoleOptions,
        specializationOptions,
        weekdayOptions,
        adminSignupCodeConfigured: Boolean(adminSignupCode),
        formData,
        message: "Username or email already exists."
      });
    }
    if (err?.name === "ValidationError") {
      return res.status(400).render("auth/signup", {
        title: "Signup",
        authRoleOptions,
        specializationOptions,
        weekdayOptions,
        adminSignupCodeConfigured: Boolean(adminSignupCode),
        formData,
        message: getMongooseErrorMessage(err, "Please check the signup details.")
      });
    }
    next(err);
  }
});

app.get("/doctors", ensureRole("user"), async (req, res, next) => {
  try {
    const specialization = String(req.query.specialization || "").trim();
    const appointmentDate = String(req.query.appointment_date || "").trim();
    const query = { active: true };
    const preservedQuery = new URLSearchParams();

    Object.entries(req.query).forEach(([key, value]) => {
      if (["doctor_id", "doctor_name", "specialization", "appointment_date"].includes(key)) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((entry) => preservedQuery.append(key, String(entry)));
      } else if (value !== undefined && value !== null) {
        preservedQuery.set(key, String(value));
      }
    });

    if (specialization && specializationLabels[specialization]) {
      query.specialization = specialization;
    }

    const doctors = await Doctor.find(query).sort({ name: 1 }).lean();
    const doctorsWithAvailability = [];

    for (const doctor of doctors) {
      const availableSlots = appointmentDate
        ? await getAvailableSlots(doctor._id.toString(), appointmentDate)
        : doctor.hospital_start_time && doctor.hospital_end_time
          ? buildTimeSlots(doctor.hospital_start_time, doctor.hospital_end_time, doctor.slot_duration_minutes || 30)
          : doctor.time_slots || [];
      const weekday = getWeekdayName(appointmentDate);
      const isOpen = appointmentDate
        ? Boolean(weekday && doctor.availability_days.includes(weekday) && availableSlots.length)
        : Boolean(availableSlots.length);

      doctorsWithAvailability.push({
        ...doctor,
        availableSlots,
        isOpen
      });
    }

    res.render("appointment/doctors", {
      title: "Choose Doctor",
      doctors: doctorsWithAvailability,
      specialization,
      appointmentDate,
      specializationOptions,
      queryString: preservedQuery.toString()
    });
  } catch (err) {
    next(err);
  }
});

app.get("/appointment", ensureRole("user"), async (req, res, next) => {
  try {
    const userId = req.user._id;
    const latestAppointment = await AppointmentDetail.findOne({ user_id: userId }).sort({ createdAt: -1 }).lean();
    const doctorId = String(req.query.doctor_id || "");
    const appointmentDate = String(req.query.appointment_date || "");
    const selectedDoctor = doctorId ? await Doctor.findById(doctorId).lean() : null;
    const availableSlots = selectedDoctor ? await getAvailableSlots(doctorId, appointmentDate) : [];
    const fullName = getUserFullName(req.user);

    res.render("appointment/form", {
      title: "Appointment",
      formData: {
        full_name: String(req.query.full_name || fullName || ""),
        email: String(req.query.email || req.user.email || ""),
        phone: String(req.query.phone || latestAppointment?.phone || ""),
        doctor_id: selectedDoctor?._id?.toString() || "",
        doctor_name: selectedDoctor?.name || "",
        specialization: selectedDoctor?.specialization || String(req.query.specialization || ""),
        appointment_date: appointmentDate,
        time_slot: String(req.query.time_slot || ""),
        symptoms: String(req.query.symptoms || ""),
        urgency_level: String(req.query.urgency_level || "medium"),
        consent: req.query.consent === "on"
      },
      selectedDoctor,
      availableSlots,
      specializationOptions,
      urgencyOptions,
      message: String(req.query.message || "")
      });
  } catch (err) {
    next(err);
  }
});

app.post("/appointment", ensureRole("user"), async (req, res, next) => {
  const userId = req.user._id;
  const rawSubmission = {
    user_id: String(userId),
    full_name: String(req.body.full_name || getUserFullName(req.user) || "").trim(),
    email: String(req.body.email || req.user.email || "").trim(),
    phone: String(req.body.phone || "").trim(),
    doctor_id: String(req.body.doctor_id || "").trim(),
    doctor_name: String(req.body.doctor_name || "").trim(),
    specialization: String(req.body.specialization || "").trim(),
    appointment_date: String(req.body.appointment_date || "").trim(),
    time_slot: String(req.body.time_slot || "").trim(),
    symptoms: String(req.body.symptoms || "").trim(),
    urgency_level: String(req.body.urgency_level || "low").trim(),
    consent: req.body.consent
  };

  try {
    if (!rawSubmission.doctor_id) {
      const selectedDoctor = null;
      return res.status(400).render("appointment/form", {
        title: "Appointment",
        formData: req.body,
        selectedDoctor,
        availableSlots: [],
        specializationOptions,
        urgencyOptions,
        message: "Please select a doctor first."
      });
    }

    const hasPreviousAppointment = Boolean(await AppointmentDetail.exists({ user_id: userId }));
    rawSubmission.patient_type = hasPreviousAppointment ? "existing" : "new";
    rawSubmission.previous_visit = hasPreviousAppointment ? "true" : "false";

    const validation = appointmentSchema.validate(rawSubmission, {
      abortEarly: true,
      stripUnknown: true
    });

    const selectedDoctor = objectIdPattern.test(rawSubmission.doctor_id)
      ? await Doctor.findById(rawSubmission.doctor_id).lean()
      : null;

    if (validation.error) {
      return res.status(400).render("appointment/form", {
        title: "Appointment",
        formData: req.body,
        selectedDoctor,
        availableSlots: selectedDoctor ? await getAvailableSlots(rawSubmission.doctor_id, rawSubmission.appointment_date) : [],
        specializationOptions,
        urgencyOptions,
        message: getValidationMessage(validation.error, "Please check the appointment details.")
      });
    }

    const submission = validation.value;
    const fullName = getUserFullName(req.user);
    const email = String(req.user.email || submission.email || "").trim();

    if (!selectedDoctor) {
      return res.status(400).render("appointment/form", {
        title: "Appointment",
        formData: submission,
        selectedDoctor: null,
        availableSlots: [],
        specializationOptions,
        urgencyOptions,
        message: "Please select a doctor first."
      });
    }

    if (selectedDoctor.active === false) {
      return res.status(400).render("appointment/form", {
        title: "Appointment",
        formData: submission,
        selectedDoctor,
        availableSlots: [],
        specializationOptions,
        urgencyOptions,
        message: "Selected doctor is not accepting appointments right now."
      });
    }

    const availableSlots = await getAvailableSlots(submission.doctor_id, submission.appointment_date);

    if (selectedDoctor.specialization !== submission.specialization) {
      return res.status(400).render("appointment/form", {
        title: "Appointment",
        formData: submission,
        selectedDoctor,
        availableSlots,
        specializationOptions,
        urgencyOptions,
        message: "Doctor specialization does not match your selection."
      });
    }

    if (submission.appointment_date < getTodayDateString()) {
      return res.status(400).render("appointment/form", {
        title: "Appointment",
        formData: submission,
        selectedDoctor,
        availableSlots,
        specializationOptions,
        urgencyOptions,
        message: "Appointment date cannot be in the past."
      });
    }

    const weekday = getWeekdayName(submission.appointment_date);
    if (selectedDoctor.availability_days?.length && !selectedDoctor.availability_days.includes(weekday)) {
      return res.status(400).render("appointment/form", {
        title: "Appointment",
        formData: submission,
        selectedDoctor,
        availableSlots,
        specializationOptions,
        urgencyOptions,
        message: "The selected doctor is not available on that date."
      });
    }

    if (!availableSlots.includes(submission.time_slot)) {
      return res.status(400).render("appointment/form", {
        title: "Appointment",
        formData: submission,
        selectedDoctor,
        availableSlots,
        specializationOptions,
        urgencyOptions,
        message: "That time slot is already booked."
      });
    }

    const appointmentCode = buildAppointmentCode(submission.appointment_date);
    const createdAppointment = await AppointmentDetail.create({
      appointment_code: appointmentCode,
      user_id: userId,
      patient_type: submission.patient_type,
      full_name: fullName,
      age: submission.age ?? undefined,
      date_of_birth: submission.date_of_birth || undefined,
      gender: submission.gender,
      email,
      phone: submission.phone,
      doctor_id: selectedDoctor._id,
      doctor_name: selectedDoctor.name,
      specialization: submission.specialization,
      appointment_date: submission.appointment_date,
      time_slot: submission.time_slot,
      symptoms: submission.symptoms,
      previous_visit: submission.previous_visit,
      urgency_level: submission.urgency_level,
      consent: submission.consent,
      status: "Pending"
    });

    const doctorUserId = selectedDoctor.user_id ? String(selectedDoctor.user_id) : "";
    const requestMessage = `${fullName} submitted an appointment request for ${submission.appointment_date} at ${submission.time_slot}.`;
    await Promise.all([
      createAppointmentNotification({
        recipientRole: "doctor",
        recipientUserId: doctorUserId || null,
        appointmentId: createdAppointment._id,
        kind: "request_submitted",
        title: "New appointment request",
        message: requestMessage,
        link: "/dashboard"
      }),
      createAppointmentNotification({
        recipientRole: "admin",
        appointmentId: createdAppointment._id,
        kind: "request_submitted",
        title: "Appointment waiting for approval",
        message: requestMessage,
        link: "/check-appointments"
      })
    ]);

    flashSuccess(req, "Appointment request submitted. Your receipt is ready to download.");
    res.redirect("/check-status");
  } catch (err) {
    if (err && err.code === 11000) {
      const selectedDoctor = objectIdPattern.test(String(req.body.doctor_id || "").trim())
        ? await Doctor.findById(String(req.body.doctor_id || "").trim()).lean()
        : null;
      const duplicateMessage = isDuplicateAppointmentSlotError(err)
        ? "That doctor and time slot combination is already booked."
        : getMongooseErrorMessage(err, "Unable to create this appointment because a duplicate record exists.");

      return res.status(400).render("appointment/form", {
        title: "Appointment",
        formData: req.body,
        selectedDoctor,
        availableSlots: selectedDoctor
          ? await getAvailableSlots(String(req.body.doctor_id || "").trim(), String(req.body.appointment_date || "").trim())
          : [],
        specializationOptions,
        urgencyOptions,
        message: duplicateMessage
      });
    }
    if (err?.name === "ValidationError") {
      return res.status(400).render("appointment/form", {
        title: "Appointment",
        formData: req.body,
        selectedDoctor: objectIdPattern.test(String(req.body.doctor_id || "").trim())
          ? await Doctor.findById(String(req.body.doctor_id || "").trim()).lean()
          : null,
        availableSlots: objectIdPattern.test(String(req.body.doctor_id || "").trim())
          ? await getAvailableSlots(String(req.body.doctor_id || "").trim(), String(req.body.appointment_date || "").trim())
          : [],
        specializationOptions,
        urgencyOptions,
        message: getMongooseErrorMessage(err, "Please check the appointment details.")
      });
    }
    next(err);
  }
});

app.get("/check-status", ensureRole("user"), async (req, res, next) => {
  try {
    const records = await AppointmentDetail.find({ user_id: req.user._id })
      .sort({ createdAt: -1 })
      .populate("doctor_id")
      .lean();
    res.render("appointment/status", {
      title: "Check Status",
      records,
      viewerMode: "patient"
    });
  } catch (err) {
    next(err);
  }
});

app.get("/appointments/:id/receipt.pdf", ensureRole("admin", "user"), async (req, res, next) => {
  try {
    const appointment = await AppointmentDetail.findById(req.params.id)
      .populate("user_id doctor_id approved_by")
      .lean();

    if (!appointment) {
      return redirectWithFlash(
        req,
        res,
        req.user.role === "admin" ? "/check-appointments" : "/check-status",
        "warning",
        "Appointment not found."
      );
    }

    const belongsToUser = String(appointment.user_id?._id || appointment.user_id) === String(req.user._id);
    if (req.user.role !== "admin" && !belongsToUser) {
      return redirectWithFlash(req, res, "/check-status", "warning", "You can only download your own appointment receipt.");
    }

    const receiptDocument = buildAppointmentReceiptDocument(appointment);
    const receiptBuffer = buildAppointmentReceiptPdf(receiptDocument);
    const patientName = appointment.full_name || getUserFullName(appointment.user_id) || "patient";
    const fileName = buildAppointmentReceiptFilename(appointment.appointment_code || appointment._id, patientName);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(receiptBuffer);
  } catch (err) {
    next(err);
  }
});

app.get("/check-appointments", ensureRole("admin", "doctor"), async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const doctorProfile = isAdmin ? null : await findDoctorByUserId(req.user._id);
    const records = isAdmin
      ? await AppointmentDetail.find({})
        .sort({ createdAt: -1 })
        .populate("user_id doctor_id")
        .lean()
      : doctorProfile
        ? await AppointmentDetail.find({ doctor_id: doctorProfile._id })
          .sort({ createdAt: -1 })
          .populate("user_id doctor_id")
          .lean()
        : [];
    const reviewSummary = doctorProfile
      ? records.reduce((summary, record) => {
        const status = String(record.status || "").trim().toLowerCase();
        summary.total += 1;
        if (status === "pending") summary.pending += 1;
        if (status === "accepted") summary.accepted += 1;
        if (status === "rejected") summary.rejected += 1;
        return summary;
      }, { total: 0, pending: 0, accepted: 0, rejected: 0 })
      : null;

    res.render("appointment/status", {
      title: isAdmin ? "Appointment Queue" : "Doctor Review Queue",
      records,
      adminMode: isAdmin,
      viewerMode: isAdmin ? "admin" : "doctor",
      doctorProfile,
      reviewSummary
    });
  } catch (err) {
    next(err);
  }
});

app.post("/check-appointments/:id/accept", ensureRole("admin", "doctor"), async (req, res, next) => {
  try {
    const appointment = await AppointmentDetail.findById(req.params.id).populate("doctor_id").lean();

    if (!appointment) {
      return redirectWithFlash(req, res, "/check-appointments", "warning", "Appointment not found.");
    }

    if (String(appointment.status || "").trim() !== "Pending") {
      return redirectWithFlash(req, res, "/check-appointments", "warning", "That appointment has already been reviewed.");
    }

    const reviewAccess = await canReviewAppointment(req.user, appointment);
    if (!reviewAccess.allowed) {
      return redirectWithFlash(req, res, "/check-appointments", "warning", reviewAccess.message);
    }

    const updatedAppointment = await AppointmentDetail.findByIdAndUpdate(
      req.params.id,
      {
        status: "Accepted",
        approved_by: req.user._id,
        approved_at: new Date()
      },
      {
        runValidators: true,
        new: true
      }
    )
      .populate("user_id doctor_id approved_by")
      .lean();

    await sendAppointmentDecisionNotifications(updatedAppointment, "approved");

    flashSuccess(req, "Appointment approved.");
    res.redirect("/check-appointments");
  } catch (err) {
    next(err);
  }
});

app.post("/check-appointments/:id/reject", ensureRole("admin", "doctor"), async (req, res, next) => {
  try {
    const appointment = await AppointmentDetail.findById(req.params.id).populate("doctor_id").lean();

    if (!appointment) {
      return redirectWithFlash(req, res, "/check-appointments", "warning", "Appointment not found.");
    }

    if (String(appointment.status || "").trim() !== "Pending") {
      return redirectWithFlash(req, res, "/check-appointments", "warning", "That appointment has already been reviewed.");
    }

    const reviewAccess = await canReviewAppointment(req.user, appointment);
    if (!reviewAccess.allowed) {
      return redirectWithFlash(req, res, "/check-appointments", "warning", reviewAccess.message);
    }

    const updatedAppointment = await AppointmentDetail.findByIdAndUpdate(
      req.params.id,
      {
        status: "Rejected",
        approved_by: req.user._id,
        approved_at: new Date()
      },
      {
        runValidators: true,
        new: true
      }
    )
      .populate("user_id doctor_id approved_by")
      .lean();

    await sendAppointmentDecisionNotifications(updatedAppointment, "rejected");

    flashSuccess(req, "Appointment rejected.");
    res.redirect("/check-appointments");
  } catch (err) {
    next(err);
  }
});

app.get("/status", (req, res) => {
  res.redirect(req.user?.role === "admin" || req.user?.role === "doctor" ? "/check-appointments" : "/check-status");
});

app.get("/appointments", (req, res) => {
  res.redirect(req.user?.role === "admin" || req.user?.role === "doctor" ? "/check-appointments" : "/check-status");
});

app.get("/bed-requests", ensureRole("doctor"), async (req, res, next) => {
  try {
    const context = await loadDoctorBedRequestContext({
      userId: req.user._id,
      appointmentId: String(req.query.appointment_id || "")
    });

    res.render("main/bedRequests", {
      title: "Bed Requests",
      ...context,
      message: String(req.query.message || "")
    });
  } catch (err) {
    next(err);
  }
});

app.post("/bed-requests", ensureRole("doctor"), async (req, res, next) => {
  const rawSubmission = {
    appointment_id: String(req.body.appointment_id || "").trim(),
    bed_category: String(req.body.bed_category || "").trim(),
    urgency_level: String(req.body.urgency_level || "").trim(),
    department: String(req.body.department || "").trim(),
    notes: String(req.body.notes || "").trim()
  };

  try {
    const validation = bedRequestSchema.validate(rawSubmission, {
      abortEarly: true,
      stripUnknown: true
    });

    const context = await loadDoctorBedRequestContext({
      userId: req.user._id,
      appointmentId: rawSubmission.appointment_id
    });

    const selectedAppointment = context.acceptedAppointments.find((record) => String(record._id) === rawSubmission.appointment_id) || null;

    if (validation.error) {
      return res.status(400).render("main/bedRequests", {
        title: "Bed Requests",
        ...context,
        selectedAppointment,
        formData: {
          ...context.formData,
          ...rawSubmission
        },
        requestAlert: "Please correct the highlighted bed request details.",
        requestAlertClass: "danger",
        message: getValidationMessage(validation.error, "Please check the bed request details.")
      });
    }

    if (!context.doctorProfile) {
      return res.status(400).render("main/bedRequests", {
        title: "Bed Requests",
        ...context,
        formData: {
          ...context.formData,
          ...rawSubmission
        },
        requestAlert: "No doctor profile found for this account.",
        requestAlertClass: "danger",
        message: "No doctor profile found for this account."
      });
    }

    if (!selectedAppointment) {
      return res.status(400).render("main/bedRequests", {
        title: "Bed Requests",
        ...context,
        formData: {
          ...context.formData,
          ...rawSubmission
        },
        requestAlert: "Please choose one of your accepted patients.",
        requestAlertClass: "danger",
        message: "Please choose one of your accepted patients."
      });
    }

    if (String(selectedAppointment.status) !== "Accepted") {
      return res.status(400).render("main/bedRequests", {
        title: "Bed Requests",
        ...context,
        selectedAppointment,
        formData: {
          ...context.formData,
          ...rawSubmission
        },
        requestAlert: "Only accepted patients can be sent for bed approval.",
        requestAlertClass: "danger",
        message: "Only accepted patients can be sent for bed approval."
      });
    }

    const existingRequest = await BedRequest.findOne({
      appointment_id: selectedAppointment._id,
      status: { $in: ["pending", "approved"] }
    }).lean();

    if (existingRequest) {
      return res.status(400).render("main/bedRequests", {
        title: "Bed Requests",
        ...context,
        selectedAppointment,
        formData: {
          ...context.formData,
          ...rawSubmission
        },
        requestAlert: "A pending or approved request already exists for this patient.",
        requestAlertClass: "warning",
        message: "A pending or approved request already exists for this patient."
      });
    }

    const selectedPatient = selectedAppointment.user_id || null;
    const submission = validation.value;

    await BedRequest.create({
      appointment_id: selectedAppointment._id,
      patient_user_id: selectedPatient?._id || selectedAppointment.user_id,
      patient_name: selectedAppointment.full_name,
      patient_email: selectedAppointment.email,
      patient_phone: selectedAppointment.phone,
      doctor_id: context.doctorProfile._id,
      doctor_name: context.doctorProfile.name || selectedAppointment.doctor_name || "Doctor",
      bed_category: submission.bed_category,
      urgency_level: submission.urgency_level,
      department: submission.department || selectedAppointment.department || context.doctorProfile.department,
      notes: submission.notes || selectedAppointment.symptoms || "",
      status: "pending",
      requested_by: req.user._id
    });

    flashSuccess(req, "Bed request sent for admin approval.");
    res.redirect(`/bed-requests?appointment_id=${selectedAppointment._id.toString()}`);
  } catch (err) {
    if (err?.name === "ValidationError" || err?.code === 11000) {
      const context = await loadDoctorBedRequestContext({
        userId: req.user._id,
        appointmentId: rawSubmission.appointment_id
      });
      const selectedAppointment = context.acceptedAppointments.find((record) => String(record._id) === rawSubmission.appointment_id) || null;

      return res.status(400).render("main/bedRequests", {
        title: "Bed Requests",
        ...context,
        selectedAppointment,
        formData: {
          ...context.formData,
          ...rawSubmission
        },
        requestAlert: "Please correct the highlighted bed request details.",
        requestAlertClass: "danger",
        message: getMongooseErrorMessage(err, "Please check the bed request details.")
      });
    }

    next(err);
  }
});

app.get("/bed-admissions", ensureRole("admin"), async (req, res, next) => {
  try {
    const bedCategory = normalizeBedCategory(req.query.bed_category, "icu");
    const search = normalizeSearchTerm(req.query.search);

    const [pendingRequestRecords, bedRecords] = await Promise.all([
      BedRequest.find({
        status: "pending",
        bed_category: bedCategory
      })
        .sort({ createdAt: -1 })
        .populate("appointment_id patient_user_id doctor_id requested_by resolved_by")
        .lean(),
      BedAdmission.find({ bed_category: bedCategory })
        .sort({ createdAt: -1 })
        .populate("patient_user_id recorded_by source_request_id approved_by")
        .lean()
    ]);

    const pendingRequests = search
      ? pendingRequestRecords.filter((record) => {
        const appointment = record.appointment_id && record.appointment_id.full_name ? record.appointment_id : null;
        const searchableText = buildSearchText(
          appointment?.full_name,
          appointment?.email,
          appointment?.phone,
          appointment?.appointment_date,
          appointment?.time_slot,
          record.patient_name,
          record.patient_email,
          record.patient_phone,
          record.doctor_name,
          record.department,
          record.notes,
          record.bed_category,
          record.urgency_level,
          appointment?.symptoms
        );
        return searchableText.includes(search);
      })
      : pendingRequestRecords;

    const recentAdmissions = search
      ? bedRecords.filter((record) => {
        const patientName = record.patient_user_id ? getUserFullName(record.patient_user_id) : "";
        const searchableText = buildSearchText(
          patientName,
          record.patient_name,
          record.patient_email,
          record.patient_phone,
          record.bed_assigned,
          record.department,
          record.status,
          record.source_request_id?.doctor_name || "",
          record.notes || ""
        );
        return searchableText.includes(search);
      })
      : bedRecords;

    const bedSummary = buildBedSummary(bedRecords);

    res.render("main/bedAdmissions", {
      title: "Bed Admissions",
      bedCategory,
      bedCategoryLabel: bedCategoryLabels[bedCategory] || "ICU",
      search,
      pendingRequests,
      recentAdmissions,
      bedSummary,
      pendingCount: pendingRequests.length,
      matchingCount: recentAdmissions.length,
      totalBeds: bedSummary ? bedSummary.totalBeds : 0,
      message: String(req.query.message || "")
    });
  } catch (err) {
    next(err);
  }
});

app.post("/bed-admissions/requests/:id/approve", ensureRole("admin"), async (req, res, next) => {
  try {
    const requestRecord = await BedRequest.findById(req.params.id)
      .populate("appointment_id patient_user_id doctor_id requested_by resolved_by")
      .lean();

    if (!requestRecord) {
      return redirectWithFlash(req, res, "/bed-admissions", "warning", "Bed request not found.");
    }

    if (String(requestRecord.status) !== "pending") {
      return redirectWithFlash(req, res, "/bed-admissions", "warning", "That bed request has already been handled.");
    }

    const latestAdmission = await getLatestBedAdmissionSnapshot(requestRecord.bed_category);
    const admissionPayload = buildAdmissionPayloadFromRequest(requestRecord, latestAdmission, req.user._id);

    if (admissionPayload?.error) {
      return redirectWithFlash(req, res, `/bed-admissions?bed_category=${normalizeBedCategory(requestRecord.bed_category)}&search=${encodeURIComponent(String(req.query.search || ""))}`, "warning", admissionPayload.error);
    }

    await BedAdmission.create(admissionPayload);
    await BedRequest.findByIdAndUpdate(requestRecord._id, {
      status: "approved",
      resolved_by: req.user._id,
      resolved_at: new Date()
    });

    flashSuccess(req, "Bed request approved and admission created.");
    res.redirect(`/bed-admissions?bed_category=${normalizeBedCategory(requestRecord.bed_category)}&search=${encodeURIComponent(String(req.query.search || ""))}`);
  } catch (err) {
    next(err);
  }
});

app.post("/bed-admissions/requests/:id/reject", ensureRole("admin"), async (req, res, next) => {
  try {
    const requestRecord = await BedRequest.findById(req.params.id).lean();

    if (!requestRecord) {
      return redirectWithFlash(req, res, "/bed-admissions", "warning", "Bed request not found.");
    }

    if (String(requestRecord.status) !== "pending") {
      return redirectWithFlash(req, res, "/bed-admissions", "warning", "That bed request has already been handled.");
    }

    await BedRequest.findByIdAndUpdate(requestRecord._id, {
      status: "rejected",
      resolved_by: req.user._id,
      resolved_at: new Date()
    });

    flashSuccess(req, "Bed request rejected.");
    res.redirect(`/bed-admissions?bed_category=${normalizeBedCategory(requestRecord.bed_category)}&search=${encodeURIComponent(String(req.query.search || ""))}`);
  } catch (err) {
    next(err);
  }
});

app.post("/bed-admissions", ensureRole("admin"), async (req, res, next) => {
  const rawSubmission = {
    patient_user_id: String(req.body.patient_user_id || "").trim(),
    patient_name: String(req.body.patient_name || "").trim(),
    patient_email: String(req.body.patient_email || "").trim(),
    patient_phone: String(req.body.patient_phone || "").trim(),
    bed_category: String(req.body.bed_category || "").trim(),
    bed_required: String(req.body.bed_required || "").trim(),
    bed_assigned: String(req.body.bed_assigned || "").trim(),
    total_beds: String(req.body.total_beds || "").trim(),
    occupied_beds: String(req.body.occupied_beds || "").trim(),
    admissions_today: String(req.body.admissions_today || "").trim(),
    discharges_today: String(req.body.discharges_today || "").trim(),
    expected_discharges_next_days: String(req.body.expected_discharges_next_days || "").trim(),
    admission_date: String(req.body.admission_date || "").trim(),
    discharge_date: String(req.body.discharge_date || "").trim(),
    status: String(req.body.status || "admitted").trim(),
    urgency_level: String(req.body.urgency_level || "medium").trim(),
    department: String(req.body.department || "").trim(),
    notes: String(req.body.notes || "").trim(),
    recorded_by: String(req.user._id)
  };

  try {
    const validation = bedAdmissionSchema.validate(rawSubmission, {
      abortEarly: true,
      stripUnknown: true
    });

    const selectedPatient = await findUserById(rawSubmission.patient_user_id);
    const patients = await User.find({ role: "user" }).sort({ first_name: 1, last_name: 1 }).lean();
    const recentAdmissions = await BedAdmission.find({})
      .sort({ createdAt: -1 })
      .limit(8)
      .populate("patient_user_id recorded_by")
      .lean();
    const bedSummary = buildBedSummary(recentAdmissions);

    if (validation.error) {
      return res.status(400).render("main/bedAdmissions", {
        title: "Bed Admissions",
        patients,
        selectedPatient,
        formData: rawSubmission,
        recentAdmissions,
        bedSummary,
        bedAlert: "Please correct the highlighted bed admission details.",
        bedAlertClass: "danger",
        message: getValidationMessage(validation.error, "Please check the bed admission details.")
      });
    }

    if (!selectedPatient || selectedPatient.role !== "user") {
      return res.status(400).render("main/bedAdmissions", {
        title: "Bed Admissions",
        patients,
        selectedPatient: null,
        formData: rawSubmission,
        recentAdmissions,
        bedSummary,
        bedAlert: "Please choose a valid patient account.",
        bedAlertClass: "danger",
        message: "Please choose a valid patient account."
      });
    }

    const submission = validation.value;

    await BedAdmission.create({
      patient_user_id: selectedPatient._id,
      patient_name: submission.patient_name,
      patient_email: submission.patient_email,
      patient_phone: submission.patient_phone,
      bed_category: submission.bed_category,
      bed_required: submission.bed_required,
      bed_assigned: submission.bed_assigned || undefined,
      total_beds: submission.total_beds,
      occupied_beds: submission.occupied_beds,
      admissions_today: submission.admissions_today,
      discharges_today: submission.discharges_today,
      expected_discharges_next_days: submission.expected_discharges_next_days,
      admission_date: submission.admission_date,
      discharge_date: submission.discharge_date || undefined,
      status: submission.status,
      urgency_level: submission.urgency_level,
      department: submission.department || undefined,
      notes: submission.notes || undefined,
      recorded_by: req.user._id
    });

    flashSuccess(req, "Bed admission saved.");
    res.redirect(`/bed-admissions?patient_user_id=${selectedPatient._id.toString()}`);
  } catch (err) {
    if (err?.name === "ValidationError" || err?.code === 11000) {
      return res.status(400).render("main/bedAdmissions", {
        title: "Bed Admissions",
        patients,
        selectedPatient,
        formData: rawSubmission,
        recentAdmissions,
        bedSummary,
        bedAlert: "Please correct the highlighted bed admission details.",
        bedAlertClass: "danger",
        message: getMongooseErrorMessage(err, "Please check the bed admission details.")
      });
    }
    next(err);
  }
});

app.get("/staff-records", ensureRole("admin"), async (req, res, next) => {
  try {
    const context = await loadStaffRosterContext({
      doctorId: String(req.query.doctor_id || "").trim(),
      search: String(req.query.search || "")
    });

    res.render("main/staffRecords", {
      title: "Staff Records",
      ...context,
      search: String(req.query.search || ""),
      message: String(req.query.message || "")
    });
  } catch (err) {
    next(err);
  }
});

app.post("/staff-records", ensureRole("admin"), async (req, res, next) => {
  const rawSubmission = {
    doctor_id: String(req.body.doctor_id || "").trim(),
    active: String(req.body.active || "true").trim(),
    department: String(req.body.department || "").trim(),
    hospital_start_time: String(req.body.hospital_start_time || "").trim(),
    hospital_end_time: String(req.body.hospital_end_time || "").trim(),
    availability_days: Array.isArray(req.body.availability_days)
      ? req.body.availability_days
      : req.body.availability_days
        ? [req.body.availability_days]
        : [],
    doctor_bio: String(req.body.doctor_bio || "").trim()
  };

  try {
    const validation = doctorRosterSchema.validate(rawSubmission, {
      abortEarly: true,
      stripUnknown: true
    });

    const context = await loadStaffRosterContext({
      doctorId: rawSubmission.doctor_id,
      search: String(req.body.search || "")
    });

    const selectedDoctorRow = context.doctorRows.find((record) => String(record.doctor_id) === rawSubmission.doctor_id) || context.selectedDoctorRow || null;

    if (validation.error) {
      return res.status(400).render("main/staffRecords", {
        title: "Staff Records",
        ...context,
        selectedDoctorRow,
        search: String(req.body.search || ""),
        formData: {
          ...context.formData,
          ...rawSubmission,
          active: rawSubmission.active === "true" ? "true" : "false"
        },
        staffAlert: "Please correct the highlighted doctor roster details.",
        staffAlertClass: "danger",
        message: getValidationMessage(validation.error, "Please check the doctor roster details.")
      });
    }

    if (!selectedDoctorRow) {
      return res.status(400).render("main/staffRecords", {
        title: "Staff Records",
        ...context,
        selectedDoctorRow: null,
        search: String(req.body.search || ""),
        formData: {
          ...context.formData,
          ...rawSubmission,
          active: rawSubmission.active === "true" ? "true" : "false"
        },
        staffAlert: "Please choose a valid doctor account.",
        staffAlertClass: "danger",
        message: "Please choose a valid doctor account."
      });
    }

    const submission = validation.value;
    const doctorProfile = await Doctor.findById(submission.doctor_id);

    if (!doctorProfile) {
      return res.status(400).render("main/staffRecords", {
        title: "Staff Records",
        ...context,
        selectedDoctorRow,
        search: String(req.body.search || ""),
        formData: {
          ...context.formData,
          ...rawSubmission,
          active: rawSubmission.active === "true" ? "true" : "false"
        },
        staffAlert: "Doctor profile not found.",
        staffAlertClass: "danger",
        message: "Doctor profile not found."
      });
    }

    const generatedTimeSlots = buildTimeSlots(
      submission.hospital_start_time,
      submission.hospital_end_time,
      doctorProfile.slot_duration_minutes || 30
    );

    if (!generatedTimeSlots.length) {
      return res.status(400).render("main/staffRecords", {
        title: "Staff Records",
        ...context,
        selectedDoctorRow,
        search: String(req.body.search || ""),
        formData: {
          ...context.formData,
          ...rawSubmission,
          active: rawSubmission.active === "true" ? "true" : "false"
        },
        staffAlert: "Hospital end time must be after the start time.",
        staffAlertClass: "danger",
        message: "Hospital end time must be after the start time."
      });
    }

    doctorProfile.active = submission.active;
    doctorProfile.department = submission.department;
    doctorProfile.hospital_start_time = submission.hospital_start_time;
    doctorProfile.hospital_end_time = submission.hospital_end_time;
    doctorProfile.availability_days = submission.availability_days;
    doctorProfile.doctor_bio = submission.doctor_bio || doctorProfile.doctor_bio;
    doctorProfile.time_slots = generatedTimeSlots;

    await doctorProfile.save();

    flashSuccess(req, `${doctorProfile.name || "Doctor"} roster updated.`);
    res.redirect(`/staff-records?doctor_id=${doctorProfile._id.toString()}&search=${encodeURIComponent(String(req.body.search || ""))}`);
  } catch (err) {
    if (err?.name === "ValidationError" || err?.code === 11000) {
      const context = await loadStaffRosterContext({
        doctorId: rawSubmission.doctor_id,
        search: String(req.body.search || "")
      });
      const selectedDoctorRow = context.doctorRows.find((record) => String(record.doctor_id) === rawSubmission.doctor_id) || context.selectedDoctorRow || null;

      return res.status(400).render("main/staffRecords", {
        title: "Staff Records",
        ...context,
        selectedDoctorRow,
        search: String(req.body.search || ""),
        formData: {
          ...context.formData,
          ...rawSubmission,
          active: rawSubmission.active === "true" ? "true" : "false"
        },
        staffAlert: "Please correct the highlighted doctor roster details.",
        staffAlertClass: "danger",
        message: getMongooseErrorMessage(err, "Please check the doctor roster details.")
      });
    }

    next(err);
  }
});

app.get("/dashboard", ensureRole("admin", "doctor"), async (req, res, next) => {
  try {
    if (req.user.role === "doctor") {
      const doctorProfile = await findDoctorByUserId(req.user._id);
      const assignedAppointments = doctorProfile
        ? await AppointmentDetail.find({ doctor_id: doctorProfile._id })
          .sort({ createdAt: -1 })
          .populate("user_id doctor_id")
          .lean()
        : [];
      const appointmentNotifications = doctorProfile
        ? await AppointmentNotification.find({ recipient_role: "doctor", recipient_user_id: req.user._id })
          .sort({ createdAt: -1 })
          .limit(6)
          .lean()
        : [];
      const pendingAppointmentCount = assignedAppointments.filter((record) => String(record.status || "").trim() === "Pending").length;
      const acceptedCount = assignedAppointments.filter((record) => String(record.status || "").trim() === "Accepted").length;
      const rejectedCount = assignedAppointments.filter((record) => String(record.status || "").trim() === "Rejected").length;
      const assignedCount = assignedAppointments.length;
      const availabilityDaysCount = doctorProfile ? (doctorProfile.availability_days || []).length : 0;
      const workloadPerDay = availabilityDaysCount > 0
        ? Math.ceil(assignedCount / availabilityDaysCount)
        : assignedCount;
      const weeklySchedule = buildWeeklyDoctorSchedule(doctorProfile);

      return res.render("main/doctorDashboard", {
        title: "Dashboard",
        profile: {
          fullName: getUserFullName(req.user),
          email: req.user.email,
          role: req.user.role,
          roleLabel: roleLabels[req.user.role] || "Doctor"
        },
        doctorProfile,
        assignedAppointments,
        assignedCount,
        acceptedCount,
        pendingAppointmentCount,
        rejectedCount,
        availabilityDaysCount,
        workloadPerDay,
        appointmentNotifications,
        weeklySchedule
      });
    }

    const [
      patientCount,
      appointmentCount,
      pendingCount,
      acceptedCount,
      rejectedCount,
      highUrgencyAppointmentCount,
      recentAppointments,
      bedRecords,
      doctorCount,
      activeDoctorCount,
      recentBedRequests,
      bedRequestCount,
      bedRequestPendingCount,
      bedRequestApprovedCount,
      bedRequestRejectedCount,
      highUrgencyBedRequestCount,
      staffContext
    ] = await Promise.all([
      User.countDocuments({ role: "user" }),
      AppointmentDetail.countDocuments({}),
      AppointmentDetail.countDocuments({ status: "Pending" }),
      AppointmentDetail.countDocuments({ status: "Accepted" }),
      AppointmentDetail.countDocuments({ status: "Rejected" }),
      AppointmentDetail.countDocuments({ urgency_level: "high" }),
      AppointmentDetail.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("doctor_id", "name department")
        .lean(),
      BedAdmission.find({}).sort({ createdAt: -1 }).limit(6).lean(),
      Doctor.countDocuments({}),
      Doctor.countDocuments({ active: true }),
      BedRequest.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("doctor_id", "name department")
        .lean(),
      BedRequest.countDocuments({}),
      BedRequest.countDocuments({ status: "pending" }),
      BedRequest.countDocuments({ status: "approved" }),
      BedRequest.countDocuments({ status: "rejected" }),
      BedRequest.countDocuments({ urgency_level: "high" }),
      loadStaffRosterContext()
    ]);

    const bedSummary = buildBedSummary(bedRecords);
    const doctorRows = Array.isArray(staffContext?.doctorRows) ? staffContext.doctorRows.slice(0, 5) : [];
    const doctorAppointmentLoad = pendingCount + acceptedCount;
    const doctorWorkloadAverage = activeDoctorCount > 0
      ? Math.ceil(doctorAppointmentLoad / activeDoctorCount)
      : doctorAppointmentLoad;
    const doctorAvailabilityPct = doctorCount > 0
      ? Math.round((activeDoctorCount / doctorCount) * 100)
      : 0;
    const appointmentApprovalRate = appointmentCount > 0
      ? Math.round((acceptedCount / appointmentCount) * 100)
      : 0;
    const appointmentRejectionRate = appointmentCount > 0
      ? Math.round((rejectedCount / appointmentCount) * 100)
      : 0;
    const appointmentPendingRate = appointmentCount > 0
      ? Math.round((pendingCount / appointmentCount) * 100)
      : 0;
    const staffSummary = staffContext?.staffSummary || null;
    const staffCoveragePct = staffSummary?.coveragePct || 0;
    const staffActiveCount = staffSummary?.activeStaff || 0;
    const staffTotalCount = staffSummary?.totalStaff || 0;
    const bedRequestPendingRate = bedRequestCount > 0
      ? Math.round((bedRequestPendingCount / bedRequestCount) * 100)
      : 0;
    const bedRequestApprovedRate = bedRequestCount > 0
      ? Math.round((bedRequestApprovedCount / bedRequestCount) * 100)
      : 0;
    const bedRequestRejectedRate = bedRequestCount > 0
      ? Math.round((bedRequestRejectedCount / bedRequestCount) * 100)
      : 0;

    res.render("main/adminDashboard", {
      title: "Dashboard",
      patientCount,
      appointmentCount,
      pendingCount,
      acceptedCount,
      rejectedCount,
      highUrgencyAppointmentCount,
      recentAppointments,
      bedSummary,
      bedRecords,
      recentBedRequests,
      bedRequestCount,
      bedRequestPendingCount,
      bedRequestApprovedCount,
      bedRequestRejectedCount,
      highUrgencyBedRequestCount,
      appointmentApprovalRate,
      appointmentRejectionRate,
      appointmentPendingRate,
      doctorCount,
      activeDoctorCount,
      doctorAvailabilityPct,
      doctorAppointmentLoad,
      doctorWorkloadAverage,
      staffSummary,
      staffCoveragePct,
      staffActiveCount,
      staffTotalCount,
      doctorRows,
      bedRequestPendingRate,
      bedRequestApprovedRate,
      bedRequestRejectedRate,
      profile: {
        fullName: getUserFullName(req.user),
        email: req.user.email,
        role: req.user.role,
        roleLabel: roleLabels[req.user.role] || "Admin"
      }
    });
  } catch (err) {
    next(err);
  }
});

app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }

    flashSuccess(req, "You have been logged out.");
    res.redirect("/");
  });
});

app.get("/auth/google", (req, res, next) => {
  if (!googleConfigured) {
    return redirectWithFlash(req, res, "/login", "warning", "Google authentication is not configured.");
  }

  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

app.get("/auth/google/callback", (req, res, next) => {
  if (!googleConfigured) {
    return redirectWithFlash(req, res, "/login", "warning", "Google authentication is not configured.");
  }

  passport.authenticate("google", (err, user) => {
    if (err) {
      return next(err);
    }

    if (!user) {
      return redirectWithFlash(req, res, "/login", "danger", "Google sign-in failed.");
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return next(loginErr);
      }

      flashSuccess(req, "Signed in with Google.");
      res.redirect("/");
    });
  })(req, res, next);
});

app.get("/reset", async (req, res, next) => {
  try {
    await Promise.all([
      User.deleteMany({}),
      AppointmentDetail.deleteMany({}),
      AppointmentNotification.deleteMany({}),
      BedAdmission.deleteMany({}),
      BedRequest.deleteMany({}),
      Doctor.deleteMany({})
    ]);
    await seedDoctors();
    await migrateDoctorProfiles();
    await seedBedAdmissions({ force: true });
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});
*/

app.use((req, res) => {
  res.status(404).render("includes/pagenotfound");
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Something went wrong.");
});

async function startServer() {
  try {
    await connectDatabase();
    await seedDoctors();
    await migrateDoctorProfiles();
    await seedBedAdmissions();
    await migrateAppointmentReferences();
    await ensureAppointmentSlotIndex();
    console.log("Connected to MongoDB database cortex-connect.");
    app.listen(port, () => {
      console.log(`CortexConnect server running on http://localhost:${port}`);
    });
  } catch (err) {
    console.error("MongoDB connection failed.");
    console.error(err);
    process.exit(1);
  }
}

module.exports = { app, startServer };

