/**
 * Controller for managing user-specific operations.
 */
const logger = require('../utils/logger');
const _User = require('../models/User.model');

const getProfile = async (req, res, next) => {
  try {
    const { id } = req.user;
    // TODO: Fetch profile logic
    res.status(200).json({ id, username: 'player' });
  } catch (error) {
    next(error);
  }
};

const createProfile = async (req, res, next) => {
  try {
    const { walletAddress } = req.body;
    logger.info(`Creating profile for wallet: ${walletAddress}`);
    // TODO: Persistence logic
    res.status(201).json({ success: true });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfile,
  createProfile,
};
