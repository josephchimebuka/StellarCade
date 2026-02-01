/**
 * seed-database.js
 * Populates the database with initial testing data.
 */
const db = require('../backend/src/config/database');
const logger = require('../backend/src/config/logger');

async function seed() {
  try {
    logger.info('Starting database seed...');

    // TODO: Insert sample users
    // const [userId] = await db('users').insert({ 
    //   wallet_address: 'GB...', 
    //   balance: 1000 
    // }).returning('id');

    // TODO: Insert sample games
    // await db('games').insert({
    //   user_id: userId,
    //   game_type: 'coin-flip',
    //   bet_amount: 10,
    //   result: 'win',
    //   payout: 19.5
    // });

    logger.info('Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed:', error);
    process.exit(1);
  }
}

// seed();
console.log('Seed script skeleton ready.');
