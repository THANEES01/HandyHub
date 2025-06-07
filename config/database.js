import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars);
    console.error('Available env vars:', Object.keys(process.env).filter(key => key.startsWith('DB_')));
}

// Log database configuration (hide sensitive data)
console.log('Database configuration:', {
    host: process.env.DB_HOST?.substring(0, 20) + '...',
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ? '***HIDDEN***' : 'NOT SET',
    ssl_enabled: true
});

// Create connection pool optimized for Vercel serverless
const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false
    },
    // Serverless optimized settings
    max: 1, // Reduced for serverless
    min: 0,
    idleTimeoutMillis: 10000, // 10 seconds
    connectionTimeoutMillis: 5000, // 5 seconds
    acquireTimeoutMillis: 10000, // 10 seconds
    statement_timeout: 30000, // 30 seconds
    query_timeout: 30000, // 30 seconds
    application_name: 'handyhub-vercel'
});

// Test connection function with detailed logging
async function testConnection() {
    let client;
    try {
        console.log('🔄 Testing database connection...');
        
        client = await pool.connect();
        console.log('✅ Database connected successfully');
        
        // Test basic query
        const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
        console.log('🕒 Database time:', result.rows[0].current_time);
        console.log('📊 PostgreSQL version:', result.rows[0].pg_version.split(' ')[0]);
        
        // Check if tables exist
        const tablesResult = await client.query(`
            SELECT COUNT(*) as table_count 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log('📋 Tables in database:', tablesResult.rows[0].table_count);
        
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:');
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        
        // Specific error diagnostics
        switch (error.code) {
            case 'ENOTFOUND':
                console.error('💡 DNS resolution failed. Check DB_HOST value.');
                break;
            case 'ECONNREFUSED':
                console.error('💡 Connection refused. Check DB_HOST and DB_PORT.');
                break;
            case '28P01':
                console.error('💡 Authentication failed. Check DB_USER and DB_PASSWORD.');
                break;
            case '3D000':
                console.error('💡 Database does not exist. Check DB_NAME.');
                break;
            case 'ETIMEDOUT':
                console.error('💡 Connection timeout. Database might be slow or unreachable.');
                break;
            default:
                console.error('💡 Unknown error. Check all database credentials.');
        }
        
        return false;
    } finally {
        if (client) {
            client.release();
        }
    }
}

// Handle pool events
pool.on('error', (err) => {
    console.error('❌ Database pool error:', err.message);
});

pool.on('connect', () => {
    console.log('🔗 New database client connected');
});

pool.on('remove', () => {
    console.log('🔌 Database client removed');
});

// Test connection on startup (only log, don't block)
if (process.env.DB_HOST) {
    testConnection().catch(err => {
        console.error('Database startup test failed:', err.message);
    });
} else {
    console.error('❌ DB_HOST environment variable not found');
}

// Graceful shutdown handlers
const shutdown = async () => {
    console.log('🔄 Shutting down database connections...');
    try {
        await pool.end();
        console.log('✅ Database connections closed');
    } catch (err) {
        console.error('❌ Error during database shutdown:', err.message);
    }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default pool;