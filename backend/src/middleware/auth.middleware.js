/**
 * Middleware for JWT authentication.
 */
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const authMiddleware = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  if (!process.env.JWT_SECRET) {
    logger.error('JWT_SECRET is not configured in environment');
    return res.status(500).json({ message: 'Internal server error' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    });
    req.user = decoded;
    next();
  } catch (error) {
    logger.warn(`Invalid JWT attempt from ${req.ip}`);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

module.exports = authMiddleware;
