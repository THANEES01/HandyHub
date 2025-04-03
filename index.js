import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import authRoutes from './auth.js'; // Import authRoutes
import providerRoutes from './provider.js'; // Import providerRoutes
import adminRoutes from './admin.js'; // Import adminRoutes
import customerRoutes from './customer.js';
import bookingRoutes from './booking.js';
import paymentRoutes from './payment.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Add this in your middleware setup section, before setting up routes
// This is important for Stripe webhook handling (raw body needed)
app.use('/customer/webhook', express.raw({ type: 'application/json' }));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// For Desktop uploads path (based on your console log)
// const desktopUploadsPath = 'C:\\Users\\ASUS\\OneDrive\\Desktop\\public\\uploads';
// app.use('/uploads', express.static(desktopUploadsPath));

// For common image placeholders
app.use('/img', express.static(path.join(__dirname, 'public/img')));

// Log the static serving paths to verify
// console.log('Static serving paths:');
// console.log('- Main public:', path.join(__dirname, 'public'));
// console.log('- Standard uploads:', path.join(__dirname, 'public/uploads'));
// console.log('- Alternative uploads:', path.join(__dirname, '../public/uploads'));
// console.log('- Desktop uploads:', desktopUploadsPath);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session setup
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Only use secure cookies in production
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Flash message middleware
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.success = req.session.success || null;
    res.locals.error = req.session.error || null;
    
    // Clear flash messages after displaying them
    delete req.session.success;
    delete req.session.error;
    
    next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/provider', providerRoutes);
app.use('/admin', adminRoutes);
app.use('/customer', customerRoutes);
app.use(bookingRoutes);
app.use('/customer', paymentRoutes);

// Home route
app.get('/', (req, res) => {
    res.render('home', { 
        title: 'HandyHub - Professional Home Services'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});