import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import authRoutes from './Routes/auth.routes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
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