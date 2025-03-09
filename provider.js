import express from 'express';
import pool from './config/database.js';

const router = express.Router();

// Middleware
const isProvider = (req, res, next) => {
    if (req.session.user && req.session.user.userType === 'provider') {
        return next();
    }
    req.session.error = 'Please login as a service provider';
    res.redirect('/auth/provider-login');
};

// Middleware to check if provider is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session.user && req.session.user.userType === 'provider') {
        next();
    } else {
        req.session.error = 'Please login to access this page';
        res.redirect('/auth/provider-login');
    }
};

// Debug middleware
const debugSession = (req, res, next) => {
    console.log('Session data:', req.session);
    console.log('Provider ID from session:', req.session.user?.providerId);
    next();
};

// Controllers
const getDashboard = async (req, res) => {
    try {
        // Get provider data including email
        const providerResult = await pool.query(`
            SELECT sp.*, u.email 
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            WHERE u.id = $1
        `, [req.session.user.id]);

        // Get provider's services
        const servicesResult = await pool.query(`
            SELECT service_name 
            FROM services_offered 
            WHERE provider_id = $1
        `, [providerResult.rows[0].id]);

        // Get provider's service categories with base fees and fee types
        const categoriesResult = await pool.query(`
            SELECT sc.category_name, sc.base_fee, sc.fee_type, cpm.description
            FROM service_categories sc
            LEFT JOIN category_pricing_models cpm ON LOWER(sc.category_name) = LOWER(cpm.category_name)
            WHERE sc.provider_id = $1
        `, [providerResult.rows[0].id]);

        // Combine all data
        const providerData = {
            ...providerResult.rows[0],
            services: servicesResult.rows,
            categories: categoriesResult.rows
        };

        res.render('provider/dashboard', {
            provider: providerData,
            services: servicesResult.rows,
            title: 'Provider Dashboard',
            error: req.session.error,
            success: req.session.success
        });

        // Clear session messages
        delete req.session.error;
        delete req.session.success;

    } catch (err) {
        console.error('Dashboard error:', err);
        req.session.error = 'Error loading dashboard';
        res.redirect('/auth/provider-login');
    }
};

// Define the updateProfile function
const updateProfile = async (req, res) => {
    const client = await pool.connect();
    
    try {
        const providerId = req.session.user.providerId;
        const { 
            businessName, 
            phoneNumber, 
            categories = [], 
            services = [],
            baseFees = {},
            feeTypes = {}
        } = req.body;
        
        // Debug log the form data
        console.log('Update profile data received:');
        console.log('- Provider ID:', providerId);
        console.log('- Business Name:', businessName);
        console.log('- Phone:', phoneNumber);
        console.log('- Categories:', categories);
        console.log('- Base Fees:', baseFees);
        console.log('- Fee Types:', feeTypes);
        console.log('- Services:', services);
        
        await client.query('BEGIN');
        
        // Update provider details
        await client.query(`
            UPDATE service_providers
            SET business_name = $1, phone_number = $2
            WHERE id = $3
        `, [businessName, phoneNumber, providerId]);
        
        // Delete existing categories and services to replace with new ones
        await client.query('DELETE FROM service_categories WHERE provider_id = $1', [providerId]);
        await client.query('DELETE FROM services_offered WHERE provider_id = $1', [providerId]);
        
        // Insert new categories with base fees and fee types
        let insertedCategories = 0;
        if (categories && Array.isArray(categories)) {
            for (const category of categories) {
                if (category.trim()) { // Skip empty categories
                    // Get base fee for this category (default to 0 if not set)
                    const baseFee = baseFees[category] ? parseFloat(baseFees[category]) : 0;
                    // Get fee type for this category (default to 'per visit' if not set)
                    const feeType = feeTypes[category] || 'per visit';
                    
                    console.log(`Inserting category: "${category}", Fee: ${baseFee}, Type: ${feeType}`);
                    
                    await client.query(
                        'INSERT INTO service_categories (provider_id, category_name, base_fee, fee_type) VALUES ($1, $2, $3, $4)',
                        [providerId, category.trim(), baseFee, feeType]
                    );
                    insertedCategories++;
                }
            }
        }
        
        // Insert new services
        let insertedServices = 0;
        if (services && Array.isArray(services)) {
            for (const service of services) {
                if (service.trim()) { // Skip empty services
                    await client.query(
                        'INSERT INTO services_offered (provider_id, service_name) VALUES ($1, $2)',
                        [providerId, service.trim()]
                    );
                    insertedServices++;
                }
            }
        }
        
        console.log(`Updated profile with ${insertedCategories} categories and ${insertedServices} services`);
        
        await client.query('COMMIT');
        
        // Update session with new business name
        req.session.user.businessName = businessName;
        
        req.session.success = 'Profile updated successfully';
        res.redirect('/provider/dashboard');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating profile:', error);
        req.session.error = 'Failed to update profile. Please try again.';
        res.redirect('/provider/edit-profile');
    } finally {
        client.release();
    }
};

// Route to display the edit profile page
router.get('/edit-profile', isAuthenticated, async (req, res) => {
    try {
        const providerId = req.session.user.providerId;
        
        console.log('Loading edit profile for provider ID:', providerId);
        
        // Fetch provider details including categories and services
        const providerResult = await pool.query(`
            SELECT sp.*, u.email
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            WHERE sp.id = $1
        `, [providerId]);
        
        if (providerResult.rows.length === 0) {
            req.session.error = 'Provider profile not found';
            return res.redirect('/provider/dashboard');
        }
        
        const provider = providerResult.rows[0];
        
        // Fetch all categories with base fees and fee types
        // Make sure we get ALL categories for this provider without any JOIN filtering
        const categoriesResult = await pool.query(`
            SELECT 
                category_name, 
                base_fee, 
                fee_type
            FROM service_categories
            WHERE provider_id = $1
        `, [providerId]);
        
        // Log each category found for debugging
        console.log('Categories found for provider:', providerId);
        categoriesResult.rows.forEach((cat, index) => {
            console.log(`Category ${index+1}: ${cat.category_name}, Fee: ${cat.base_fee}, Type: ${cat.fee_type}`);
        });
        
        // Fetch all services
        const servicesResult = await pool.query(`
            SELECT service_name
            FROM services_offered
            WHERE provider_id = $1
        `, [providerId]);
        
        console.log('Services found:', servicesResult.rows.length);
        
        // Add categories and services to provider object
        provider.categories = categoriesResult.rows;
        provider.services = servicesResult.rows;
        
        // Debug - log what's being passed to the template
        console.log('Provider data for template:', {
            id: provider.id,
            businessName: provider.business_name,
            categoryCount: provider.categories.length,
            categories: provider.categories.map(c => c.category_name),
            serviceCount: provider.services.length
        });
        
        // Fetch category pricing models if needed, but don't join with service_categories
        const pricingModelsResult = await pool.query(`
            SELECT category_name, default_fee_type, description
            FROM category_pricing_models
        `);
        
        res.render('provider/edit-profile', {
            title: 'Edit Profile',
            provider: provider,
            pricingModels: pricingModelsResult.rows,
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        console.error('Error fetching provider details:', error);
        req.session.error = 'Failed to load profile. Please try again.';
        res.redirect('/provider/dashboard');
    }
});

// Handle the case where someone goes to /profile - redirect to edit-profile
router.get('/profile', isProvider, (req, res) => {
    res.redirect('/provider/edit-profile');
});

// Add this to your provider.js routes
router.get('/test-session', (req, res) => {
    res.json({
        sessionExists: !!req.session,
        user: req.session.user || 'No user in session',
        sessionID: req.sessionID
    });
});

// Routes
router.get('/', isProvider, (req, res) => res.redirect('/provider/dashboard'));
router.get('/dashboard', isProvider, getDashboard);
router.post('/profile/update', isProvider, updateProfile);

export default router;