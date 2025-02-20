import express from 'express';
import bcrypt from 'bcrypt';
import pool from './config/database.js';
//file upload
import multer from 'multer';
import session from 'express-session';

// Add at the top of your auth.js, before defining routes
// router.use(session({
//     secret: 'your-secret-key',
//     resave: false,
//     saveUninitialized: true,
//     cookie: { secure: false } // Set to true if using HTTPS
//   }));

const router = express.Router();

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

//file upload middleware
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG and PDF files are allowed.'));
        }
    }
});

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
    res.render('auth/provider-login', {
        error: req.session.error,
        success: req.session.success
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

        const certification = req.file;
        const hashedPassword = await bcrypt.hash(password, 10);

        await client.query('BEGIN');

        // Create user
        const newUser = await client.query(
            'INSERT INTO users (email, password, user_type) VALUES ($1, $2, $3) RETURNING id',
            [email, hashedPassword, 'provider']
        );

        // Create provider profile
        const certificationUrl = certification ? certification.filename : null;
        const newProvider = await client.query(
            'INSERT INTO service_providers (user_id, business_name, phone_number, certification_url) VALUES ($1, $2, $3, $4) RETURNING id',
            [newUser.rows[0].id, businessName, phoneNumber, certificationUrl]
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
        req.session.success = 'Registration successful! Please wait for admin verification.';
        res.redirect('/auth/provider-login');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Provider registration error:', err);
        req.session.error = 'Registration failed. Please try again.';
        res.redirect('/auth/provider-register');
    } finally {
        client.release();
    }
};

// Handle provider login
const providerLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        const result = await pool.query(`
            SELECT u.*, sp.id as provider_id, sp.business_name, sp.is_verified 
            FROM users u 
            JOIN service_providers sp ON u.id = sp.user_id 
            WHERE u.email = $1 AND u.user_type = $2
        `, [email, 'provider']);

        const user = result.rows[0];

        if (!user) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/provider-login');
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/provider-login');
        }

        if (!user.is_verified) {
            req.session.error = 'Account pending verification. Please wait for admin approval.';
            return res.redirect('/auth/provider-login');
        }

        req.session.user = {
            id: user.id,
            email: user.email,
            businessName: user.business_name,
            userType: 'provider',
            providerId: user.provider_id
        };

        res.redirect('/provider/dashboard');

    } catch (err) {
        console.error('Provider login error:', err);
        req.session.error = 'Login failed. Please try again.';
        res.redirect('/auth/provider-login');
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
router.post('/provider-login', providerLogin);

export default router;