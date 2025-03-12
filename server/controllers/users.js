const ErrorResponse = require('../utils/errorResponse');
const User = require('../models/User');

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin/Teacher
exports.getUsers = async (req, res, next) => {
    try {
        // Add filtering for teachers to only see their students
        let query = {};
        
        if (req.user.role === 'teacher') {
            // Teachers can only see students
            query = { role: 'student' };
        }
        
        const users = await User.find(query);
        
        res.status(200).json({
            success: true,
            count: users.length,
            data: users
        });
    } catch (err) {
        next(err);
    }
};

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private/Admin/Teacher
exports.getUser = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id);
        
        if (!user) {
            return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
        }
        
        // Check if teacher is trying to access non-student user
        if (req.user.role === 'teacher' && user.role !== 'student') {
            return next(new ErrorResponse(`Not authorized to access this user`, 403));
        }
        
        res.status(200).json({
            success: true,
            data: user
        });
    } catch (err) {
        next(err);
    }
};

// @desc    Create user
// @route   POST /api/users
// @access  Private/Admin
exports.createUser = async (req, res, next) => {
    try {
        // Only admin can create any user; teacher can create only students
        if (req.user.role === 'teacher' && req.body.role !== 'student') {
            return next(new ErrorResponse(`Teachers can only create student accounts`, 403));
        }
        
        const user = await User.create(req.body);
        
        res.status(201).json({
            success: true,
            data: user
        });
    } catch (err) {
        next(err);
    }
};

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private/Admin/Teacher
exports.updateUser = async (req, res, next) => {
    try {
        let user = await User.findById(req.params.id);
        
        if (!user) {
            return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
        }
        
        // Check if teacher is trying to update non-student user
        if (req.user.role === 'teacher') {
            if (user.role !== 'student') {
                return next(new ErrorResponse(`Not authorized to update this user`, 403));
            }
            
            // Teachers cannot change user roles
            if (req.body.role && req.body.role !== 'student') {
                return next(new ErrorResponse(`Teachers cannot change user roles`, 403));
            }
        }
        
        // If password is being updated, hash it
        if (req.body.password) {
            user.password = req.body.password;
            await user.save();
            
            delete req.body.password;
        }
        
        // Update user with remaining fields
        user = await User.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });
        
        res.status(200).json({
            success: true,
            data: user
        });
    } catch (err) {
        next(err);
    }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin/Teacher
exports.deleteUser = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id);
        
        if (!user) {
            return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
        }
        
        // Check if teacher is trying to delete non-student user
        if (req.user.role === 'teacher' && user.role !== 'student') {
            return next(new ErrorResponse(`Not authorized to delete this user`, 403));
        }
        
        await user.remove();
        
        res.status(200).json({
            success: true,
            data: {}
        });
    } catch (err) {
        next(err);
    }
}; 