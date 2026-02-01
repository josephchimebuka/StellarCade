/**
 * Centralized model index for managing database interactions.
 */
const User = require('./User.model');
const Game = require('./Game.model');
const Transaction = require('./Transaction.model');

module.exports = {
  User,
  Game,
  Transaction,
};
