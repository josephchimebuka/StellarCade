/**
 * Controller for managing all game-related API requests.
 */
const logger = require('../utils/logger');
const _gameService = require('../services/game.service');

const getGames = async (req, res, next) => {
  try {
    // TODO: Fetch games from DB
    res.status(200).json({ games: [] });
  } catch (error) {
    next(error);
  }
};

const playSimpleGame = async (req, res, next) => {
  try {
    const { gameType, _amount, _choice } = req.body;
    logger.info(`User ${req.user.id} playing ${gameType}`);
    // TODO: Logic
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getGames,
  playSimpleGame,
};
