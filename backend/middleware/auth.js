'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Verify JWT and attach user to req.user.
 * Returns 401 if missing/invalid, 403 if user no longer exists.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Fetch fresh from DB — ensures deleted/deactivated users are blocked
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(403).json({ success: false, error: 'User account not found.' });
    }
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ success: false, error: 'Invalid authentication token.' });
  }
}

/**
 * Role-level authorization middleware factory.
 * Usage: requireRole('teamadmin') — allows teamadmin and above.
 */
const ROLE_LEVELS = {
  platform_superadmin: 5,
  company_admin:       4,
  superadmin:          4,
  teamadmin:           3,
  senior:              2,
  junior:              1,
};

function requireRole(minRole) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated.' });
    }
    const userLevel = ROLE_LEVELS[req.user.role] || 0;
    const requiredLevel = ROLE_LEVELS[minRole] || 0;
    if (userLevel < requiredLevel) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions.' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, ROLE_LEVELS };
