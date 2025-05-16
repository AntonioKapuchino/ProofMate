const express = require('express');
const router = express.Router();
const { 
    register,
    login,
    logout,
    getMe,
    forgotPassword,
    resetPassword,
    verifyEmail
} = require('../controllers/auth');

const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.get('/logout', logout);
router.get('/me', protect, getMe);
router.post('/forgotpassword', forgotPassword);
router.put('/resetpassword/:resettoken', resetPassword);
router.get('/verifyemail/:verificationtoken', verifyEmail);

module.exports = router; 