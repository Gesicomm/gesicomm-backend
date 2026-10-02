const express = require('express');
const router = express.Router();
const courierAuthController = require('../controllers/courierAuthController');
const { verificarCourierToken } = require('../middleware/autenticacionCourier');

router.post('/login', courierAuthController.login);
router.post('/logout', courierAuthController.logout);
router.get('/me', verificarCourierToken, courierAuthController.me);

module.exports = router;
