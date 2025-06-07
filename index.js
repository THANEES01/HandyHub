import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
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

// Conditionally import chat routes only in development
let chatRoutes = null;
let chatProviderRoutes = null;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Create HTTP server
const server = http.createServer(app);

// ============= MIDDLEWARE SETUP =============

// Raw body for Stripe webhooks (must be before other body parsers)
app.use('/customer/webhook', express.raw({ type: 'application/json' }));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/img', express.static(path.join(__dirname, 'public/img')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session configuration
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'handyhub-fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        sameSite: 'lax'
    }
});

app.use(sessionMiddleware);

// Improved flash message middleware
app.use((req, res, next) => {
    // Initialize session if needed
    if (!req.session) {
        console.warn('⚠️ Session middleware not working properly');
    }
    
    // Set locals for views with safe defaults
    res.locals.user = req.session?.user || null;
    res.locals.success = req.session?.success || null;
    res.locals.error = req.session?.error || null;
    
    // Custom flash function
    req.flash = function(type, message) {
        if (!req.session) {
            console.warn('⚠️ Cannot set flash message: session unavailable');
            return;
        }
        
        if (type === 'success') {
            req.session.success = message;
        } else if (type === 'error') {
            req.session.error = message;
        }
    };
    
    // Function to clear flash messages
    req.clearFlash = function() {
        if (req.session) {
            delete req.session.success;
            delete req.session.error;
        }
    };
    
    next();
});

// ============= SOCKET.IO SETUP (Development Only) =============

// Load chat routes conditionally
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    try {
        const chatModule = await import('./chat.js');
        const chatProviderModule = await import('./chat-provider.js');
        chatRoutes = chatModule.default;
        chatProviderRoutes = chatProviderModule.default;
        console.log('✅ Chat features loaded for development');
    } catch (error) {
        console.log('ℹ️ Chat features not available in production mode');
    }
}

// Provide dummy Socket.IO object for production
app.use((req, res, next) => {
    req.io = {
        emit: () => {},
        to: () => ({ emit: () => {} }),
        in: () => ({ emit: () => {} })
    };
    next();
});

// ============= DEBUG AND TEST ROUTES =============

// Fix favicon 404 error
app.get('/favicon.ico', (req, res) => {
    res.status(204).send();
});

// Environment variables debug route
app.get('/debug-env', (req, res) => {
    res.json({
        status: 'Environment Variables Check',
        node_env: process.env.NODE_ENV,
        vercel_env: process.env.VERCEL_ENV,
        vercel_url: process.env.VERCEL_URL,
        // Database variables
        db_host: process.env.DB_HOST?.substring(0, 30) + '...',
        db_port: process.env.DB_PORT,
        db_name: process.env.DB_NAME,
        db_user: process.env.DB_USER,
        db_password_exists: !!process.env.DB_PASSWORD,
        db_password_length: process.env.DB_PASSWORD?.length || 0,
        // Session
        session_secret_exists: !!process.env.SESSION_SECRET,
        session_secret_length: process.env.SESSION_SECRET?.length || 0,
        // All relevant env vars
        relevant_env_vars: Object.keys(process.env).filter(key => 
            key.includes('DB_') || 
            key.includes('SESSION_') || 
            key.includes('STRIPE_') ||
            key.includes('VERCEL_')
        ),
        timestamp: new Date().toISOString()
    });
});

// Database connection test route
app.get('/test-db', async (req, res) => {
    let client;
    try {
        console.log('🔍 Testing database connection via API...');
        
        if (!pool) {
            return res.status(500).json({
                status: 'error',
                message: 'Database pool not initialized',
                debug: {
                    db_host: !!process.env.DB_HOST,
                    db_name: !!process.env.DB_NAME,
                    db_user: !!process.env.DB_USER,
                    db_password: !!process.env.DB_PASSWORD
                }
            });
        }

        client = await pool.connect();
        console.log('✅ Database connection successful via API');
        
        // Basic connectivity test
        const timeResult = await client.query('SELECT NOW() as current_time, version() as pg_version');
        
        // Check tables
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
        console.error('❌ Database test failed via API:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Database connection failed',
            error: {
                message: error.message,
                code: error.code,
                detail: error.detail
            },
            environment_check: {
                db_host: !!process.env.DB_HOST,
                db_name: !!process.env.DB_NAME,
                db_user: !!process.env.DB_USER,
                db_password: !!process.env.DB_PASSWORD,
                session_secret: !!process.env.SESSION_SECRET
            }
        });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// Routes test endpoint
app.get('/test-routes', (req, res) => {
    const routes = [];
    
    // Extract routes from Express router
    function extractRoutes(stack, prefix = '') {
        stack.forEach(middleware => {
            if (middleware.route) {
                routes.push({
                    path: prefix + middleware.route.path,
                    methods: Object.keys(middleware.route.methods)
                });
            } else if (middleware.name === 'router' && middleware.handle?.stack) {
                const routerPrefix = middleware.regexp.source
                    .replace(/\\\//g, '/')
                    .replace(/\$.*/, '')
                    .replace(/^\^/, '');
                extractRoutes(middleware.handle.stack, routerPrefix);
            }
        });
    }
    
    extractRoutes(app._router.stack);
    
    res.json({
        status: 'success',
        total_routes: routes.length,
        routes: routes.slice(0, 20), // Limit output
        auth_routes_found: routes.filter(r => r.path.includes('/auth')).length,
        customer_routes_found: routes.filter(r => r.path.includes('/customer')).length
    });
});

// ============= APPLICATION ROUTES =============

// Main application routes
app.use('/auth', authRoutes);
app.use('/provider', providerRoutes);
app.use('/admin', adminRoutes);
app.use('/customer', customerRoutes);
app.use(bookingRoutes);
app.use('/customer', paymentRoutes);

// Chat routes (development only)
if (chatRoutes && process.env.NODE_ENV !== 'production') {
    app.use('/', chatRoutes);
    app.use('/provider', chatProviderRoutes);
    console.log('✅ Chat routes enabled for development');
} else {
    // Disabled chat endpoints for production
    app.get('/chat/*', (req, res) => {
        res.json({ 
            message: 'Chat features are disabled in production. Contact support for real-time communication.' 
        });
    });
    app.post('/chat/*', (req, res) => {
        res.json({ 
            message: 'Chat features are disabled in production. Contact support for real-time communication.' 
        });
    });
}

// Home route
app.get('/', (req, res) => {
    res.render('home', { 
        title: 'HandyHub - Professional Home Services'
    });
});

// ============= DEVELOPMENT-ONLY ROUTES =============

if (process.env.NODE_ENV !== 'production') {
    // Session test route
    app.get('/test-session', (req, res) => {
        req.session.success = 'Test success message';
        req.session.error = 'Test error message';
        
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ error: 'Session save failed', details: err.message });
            }
            
            res.redirect('/auth/customer-login');
        });
    });

    // Chat test route
    app.get('/chat-test', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Chat Test</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
                    .success { background: #d4edda; color: #155724; }
                    .error { background: #f8d7da; color: #721c24; }
                </style>
            </head>
            <body>
                <h1>Socket.IO Test Page (Development Only)</h1>
                <div id="status" class="status">Testing connection...</div>
                <button onclick="testConnection()">Test Connection</button>
                <div id="log"></div>
                
                <script>
                    function testConnection() {
                        const status = document.getElementById('status');
                        const log = document.getElementById('log');
                        
                        if (typeof io === 'undefined') {
                            status.className = 'status error';
                            status.textContent = 'Socket.IO not available in production mode';
                            return;
                        }
                        
                        status.className = 'status';
                        status.textContent = 'Attempting connection...';
                        log.innerHTML = '<p>Connection test started...</p>';
                    }
                </script>
            </body>
            </html>
        `);
    });
}

// ============= ERROR HANDLING =============

// 404 handler
app.use((req, res, next) => {
    console.log(`404 - Route not found: ${req.method} ${req.path}`);
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
    console.error('Server error:', err);
    res.status(err.status || 500).render('error', {
        title: 'Error',
        error: { 
            status: err.status || 500, 
            message: err.message || 'An unexpected error occurred' 
        }
    });
});

// ============= SERVER STARTUP =============

// Export for Vercel
export default app;

// Local development server
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
        console.log(`📊 Test routes available:`);
        console.log(`   - http://localhost:${PORT}/debug-env`);
        console.log(`   - http://localhost:${PORT}/test-db`);
        console.log(`   - http://localhost:${PORT}/test-routes`);
    });
}