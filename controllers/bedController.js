const express = require("express");

const User = require("../models/users");
const BedAdmission = require("../models/bedAdmission");
const BedRequest = require("../models/bedRequest");

module.exports = function createBedController(deps = {}) {
  const router = express.Router();

  const {
    auth = {},
    helpers = {},
    schemas = {},
    options = {}
  } = deps;

  const { ensureRole } = auth;

  const {
    loadDoctorBedRequestContext,
    getValidationMessage,
    getMongooseErrorMessage,
    buildBedSummary,
    normalizeBedCategory,
    normalizeSearchTerm,
    buildSearchText,
    getLatestBedAdmissionSnapshot,
    buildAdmissionPayloadFromRequest,
    flashSuccess,
    redirectWithFlash,
    findUserById,
    getUserFullName
  } = helpers;

  const {
    bedCategoryLabels = {}
  } = options;

  const { bedRequestSchema, bedAdmissionSchema } = schemas;

  router.get("/bed-requests", ensureRole("doctor"), async (req, res, next) => {
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

  router.post("/bed-requests", ensureRole("doctor"), async (req, res, next) => {
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

  router.get("/bed-admissions", ensureRole("admin"), async (req, res, next) => {
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

  router.post("/bed-admissions/requests/:id/approve", ensureRole("admin"), async (req, res, next) => {
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

  router.post("/bed-admissions/requests/:id/reject", ensureRole("admin"), async (req, res, next) => {
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

  router.post("/bed-admissions", ensureRole("admin"), async (req, res, next) => {
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

    let selectedPatient = null;
    let patients = [];
    let recentAdmissions = [];
    let bedSummary = null;

    try {
      const validation = bedAdmissionSchema.validate(rawSubmission, {
        abortEarly: true,
        stripUnknown: true
      });

      selectedPatient = await findUserById(rawSubmission.patient_user_id);
      patients = await User.find({ role: "user" }).sort({ first_name: 1, last_name: 1 }).lean();
      recentAdmissions = await BedAdmission.find({})
        .sort({ createdAt: -1 })
        .limit(8)
        .populate("patient_user_id recorded_by")
        .lean();
      bedSummary = buildBedSummary(recentAdmissions);

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

  return router;
};
