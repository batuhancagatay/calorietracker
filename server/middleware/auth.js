// Simple auth middleware - enforce single-user (Whoop) for now
// In production, implement proper user authentication

module.exports = (req, res, next) => {
  // Allow read-only GET requests without auth for /api/food-log/today
  if (req.method === 'GET' && req.path === '/today') {
    return next();
  }

  // Require session for state-changing operations
  if (!req.session) {
    return res.status(401).json({ error: 'unauthorized', message: 'Session required' });
  }

  next();
};
