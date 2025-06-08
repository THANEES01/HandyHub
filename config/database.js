import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

// Validate DATABASE_URL
if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
}

// Add connection timeout parameters to DATABASE_URL if not present
let connectionString = process.env.DATABASE_URL;
if (!connectionString.includes('connect_timeout')) {
    const separator = connectionString.includes('?') ? '&' : '?';
    connectionString += `${separator}connect_timeout=30&pool_timeout=30&statement_timeout=30000`;
}

console.log('🔧 Connecting to Neon database with enhanced timeouts...');

// Create pool with Neon-optimized settings for cold starts
const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false
    },
    // Enhanced settings for Neon cold starts
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000, // Increased for cold starts
    acquireTimeoutMillis: 30000,    // Increased for cold starts
    statement_timeout: 30000,
    query_timeout: 30000,
    application_name: 'handyhub-app',
    // Additional Neon-specific settings
    keepAlive: true,
    keepAliveInitialDelayMillis: 0
});

// Connection event handlers
pool.on('connect', (client) => {
    console.log('✅ Connected to Neon database');
});

pool.on('error', (err) => {
    console.error('❌ Database connection error:', err.message);
    
    if (err.message.includes('timeout')) {
        console.error('💡 Database timeout - Neon may be sleeping, will retry automatically');
    }
});

// Test connection function with retry logic for cold starts
async function testConnection() {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
        let client;
        try {
            attempt++;
            console.log(`🔄 Testing database connection (attempt ${attempt}/${maxRetries})...`);
            
            // First, try to wake up the database by connecting
            client = await Promise.race([
                pool.connect(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Connection timeout after 25 seconds')), 25000)
                )
            ]);
            
            console.log('✅ Database connected successfully');
            
            // Test a simple query with timeout
            const result = await Promise.race([
                client.query('SELECT NOW() as current_time, version() as pg_version'),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Query timeout after 10 seconds')), 10000)
                )
            ]);
            
            console.log('🕒 Database time:', result.rows[0].current_time);
            console.log('📊 PostgreSQL version:', result.rows[0].pg_version.split(' ')[0]);
            
            return true;
            
        } catch (error) {
            console.error(`❌ Connection attempt ${attempt} failed:`, error.message);
            
            if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
                console.log('💡 This looks like a cold start issue. Database may be sleeping.');
                if (attempt < maxRetries) {
                    console.log(`⏳ Waiting 3 seconds before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            } else if (attempt === maxRetries) {
                console.error('💥 All connection attempts failed');
                console.error('💡 Troubleshooting steps:');
                console.error('   1. Check if DATABASE_URL is correct');
                console.error('   2. Verify Neon database is not suspended');
                console.error('   3. Try connecting from Neon dashboard first');
                console.error('   4. Check your network/firewall settings');
            }
        } finally {
            if (client) {
                client.release();
            }
        }
    }
    
    return false;
}

// Test connection on startup
testConnection().catch(err => {
    console.error('Database startup test error:', err.message);
});

// Graceful shutdown
const shutdown = async () => {
    console.log('🔄 Closing database connections...');
    try {
        await pool.end();
        console.log('✅ Database connections closed');
    } catch (err) {
        console.error('❌ Error during shutdown:', err.message);
    }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default pool;