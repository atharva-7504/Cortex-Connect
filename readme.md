<img width="250" height="230" align="left" alt="logo" src="https://github.com/user-attachments/assets/f7610caa-10f5-4790-acf0-b37940fdf9e1" />
<div align="center">
 
### Cortex-Connect

--- 

A Hospital Management & Appointment Booking System designed to streamline patient appointments, doctor scheduling, hospital resource management, and administrative operations.

🌐 **Live Demo:** https://cortex-connect.onrender.com

📂 **Repository:** https://github.com/atharva-7504/Cortex-Connect

</div>




# 📖 About The Project

Cortex Connect is a comprehensive Hospital Management and Appointment Booking Platform built using the MERN Stack. The platform digitizes and streamlines hospital operations by connecting patients, doctors, and administrators within a centralized ecosystem.

Patients can easily schedule appointments with doctors based on their specialization and department. Once an appointment is submitted, it is reviewed and approved by the administrator. Doctors are notified about upcoming appointments and patient queues, enabling better schedule management.

Beyond appointment handling, the platform also provides hospital administration tools such as bed allocation, staff management, admission tracking, and analytical dashboards that offer valuable insights into hospital resources and patient flow.

The goal of Cortex Connect is to reduce manual paperwork, improve operational efficiency, and provide a modern healthcare management experience.

---

## ✨ Key Features

### 👤 Patient Portal

- Secure Registration & Login
- Book Appointments with Doctors
- Track Appointment Status
- Receive Appointment Confirmations
- Manage Personal Information

### 👨‍⚕️ Doctor Module

- Manage Availability & Schedules
- Monitor Patient Queue
- View Assigned Appointments
- Access Patient Information

### 👨‍💼 Admin Module

- Approve or Reject Appointments
- Manage Staff Records
- Allocate Hospital Beds
- Monitor Resources & Admissions
- Access Analytics Dashboard

### 📊 Analytics Dashboard

- Total Patients
- Total Appointments
- Active Doctors
- Bed Occupancy Statistics
- Resource Utilization Reports

---

## 👥 User Roles

| Role | Responsibilities |
|--------|------------------|
| **Patient** | Book appointments, track status, receive confirmations |
| **Doctor** | Manage appointments, monitor patient queue, review patient details |
| **Administrator** | Manage appointments, staff records, bed allocation, analytics |

---

## 🔄 Workflow

```text
Patient Registration/Login
            │
            ▼
      Book Appointment
            │
            ▼
 Appointment Request Created
            │
            ▼
     Admin Verification
            │
      ┌─────┴─────┐
      │           │
   Approved    Rejected
      │
      ▼
 Doctor Notified
      │
      ▼
 Patient Added To Queue
      │
      ▼
 Consultation
```

### Bed Admission Workflow

```text
Doctor Recommends Admission
            │
            ▼
      Bed Request Created
            │
            ▼
     Admin Reviews Request
            │
            ▼
        Bed Allocated
            │
            ▼
      Patient Admission
```

📄 **Detailed Workflow:**  
[System Workflow PDF](https://github.com/user-attachments/files/28554056/SytemWorkflow.pdf)

---

## 🗄️ Database Overview

The platform is built around six core collections:

- Users
- Doctors
- Appointment Details
- Bed Requests
- Bed Admissions
- Staff Records

These collections work together to manage appointments, admissions, hospital resources, and staff operations.

---

## 🔗 ER Diagram

<p align="center">
  <img src="https://github.com/user-attachments/assets/2c94c660-12cc-48de-9c45-d634bd72c5d6" width="85%">
</p>

---

## 💻 Tech Stack

| Category | Technologies |
|-----------|-------------|
| **Frontend** | React.js, JavaScript, HTML5, CSS3, Bootstrap |
| **Backend** | Node.js, Express.js |
| **Database** | MongoDB Atlas, Mongoose ODM |
| **Authentication** | JWT Authentication, Google OAuth |
| **Deployment** | Render, GitHub |

---

## 📸 Application Screenshots

<p align="center">
  <img src="https://github.com/user-attachments/assets/81be7c6a-1e89-493c-ab42-367918c52245" width="48%">
  <img src="https://github.com/user-attachments/assets/5403c8dc-c518-4425-b56b-f107594409b3" width="48%">
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/1e05a919-2d1a-499e-8dc7-eb64eba20978" width="48%">
  <img src="https://github.com/user-attachments/assets/f01e5779-64fe-4eed-ba2b-b86de1303ef1" width="48%">
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/115da387-65ce-4ab6-9a64-c179e26426f3" width="48%">
  <img src="https://github.com/user-attachments/assets/a08a9e90-3483-443f-a8ab-469eff0aa13a" width="48%">
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/5cfcd15d-feef-4705-951e-ab13acf6d01e" width="48%">
  <img src="https://github.com/user-attachments/assets/b5ee68ca-cafb-4aa0-af51-8d8da581e92f" width="48%">
</p>

---

## 🎯 Project Goal

To modernize hospital operations by bringing appointment scheduling, patient admissions, bed allocation, staff management, and analytics into a single centralized platform.

---

## 🚀 Future Enhancements

- Real-Time Notifications
- Doctor–Patient Chat
- Online Prescriptions
- Email & SMS Appointment Reminders
- Electronic Health Records (EHR)
- AI-Powered Appointment Recommendations
- Advanced Reporting & Analytics

---

## ❤️ Built With

**MongoDB • Express.js • React.js • Node.js**

Built to make healthcare management smarter, faster, and more accessible.
