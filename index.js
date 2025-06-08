import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import http from 'http';
import pool from './config/database.js';

// Import route modules
import authRoutes from './auth.js';
import providerRoutes from './provider.js';
import adminRoutes from './admin.js';
import customerRoutes from './customer.js';
import bookingRoutes from './booking.js';
import paymentRoutes from './payment.js';
import chatRoutes from './chat.js';
import chatProviderRoutes from './chat-provider.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Create HTTP server
const server = http.createServer(app);

// ============= ENVIRONMENT DETECTION =============

// Smart environment detection
const isVercelDeployment = !!(process.env.VERCEL_ENV || process.env.VERCEL_URL);
const isProduction = process.env.NODE_ENV === 'production';
const isLocalDevelopment = !isVercelDeployment && !isProduction;

// Log environment for debugging
if (isLocalDevelopment) {
    console.log('🔧 Environment: Local Development');
} else if (isVercelDeployment) {
    console.log('🌐 Environment: Vercel Deployment');
} else if (isProduction) {
    console.log('🚀 Environment: Production');
}

// ============= VERCEL PRODUCTION OPTIMIZATIONS =============

// Trust proxy for Vercel and production
if (isVercelDeployment || isProduction) {
    app.set('trust proxy', 1);
}

// ============= MIDDLEWARE SETUP =============

// Raw body for Stripe webhooks (must be before other body parsers)
app.use('/customer/webhook', express.raw({ type: 'application/json' }));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving with conditional cache headers
const staticOptions = isVercelDeployment ? {
    maxAge: '1y',
    etag: false,
    lastModified: false
} : {
    maxAge: '1h' // Shorter cache for development
};

app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), staticOptions));
app.use('/img', express.static(path.join(__dirname, 'public/img'), staticOptions));
app.use('/css', express.static(path.join(__dirname, 'public/css'), staticOptions));
app.use('/js', express.static(path.join(__dirname, 'public/js'), staticOptions));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============= SESSION CONFIGURATION =============

// Fixed session configuration for all environments
// Enhanced session configuration that works for both localhost and Vercel
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'THANEES01',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    name: 'handyhub.sid',
    cookie: { 
        // FIXED: Different settings for different environments
        secure: false, // Always false for localhost compatibility
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        sameSite: 'lax' // Always 'lax' for better compatibility
    }
};

// Override for production environments only
if (isVercelDeployment || (isProduction && process.env.HTTPS === 'true')) {
    sessionConfig.cookie.secure = true;
    sessionConfig.cookie.sameSite = 'none';
}

// Add session debugging only in local development
if (isLocalDevelopment) {
    sessionConfig.genid = function(req) {
        const sessionId = Math.random().toString(36).substring(2, 15) + 
                         Math.random().toString(36).substring(2, 15);
        console.log('🔑 New session created:', sessionId);
        return sessionId;
    };
}

app.use(session(sessionConfig));

// ============= FLASH MESSAGE MIDDLEWARE =============

app.use((req, res, next) => {
    // Session logging only in local development
    if (isLocalDevelopment && req.session) {
        console.log('📋 Session Info:', {
            sessionID: req.sessionID?.substring(0, 8) + '...',
            hasUser: !!req.session.user,
            userType: req.session.user?.userType,
            error: !!req.session.error,
            success: !!req.session.success,
            url: req.url
        });
    }
    
    // Set locals for views
    res.locals.user = req.session?.user || null;
    res.locals.success = req.session?.success || null;
    res.locals.error = req.session?.error || null;
    res.locals.isProduction = isProduction;
    res.locals.isVercel = isVercelDeployment;
    
    // Enhanced flash function
    req.flash = function(type, message) {
        if (!req.session) {
            if (isLocalDevelopment) console.warn('⚠️ Cannot set flash message: session unavailable');
            return;
        }
        
        if (isLocalDevelopment) console.log(`💬 Flash message: ${type} - ${message}`);
        
        if (type === 'success') {
            req.session.success = message;
        } else if (type === 'error') {
            req.session.error = message;
        }
        
        // Force session save for better reliability
        req.session.save((err) => {
            if (err && isLocalDevelopment) console.error('Flash message session save error:', err);
        });
    };
    
    // Function to clear flash messages
    req.clearFlash = function() {
        if (req.session) {
            delete req.session.success;
            delete req.session.error;
            req.session.save((err) => {
                if (err && isLocalDevelopment) console.error('Clear flash session save error:', err);
            });
        }
    };
    
    next();
});

// ============= SOCKET.IO PLACEHOLDER =============

// Provide dummy Socket.IO object for compatibility
app.use((req, res, next) => {
    req.io = {
        emit: () => {},
        to: () => ({ emit: () => {} }),
        in: () => ({ emit: () => {} })
    };
    next();
});

// ============= HEALTH & DEBUG ROUTES =============

// Health check endpoint (always available)
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        environment: isVercelDeployment ? 'vercel' : (isProduction ? 'production' : 'development'),
        node_env: process.env.NODE_ENV || 'development',
        session_info: {
            has_session: !!req.session,
            session_id: req.sessionID?.substring(0, 8) + '...',
            has_user: !!req.session?.user,
            user_type: req.session?.user?.userType
        }
    });
});

// Fix favicon 404 error
app.get('/favicon.ico', (req, res) => {
    res.status(204).send();
});

// Debug routes (only in local development)
if (isLocalDevelopment) {
    console.log('🔧 Debug routes enabled for local development');
    
    // Environment variables debug route
    app.get('/debug-env', (req, res) => {
        res.json({
            status: 'Environment Variables Check',
            environment: {
                isLocalDevelopment,
                isVercelDeployment,
                isProduction,
                node_env: process.env.NODE_ENV,
                vercel_env: process.env.VERCEL_ENV,
                vercel_url: process.env.VERCEL_URL
            },
            database: {
                db_host: process.env.DB_HOST?.substring(0, 30) + '...',
                db_port: process.env.DB_PORT,
                db_name: process.env.DB_NAME,
                db_user: process.env.DB_USER,
                db_password_exists: !!process.env.DB_PASSWORD
            },
            session: {
                session_secret_exists: !!process.env.SESSION_SECRET,
                session_secret_length: process.env.SESSION_SECRET?.length || 0,
                current_session_id: req.sessionID,
                has_user: !!req.session?.user,
                user_type: req.session?.user?.userType
            },
            timestamp: new Date().toISOString()
        });
    });

    // Database connection test route
    app.get('/test-db', async (req, res) => {
        let client;
        try {
            console.log('🔍 Testing database connection...');
            
            if (!pool) {
                return res.status(500).json({
                    status: 'error',
                    message: 'Database pool not initialized'
                });
            }

            client = await pool.connect();
            console.log('✅ Database connection successful');
            
            const timeResult = await client.query('SELECT NOW() as current_time, version() as pg_version');
            const tablesResult = await client.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
                ORDER BY table_name
            `);
            
            res.json({ 
                status: 'success', 
                message: 'Database connected successfully',
                timestamp: timeResult.rows[0].current_time,
                postgresql_version: timeResult.rows[0].pg_version.split(' ')[0],
                tables_found: tablesResult.rows.length,
                tables: tablesResult.rows.map(row => row.table_name),
                connection_info: {
                    host: process.env.DB_HOST?.substring(0, 30) + '...',
                    database: process.env.DB_NAME,
                    user: process.env.DB_USER,
                    port: process.env.DB_PORT
                }
            });
        } catch (error) {
            console.error('❌ Database test failed:', error);
            res.status(500).json({ 
                status: 'error', 
                message: 'Database connection failed',
                error: error.message
            });
        } finally {
            if (client) {
                client.release();
            }
        }
    });
}


// ============= APPLICATION ROUTES =============

// Main application routes
app.use('/auth', authRoutes);
app.use('/provider', providerRoutes);
app.use('/admin', adminRoutes);
app.use('/customer', customerRoutes);
app.use(bookingRoutes);
app.use('/customer', paymentRoutes);
app.use('/', chatRoutes);  // This handles customer chat routes
app.use('/provider', chatProviderRoutes);  // This handles provider chat routes

// ============= API ENDPOINTS =============

// API endpoint for unread message count
app.get('/api/unread-count', (req, res) => {
    if (isLocalDevelopment) console.log('API call: /api/unread-count');
    
    if (!req.session.user) {
        return res.json({ count: 0, success: true });
    }
    
    res.json({ 
        count: 0, 
        success: true,
        user_type: req.session.user.userType || 'guest'
    });
});

// API endpoint for notifications
app.get('/api/notifications', (req, res) => {
    if (isLocalDevelopment) console.log('API call: /api/notifications');
    
    if (!req.session.user) {
        return res.json({ notifications: [], success: true });
    }
    
    res.json({ 
        notifications: [], 
        success: true,
        user_type: req.session.user.userType || 'guest'
    });
});

// API endpoint for user status
app.get('/api/user/status', (req, res) => {
    if (isLocalDevelopment) console.log('API call: /api/user/status');
    
    if (!req.session.user) {
        return res.json({ 
            logged_in: false, 
            user_type: null,
            success: true 
        });
    }
    
    res.json({ 
        logged_in: true,
        user_type: req.session.user.userType,
        user_id: req.session.user.id,
        success: true
    });
});



// General API catch-all
app.get('/api/*', (req, res) => {
    if (isLocalDevelopment) console.log(`API call to undefined endpoint: ${req.path}`);
    res.status(404).json({ 
        error: 'API endpoint not found',
        path: req.path,
        success: false,
        available_endpoints: [
            '/api/health',
            '/api/unread-count',
            '/api/notifications', 
            '/api/user/status'
        ]
    });
});

// Home route
app.get('/', (req, res) => {
    res.render('home', { 
        title: 'HandyHub - Professional Home Services'
    });
});

// Generic login route handlers
app.get('/login', (req, res) => {
    if (isLocalDevelopment) console.log('Generic /login accessed, redirecting to customer login');
    res.redirect('/auth/customer-login');
});

app.post('/login', (req, res) => {
    if (isLocalDevelopment) console.log('POST to generic /login, redirecting to customer login');
    res.redirect('/auth/customer-login');
});

app.get('/signin', (req, res) => {
    if (isLocalDevelopment) console.log('Generic /signin accessed, redirecting to customer login');
    res.redirect('/auth/customer-login');
});

// ============= ERROR HANDLING =============

// 404 handler
app.use((req, res, next) => {
    // Log 404s only in development
    if (isLocalDevelopment) {
        console.log(`404 - Route not found: ${req.method} ${req.path}`);
    }
    
    // Handle API requests differently
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            error: 'API endpoint not found',
            path: req.path,
            method: req.method
        });
    }
    
    // Regular page 404
    res.status(404).render('error', {
        title: 'Page Not Found',
        error: { 
            status: 404, 
            message: `The page you are looking for does not exist: ${req.path}` 
        }
    });
});

// General error handler
app.use((err, req, res, next) => {
    // Error logging based on environment
    if (isLocalDevelopment) {
        console.error('Server error:', err);
    } else {
        console.error('Error:', err.message);
    }
    
    const status = err.status || 500;
    res.status(status);
    
    // Handle API errors
    if (req.path.startsWith('/api/')) {
        return res.json({
            error: 'Internal server error',
            message: isLocalDevelopment ? err.message : 'Something went wrong',
            status: status
        });
    }
    
    // Regular page errors
    res.render('error', {
        title: 'Error',
        error: { 
            status: status, 
            message: isLocalDevelopment ? err.message : 'An unexpected error occurred'
        }
    });
});

// ============= SERVER STARTUP =============

// Export for Vercel (always available)
export default app;

// Local development server (only start if not in Vercel)
if (!isVercelDeployment) {
    const PORT = process.env.PORT || 3000;
    
    // Start the server
    server.listen(PORT, '0.0.0.0', () => {
        // Clear console for better visibility in development
        if (isLocalDevelopment) {
            console.clear();
        }
        
        console.log('\n🎉 HandyHub Server Started Successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🚀 Server URL: http://localhost:${PORT}`);
        console.log(`🌍 Environment: ${isLocalDevelopment ? 'Local Development' : 'Production'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        if (isLocalDevelopment) {
            console.log('\n📱 Application Routes:');
            console.log(`   🏠 Homepage:        http://localhost:${PORT}/`);
            console.log(`   👤 Customer Login:  http://localhost:${PORT}/auth/customer-login`);
            console.log(`   🔧 Provider Login:  http://localhost:${PORT}/auth/provider-login`);
            console.log(`   👑 Admin Login:     http://localhost:${PORT}/auth/admin-login`);
            
            console.log('\n🛠️  Development Tools:');
            console.log(`   🔍 Environment:     http://localhost:${PORT}/debug-env`);
            console.log(`   💾 Database Test:   http://localhost:${PORT}/test-db`);
            console.log(`   📊 Session Check:   http://localhost:${PORT}/auth/check-session`);
            console.log(`   ⚡ Health Check:    http://localhost:${PORT}/api/health`);
            
            console.log('\n💡 Login Credentials:');
            console.log('   Admin: username "admin", password "admin123"');
            
            console.log('\n🛑 Stop server: Ctrl+C');
        }
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        if (isLocalDevelopment) {
            setTimeout(() => {
                console.log('✅ Server is ready! Click on any link above to get started.\n');
            }, 500);
        }
    });
    
    // Enhanced error handling for server startup
    server.on('error', (err) => {
        console.error('\n❌ Server startup failed!');
        
        if (err.code === 'EADDRINUSE') {
            console.error(`🔴 Port ${PORT} is already in use.`);
            console.error('\n💡 Solutions:');
            console.error(`   1. Kill existing process: npx kill-port ${PORT}`);
            console.error(`   2. Use different port: PORT=3001 nodemon index.js`);
            console.error(`   3. Stop other development servers`);
        } else if (err.code === 'EACCES') {
            console.error(`🔴 Permission denied on port ${PORT}.`);
            console.error('\n💡 Try using a port above 1024 (e.g., PORT=3001)');
        } else {
            console.error('🔴 Unexpected server error:', err.message);
        }
        
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        process.exit(1);
    });
    
    // Graceful shutdown handlers
    const gracefulShutdown = (signal) => {
        console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
        
        server.close(() => {
            console.log('✅ Server closed successfully');
            if (pool && pool.end) {
                pool.end(() => {
                    console.log('💾 Database connections closed');
                    process.exit(0);
                });
            } else {
                process.exit(0);
            }
        });
        
        // Force close after 10 seconds
        setTimeout(() => {
            console.error('⚠️  Forcing server shutdown...');
            process.exit(1);
        }, 10000);
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
} else {
    console.log('🌐 Running in Vercel deployment mode - server exported for serverless');
}