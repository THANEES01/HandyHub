import express from 'express';
import bcrypt from 'bcrypt';
import pool from './config/database.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { storage as cloudinaryStorage } from './config/cloudinary.js'; // Import Cloudinary storage

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Configure multer to use Cloudinary storage for certifications
const certificationStorage = multer({
    storage: cloudinaryStorage, // Use Cloudinary storage instead of local
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
    if (req.session.user && req.session.user.userType === 'customer') {
        return next();
    }
    req.session.error = 'Access denied';
    res.redirect('/auth/customer-login');
};

const isProvider = (req, res, next) => {
    if (req.session.user && req.session.user.userType === 'provider') {
        return next();
    }
    req.session.error = 'Please login as a service provider';
    res.redirect('/auth/provider-login');
};

// ====== Controllers ======

// FIXED: Customer Login Controller
const showCustomerLogin = (req, res) => {
    // Get messages from session and provide safe defaults
    const error = req.session?.error || null;
    const success = req.session?.success || null;
    
    console.log('Customer login - Messages from session:', { 
        error: error, 
        success: success,
        sessionExists: !!req.session
    });
    
    // Clear messages from session AFTER getting them
    if (req.session) {
        delete req.session.error;
        delete req.session.success;
    }
    
    // Render with explicit null values if no messages
    res.render('auth/customer-login', {
        title: 'Customer Login',
        error: error,
        success: success
    });
};

// FIXED: Customer Register Controller
const showCustomerRegister = (req, res) => {
    // Get messages from session and provide safe defaults
    const error = req.session?.error || null;
    const success = req.session?.success || null;
    
    console.log('Customer register - Messages from session:', { 
        error: error, 
        success: success,
        sessionExists: !!req.session
    });
    
    // Clear messages from session AFTER getting them
    if (req.session) {
        delete req.session.error;
        delete req.session.success;
    }
    
    res.render('auth/customer-register', {
        title: 'Customer Registration',
        error: error,
        success: success
    });
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
            
            // Explicitly save session before redirect
            return req.session.save((err) => {
                if (err) console.error('Session save error:', err);
                return res.redirect('/auth/customer-register');
            });
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
        
        // Explicitly save session before redirect
        return req.session.save((err) => {
            if (err) console.error('Session save error:', err);
            return res.redirect('/auth/customer-login');
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Customer registration error:', err);
        req.session.error = 'Registration failed. Please try again.';
        
        // Explicitly save session before redirect
        return req.session.save((err) => {
            if (err) console.error('Session save error:', err);
            return res.redirect('/auth/customer-register');
        });
    } finally {
        client.release();
    }
};

// Customer Login
const customerLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // First find the user by email
        const userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND user_type = $2',
            [email, 'customer']
        );

        if (userResult.rows.length === 0) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/customer-login');
        }

        const user = userResult.rows[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/customer-login');
        }

        // Get customer details
        const customerResult = await pool.query(
            'SELECT * FROM customers WHERE user_id = $1',
            [user.id]
        );

        if (customerResult.rows.length === 0) {
            req.session.error = 'Customer account not found';
            return res.redirect('/auth/customer-login');
        }

        const customer = customerResult.rows[0];

        // Set session data
        req.session.user = {
            id: user.id,
            email: user.email,
            firstName: customer.first_name,
            lastName: customer.last_name,
            userType: 'customer',
            customerId: customer.id
        };

        // Save session and redirect
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                req.session.error = 'Login failed. Please try again.';
                return res.redirect('/auth/customer-login');
            }
            console.log("Customer session saved successfully, redirecting to dashboard");
            res.redirect('/customer/dashboard');
        });

    } catch (err) {
        console.error('Login error:', err);
        req.session.error = 'Login failed. Please try again.';
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
            }
            res.redirect('/auth/customer-login');
        });
    }
};

const logout = (req, res) => {
    // Store user type before destroying session
    const userType = req.session.user?.userType;
    
    req.session.destroy((err) => {
        if (err) console.error('Logout error:', err);
        
        // Redirect based on previous user type
        if (userType === 'provider') {
            res.redirect('/auth/provider-login');
        } else if (userType === 'admin') {
            res.redirect('/auth/admin-login');
        } else {
            // Default to customer login
            res.redirect('/auth/customer-login');
        }
    });
};

// FIXED: Provider Login Controller
const showProviderLogin = (req, res) => {
    // Get messages from session and provide safe defaults
    const error = req.session?.error || null;
    const success = req.session?.success || null;
    
    console.log('Provider login - Messages from session:', { 
        error: error, 
        success: success,
        sessionExists: !!req.session
    });
    
    // Clear messages from session AFTER getting them
    if (req.session) {
        delete req.session.error;
        delete req.session.success;
    }
    
    res.render('auth/provider-login', {
        title: 'Service Provider Login',
        error: error,
        success: success
    });
};

// FIXED: Provider Register Controller
const showProviderRegister = (req, res) => {
    // Get messages from session and provide safe defaults
    const error = req.session?.error || null;
    const success = req.session?.success || null;
    
    console.log('Provider register - Messages from session:', { 
        error: error, 
        success: success,
        sessionExists: !!req.session
    });
    
    // Clear messages from session AFTER getting them
    if (req.session) {
        delete req.session.error;
        delete req.session.success;
    }
    
    res.render('auth/provider-register', {
        title: 'Service Provider Registration',
        error: error,
        success: success
    });
};

// Service Provider Registration with Cloudinary
const providerRegister = async (req, res) => {
    const client = await pool.connect();
    try {
        // Log full request body for debugging
        console.log("Full request body:", req.body);
        console.log("Request body structure:", Object.keys(req.body));
        console.log("Uploaded file from Cloudinary:", req.file); // Log Cloudinary file info

        const {
            businessName,
            email,
            phoneNumber,
            password,
            services,
            coverageAreas
        } = req.body;

        // Get the serviceCategories from the request body, which might be a single value or an array
        const serviceCategories = req.body.serviceCategories;

        console.log("Registration data:", {
            businessName,
            email,
            phoneNumber,
            serviceCategories: Array.isArray(serviceCategories) ? serviceCategories.length + " categories" : "1 category",
            servicesCount: services ? JSON.parse(services).length : 0,
            coverageAreas: coverageAreas ? JSON.parse(coverageAreas).length : 0,
            cloudinaryFile: req.file ? req.file.path : 'No file uploaded'
        });

        await client.query('BEGIN');

        // Check if email already exists as a provider
        const existingUser = await client.query(
            'SELECT id FROM users WHERE email = $1 AND user_type = $2',
            [email, 'provider']
        );

        if (existingUser.rows.length) {
            req.session.error = 'Email already registered as a provider';
            return res.redirect('/auth/provider-register');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const newUser = await client.query(
            'INSERT INTO users (email, password, user_type) VALUES ($1, $2, $3) RETURNING id',
            [email, hashedPassword, 'provider']
        );

        // Create provider profile with Cloudinary URL
        const certificationUrl = req.file ? req.file.path : null; // Use Cloudinary URL
        
        console.log("Certification URL from Cloudinary:", certificationUrl);
        
        const newProvider = await client.query(
            'INSERT INTO service_providers (user_id, business_name, phone_number, certification_url) VALUES ($1, $2, $3, $4) RETURNING id',
            [newUser.rows[0].id, businessName, phoneNumber, certificationUrl]
        );

        const providerId = newProvider.rows[0].id;

        // Improved extractCategoryData function with better error handling
        function extractCategoryData(body, category) {
            try {
                // Ensure we have a string key for accessing the form data
                const categoryKey = String(category);
                
                // Define field names
                const feeField = `categoryFees[${categoryKey}]`;
                const feeTypeField = `feeTypes[${categoryKey}]`;
                
                console.log(`Looking for fee data: ${feeField}, ${feeTypeField}`);
                
                // Access the fee data safely
                let fee = 0;
                
                // Handle different ways the categoryFees might be structured
                if (body.categoryFees && body.categoryFees[categoryKey]) {
                    const rawFee = body.categoryFees[categoryKey];
                    fee = parseFloat(rawFee) || 0;
                    console.log(`Extracted fee ${fee} from body.categoryFees[${categoryKey}]`);
                } else if (body[feeField]) {
                    const rawFee = body[feeField];
                    fee = parseFloat(rawFee) || 0;
                    console.log(`Extracted fee ${fee} from body[${feeField}]`);
                }
                
                // Ensure fee is a number
                if (isNaN(fee)) {
                    console.log(`Fee is NaN, setting to 0`);
                    fee = 0;
                }
                
                // Handle different ways the feeTypes might be structured
                let feeType = 'per visit'; // Default value
                
                if (body.feeTypes && body.feeTypes[categoryKey]) {
                    feeType = body.feeTypes[categoryKey];
                    console.log(`Extracted feeType ${feeType} from body.feeTypes[${categoryKey}]`);
                } else if (body[feeTypeField]) {
                    feeType = body[feeTypeField];
                    console.log(`Extracted feeType ${feeType} from body[${feeTypeField}]`);
                }
                
                console.log(`Final extracted data for ${category}: ${fee} (${feeType})`);
                
                return {
                    fee: fee,
                    feeType: feeType
                };
            } catch (e) {
                console.error(`Error extracting category data for ${category}:`, e);
                return {
                    fee: 0,
                    feeType: 'per visit'
                };
            }
        }

        // Insert service categories with base fees with improved error handling
        console.log("Beginning service categories insertion");
        
        if (Array.isArray(serviceCategories)) {
            console.log(`Processing ${serviceCategories.length} categories`);
            
            for (const category of serviceCategories) {
                try {
                    console.log(`Processing category: ${category}`);
                    
                    // Extract fee data using the helper function
                    const { fee, feeType } = extractCategoryData(req.body, category);
                    
                    console.log(`Adding category ${category} with fee ${fee} (${feeType})`);
                    
                    await client.query(
                        'INSERT INTO service_categories (provider_id, category_name, base_fee, fee_type) VALUES ($1, $2, $3, $4)',
                        [providerId, category, fee, feeType]
                    );
                    
                    console.log(`Successfully inserted category: ${category}`);
                } catch (error) {
                    console.error(`Error inserting category ${category}:`, error);
                    // Continue with other categories instead of failing the entire transaction
                }
            }
        } else if (serviceCategories) {
            try {
                console.log(`Processing single category: ${serviceCategories}`);
                
                // Handle single category case
                const { fee, feeType } = extractCategoryData(req.body, serviceCategories);
                
                console.log(`Adding single category ${serviceCategories} with fee ${fee} (${feeType})`);
                
                await client.query(
                    'INSERT INTO service_categories (provider_id, category_name, base_fee, fee_type) VALUES ($1, $2, $3, $4)',
                    [providerId, serviceCategories, fee, feeType]
                );
                
                console.log(`Successfully inserted single category: ${serviceCategories}`);
            } catch (error) {
                console.error(`Error inserting single category ${serviceCategories}:`, error);
            }
        } else {
            console.log("No service categories found");
        }

        // Insert provider availability
        if (Array.isArray(req.body.availableDays)) {
            for (const day of req.body.availableDays) {
                const startTime = req.body[`startTime_${day}`];
                const endTime = req.body[`endTime_${day}`];
                const slotDuration = parseInt(req.body.slotDuration);
                
                await client.query(
                    'INSERT INTO provider_availability (provider_id, day_of_week, start_time, end_time, slot_duration, is_available) VALUES ($1, $2, $3, $4, $5, $6)',
                    [providerId, day, startTime, endTime, slotDuration, true]
                );
            }
        } else if (req.body.availableDays) {
            // Handle single day case
            const day = req.body.availableDays;
            const startTime = req.body[`startTime_${day}`];
            const endTime = req.body[`endTime_${day}`];
            const slotDuration = parseInt(req.body.slotDuration);
            
            await client.query(
                'INSERT INTO provider_availability (provider_id, day_of_week, start_time, end_time, slot_duration, is_available) VALUES ($1, $2, $3, $4, $5, $6)',
                [providerId, day, startTime, endTime, slotDuration, true]
            );
        }

        // Insert services
        if (services) {
            const servicesArray = JSON.parse(services);
            if (Array.isArray(servicesArray)) {
                for (const service of servicesArray) {
                    await client.query(
                        'INSERT INTO services_offered (provider_id, service_name) VALUES ($1, $2)',
                        [providerId, service]
                    );
                }
            }
        }

        // Insert coverage areas
        if (coverageAreas) {
            const coverageAreasArray = JSON.parse(coverageAreas);
            
            if (Array.isArray(coverageAreasArray) && coverageAreasArray.length > 0) {
                console.log(`Adding ${coverageAreasArray.length} coverage areas`);
                
                for (const area of coverageAreasArray) {
                    // First check if the city exists in our database
                    let cityResult = await client.query(
                        'SELECT id FROM cities WHERE city_name = $1 AND state_id = $2',
                        [area.cityName, area.stateId]
                    );
                    
                    let cityId;
                    
                    // If city doesn't exist, insert it
                    if (cityResult.rows.length === 0) {
                        // First check if state exists
                        let stateResult = await client.query(
                            'SELECT id FROM states WHERE id = $1',
                            [area.stateId]
                        );
                        
                        // If state doesn't exist, insert it
                        if (stateResult.rows.length === 0) {
                            const newState = await client.query(
                                'INSERT INTO states (id, state_name) VALUES ($1, $2) RETURNING id',
                                [area.stateId, area.stateName]
                            );
                        }
                        
                        // Insert the city
                        const newCity = await client.query(
                            'INSERT INTO cities (city_name, state_id) VALUES ($1, $2) RETURNING id',
                            [area.cityName, area.stateId]
                        );
                        
                        cityId = newCity.rows[0].id;
                    } else {
                        cityId = cityResult.rows[0].id;
                    }
                    
                    // Insert the provider coverage
                    await client.query(
                        'INSERT INTO provider_coverage (provider_id, city_id) VALUES ($1, $2)',
                        [providerId, cityId]
                    );
                    
                    console.log(`Added coverage for ${area.cityName}, ${area.stateName}`);
                }
            }
        }

        await client.query('COMMIT');
        
        // Set success message and explicitly save session before redirecting
        req.session.success = 'Registration successful! Please login to continue. Your account will be verified by our admin team shortly.';
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
            }
            res.redirect('/auth/provider-login');
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Provider registration error:', err);
        
        // Set error message and explicitly save session before redirecting
        req.session.error = 'Registration failed. Please check your information and try again.';
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
            }
            res.redirect('/auth/provider-register');
        });
    } finally {
        client.release();
    }
};

// Handle provider login
const providerLogin = async (req, res) => {
    try {
        console.log("Provider login attempt:", req.body.email);
        const { email, password } = req.body;
        
        // First find the user by email
        const userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND user_type = $2',
            [email, 'provider']
        );

        console.log("User query result:", userResult.rows.length > 0 ? "User found" : "No user found");

        if (userResult.rows.length === 0) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/provider-login');
        }

        const user = userResult.rows[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/provider-login');
        }

        // Get provider details
        const providerResult = await pool.query(
            'SELECT * FROM service_providers WHERE user_id = $1',
            [user.id]
        );

        if (providerResult.rows.length === 0) {
            req.session.error = 'Provider account not found';
            return res.redirect('/auth/provider-login');
        }

        const provider = providerResult.rows[0];
        
        // Check if provider is verified
        if (!provider.is_verified) {
            req.session.error = 'Your account is pending verification by our admin. Please check back later.';
            return res.redirect('/auth/provider-login');
        }

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

        console.log("Provider session data set:", req.session.user);

        // Save session explicitly and redirect
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                req.session.error = 'Login failed. Please try again.';
                return res.redirect('/auth/provider-login');
            }
            console.log("Provider session saved successfully, redirecting to dashboard");
            return res.redirect('/provider/dashboard');
        });

    } catch (err) {
        console.error('Provider login error:', err);
        req.session.error = 'Login failed. Please try again.';
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
            }
            res.redirect('/auth/provider-login');
        });
    }
};

const adminLogin = async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Simple admin login check
        if (username === 'admin' && password === 'admin123') {
            const result = await pool.query(`
                SELECT u.*, a.id as admin_id 
                FROM users u
                JOIN admins a ON u.id = a.user_id
                WHERE u.email = 'admin@handyhub.com'
            `);
     
            if (result.rows.length === 0) {
                req.session.error = 'Admin account not configured. Please contact system administrator.';
                return res.redirect('/auth/admin-login');
            }
     
            const admin = result.rows[0];
            req.session.user = {
                id: admin.id,
                email: admin.email,
                userType: 'admin',
                adminId: admin.admin_id
            };
            
            // Save session explicitly and redirect
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    req.session.error = 'Login failed. Please try again.';
                    return res.redirect('/auth/admin-login');
                }
                return res.redirect('/admin/dashboard');
            });
        } else {
            req.session.error = 'Invalid username or password';
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                }
                res.redirect('/auth/admin-login');
            });
        }
    } catch (err) {
        console.error('Admin login error:', err);
        req.session.error = 'Login failed. Please try again.';
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
            }
            res.redirect('/auth/admin-login');
        });
    }
};

// Debug route to check session
router.get('/check-session', (req, res) => {
    res.json({
        session: req.session,
        sessionID: req.sessionID,
        user: req.session.user || 'No user in session'
    });
});

// ====== Routes ======

// NEW: General login route (fixes the 404 error)
router.get('/login', (req, res) => {
    res.render('auth/login-selection', { 
        title: 'Login to HandyHub',
        error: null,
        success: null
    });
});

// If you don't have a login-selection.ejs template, use this simple redirect instead:
// router.get('/login', (req, res) => {
//     res.redirect('/auth/customer-login');
// });

// Customer authentication routes
router.get('/customer-login', isGuest, showCustomerLogin);
router.post('/customer-login', customerLogin);
router.get('/customer-register', isGuest, showCustomerRegister);
router.post('/customer-register', customerRegister);
router.get('/logout', logout);

// Provider authentication routes
router.get('/provider-login', isGuest, showProviderLogin);
router.post('/provider-login', providerLogin);
router.get('/provider-register', isGuest, showProviderRegister);
router.post('/provider-register', certificationStorage.single('certification'), providerRegister); // Use Cloudinary storage

// FIXED: Admin login route
router.get('/admin-login', isGuest, (req, res) => {
    // Get messages from session and provide safe defaults
    const error = req.session?.error || null;
    const success = req.session?.success || null;
    
    console.log('Admin login - Messages from session:', { 
        error: error, 
        success: success,
        sessionExists: !!req.session
    });
    
    // Clear messages from session AFTER getting them
    if (req.session) {
        delete req.session.error;
        delete req.session.success;
    }
    
    res.render('auth/admin-login', {
        title: 'Admin Login',
        error: error,
        success: success
    });
});

router.post('/admin-login', adminLogin);

export default router;