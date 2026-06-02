const express = require("express");

const User = require("../models/users");
const Doctor = require("../models/doctor");
const AppointmentDetail = require("../models/appointmentDetail");
const AppointmentNotification = require("../models/appointmentNotification");
const BedAdmission = require("../models/bedAdmission");
const BedRequest = require("../models/bedRequest");

module.exports = function createDashboardController(deps = {}) {
  const router = express.Router();

  const {
    auth = {},
    helpers = {},
    options = {}
  } = deps;

  const { ensureRole } = auth;

  const {
    getUserFullName,
    findDoctorByUserId,
    buildWeeklyDoctorSchedule,
    buildBedSummary,
    loadStaffRosterContext
  } = helpers;

  const {
    roleLabels = {}
  } = options;

  router.get("/dashboard", ensureRole("admin", "doctor"), async (req, res, next) => {
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

  return router;
};
