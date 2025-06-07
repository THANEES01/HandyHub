import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import http from 'http';
import authRoutes from './auth.js'; // Import authRoutes
import providerRoutes from './provider.js'; // Import providerRoutes
import adminRoutes from './admin.js'; // Import adminRoutes
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

// Add this in your middleware setup section, before setting up routes
// This is important for Stripe webhook handling (raw body needed)
app.use('/customer/webhook', express.raw({ type: 'application/json' }));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// For common image placeholders
app.use('/img', express.static(path.join(__dirname, 'public/img')));

// View engine setup
app.set('view engine', 'ejs');
// Fixed: Use correct views folder case
app.set('views', path.join(__dirname, 'Views'));

// Define session middleware once with more secure settings
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'your-secret-key', // Use environment variable in production
  resave: false, // Don't save session if unmodified
  saveUninitialized: false, // Don't create session until something stored
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true, // Helps prevent XSS attacks
    sameSite: 'lax' // Helps prevent CSRF attacks
  }
});

// Apply middleware
app.use(sessionMiddleware);

// Flash message middleware
app.use((req, res, next) => {
    // Make sure session exists before accessing it
    if (req.session) {
        // Set locals for views
        res.locals.user = req.session.user || null;
        res.locals.success = req.session.success || null;
        res.locals.error = req.session.error || null;
        
        // Log messages for debugging
        if (req.session.success || req.session.error) {
            console.log('Session messages found:', {
                success: req.session.success,
                error: req.session.error
            });
        }
        
        // IMPORTANT: Don't delete the messages here
        // They will be deleted in the controller functions after rendering
    }
    
    // Custom flash function for setting messages
    req.flash = function(type, message) {
        if (!req.session) return;
        
        if (type === 'success') {
            req.session.success = message;
        } else if (type === 'error') {
            req.session.error = message;
        }
    };
    
    next();
});

// Socket.IO setup - only in development
let setupSocketIO = null;
let io = null;

// Only load Socket.IO in development (not on Vercel)
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    try {
        const socketModule = await import('./socketio.js');
        setupSocketIO = socketModule.default;
        
        // Load chat routes only in development
        const chatModule = await import('./chat.js');
        const chatProviderModule = await import('./chat-provider.js');
        chatRoutes = chatModule.default;
        chatProviderRoutes = chatProviderModule.default;
        
        console.log('Socket.IO and chat features loaded for development');
    } catch (error) {
        console.log('Socket.IO not available, running without real-time features');
    }
}

// Set up Socket.IO with session middleware for authentication (development only)
if (setupSocketIO && process.env.NODE_ENV !== 'production') {
    io = setupSocketIO(server, sessionMiddleware);
    
    // Make io available to request objects
    app.use((req, res, next) => {
        req.io = io;
        next();
    });
} else {
    // Provide a dummy io object for production
    app.use((req, res, next) => {
        req.io = {
            emit: () => {},
            to: () => ({ emit: () => {} }),
            in: () => ({ emit: () => {} })
        };
        next();
    });
    console.log('Running in production mode without Socket.IO');
}

// Routes
app.use('/auth', authRoutes);
app.use('/provider', providerRoutes);
app.use('/admin', adminRoutes);
app.use('/customer', customerRoutes);
app.use(bookingRoutes);
app.use('/customer', paymentRoutes);

// Only use chat routes in development
if (chatRoutes && process.env.NODE_ENV !== 'production') {
    app.use('/', chatRoutes);
    app.use('/provider', chatProviderRoutes);
    console.log('Chat routes enabled for development');
} else {
    // Provide basic chat endpoints that return "feature disabled" message
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

// Chat test route - only in development
if (process.env.NODE_ENV !== 'production') {
    app.get('/chat-test', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Chat Test</title>
                <script src="/socket.io/socket.io.js"></script>
                <script>
                    document.addEventListener('DOMContentLoaded', function() {
                        const socket = io({
                            auth: {
                                userType: 'customer'
                            }
                        });
                        
                        socket.on('connect', function() {
                            console.log('Connected to Socket.IO server');
                            document.getElementById('status').textContent = 'Connected';
                            document.getElementById('status').style.color = 'green';
                        });
                        
                        socket.on('connect_error', function(err) {
                            console.error('Connection error:', err);
                            document.getElementById('status').textContent = 'Error: ' + err.message;
                            document.getElementById('status').style.color = 'red';
                        });
                        
                        socket.on('disconnect', function() {
                            console.log('Disconnected from Socket.IO server');
                            document.getElementById('status').textContent = 'Disconnected';
                            document.getElementById('status').style.color = 'red';
                        });
                        
                        document.getElementById('test-btn').addEventListener('click', function() {
                            console.log('Sending test event');
                            socket.emit('test', { message: 'Hello from the client!' });
                        });
                    });
                </script>
            </head>
            <body>
                <h1>Socket.IO Test Page</h1>
                <p>Status: <span id="status">Connecting...</span></p>
                <button id="test-btn">Send Test Event</button>
            </body>
            </html>
        `);
    });
}

// Error handling for 404
app.use((req, res, next) => {
    res.status(404).render('error', {
        title: 'Page Not Found',
        error: { status: 404, message: 'The page you are looking for does not exist.' }
    });
});

// General error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(err.status || 500).render('error', {
        title: 'Error',
        error: { status: err.status || 500, message: err.message || 'An unexpected error occurred' }
    });
});

// ===== DEBUGGING ROUTES - only in development =====
if (process.env.NODE_ENV !== 'production') {
    // Add this temporary route to test sessions
    app.get('/test-session', (req, res) => {
        // Set test messages
        req.session.success = 'This is a test success message';
        req.session.error = 'This is a test error message';
        
        console.log('Test messages set in session:', {
            success: req.session.success,
            error: req.session.error
        });
        
        // Save session explicitly
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).send('Session save error');
            }
            
            // Redirect to a page to see if messages appear
            res.redirect('/auth/customer-login');
        });
    });

    // Add this route to test direct file access
    app.get('/test-image-access', (req, res) => {
        const uploadDir = path.join(__dirname, 'public/uploads/chat_attachments');
        
        // List all files in the directory
        fs.readdir(uploadDir, (err, files) => {
            if (err) {
                return res.status(500).json({ 
                    error: 'Error reading directory', 
                    details: err.message,
                    path: uploadDir
                });
            }
            
            const imageFiles = files.filter(file => 
                file.endsWith('.jpg') || 
                file.endsWith('.jpeg') || 
                file.endsWith('.png') || 
                file.endsWith('.gif')
            );
            
            res.json({
                directory: uploadDir,
                files: files,
                imageFiles: imageFiles,
                testUrl: imageFiles.length > 0 ? `/uploads/chat_attachments/${imageFiles[0]}` : null
            });
        });
    });
}

// For Vercel deployment - export the Express app
export default app;

// Modify server startup for serverless
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

// Export io for potential external use (development only)
// if (io) {
//     export { io };
// }