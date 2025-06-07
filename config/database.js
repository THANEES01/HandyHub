import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

// Create connection pool for PostgreSQL (Neon)
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'HandyHub',
    user: process.env.DB_USER || 'HandyHub_owner',
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false // Required for Neon and most cloud PostgreSQL providers
    },
    // Connection pool settings for serverless
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
});

// Test connection function
async function testConnection() {
    try {
        const client = await pool.connect();
        console.log('✅ Database connected successfully to:', process.env.DB_NAME);
        const result = await client.query('SELECT NOW()');
        console.log('🕒 Database time:', result.rows[0].now);
        client.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🔄 Gracefully shutting down database connections...');
    await pool.end();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🔄 Gracefully shutting down database connections...');
    await pool.end();
    process.exit(0);
});

// Test connection on startup (only in development)
if (process.env.NODE_ENV !== 'production') {
    testConnection();
}

export default pool;