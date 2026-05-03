const mongoose = require("mongoose");

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const phonePattern = /^[0-9]{10}$/;
const slotPattern = /^\d{2}:\d{2}\s(?:AM|PM)$/;

const appointmentDetailSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    appointment_code: {
      type: String,
      trim: true,
      unique: true,
      sparse: true
    },
    patient_type: {
      type: String,
      enum: ["new", "existing"],
      default: "existing"
    },
    full_name: {
      type: String,
      required: true,
      trim: true
    },
    age: {
      type: Number,
      min: 0,
      max: 120
    },
    date_of_birth: {
      type: String,
      match: datePattern
    },
    gender: {
      type: String,
      enum: ["male", "female", "other", "prefer_not_to_say"],
      default: "prefer_not_to_say"
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "")),
        message: "Please provide a valid email address."
      }
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: phonePattern
    },
    doctor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
    doctor_name: {
      type: String,
      required: true,
      trim: true
    },
    specialization: {
      type: String,
      enum: ["cardiology", "orthopedic", "general_physician"],
      required: true
    },
    appointment_date: {
      type: String,
      required: true,
      match: datePattern
    },
    time_slot: {
      type: String,
      required: true,
      match: slotPattern
    },
    symptoms: {
      type: String,
      required: true,
      trim: true
    },
    previous_visit: {
      type: Boolean,
      default: false
    },
    urgency_level: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "low"
    },
    consent: {
      type: Boolean,
      required: true,
      validate: {
        validator: (value) => value === true,
        message: "Consent must be confirmed."
      }
    },
    status: {
      type: String,
      enum: ["Pending", "Accepted", "Rejected"],
      default: "Pending"
    },
    approved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    approved_at: {
      type: Date
    }
  },
  {
    timestamps: true,
    collection: "appointment_details"
  }
);

appointmentDetailSchema.index(
  { doctor_id: 1, appointment_date: 1, time_slot: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["Pending", "Accepted"] }
    }
  }
);

module.exports = mongoose.model("AppointmentDetail", appointmentDetailSchema);
