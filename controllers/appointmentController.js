const express = require("express");

const Doctor = require("../models/doctor");
const AppointmentDetail = require("../models/appointmentDetail");

const { buildAppointmentReceiptPdf, buildAppointmentReceiptFilename } = require("../utils/pdfReceipt");

module.exports = function createAppointmentController(deps = {}) {
  const router = express.Router();

  const {
    auth = {},
    helpers = {},
    options = {},
    schemas = {}
  } = deps;

  const {
    ensureRole
  } = auth;

  const {
    getUserFullName,
    getValidationMessage,
    getMongooseErrorMessage,
    getTodayDateString,
    getWeekdayName,
    buildTimeSlots,
    getAppointmentStatusLabel,
    getUrgencyLabel,
    buildAppointmentCode,
    buildAppointmentReceiptDocument,
    createAppointmentNotification,
    sendAppointmentDecisionNotifications,
    canReviewAppointment,
    findDoctorByUserId,
    getAvailableSlots,
    buildWeeklyDoctorSchedule,
    normalizeSearchTerm,
    buildSearchText,
    flashSuccess,
    redirectWithFlash,
    isDuplicateAppointmentSlotError
  } = helpers;

  const {
    specializationOptions = [],
    urgencyOptions = [],
    specializationLabels = {}
  } = options;

  const { appointmentSchema, objectIdPattern } = schemas;

  const renderAppointmentForm = (res, payload) => {
    res.status(payload.statusCode || 200).render("appointment/form", {
      title: "Appointment",
      formData: payload.formData,
      selectedDoctor: payload.selectedDoctor,
      availableSlots: payload.availableSlots || [],
      specializationOptions,
      urgencyOptions,
      message: payload.message || ""
    });
  };

  router.get("/doctors", ensureRole("user"), async (req, res, next) => {
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

  router.get("/appointment", ensureRole("user"), async (req, res, next) => {
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

  router.post("/appointment", ensureRole("user"), async (req, res, next) => {
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
        return renderAppointmentForm(res, {
          statusCode: 400,
          formData: req.body,
          selectedDoctor: null,
          availableSlots: [],
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
        return renderAppointmentForm(res, {
          statusCode: 400,
          formData: req.body,
          selectedDoctor,
          availableSlots: selectedDoctor ? await getAvailableSlots(rawSubmission.doctor_id, rawSubmission.appointment_date) : [],
          message: getValidationMessage(validation.error, "Please check the appointment details.")
        });
      }

      const submission = validation.value;
      const fullName = getUserFullName(req.user);
      const email = String(req.user.email || submission.email || "").trim();

      if (!selectedDoctor) {
        return renderAppointmentForm(res, {
          statusCode: 400,
          formData: submission,
          selectedDoctor: null,
          availableSlots: [],
          message: "Please select a doctor first."
        });
      }

      if (selectedDoctor.active === false) {
        return renderAppointmentForm(res, {
          statusCode: 400,
          formData: submission,
          selectedDoctor,
          availableSlots: [],
          message: "Selected doctor is not accepting appointments right now."
        });
      }

      const availableSlots = await getAvailableSlots(submission.doctor_id, submission.appointment_date);

      if (selectedDoctor.specialization !== submission.specialization) {
        return renderAppointmentForm(res, {
          statusCode: 400,
          formData: submission,
          selectedDoctor,
          availableSlots,
          message: "Doctor specialization does not match your selection."
        });
      }

      if (submission.appointment_date < getTodayDateString()) {
        return renderAppointmentForm(res, {
          statusCode: 400,
          formData: submission,
          selectedDoctor,
          availableSlots,
          message: "Appointment date cannot be in the past."
        });
      }

      const weekday = getWeekdayName(submission.appointment_date);
      if (selectedDoctor.availability_days?.length && !selectedDoctor.availability_days.includes(weekday)) {
        return renderAppointmentForm(res, {
          statusCode: 400,
          formData: submission,
          selectedDoctor,
          availableSlots,
          message: "The selected doctor is not available on that date."
        });
      }

      if (!availableSlots.includes(submission.time_slot)) {
        return renderAppointmentForm(res, {
          statusCode: 400,
          formData: submission,
          selectedDoctor,
          availableSlots,
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
        const duplicateMessage = isDuplicateAppointmentSlotError?.(err)
          ? "That doctor and time slot combination is already booked."
          : getMongooseErrorMessage(err, "Unable to create this appointment because a duplicate record exists.");

        return renderAppointmentForm(res, {
          statusCode: 400,
          formData: req.body,
          selectedDoctor,
          availableSlots: selectedDoctor
            ? await getAvailableSlots(String(req.body.doctor_id || "").trim(), String(req.body.appointment_date || "").trim())
            : [],
          message: duplicateMessage
        });
      }
      if (err?.name === "ValidationError") {
        return renderAppointmentForm(res, {
          statusCode: 400,
          formData: req.body,
          selectedDoctor: objectIdPattern.test(String(req.body.doctor_id || "").trim())
            ? await Doctor.findById(String(req.body.doctor_id || "").trim()).lean()
            : null,
          availableSlots: objectIdPattern.test(String(req.body.doctor_id || "").trim())
            ? await getAvailableSlots(String(req.body.doctor_id || "").trim(), String(req.body.appointment_date || "").trim())
            : [],
          message: getMongooseErrorMessage(err, "Please check the appointment details.")
        });
      }
      next(err);
    }
  });

  router.get("/check-status", ensureRole("user"), async (req, res, next) => {
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

  router.get("/appointments/:id/receipt.pdf", ensureRole("admin", "user"), async (req, res, next) => {
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

  router.get("/check-appointments", ensureRole("admin", "doctor"), async (req, res, next) => {
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

  router.post("/check-appointments/:id/accept", ensureRole("admin", "doctor"), async (req, res, next) => {
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

  router.post("/check-appointments/:id/reject", ensureRole("admin", "doctor"), async (req, res, next) => {
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

  router.get("/status", (req, res) => {
    res.redirect(req.user?.role === "admin" || req.user?.role === "doctor" ? "/check-appointments" : "/check-status");
  });

  router.get("/appointments", (req, res) => {
    res.redirect(req.user?.role === "admin" || req.user?.role === "doctor" ? "/check-appointments" : "/check-status");
  });

  return router;
};
