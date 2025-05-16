const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        // Add fallback URI in case env variable is not loaded
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/proofmate';
        
        const conn = await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
};

module.exports = connectDB; 