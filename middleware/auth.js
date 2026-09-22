function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.status(403).render("error", { message: "You do not have access to this page.", user: req.session.user || null });
    }
    next();
  };
}

// Makes req.session.user available in every EJS view as `user`
function injectUser(req, res, next) {
  res.locals.user = req.session.user || null;
  next();
}

module.exports = { requireLogin, requireRole, injectUser };
