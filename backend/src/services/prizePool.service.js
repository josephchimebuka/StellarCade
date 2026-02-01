/**
 * Logic for interacting with the Prize Pool contract.
 */
const logger = require('../utils/logger');

const allocatePrizes = async (poolId, _recipients) => {
  logger.info(`Allocating prizes for pool ${poolId}`);
  // TODO: Multi-send interaction with Prize Pool contract
  return { status: 'success' };
};

module.exports = {
  allocatePrizes,
};
