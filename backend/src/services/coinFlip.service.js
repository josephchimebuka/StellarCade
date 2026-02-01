/**
 * Business logic for the Coin Flip game.
 */
const logger = require('../utils/logger');

const playCoinFlip = async (userId, betAmount, side) => {
  logger.info(`Playing Coin Flip: User ${userId}, Bet ${betAmount}, Side ${side}`);
  // TODO: Interact with Soroban CoinFlip contract
  // TODO: Calculate outcome and record in DB
  return { result: 'heads', win: side === 'heads' };
};

module.exports = {
  playCoinFlip,
};
