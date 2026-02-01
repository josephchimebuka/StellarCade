const express = require('express');
const { getProfile, createProfile } = require('../controllers/users.controller');
const auth = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/profile', auth, getProfile);
router.post('/create', createProfile);

module.exports = router;
