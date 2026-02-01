const { createClient } = require('redis');
const logger = require('./logger');

const client = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

client.on('error', (err) => logger.error('Redis Client Error', err));
client.on('connect', () => logger.info('Redis connected successfully'));

const connectPromise = client.connect().catch((err) => {
  logger.error('Redis connection failed:', err);
});

module.exports = {
  client,
  connectPromise,
};
