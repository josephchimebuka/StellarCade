const express = require('express');
const gamesRoutes = require('./games.routes');
const usersRoutes = require('./users.routes');
const walletRoutes = require('./wallet.routes');

const router = express.Router();

router.use('/games', gamesRoutes);
router.use('/users', usersRoutes);
router.use('/wallet', walletRoutes);

module.exports = router;
