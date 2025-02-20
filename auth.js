import express from 'express';
import bcrypt from 'bcrypt';
import supabase from './config/supabase.js';
//file upload
import multer from 'multer';

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
    if (!req.session.user) {
        return next();
    }
    // Changed to always redirect to home page
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

const customerRegister = async (req, res) => {
    try {
        const { firstName, lastName, email, phoneNumber, password } = req.body;

        // Check if user exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (existingUser) {
            req.session.error = 'Email already registered';
            return res.redirect('/auth/customer-register');
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const { data: newUser, error } = await supabase
            .from('users')
            .insert([{
                email,
                password: hashedPassword,
                first_name: firstName,
                last_name: lastName,
                phone_number: phoneNumber,
                user_type: 'customer'
            }])
            .select()
            .single();

        if (error) {
            console.error('Registration error:', error);
            req.session.error = 'Registration failed. Please try again.';
            return res.redirect('/auth/customer-register');
        }

        req.session.success = 'Registration successful! Please login.';
        res.redirect('/auth/customer-login');

    } catch (err) {
        console.error('Registration error:', err);
        req.session.error = 'Registration failed. Please try again.';
        res.redirect('/auth/customer-register');
    }
};

const customerLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Get user from database
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .eq('user_type', 'customer')
            .single();

        if (error || !user) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/customer-login');
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/customer-login');
        }

        // Set session
        req.session.user = {
            id: user.id,
            email: user.email,
            name: `${user.first_name} ${user.last_name}`,
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

// Handle provider registration
const providerRegister = async (req, res) => {
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

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user account without checking for existing email
        const { data: newUser, error: userError } = await supabase
            .from('users')
            .insert([{
                email,
                password: hashedPassword,
                user_type: 'provider'
            }])
            .select()
            .single();

        if (userError) throw userError;

        // Upload certification document
        const { data: fileData, error: fileError } = await supabase
            .storage
            .from('certifications')
            .upload(
                `${newUser.id}/${certification.originalname}`,
                certification.buffer,
                {
                    contentType: certification.mimetype
                }
            );

        if (fileError) throw fileError;

        // Create provider profile
        const { data: newProvider, error: providerError } = await supabase
            .from('service_providers')
            .insert([{
                user_id: newUser.id,
                business_name: businessName,
                phone_number: phoneNumber,
                services_offered: JSON.parse(services),
                certification_url: fileData.path,
                verification_status: 'pending'
            }])
            .select()
            .single();

        if (providerError) throw providerError;

        // Insert service categories
        const categoryInserts = serviceCategories.map(category => ({
            provider_id: newProvider.id,
            category_name: category
        }));

        const { error: categoriesError } = await supabase
            .from('provider_service_categories')
            .insert(categoryInserts);

        if (categoriesError) throw categoriesError;

        req.session.success = 'Registration successful! Please wait for admin verification before logging in.';
        res.redirect('/auth/provider-login');

    } catch (err) {
        console.error('Provider registration error:', err);
        req.session.error = 'Registration failed. Please try again.';
        res.redirect('/auth/provider-register');
    }
};

// Handle provider login
const providerLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Get user and provider data
        const { data: user, error: userError } = await supabase
            .from('users')
            .select(`
                *,
                service_providers(*)
            `)
            .eq('email', email)
            .eq('user_type', 'provider')
            .single();

        if (userError || !user) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/provider-login');
        }

        // Check verification status
        if (!user.service_providers[0].is_verified) {
            req.session.error = 'Your account is pending verification. Please wait for admin approval.';
            return res.redirect('/auth/provider-login');
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/auth/provider-login');
        }

        // Set session
        req.session.user = {
            id: user.id,
            email: user.email,
            businessName: user.service_providers[0].business_name,
            userType: 'provider',
            serviceCategory: user.service_providers[0].service_category
        };

        res.redirect('/');

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

export default router;