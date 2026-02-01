/**
 * Business logic for Daily Trivia game.
 */
const logger = require('../utils/logger');

const submitTriviaAnswers = async (userId, _answers) => {
  logger.info(`Submitting trivia for user ${userId}`);
  // TODO: Validate answers
  // TODO: Score the round
  return { score: 8, correct: 8, total: 10 };
};

module.exports = {
  submitTriviaAnswers,
};
