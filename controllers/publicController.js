const express = require("express");

const User = require("../models/users");
const Doctor = require("../models/doctor");
const AppointmentDetail = require("../models/appointmentDetail");
const AppointmentNotification = require("../models/appointmentNotification");
const BedAdmission = require("../models/bedAdmission");
const BedRequest = require("../models/bedRequest");

module.exports = function createPublicController(deps = {}) {
  const router = express.Router();

  const {
    auth = {},
    helpers = {},
    options = {},
    schemas = {},
    services = {},
    env = {}
  } = deps;

  const {
    passport,
    googleConfigured,
    ensureAuthenticated
  } = auth;

  const {
    getUserFullName,
    normalizeRole,
    getValidationMessage,
    getMongooseErrorMessage,
    flashSuccess,
    redirectWithFlash,
    findDoctorByUserId,
    buildTimeSlots
  } = helpers;

  const {
    authRoleOptions = [],
    specializationOptions = [],
    weekdayOptions = [],
    roleLabels = {}
  } = options;

  const {
    seedDoctors,
    migrateDoctorProfiles,
    seedBedAdmissions
  } = services;

  const {
    loginSchema,
    signupSchema
  } = schemas;

  const { adminSignupCode = "" } = env;

  const renderAuthPage = (res, viewName, title, formData = {}, message = "") => {
    res.render(viewName, {
      title,
      authRoleOptions,
      specializationOptions,
      weekdayOptions,
      adminSignupCodeConfigured: Boolean(adminSignupCode),
      formData,
      message
    });
  };

  const buildProfileContext = (user) => {
    if (!user) {
      return null;
    }

    return {
      id: String(user._id),
      fullName: getUserFullName(user),
      username: String(user.username || ""),
      firstName: String(user.first_name || ""),
      lastName: String(user.last_name || ""),
      email: String(user.email || ""),
      role: String(user.role || "user"),
      roleLabel: roleLabels[user.role] || "Patient",
      provider: String(user.provider || "local")
    };
  };

  router.get("/", async (req, res, next) => {
    try {
      const doctorProfile = req.user?.role === "doctor"
        ? await findDoctorByUserId(req.user._id)
        : null;

      res.render("main/index", {
        title: "Home",
        message: String(req.query.message || ""),
        profile: buildProfileContext(req.user),
        doctorProfile
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/profile", ensureAuthenticated, async (req, res, next) => {
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

      res.render("main/profile", {
        title: "Profile",
        profile: {
          ...buildProfileContext(req.user),
          createdAt: req.user.createdAt ? new Date(req.user.createdAt).toLocaleString() : "-"
        },
        doctorProfile,
        recentAppointments
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/login", (req, res) => {
    renderAuthPage(res, "auth/login", "Login", {}, String(req.query.message || ""));
  });

  router.post("/login", (req, res, next) => {
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

  router.get("/signup", (req, res) => {
    renderAuthPage(res, "auth/signup", "Signup", {}, String(req.query.message || ""));
  });

  router.post("/signup", async (req, res, next) => {
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

  router.get("/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }

      flashSuccess(req, "You have been logged out.");
      res.redirect("/");
    });
  });

  router.get("/auth/google", (req, res, next) => {
    if (!googleConfigured) {
      return redirectWithFlash(req, res, "/login", "warning", "Google authentication is not configured.");
    }

    passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
  });

  router.get("/auth/google/callback", (req, res, next) => {
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

  router.get("/reset", async (req, res, next) => {
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

  return router;
};
