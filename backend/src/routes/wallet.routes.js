const express = require('express');
const { deposit, withdraw } = require('../controllers/wallet.controller');
const auth = require('../middleware/auth.middleware');

const { body } = require('express-validator');
const validate = require('../middleware/validation.middleware');

const router = express.Router();

const amountValidation = [
  body('amount')
    .isFloat({ min: 0.0000001 })
    .withMessage('Amount must be positive and greater than 0'),
];

router.post('/deposit', auth, amountValidation, validate, deposit);
router.post('/withdraw', auth, amountValidation, validate, withdraw);

module.exports = router;
