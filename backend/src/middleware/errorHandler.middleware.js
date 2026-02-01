/**
 * Centralized error handling middleware.
 */
const logger = require('../utils/logger');

const errorHandlerMiddleware = (err, req, res, _next) => {
  logger.error(`${err.name}: ${err.message}`, { stack: err.stack });

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: {
      message,
      code: err.code || 'INTERNAL_ERROR',
      status: statusCode,
    },
  });
};

module.exports = errorHandlerMiddleware;
