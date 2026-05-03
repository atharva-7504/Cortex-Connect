const express = require("express");

const Doctor = require("../models/doctor");

module.exports = function createStaffController(deps = {}) {
  const router = express.Router();

  const {
    auth = {},
    helpers = {},
    schemas = {}
  } = deps;

  const { ensureRole } = auth;

  const {
    loadStaffRosterContext,
    buildTimeSlots,
    getValidationMessage,
    getMongooseErrorMessage,
    flashSuccess
  } = helpers;

  const { doctorRosterSchema } = schemas;

  router.get("/staff-records", ensureRole("admin"), async (req, res, next) => {
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

  router.post("/staff-records", ensureRole("admin"), async (req, res, next) => {
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

  return router;
};
