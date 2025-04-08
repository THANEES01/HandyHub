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
        const customerId = req.session.user.id;
        
        // Get booking statistics
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_bookings,
                COUNT(CASE WHEN status = 'Confirmed' OR status = 'In Progress' THEN 1 END) as active_services,
                COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed_bookings,
                COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN base_fee ELSE 0 END), 0) as total_spent
            FROM service_bookings
            WHERE customer_id = $1
        `, [customerId]);
        
        // Get all service categories
        const categoriesResult = await pool.query(`
            SELECT DISTINCT category_name 
            FROM service_categories 
            ORDER BY category_name
        `);
        
        // Render dashboard with statistics and categories
        res.render('customer/customer-dashboard', {
            title: 'Customer Dashboard',
            user: req.session.user,
            totalBookings: statsResult.rows[0].total_bookings || 0,
            activeServices: statsResult.rows[0].active_services || 0,
            completedBookings: statsResult.rows[0].completed_bookings || 0,
            totalSpent: statsResult.rows[0].total_spent || 0,
            categories: categoriesResult.rows
        });
    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).render('error', { 
            message: 'Failed to load dashboard',
            error: error
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

// View service providers by category with optional location filtering
router.get('/category/:categoryName', isCustomerAuth, async (req, res) => {
    try {
        const categoryName = req.params.categoryName;
        const stateId = req.query.state || null;
        const cityId = req.query.city || null;
        
        // Fetch all states for the filter dropdown
        const statesResult = await pool.query(`
            SELECT id, state_name
            FROM states
            ORDER BY state_name ASC
        `);
        
        // Fetch cities for the selected state (if a state is selected)
        let citiesResult = { rows: [] };
        if (stateId) {
            citiesResult = await pool.query(`
                SELECT id, city_name
                FROM cities
                WHERE state_id = $1
                ORDER BY city_name ASC
            `, [stateId]);
        }
        
        // Build the query for providers based on filters
        let providersQuery = `
            SELECT DISTINCT sp.id, sp.business_name, sp.phone_number, 
                   u.email, sp.is_verified, sc.base_fee, sc.fee_type
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            JOIN service_categories sc ON sp.id = sc.provider_id
            WHERE sc.category_name = $1 AND sp.is_verified = true
        `;
        
        const queryParams = [categoryName];
        
        // Add location filter if specified
        if (cityId) {
            providersQuery += `
                AND sp.id IN (
                    SELECT provider_id
                    FROM provider_coverage
                    WHERE city_id = $2
                )
            `;
            queryParams.push(cityId);
        } else if (stateId) {
            providersQuery += `
                AND sp.id IN (
                    SELECT provider_id
                    FROM provider_coverage pc
                    JOIN cities c ON pc.city_id = c.id
                    WHERE c.state_id = $2
                )
            `;
            queryParams.push(stateId);
        }
        
        providersQuery += ` ORDER BY sp.business_name ASC`;
        
        const providersResult = await pool.query(providersQuery, queryParams);
        
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
            
            // Get coverage areas for this provider
            const coverageResult = await pool.query(`
                SELECT c.city_name, s.state_name
                FROM provider_coverage pc
                JOIN cities c ON pc.city_id = c.id
                JOIN states s ON c.state_id = s.id
                WHERE pc.provider_id = $1
                ORDER BY s.state_name, c.city_name
            `, [provider.id]);
            
            providers.push({
                ...provider,
                services: servicesResult.rows,
                coverage: coverageResult.rows
            });
        }
        
        res.render('customer/providers-by-category', { 
            title: `${categoryName} Service Providers`,
            user: req.session.user,
            category: categoryName,
            providers: providers,
            states: statesResult.rows,
            cities: citiesResult.rows,
            selectedState: stateId,
            selectedCity: cityId,
            locationFilterActive: !!(stateId || cityId)
        });
    } catch (error) {
        console.error('Error fetching providers by category:', error);
        req.session.error = 'Failed to load service providers';
        res.redirect('/customer/categories');
    }
});

// API endpoint to get cities by state_id
router.get('/api/cities', isCustomerAuth, async (req, res) => {
    try {
        const stateId = req.query.state_id;
        
        if (!stateId) {
            return res.status(400).json({ error: 'State ID is required' });
        }
        
        const citiesResult = await pool.query(`
            SELECT id, city_name
            FROM cities
            WHERE state_id = $1
            ORDER BY city_name ASC
        `, [stateId]);
        
        res.json(citiesResult.rows);
    } catch (error) {
        console.error('Error fetching cities:', error);
        res.status(500).json({ error: 'Failed to fetch cities' });
    }
});

// View service provider details
router.get('/provider/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const providerId = req.params.providerId;
        const categoryParam = req.query.category; // Get category from query param
        
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
            SELECT category_name, base_fee, fee_type
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
        
        // Get coverage areas for this provider
        const coverageResult = await pool.query(`
            SELECT c.city_name, s.state_name
            FROM provider_coverage pc
            JOIN cities c ON pc.city_id = c.id
            JOIN states s ON c.state_id = s.id
            WHERE pc.provider_id = $1
            ORDER BY s.state_name, c.city_name
        `, [providerId]);
        
        // Find the selected category from the query parameter
        let selectedCategory = null;
        
        if (categoryParam && categoriesResult.rows.length > 0) {
            selectedCategory = categoriesResult.rows.find(
                cat => cat.category_name.toLowerCase() === categoryParam.toLowerCase()
            );
        }
        
        // If no match found or no parameter provided, use the first category
        if (!selectedCategory && categoriesResult.rows.length > 0) {
            selectedCategory = categoriesResult.rows[0];
        }
        
        res.render('customer/provider-details', { 
            title: provider.business_name,
            user: req.session.user,
            provider: provider,
            categories: categoriesResult.rows,
            selectedCategory: selectedCategory,
            services: servicesResult.rows,
            coverage: coverageResult.rows
        });
    } catch (error) {
        console.error('Error fetching provider details:', error);
        req.session.error = 'Failed to load provider details';
        res.redirect('/customer/categories');
    }
});

export default router;