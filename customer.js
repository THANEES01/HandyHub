import express from 'express';
import pool from './config/database.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';

// Get current file path (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure storage for Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../public/uploads/booking_images/');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename with timestamp
        const timestamp = Date.now();
        const originalName = file.originalname.replace(/\s+/g, '_');
        cb(null, `${timestamp}_${originalName}`);
    }
});

// File filter to only allow images
const fileFilter = (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

// Create the Multer middleware
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max file size
    },
    fileFilter: fileFilter
});

// Middleware to handle Multer errors
const handleMulterErrors = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // A Multer error occurred during file upload
        let errorMessage = 'An error occurred during file upload.';
        
        if (err.code === 'LIMIT_FILE_SIZE') {
            errorMessage = 'File size exceeds the 10MB limit.';
        } else if (err.code === 'LIMIT_FILE_COUNT') {
            errorMessage = 'Too many files. Maximum 5 files allowed.';
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            errorMessage = 'Unexpected field name for file upload.';
        }
        
        req.session.error = errorMessage;
        return res.redirect(`/customer/book-service/${req.body.providerId}`);
    } else if (err) {
        // Other errors
        req.session.error = err.message || 'An unexpected error occurred.';
        return res.redirect(`/customer/book-service/${req.body.providerId}`);
    }
    
    // If no error, continue
    next();
};

// Middleware to check if user is logged in
const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/auth/login');
    }
};

// Middleware to check if user is logged in as customer
const isCustomerAuth = (req, res, next) => {
    if (req.session.user && req.session.user.userType === 'customer') {
        next();
    } else {
        res.redirect('/auth/customer-login');
    }
};

// Add more routes as needed
router.get('/', isAuthenticated, (req, res) => {
    res.redirect('/customer/dashboard');
});

router.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        // These would typically come from your database
        const user = req.session.user || { name: 'Customer' };
        const totalBookings = 5;  // Example data
        const activeServices = 2;
        const totalSpent = 3500;
        const completedBookings = 3;

        const recentBookings = [
            { 
                serviceName: 'Plumbing Repair', 
                bookingDate: '2023-06-15', 
                status: 'Pending' 
            },
            { 
                serviceName: 'AC Servicing', 
                bookingDate: '2023-06-10', 
                status: 'Completed' 
            }
        ];

        const activeServicesList = [
            { 
                name: 'Home Cleaning', 
                providerName: 'CleanPro Services', 
                startDate: '2023-06-20' 
            }
        ];

        // Get all unique categories from the service_categories table
        const categoriesResult = await pool.query(`
            SELECT DISTINCT category_name 
            FROM service_categories 
            ORDER BY category_name ASC
        `);

        res.render('customer/customer-dashboard', { 
            title: 'Customer Dashboard',
            user,
            totalBookings,
            activeServices,
            totalSpent,
            completedBookings,
            recentBookings,
            activeServicesList,
            categories: categoriesResult.rows  // Add this line to pass categories to the template
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        
        // Render the dashboard even if there's an error fetching categories
        res.render('customer/customer-dashboard', { 
            title: 'Customer Dashboard',
            user: req.session.user || { name: 'Customer' },
            totalBookings: 0,
            activeServices: 0,
            totalSpent: 0,
            completedBookings: 0,
            recentBookings: [],
            activeServicesList: [],
            categories: []  // Empty categories array as fallback
        });
    }
});

router.get('/categories', isCustomerAuth, async (req, res) => {
    try {
        // Get all unique categories from the service_categories table
        const categoriesResult = await pool.query(`
            SELECT DISTINCT category_name 
            FROM service_categories 
            ORDER BY category_name ASC
        `);
        
        res.render('customer/service-categories', { 
            title: 'Service Categories',
            user: req.session.user,
            categories: categoriesResult.rows
        });
    } catch (error) {
        console.error('Error fetching categories:', error);
        req.session.error = 'Failed to load service categories';
        res.redirect('/customer/dashboard');
    }
});

// View service providers by category
router.get('/category/:categoryName', isCustomerAuth, async (req, res) => {
    try {
        const categoryName = req.params.categoryName;
        
        // Get all service providers that offer services in this category
        const providersResult = await pool.query(`
            SELECT DISTINCT sp.id, sp.business_name, sp.phone_number, 
                   u.email, sp.is_verified
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            JOIN service_categories sc ON sp.id = sc.provider_id
            WHERE sc.category_name = $1 AND sp.is_verified = true
            ORDER BY sp.business_name ASC
        `, [categoryName]);
        
        // For each provider, get their services in this category
        const providers = [];
        for (const provider of providersResult.rows) {
            // Get services offered by this provider in this category
            const servicesResult = await pool.query(`
                SELECT so.service_name
                FROM services_offered so
                JOIN service_categories sc ON so.provider_id = sc.provider_id
                WHERE so.provider_id = $1 AND sc.category_name = $2
            `, [provider.id, categoryName]);
            
            providers.push({
                ...provider,
                services: servicesResult.rows
            });
        }
        
        res.render('customer/providers-by-category', { 
            title: `${categoryName} Service Providers`,
            user: req.session.user,
            category: categoryName,
            providers: providers
        });
    } catch (error) {
        console.error('Error fetching providers by category:', error);
        req.session.error = 'Failed to load service providers';
        res.redirect('/customer/categories');
    }
});

// View service provider details
router.get('/provider/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const providerId = req.params.providerId;
        
        // Get provider details
        const providerResult = await pool.query(`
            SELECT sp.id, sp.business_name, sp.phone_number, u.email,
                   sp.certification_url, sp.is_verified
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            WHERE sp.id = $1 AND sp.is_verified = true
        `, [providerId]);
        
        if (providerResult.rows.length === 0) {
            req.session.error = 'Service provider not found';
            return res.redirect('/customer/categories');
        }
        
        const provider = providerResult.rows[0];
        
        // Get all categories offered by this provider
        const categoriesResult = await pool.query(`
            SELECT category_name
            FROM service_categories
            WHERE provider_id = $1
            ORDER BY category_name ASC
        `, [providerId]);
        
        // Get all services offered by this provider
        const servicesResult = await pool.query(`
            SELECT service_name
            FROM services_offered
            WHERE provider_id = $1
            ORDER BY service_name ASC
        `, [providerId]);
        
        res.render('customer/provider-details', { 
            title: provider.business_name,
            user: req.session.user,
            provider: provider,
            categories: categoriesResult.rows,
            services: servicesResult.rows
        });
    } catch (error) {
        console.error('Error fetching provider details:', error);
        req.session.error = 'Failed to load provider details';
        res.redirect('/customer/categories');
    }
});

// Get booking form
router.get('/book-service/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const providerId = req.params.providerId;
        
        // Get provider details
        const providerResult = await pool.query(`
            SELECT sp.id, sp.business_name, sp.phone_number, u.email,
                   sp.certification_url, sp.is_verified
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            WHERE sp.id = $1 AND sp.is_verified = true
        `, [providerId]);
        
        if (providerResult.rows.length === 0) {
            req.session.error = 'Service provider not found';
            return res.redirect('/customer/categories');
        }
        
        const provider = providerResult.rows[0];
        
        // Get all categories offered by this provider
        const categoriesResult = await pool.query(`
            SELECT category_name
            FROM service_categories
            WHERE provider_id = $1
            ORDER BY category_name ASC
        `, [providerId]);
        
        // Get all services offered by this provider
        const servicesResult = await pool.query(`
            SELECT service_name
            FROM services_offered
            WHERE provider_id = $1
            ORDER BY service_name ASC
        `, [providerId]);
        
        res.render('customer/book-service', { 
            title: `Book Service - ${provider.business_name}`,
            user: req.session.user,
            provider: provider,
            categories: categoriesResult.rows,
            services: servicesResult.rows,
            error: req.session.error
        });
        
        // Clear session error
        delete req.session.error;
    } catch (error) {
        console.error('Error loading booking form:', error);
        req.session.error = 'Failed to load booking form';
        res.redirect(`/customer/provider/${req.params.providerId}`);
    }
});

// Handle service booking submission with Multer
router.post('/book-service', isCustomerAuth, upload.array('problemImages', 5), handleMulterErrors, async (req, res) => {
    try {
        const { 
            providerId, 
            serviceType, 
            issueDescription,
            streetAddress,
            city,
            state,
            zipCode,
            accessInstructions,
            preferredDate,
            timeSlot,
            fullName,
            phoneNumber,
            email
        } = req.body;
        
        const customerId = req.session.user.id;
        
        // Validate the required inputs
        if (!providerId || !serviceType || !issueDescription || !streetAddress || 
            !city || !state || !zipCode || !preferredDate || !timeSlot || 
            !fullName || !phoneNumber || !email) {
            req.session.error = 'Please fill out all required fields';
            return res.redirect(`/customer/book-service/${providerId}`);
        }
        
        // Process uploaded files
        let imageFiles = [];
        if (req.files && req.files.length > 0) {
            imageFiles = req.files.map(file => `/uploads/booking_images/${file.filename}`);
        }
        
        // Format full address
        const fullAddress = `${streetAddress}, ${city}, ${state} ${zipCode}`;
        
        // Insert the booking into the database
        const bookingResult = await pool.query(`
            INSERT INTO service_bookings 
            (customer_id, provider_id, service_type, issue_description, service_address, 
             access_instructions, preferred_date, time_slot, customer_name, 
             customer_phone, customer_email, status, created_at, images)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13)
            RETURNING id
        `, [
            customerId, 
            providerId, 
            serviceType, 
            issueDescription, 
            fullAddress,
            accessInstructions || '', 
            preferredDate, 
            timeSlot, 
            fullName, 
            phoneNumber, 
            email, 
            'Pending',
            JSON.stringify(imageFiles)
        ]);
        
        // If booking was successful
        if (bookingResult.rows.length > 0) {
            req.session.success = 'Your service request has been submitted successfully';
            return res.redirect('/customer/bookings');
        } else {
            throw new Error('Failed to create booking');
        }
    } catch (error) {
        console.error('Error booking service:', error);
        req.session.error = 'Failed to book service. Please try again later.';
        return res.redirect(`/customer/book-service/${req.body.providerId}`);
    }
});

// View customer's bookings
router.get('/bookings', isCustomerAuth, async (req, res) => {
    try {
        const customerId = req.session.user.id;
        
        // Get all bookings for this customer
        const bookingsResult = await pool.query(`
            SELECT sb.id, sb.service_type, sb.booking_date, sb.status, 
                   sb.created_at, sp.business_name as provider_name
            FROM service_bookings sb
            JOIN service_providers sp ON sb.provider_id = sp.id
            WHERE sb.customer_id = $1
            ORDER BY sb.booking_date DESC
        `, [customerId]);
        
        res.render('customer/my-bookings', {
            title: 'My Bookings',
            user: req.session.user,
            bookings: bookingsResult.rows,
            success: req.session.success,
            error: req.session.error
        });
        
        // Clear session messages
        delete req.session.success;
        delete req.session.error;
    } catch (error) {
        console.error('Error fetching bookings:', error);
        req.session.error = 'Failed to load your bookings';
        res.redirect('/customer/dashboard');
    }
});

// Ensure default export
export default router;