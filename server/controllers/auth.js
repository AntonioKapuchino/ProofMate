const crypto = require('crypto');
const ErrorResponse = require('../utils/errorResponse');
const sendEmail = require('../utils/sendEmail');
const User = require('../models/User');

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res, next) => {
    try {
        const { name, email, password, role, institution } = req.body;
        
        // Check if role is valid
        if (role && !['student', 'teacher'].includes(role)) {
            return next(new ErrorResponse('Invalid role', 400));
        }
        
        // Check if institution is provided for teacher
        if (role === 'teacher' && !institution) {
            return next(new ErrorResponse('Institution is required for teachers', 400));
        }
        
        // Create user
        const user = await User.create({
            name,
            email,
            password,
            role,
            institution
        });
        
        // Generate email verification token
        const verificationToken = user.generateEmailVerificationToken();
        
        await user.save({ validateBeforeSave: false });
        
        // Create verification URL
        const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;
        
        const message = `
            <h1>Email Verification</h1>
            <p>Thank you for registering with ProofMate. Please verify your email by clicking the link below:</p>
            <a href="${verificationUrl}" target="_blank">Verify Email</a>
        `;
        
        try {
            await sendEmail({
                to: user.email,
                subject: 'ProofMate - Email Verification',
                html: message
            });
            
            sendTokenResponse(user, 200, res);
        } catch (err) {
            console.log(err);
            user.emailVerificationToken = undefined;
            user.emailVerificationTokenExpire = undefined;
            
            await user.save({ validateBeforeSave: false });
            
            return next(new ErrorResponse('Email could not be sent', 500));
        }
    } catch (err) {
        next(err);
    }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
    try {
        const { email, password, role } = req.body;
        
        // Validate email & password
        if (!email || !password) {
            return next(new ErrorResponse('Please provide an email and password', 400));
        }
        
        // Check for user
        const user = await User.findOne({ email }).select('+password');
        
        if (!user) {
            return next(new ErrorResponse('Invalid credentials', 401));
        }
        
        // Check if role matches
        if (role && user.role !== role) {
            return next(new ErrorResponse(`This account is registered as a ${user.role}. Please select the correct role.`, 401));
        }
        
        // Check if password matches
        const isMatch = await user.matchPassword(password);
        
        if (!isMatch) {
            return next(new ErrorResponse('Invalid credentials', 401));
        }
        
        sendTokenResponse(user, 200, res);
    } catch (err) {
        next(err);
    }
};

// @desc    Log user out / clear cookie
// @route   GET /api/auth/logout
// @access  Private
exports.logout = (req, res, next) => {
    res.cookie('token', 'none', {
        expires: new Date(Date.now() + 10 * 1000),
        httpOnly: true
    });
    
    res.status(200).json({
        success: true,
        data: {}
    });
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        
        res.status(200).json({
            success: true,
            data: user
        });
    } catch (err) {
        next(err);
    }
};

// @desc    Forgot password
// @route   POST /api/auth/forgotpassword
// @access  Public
exports.forgotPassword = async (req, res, next) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        
        if (!user) {
            return next(new ErrorResponse('There is no user with that email', 404));
        }
        
        // Get reset token
        const resetToken = user.generateResetPasswordToken();
        
        await user.save({ validateBeforeSave: false });
        
        // Create reset url
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
        
        const message = `
            <h1>Password Reset Request</h1>
            <p>You are receiving this email because you (or someone else) has requested the reset of a password. Please click the link below to reset your password:</p>
            <a href="${resetUrl}" target="_blank">Reset Password</a>
            <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
        `;
        
        try {
            await sendEmail({
                to: user.email,
                subject: 'Password Reset Token',
                html: message
            });
            
            res.status(200).json({ success: true, data: 'Email sent' });
        } catch (err) {
            console.log(err);
            user.resetPasswordToken = undefined;
            user.resetPasswordExpire = undefined;
            
            await user.save({ validateBeforeSave: false });
            
            return next(new ErrorResponse('Email could not be sent', 500));
        }
    } catch (err) {
        next(err);
    }
};

// @desc    Reset password
// @route   PUT /api/auth/resetpassword/:resettoken
// @access  Public
exports.resetPassword = async (req, res, next) => {
    try {
        // Get hashed token
        const resetPasswordToken = crypto
            .createHash('sha256')
            .update(req.params.resettoken)
            .digest('hex');
        
        const user = await User.findOne({
            resetPasswordToken,
            resetPasswordExpire: { $gt: Date.now() }
        });
        
        if (!user) {
            return next(new ErrorResponse('Invalid token', 400));
        }
        
        // Set new password
        user.password = req.body.password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        
        await user.save();
        
        sendTokenResponse(user, 200, res);
    } catch (err) {
        next(err);
    }
};

// @desc    Verify email
// @route   GET /api/auth/verifyemail/:verificationtoken
// @access  Public
exports.verifyEmail = async (req, res, next) => {
    try {
        // Get hashed token
        const emailVerificationToken = crypto
            .createHash('sha256')
            .update(req.params.verificationtoken)
            .digest('hex');
        
        const user = await User.findOne({
            emailVerificationToken,
            emailVerificationTokenExpire: { $gt: Date.now() }
        });
        
        if (!user) {
            return next(new ErrorResponse('Invalid token', 400));
        }
        
        // Set email as verified
        user.emailVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationTokenExpire = undefined;
        
        await user.save();
        
        res.status(200).json({
            success: true,
            message: 'Email verified successfully'
        });
    } catch (err) {
        next(err);
    }
};

// Helper function to get token from model, create cookie and send response
const sendTokenResponse = (user, statusCode, res) => {
    // Create token
    const token = user.getSignedJwtToken();
    
    const options = {
        expires: new Date(
            Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000
        ),
        httpOnly: true
    };
    
    if (process.env.NODE_ENV === 'production') {
        options.secure = true;
    }
    
    res
        .status(statusCode)
        .cookie('token', token, options)
        .json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                institution: user.institution,
                emailVerified: user.emailVerified
            }
        });
}; 