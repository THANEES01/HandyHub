import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

// Validate DATABASE_URL exists
if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
}

// Log database configuration (hide sensitive parts)
console.log('Database configuration:', {
    url_preview: process.env.DATABASE_URL.substring(0, 30) + '...',
    ssl_enabled: true,
    environment: process.env.NODE_ENV || 'development'
});

// Create connection pool with timeout-resistant settings for Neon
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    // FIXED: Better settings for Neon + Vercel
    max: 1, // Single connection for serverless
    min: 0,
    idleTimeoutMillis: 30000, // 30 seconds
    connectionTimeoutMillis: 20000, // 20 seconds (increased)
    acquireTimeoutMillis: 30000, // 30 seconds (increased)
    createTimeoutMillis: 20000, // 20 seconds
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 200,
    // Neon-specific settings
    keepAlive: true,
    keepAliveInitialDelayMillis: 0,
    statement_timeout: 60000, // 1 minute
    query_timeout: 60000, // 1 minute
    application_name: 'handyhub-vercel'
});

// Enhanced test connection function
async function testConnection() {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
        let client;
        try {
            attempt++;
            console.log(`🔄 Testing database connection (attempt ${attempt}/${maxRetries})...`);
            
            // Use pool.connect with timeout
            client = await Promise.race([
                pool.connect(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Connection timeout after 15 seconds')), 15000)
                )
            ]);
            
            console.log('✅ Database connected successfully');
            
            // Test basic query with timeout
            const result = await Promise.race([
                client.query('SELECT NOW() as current_time, version() as pg_version'),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Query timeout after 10 seconds')), 10000)
                )
            ]);
            
            console.log('🕒 Database time:', result.rows[0].current_time);
            console.log('📊 PostgreSQL version:', result.rows[0].pg_version.split(' ')[0]);
            
            // Quick table check
            const tablesResult = await client.query(`
                SELECT COUNT(*) as table_count 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
            `);
            console.log('📋 Tables in database:', tablesResult.rows[0].table_count);
            
            return true;
            
        } catch (error) {
            console.error(`❌ Database connection attempt ${attempt} failed:`, error.message);
            
            if (attempt === maxRetries) {
                console.error('💡 Troubleshooting tips:');
                console.error('   - Check if DATABASE_URL is correct');
                console.error('   - Verify Neon database is active');
                console.error('   - Check network connectivity');
                console.error('   - Ensure database accepts connections');
            }
            
            // Wait before retry
            if (attempt < maxRetries) {
                console.log(`⏳ Waiting 2 seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } finally {
            if (client) {
                client.release();
            }
        }
    }
    
    return false;
}

// Handle pool events with better logging
pool.on('error', (err) => {
    console.error('❌ Database pool error:', err.message);
    console.error('Error code:', err.code);
});

pool.on('connect', (client) => {
    console.log('🔗 New database client connected to Neon');
});

pool.on('acquire', (client) => {
    console.log('📥 Database client acquired from pool');
});

pool.on('remove', (client) => {
    console.log('🔌 Database client removed from pool');
});

// Test connection on startup (don't block if it fails)
if (process.env.DATABASE_URL) {
    testConnection().then(success => {
        if (success) {
            console.log('🚀 Database ready for queries');
        } else {
            console.log('⚠️ Database connection failed - will retry on first query');
        }
    }).catch(err => {
        console.error('Database startup test error:', err.message);
    });
} else {
    console.error('❌ DATABASE_URL not found in environment variables');
}

// Graceful shutdown
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