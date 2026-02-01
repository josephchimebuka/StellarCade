/**
 * Utility helpers for various backend tasks.
 */
const _logger = require('./logger');

/**
 * Validates a Stellar public key (G... address).
 * @param {string} address
 * @returns {boolean}
 */
const isValidStellarAddress = (address) => {
  // Simple check for skeleton
  return /^G[A-Z2-7]{55}$/.test(address);
};

module.exports = {
  isValidStellarAddress,
};
