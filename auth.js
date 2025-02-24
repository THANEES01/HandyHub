import express from 'express';
import bcrypt from 'bcrypt';
import pool from './config/database.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Configure multer for file storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/certifications')
    },
    filename: function (req, file, cb) {
        // Create unique filename: timestamp-originalname
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// File filter
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PDF, JPG, and PNG files are allowed.'));
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// ====== Middleware ======
const isAuth = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    req.session.error = 'Please login to access this page';
    res.redirect('/auth/customer-login');
};

const isGuest = (req, res, next) => {
    if (!req.session?.user) {
        return next();
      }
      res.redirect('/');
};

const isCustomer = (req, res, next) => {
    if (req.session.user && req.session.user.userType === 'customer') {
        return next();
    }
    req.session.error = 'Access denied';
    res.redirect('/auth/customer-login');
};

// ====== Controllers ======
const showCustomerLogin = (req, res) => {
    res.render('auth/customer-login');
};

const showCustomerRegister = (req, res) => {
    res.render('auth/customer-register');
};

// Customer Registration
const customerRegister = async (req, res) => {
    const client = await pool.connect();
    try {
        const { firstName, lastName, email, phoneNumber, password } = req.body;

        await client.query('BEGIN');

        // Check existing user
        const existingUser = await client.query(
            'SELECT id FROM users WHERE email = $1 AND user_type = $2',
            [email, 'customer']
        );

        if (existingUser.rows.length) {
            req.session.error = 'Email already registered';
            return res.redirect('/auth/customer-register');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const newUser = await client.query(
            'INSERT INTO users (email, password, user_type) VALUES ($1, $2, $3) RETURNING id',
            [email, hashedPassword, 'customer']
        );

        // Create customer profile
        await client.query(
            'INSERT INTO customers (user_id, first_name, last_name, phone_number) VALUES ($1, $2, $3, $4)',
            [newUser.rows[0].id, firstName, lastName, phoneNumber]
        );

        await client.query('COMMIT');
        req.session.success = 'Registration successful! Please login.';
        res.redirect('/auth/customer-login');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Customer registration error:', err);
        req.session.error = 'Registration failed. Please try again.';
        res.redirect('/auth/customer-register');
    } finally {
        client.release();
    }
};

// Customer Login
const customerLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        const result = await pool.query(`
            SELECT u.*, c.first_name, c.last_name 
            FROM users u
            JOIN customers c ON u.id = c.user_id
            WHERE u.email = $1 AND u.user_type = $2
        `, [email, 'customer']);

        const user = result.rows[0];

        if (!user) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/customer-login');
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/customer-login');
        }

        req.session.user = {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            userType: 'customer'
        };

        res.redirect('/');

    } catch (err) {
        console.error('Login error:', err);
        req.session.error = 'Login failed. Please try again.';
        res.redirect('/auth/customer-login');
    }
};


const logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Logout error:', err);
        res.redirect('/auth/customer-login');
    });
};

// Service Provider Authentication
// Show provider login page
const showProviderLogin = (req, res) => {
    // Get messages from session
    const error = req.session.error;
    const success = req.session.success;
    
    // Clear messages from session
    delete req.session.error;
    delete req.session.success;
    
    // Render page with messages
    res.render('auth/provider-login', {
        error: error,
        success: success
    });
};

// Show provider registration page
const showProviderRegister = (req, res) => {
    res.render('auth/provider-register', {
        error: req.session.error
    });
};

// Service Provider Registration
const providerRegister = async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            businessName,
            email,
            phoneNumber,
            serviceCategories,
            services,
            password
        } = req.body;

        await client.query('BEGIN');

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const newUser = await client.query(
            'INSERT INTO users (email, password, user_type) VALUES ($1, $2, $3) RETURNING id',
            [email, hashedPassword, 'provider']
        );

        // Create provider profile with certification file path
        const certificationPath = req.file ? `/uploads/certifications/${req.file.filename}` : null;
        
        const newProvider = await client.query(
            'INSERT INTO service_providers (user_id, business_name, phone_number, certification_url) VALUES ($1, $2, $3, $4) RETURNING id',
            [newUser.rows[0].id, businessName, phoneNumber, certificationPath]
        );

        // Insert service categories
        if (Array.isArray(serviceCategories)) {
            for (const category of serviceCategories) {
                await client.query(
                    'INSERT INTO service_categories (provider_id, category_name) VALUES ($1, $2)',
                    [newProvider.rows[0].id, category]
                );
            }
        }

        // Insert services
        const servicesArray = JSON.parse(services);
        if (Array.isArray(servicesArray)) {
            for (const service of servicesArray) {
                await client.query(
                    'INSERT INTO services_offered (provider_id, service_name) VALUES ($1, $2)',
                    [newProvider.rows[0].id, service]
                );
            }
        }

        await client.query('COMMIT');
        req.session.success = 'Registration successful! Please login to continue.';
        req.session.save(() => {
            res.redirect('/auth/provider-login');
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Provider registration error:', err);
        req.session.error = 'Registration failed. Please try again.';
        req.session.save(() => {
            res.redirect('/auth/provider-register');
        });
    } finally {
        client.release();
    }
};

// Handle provider login
const providerLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // First, check if the user exists
        const result = await pool.query(`
            SELECT u.*, sp.id as provider_id, sp.business_name, sp.phone_number, sp.is_verified
            FROM users u 
            JOIN service_providers sp ON u.id = sp.user_id 
            WHERE u.email = $1 AND u.user_type = $2
        `, [email, 'provider']);

        if (result.rows.length === 0) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/provider-login');
        }

        const user = result.rows[0];
        
        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/provider-login');
        }

        // Set user session data
        req.session.user = {
            id: user.id,
            email: user.email,
            businessName: user.business_name,
            phoneNumber: user.phone_number,
            userType: 'provider',
            providerId: user.provider_id,
            isVerified: user.is_verified
        };

        req.session.success = 'Login successful!';

        // Save session and redirect
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                req.session.error = 'Login failed. Please try again.';
                return res.redirect('/auth/provider-login');
            }
            res.redirect('/provider/dashboard');
        });

    } catch (err) {
        console.error('Provider login error:', err);
        req.session.error = 'Login failed. Please try again.';
        res.redirect('/auth/provider-login');
    }
};

const adminLogin = async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const result = await pool.query(`
            SELECT u.*, a.id as admin_id 
            FROM users u
            JOIN admins a ON u.id = a.user_id
            WHERE u.email = 'admin@handyhub.com'
        `);
 
        if (result.rows.length === 0) {
            req.session.error = 'Invalid credentials';
            return res.redirect('/auth/admin-login');
        }
 
        const admin = result.rows[0];
        if (username === 'admin' && password === 'admin123') {
            req.session.user = {
                id: admin.id,
                email: admin.email,
                userType: 'admin',
                adminId: admin.admin_id
            };
            return res.redirect('/admin/dashboard');
        }
 
        req.session.error = 'Invalid credentials';
        res.redirect('/auth/admin-login');
    } catch (err) {
        console.error(err);
        req.session.error = 'Login failed';
        res.redirect('/auth/admin-login');
    }
 };



// ====== Routes ======
// Customer authentication routes
router.get('/customer-login', isGuest, showCustomerLogin);
router.post('/customer-login', isGuest, customerLogin);
router.get('/customer-register', isGuest, showCustomerRegister);
router.post('/customer-register', isGuest, customerRegister);
router.get('/logout', logout);

// Provider authentication routes
router.get('/provider-login', isGuest, showProviderLogin);
router.post('/provider-login', isGuest, providerLogin);
router.get('/provider-register', isGuest, showProviderRegister);
router.post('/provider-register', upload.single('certification'), providerRegister);
// router.post('/provider-login', providerLogin);

// Admin routes
router.get('/admin-login', isGuest, (req, res) => res.render('auth/admin-login'));
router.post('/admin-login', isGuest, adminLogin);

export default router;