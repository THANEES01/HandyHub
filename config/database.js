import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

// Log environment variables for debugging (remove passwords in production)
console.log('Database configuration:', {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ? '***HIDDEN***' : 'NOT SET'
});

// Create connection pool for PostgreSQL (Neon)
const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false
    },
    // Optimized for serverless
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 30000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 200,
});

// Test connection function with detailed logging
async function testConnection() {
    let client;
    try {
        console.log('🔄 Attempting database connection...');
        client = await pool.connect();
        console.log('✅ Database connected successfully');
        
        // Test query
        const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
        console.log('🕒 Database time:', result.rows[0].current_time);
        console.log('📊 PostgreSQL version:', result.rows[0].pg_version.split(' ')[0]);
        
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:');
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        console.error('Error details:', error.detail);
        
        // Common error solutions
        if (error.code === 'ENOTFOUND') {
            console.error('💡 Solution: Check if DB_HOST is correct');
        } else if (error.code === 'ECONNREFUSED') {
            console.error('💡 Solution: Check if DB_PORT is correct and database is running');
        } else if (error.message.includes('password authentication failed')) {
            console.error('💡 Solution: Check DB_USER and DB_PASSWORD');
        }
        
        return false;
    } finally {
        if (client) {
            client.release();
        }
    }
}

// Handle pool errors
pool.on('error', (err, client) => {
    console.error('❌ Unexpected error on idle client', err);
});

pool.on('connect', (client) => {
    console.log('🔗 New client connected');
});

pool.on('remove', (client) => {
    console.log('🔌 Client removed');
});

// Test connection on startup
testConnection().then(success => {
    if (success) {
        console.log('🚀 Database ready for queries');
    } else {
        console.log('⚠️ Database connection failed - app may not function properly');
    }
});

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

export default pool;