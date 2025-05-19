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
import chatRoutes from './chat.js';
import setupSocketIO from './socketio.js';

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
app.set('views', path.join(__dirname, 'views'));

// Define session middleware once
const sessionMiddleware = session({
  secret: 'your-secret-key',
  resave: true,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 
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

// Set up Socket.IO with session middleware
const io = setupSocketIO(server, sessionMiddleware);

// Routes
app.use('/auth', authRoutes);
app.use('/provider', providerRoutes);
app.use('/admin', adminRoutes);
app.use('/customer', customerRoutes);
app.use(bookingRoutes);
app.use('/customer', paymentRoutes);
app.use('/', chatRoutes);

// Home route
app.get('/', (req, res) => {
    res.render('home', { 
        title: 'HandyHub - Professional Home Services'
    });
});

// ===== DEBUGGING ROUTE =====
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});