import express from 'express';
import pool from './config/database.js';

const router = express.Router();

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
        
        // Get all service providers that offer services in this category with pricing info
        const providersResult = await pool.query(`
            SELECT DISTINCT sp.id, sp.business_name, sp.phone_number, 
                   u.email, sp.is_verified, sc.base_fee, sc.fee_type
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
        // Get the category from query parameter if available
        const categoryName = req.query.category;
        
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
        
        // If category is specified, get only that category's pricing
        let categoriesResult;
        if (categoryName) {
            categoriesResult = await pool.query(`
                SELECT category_name, base_fee, fee_type
                FROM service_categories
                WHERE provider_id = $1 AND category_name = $2
                LIMIT 1
            `, [providerId, categoryName]);
        } else {
            // Otherwise get all categories offered by this provider
            categoriesResult = await pool.query(`
                SELECT category_name, base_fee, fee_type
                FROM service_categories
                WHERE provider_id = $1
                ORDER BY category_name ASC
            `, [providerId]);
        }
        
        // Get all services offered by this provider
        const servicesResult = await pool.query(`
            SELECT service_name
            FROM services_offered
            WHERE provider_id = $1
            ORDER BY service_name ASC
        `, [providerId]);

        // For debugging
        console.log('Provider ID:', providerId);
        console.log('Selected Category:', categoryName || 'All categories');
        console.log('Categories for this provider:', categoriesResult.rows);
        
        res.render('customer/provider-details', { 
            title: provider.business_name,
            user: req.session.user,
            provider: provider,
            categories: categoriesResult.rows,
            selectedCategory: categoryName,
            services: servicesResult.rows
        });
    } catch (error) {
        console.error('Error fetching provider details:', error);
        req.session.error = 'Failed to load provider details';
        res.redirect('/customer/categories');
    }
});

export default router;