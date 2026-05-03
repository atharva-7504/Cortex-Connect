const createAuthMiddleware = ({ redirectWithFlash }) => {
  const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
      return next();
    }

    return redirectWithFlash(req, res, "/login", "warning", "Please log in to continue.");
  };

  const ensureRole = (...roles) => (req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated() && roles.includes(req.user?.role)) {
      return next();
    }

    return redirectWithFlash(req, res, "/", "warning", "You do not have access to that page.");
  };

  return {
    ensureAuthenticated,
    ensureRole
  };
};

module.exports = {
  createAuthMiddleware
};
