const knex = require('knex');
const logger = require('./logger');

const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL || {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  pool: { min: 2, max: 10 },
});

db.raw('SELECT 1')
  .then(() => logger.info('PostgreSQL connected successfully'))
  .catch((err) => {
    logger.error('PostgreSQL connection failed:', err);
    process.exit(1);
  });

module.exports = db;
