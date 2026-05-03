const createPublicController = require("./publicController");
const createAppointmentController = require("./appointmentController");
const createBedController = require("./bedController");
const createStaffController = require("./staffController");
const createDashboardController = require("./dashboardController");

module.exports = function createControllers(deps = {}) {
  return {
    public: createPublicController(deps),
    appointment: createAppointmentController(deps),
    bed: createBedController(deps),
    staff: createStaffController(deps),
    dashboard: createDashboardController(deps)
  };
};
