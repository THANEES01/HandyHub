import express from 'express';
import bcrypt from 'bcrypt';
import pool from './config/database.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { storage as cloudinaryStorage } from './config/cloudinary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Environment detection for logging
const isLocalDevelopment = !process.env.VERCEL_ENV && process.env.NODE_ENV !== 'production';

// Configure multer to use Cloudinary storage for certifications
const certificationStorage = multer({
    storage: cloudinaryStorage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, JPG, and PNG files are allowed.'));
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// ====== Middleware ======
const isAuth = (req, res, next) => {
    if (req.session?.user) {
        return next();
    }
    req.flash('error', 'Please login to access this page');
    res.redirect('/auth/customer-login');
};

const isGuest = (req, res, next) => {
    if (!req.session?.user) {
        return next();
    }
    
    // Redirect based on user type if already logged in
    if (req.session.user.userType === 'provider') {
        return res.redirect('/provider/dashboard');
    } else if (req.session.user.userType === 'customer') {
        return res.redirect('/customer/dashboard');
    } else if (req.session.user.userType === 'admin') {
        return res.redirect('/admin/dashboard');
    }
    
    res.redirect('/');
};

const isCustomer = (req, res, next) => {
    if (req.session?.user && req.session.user.userType === 'customer') {
        return next();
    }
    req.flash('error', 'Access denied');
    res.redirect('/auth/customer-login');
};

const isProvider = (req, res, next) => {
    if (req.session?.user && req.session.user.userType === 'provider') {
        return next();
    }
    req.flash('error', 'Please login as a service provider');
    res.redirect('/auth/provider-login');
};

// ====== Helper Functions ======
const renderWithMessages = (req, res, template, data = {}) => {
    const error = req.session?.error || null;
    const success = req.session?.success || null;
    
    if (isLocalDevelopment) {
        console.log(`Rendering ${template} with messages:`, { 
            error: error, 
            success: success,
            hasSession: !!req.session,
            sessionID: req.sessionID?.substring(0, 8) + '...'
        });
    }
    
    // Clear messages from session BEFORE rendering
    if (req.session) {
        delete req.session.error;
        delete req.session.success;
    }
    
    // Render with the captured messages
    res.render(template, {
        title: data.title || 'HandyHub',
        error: error,
        success: success,
        user: req.session?.user || null,
        ...data
    });
};

// ====== Controllers ======
const showCustomerLogin = (req, res) => {
    renderWithMessages(req, res, 'auth/customer-login', {
        title: 'Customer Login'
    });
};

const showCustomerRegister = (req, res) => {
    renderWithMessages(req, res, 'auth/customer-register', {
        title: 'Customer Registration'
    });
};

// Customer Registration
const customerRegister = async (req, res) => {
    const client = await pool.connect();
    try {
        const { firstName, lastName, email, phoneNumber, password } = req.body;

        if (isLocalDevelopment) console.log('Customer registration attempt for:', email);

        await client.query('BEGIN');

        // Check existing user in users table
        const existingUser = await client.query(
            'SELECT id FROM users WHERE email = $1 AND user_type = $2',
            [email, 'customer']
        );

        if (existingUser.rows.length) {
            await client.query('ROLLBACK');
            req.flash('error', 'Email already registered');
            return res.redirect('/auth/customer-register');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user in users table
        const newUser = await client.query(
            'INSERT INTO users (email, password, user_type) VALUES ($1, $2, $3) RETURNING id',
            [email, hashedPassword, 'customer']
        );

        // Create customer profile in customers table
        await client.query(
            'INSERT INTO customers (user_id, first_name, last_name, phone_number) VALUES ($1, $2, $3, $4)',
            [newUser.rows[0].id, firstName, lastName, phoneNumber]
        );

        await client.query('COMMIT');
        
        if (isLocalDevelopment) console.log('Customer registration successful for:', email);
        
        req.flash('success', 'Registration successful! Please login.');
        res.redirect('/auth/customer-login');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Customer registration error:', err);
        req.flash('error', 'Registration failed. Please try again.');
        res.redirect('/auth/customer-register');
    } finally {
        client.release();
    }
};

// Customer Login - FIXED VERSION
const customerLogin = async (req, res) => {
   try {
        const { email, password } = req.body;
        
        if (isLocalDevelopment) console.log('Customer login attempt for:', email);

        // FIXED: Query for customer, not provider
        const userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND user_type = $2',
            [email, 'customer']  // Changed from 'provider' to 'customer'
        );

        if (userResult.rows.length === 0) {
            if (isLocalDevelopment) console.log('Customer user not found:', email);
            req.flash('error', 'Invalid email or password');
            return res.redirect('/auth/customer-login');  // Fixed redirect
        }

        const user = userResult.rows[0];
        if (isLocalDevelopment) console.log('Customer user found, verifying password...');

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            if (isLocalDevelopment) console.log('Invalid password for customer:', email);
            req.flash('error', 'Invalid email or password');
            return res.redirect('/auth/customer-login');  // Fixed redirect
        }

        if (isLocalDevelopment) console.log('Password verified, getting customer details...');

        // FIXED: Query customers table, not service_providers
        const customerResult = await pool.query(
            'SELECT * FROM customers WHERE user_id = $1',
            [user.id]
        );

        if (customerResult.rows.length === 0) {
            if (isLocalDevelopment) console.log('Customer profile not found for user:', user.id);
            req.flash('error', 'Customer account not found');
            return res.redirect('/auth/customer-login');  // Fixed redirect
        }

        const customer = customerResult.rows[0];
        if (isLocalDevelopment) console.log('Customer profile found, setting session...');

        // FIXED: Set customer session data, not provider data
        req.session.user = {
            id: user.id,
            email: user.email,
            firstName: customer.first_name,
            lastName: customer.last_name,
            phoneNumber: customer.phone_number,
            userType: 'customer',  // Fixed userType
            customerId: customer.id  // Fixed to customerId
        };

        if (isLocalDevelopment) console.log('Customer session data set:', req.session.user);

        // Force session save and redirect
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                req.flash('error', 'Login failed. Please try again.');
                return res.redirect('/auth/customer-login');  // Fixed redirect
            }
            
            if (isLocalDevelopment) console.log("Customer session saved successfully, redirecting to dashboard");
            res.redirect('/customer/dashboard');  // Fixed redirect to customer dashboard
        });

    } catch (err) {
        console.error('Customer login error:', err);
        req.flash('error', 'Login failed. Please try again.');
        res.redirect('/auth/customer-login');  // Fixed redirect
    }
};

// Provider Login - FIXED VERSION
const providerLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (isLocalDevelopment) console.log('Provider login attempt for:', email);

        const userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND user_type = $2',
            [email, 'provider']
        );

        if (userResult.rows.length === 0) {
            if (isLocalDevelopment) console.log('Provider user not found:', email);
            req.flash('error', 'Invalid email or password');
            return res.redirect('/auth/provider-login');
        }

        const user = userResult.rows[0];
        if (isLocalDevelopment) console.log('Provider user found, verifying password...');

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            if (isLocalDevelopment) console.log('Invalid password for provider:', email);
            req.flash('error', 'Invalid email or password');
            return res.redirect('/auth/provider-login');
        }

        if (isLocalDevelopment) console.log('Password verified, getting provider details...');

        const providerResult = await pool.query(
            'SELECT * FROM service_providers WHERE user_id = $1',
            [user.id]
        );

        if (providerResult.rows.length === 0) {
            if (isLocalDevelopment) console.log('Provider profile not found for user:', user.id);
            req.flash('error', 'Provider account not found');
            return res.redirect('/auth/provider-login');
        }

        const provider = providerResult.rows[0];
        if (isLocalDevelopment) console.log('Provider profile found, checking verification...');

        if (!provider.is_verified) {
            if (isLocalDevelopment) console.log('Provider not verified:', email);
            req.flash('error', 'Your account is pending verification by our admin. Please check back later.');
            return res.redirect('/auth/provider-login');
        }

        if (isLocalDevelopment) console.log('Provider verified, setting session...');

        // Set session data
        req.session.user = {
            id: user.id,
            email: user.email,
            businessName: provider.business_name,
            phoneNumber: provider.phone_number,
            userType: 'provider',
            providerId: provider.id,
            isVerified: provider.is_verified
        };

        if (isLocalDevelopment) console.log('Provider session data set:', req.session.user);

        // Force session save and redirect
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                req.flash('error', 'Login failed. Please try again.');
                return res.redirect('/auth/provider-login');
            }
            
            if (isLocalDevelopment) console.log("Provider session saved successfully, redirecting to dashboard");
            res.redirect('/provider/dashboard');
        });

    } catch (err) {
        console.error('Provider login error:', err);
        req.flash('error', 'Login failed. Please try again.');
        res.redirect('/auth/provider-login');
    }
};

// Admin Login - FIXED VERSION
const adminLogin = async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (isLocalDevelopment) console.log('Admin login attempt for:', username);
        
        if (username === 'admin' && password === 'admin123') {
            if (isLocalDevelopment) console.log('Admin credentials valid, checking database...');
            
            const userResult = await pool.query(
                'SELECT u.*, a.id as admin_id FROM users u JOIN admins a ON u.id = a.user_id WHERE u.email = $1 AND u.user_type = $2',
                ['admin@handyhub.com', 'admin']
            );

            let adminUser;
            let adminId;

            if (userResult.rows.length === 0) {
                if (isLocalDevelopment) console.log('Admin user not found, creating...');
                
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    
                    const hashedPassword = await bcrypt.hash('admin123', 10);
                    const newUser = await client.query(
                        'INSERT INTO users (email, password, user_type) VALUES ($1, $2, $3) RETURNING *',
                        ['admin@handyhub.com', hashedPassword, 'admin']
                    );
                    
                    const newAdmin = await client.query(
                        'INSERT INTO admins (user_id, username, is_super_admin) VALUES ($1, $2, $3) RETURNING id',
                        [newUser.rows[0].id, 'admin', true]
                    );
                    
                    await client.query('COMMIT');
                    
                    adminUser = newUser.rows[0];
                    adminId = newAdmin.rows[0].id;
                    
                    if (isLocalDevelopment) console.log('Admin user created successfully');
                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
            } else {
                adminUser = userResult.rows[0];
                adminId = userResult.rows[0].admin_id;
                if (isLocalDevelopment) console.log('Admin user found in database');
            }

            if (isLocalDevelopment) console.log('Setting admin session...');

            // Set session data
            req.session.user = {
                id: adminUser.id,
                email: adminUser.email,
                username: 'admin',
                userType: 'admin',
                adminId: adminId,
                isSuperAdmin: true
            };
            
            if (isLocalDevelopment) console.log('Admin session data set:', req.session.user);
            
            // Force session save and redirect
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    req.flash('error', 'Login failed. Please try again.');
                    return res.redirect('/auth/admin-login');
                }
                
                if (isLocalDevelopment) console.log("Admin session saved successfully, redirecting to dashboard");
                res.redirect('/admin/dashboard');
            });
        } else {
            if (isLocalDevelopment) console.log('Invalid admin credentials provided');
            req.flash('error', 'Invalid username or password');
            res.redirect('/auth/admin-login');
        }
    } catch (err) {
        console.error('Admin login error:', err);
        req.flash('error', 'Login failed. Please try again.');
        res.redirect('/auth/admin-login');
    }
};

// Logout
const logout = (req, res) => {
    // Store user type before destroying session
    const userType = req.session?.user?.userType;
    
    if (isLocalDevelopment) console.log('Logging out user type:', userType);
    
    req.session.destroy((err) => {
        if (err && isLocalDevelopment) console.error('Logout error:', err);
        
        // Clear cookie as well
        res.clearCookie('handyhub.sid');
        
        // Redirect based on previous user type
        if (userType === 'provider') {
            res.redirect('/auth/provider-login');
        } else if (userType === 'admin') {
            res.redirect('/auth/admin-login');
        } else {
            res.redirect('/auth/customer-login');
        }
    });
};

const showProviderLogin = (req, res) => {
    renderWithMessages(req, res, 'auth/provider-login', {
        title: 'Service Provider Login'
    });
};

const showProviderRegister = (req, res) => {
    renderWithMessages(req, res, 'auth/provider-register', {
        title: 'Service Provider Registration'
    });
};

// Provider Registration
const providerRegister = async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            businessName,
            email,
            phoneNumber,
            password,
            services,
            coverageAreas
        } = req.body;

        // Get the serviceCategories from the request body
        const serviceCategories = req.body.serviceCategories;

        if (isLocalDevelopment) console.log('Provider registration attempt for:', email);

        await client.query('BEGIN');

        // Check if email already exists as a provider
        const existingUser = await client.query(
            'SELECT id FROM users WHERE email = $1 AND user_type = $2',
            [email, 'provider']
        );

        if (existingUser.rows.length) {
            await client.query('ROLLBACK');
            req.flash('error', 'Email already registered as a provider');
            return res.redirect('/auth/provider-register');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user in users table
        const newUser = await client.query(
            'INSERT INTO users (email, password, user_type) VALUES ($1, $2, $3) RETURNING id',
            [email, hashedPassword, 'provider']
        );

        // Get certification URL from Cloudinary
        const certificationUrl = req.file ? req.file.path : null;

        // Create provider profile in service_providers table
        const newProvider = await client.query(
            'INSERT INTO service_providers (user_id, business_name, phone_number, certification_url, is_verified, verification_status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [newUser.rows[0].id, businessName, phoneNumber, certificationUrl, false, 'pending']
        );

        const providerId = newProvider.rows[0].id;

        // Insert service categories if provided
        if (serviceCategories && Array.isArray(serviceCategories)) {
            for (const category of serviceCategories) {
                if (category.trim()) {
                    await client.query(
                        'INSERT INTO service_categories (provider_id, category_name, base_fee, fee_type) VALUES ($1, $2, $3, $4)',
                        [providerId, category.trim(), 0, 'per visit']
                    );
                }
            }
        }

        // Insert services if provided
        if (services && Array.isArray(services)) {
            for (const service of services) {
                if (service.trim()) {
                    await client.query(
                        'INSERT INTO services_offered (provider_id, service_name) VALUES ($1, $2)',
                        [providerId, service.trim()]
                    );
                }
            }
        }

        // Insert coverage areas if provided
        if (coverageAreas) {
            try {
                const coverageAreasArray = JSON.parse(coverageAreas);
                if (Array.isArray(coverageAreasArray)) {
                    for (const area of coverageAreasArray) {
                        if (area && area.cityId) {
                            await client.query(
                                'INSERT INTO provider_coverage (provider_id, city_id) VALUES ($1, $2)',
                                [providerId, area.cityId]
                            );
                        }
                    }
                }
            } catch (e) {
                console.error('Error parsing coverage areas:', e);
            }
        }

        await client.query('COMMIT');
        
        if (isLocalDevelopment) console.log('Provider registration successful for:', email);
        
        req.flash('success', 'Registration successful! Please login to continue. Your account will be verified by our admin team shortly.');
        res.redirect('/auth/provider-login');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Provider registration error:', err);
        
        req.flash('error', 'Registration failed. Please check your information and try again.');
        res.redirect('/auth/provider-register');
    } finally {
        client.release();
    }
};

// Debug route to check session
router.get('/check-session', (req, res) => {
    res.json({
        session: {
            exists: !!req.session,
            id: req.sessionID,
            user: req.session?.user || null,
            cookie: req.session?.cookie || null
        },
        environment: {
            isLocalDevelopment,
            nodeEnv: process.env.NODE_ENV,
            vercelEnv: process.env.VERCEL_ENV
        },
        timestamp: new Date().toISOString()
    });
});

// ====== Routes ======

// Generic login route - redirect to customer login by default
router.get('/login', (req, res) => {
    if (isLocalDevelopment) console.log('Generic /auth/login accessed, redirecting to customer login');
    res.redirect('/auth/customer-login');
});

// Handle any POST to /login
router.post('/login', (req, res) => {
    if (isLocalDevelopment) console.log('POST to generic /auth/login, redirecting to customer login');
    res.redirect('/auth/customer-login');
});

// Customer authentication routes
router.get('/customer-login', isGuest, showCustomerLogin);
router.post('/customer-login', customerLogin);
router.get('/customer-register', isGuest, showCustomerRegister);
router.post('/customer-register', customerRegister);

// Provider authentication routes
router.get('/provider-login', isGuest, showProviderLogin);
router.post('/provider-login', providerLogin);
router.get('/provider-register', isGuest, showProviderRegister);
router.post('/provider-register', certificationStorage.single('certification'), providerRegister);

// Admin routes
router.get('/admin-login', isGuest, (req, res) => {
    renderWithMessages(req, res, 'auth/admin-login', {
        title: 'Admin Login'
    });
});
router.post('/admin-login', adminLogin);

// Logout route
router.get('/logout', logout);

// Catch-all for any other auth routes that might be accessed
router.get('*', (req, res) => {
    if (isLocalDevelopment) console.log(`Unknown auth route accessed: ${req.path}, redirecting to customer login`);
    res.redirect('/auth/customer-login');
});

export default router;