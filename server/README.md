# ProofMate Server

Backend server for ProofMate - Linear Algebra Solution Verification

## Features

- User authentication with JWT
- Role-based access control (students, teachers, administrators)
- Email verification
- Password reset functionality
- MongoDB database integration
- Express.js API

## Prerequisites

Before you begin, ensure you have met the following requirements:
- Node.js (v14 or later)
- MongoDB (local or MongoDB Atlas)
- npm or yarn package manager

## Installation

1. Clone the repository
```
git clone <repository-url>
```

2. Navigate to the server directory
```
cd proofmate/server
```

3. Install dependencies
```
npm install
```

4. Create a `.env` file in the root directory with the following variables:
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/proofmate
JWT_SECRET=your_jwt_secret_should_be_long_and_random
JWT_EXPIRE=30d
EMAIL_SERVICE=gmail
EMAIL_USERNAME=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
EMAIL_FROM=ProofMate <noreply@proofmate.com>
FRONTEND_URL=http://localhost:8000
```

Note: For Gmail, you'll need to use an "app password". See [Google Account Help](https://support.google.com/accounts/answer/185833) for instructions.

## Usage

### Development

Run the server in development mode with hot reloading:
```
npm run dev
```

### Production

Run the server in production mode:
```
npm start
```

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/forgotpassword` - Request password reset
- `PUT /api/auth/resetpassword/:resettoken` - Reset password
- `GET /api/auth/verifyemail/:verificationtoken` - Verify email

### User Management

- `GET /api/users` - Get all users (admin/teacher only)
- `GET /api/users/:id` - Get a specific user (admin/teacher only)
- `POST /api/users` - Create a new user (admin only)
- `PUT /api/users/:id` - Update a user (admin/teacher only)
- `DELETE /api/users/:id` - Delete a user (admin/teacher only)

## License

This project is licensed under the MIT License. 