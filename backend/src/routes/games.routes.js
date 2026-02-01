const express = require('express');
const { getGames, playSimpleGame } = require('../controllers/games.controller');
const auth = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', getGames);
router.post('/play', auth, playSimpleGame);

module.exports = router;
