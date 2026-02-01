const StellarSdk = require('@stellar/stellar-sdk');
const logger = require('./logger'); // Changed _logger to logger as it's used
const _gameService = require('../services/game.service'); // Added this line

/**
 * Configure Stellar Server instance based on environment.
 */
const network = process.env.STELLAR_NETWORK || 'testnet';
const horizonUrl = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';

const server = new StellarSdk.Horizon.Server(horizonUrl);

logger.info(`Stellar SDK initialized for ${network} at ${horizonUrl}`);

/**
 * Helper to get Contract Client (Skeleton)
 */
const getContractClient = (contractId) => {
  // TODO: Add Soroban client initialization logic when SDK v12+ is integrated
  return {
    contractId,
    invoke: async (method, _args) => {
      logger.info(`Invoking ${method} on ${contractId}`);
      // Mock result
      return { status: 'pending' };
    },
  };
};

module.exports = {
  server,
  network,
  passphrase: process.env.NETWORK_PASSPHRASE,
  getContractClient,
};
