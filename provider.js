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

        // Get provider's service categories
        const categoriesResult = await pool.query(`
            SELECT category_name 
            FROM service_categories 
            WHERE provider_id = $1
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

const getProfile = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT sp.*, u.email
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            WHERE u.id = $1
        `, [req.session.user.id]);

        const servicesResult = await pool.query(`
            SELECT service_name 
            FROM services_offered 
            WHERE provider_id = $1
        `, [result.rows[0].id]);

        res.render('provider/profile', {
            profile: result.rows[0],
            services: servicesResult.rows,
            title: 'Provider Profile',
            error: req.session.error,
            success: req.session.success
        });

        // Clear session messages
        delete req.session.error;
        delete req.session.success;

    } catch (err) {
        console.error('Profile error:', err);
        req.session.error = 'Error loading profile';
        res.redirect('/provider/dashboard');
    }
};

// Define the updateProfile function
const updateProfile = async (req, res) => {
    const client = await pool.connect();
    
    try {
        const providerId = req.session.user.providerId;
        const { businessName, phoneNumber, categories, services } = req.body;
        
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
        
        // Insert new categories
        if (categories && Array.isArray(categories)) {
            for (const category of categories) {
                if (category.trim()) { // Skip empty categories
                    await client.query(
                        'INSERT INTO service_categories (provider_id, category_name) VALUES ($1, $2)',
                        [providerId, category.trim()]
                    );
                }
            }
        }
        
        // Insert new services
        if (services && Array.isArray(services)) {
            for (const service of services) {
                if (service.trim()) { // Skip empty services
                    await client.query(
                        'INSERT INTO services_offered (provider_id, service_name) VALUES ($1, $2)',
                        [providerId, service.trim()]
                    );
                }
            }
        }
        
        await client.query('COMMIT');
        
        req.session.success = 'Profile updated successfully';
        res.redirect('/provider/dashboard');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating profile:', error);
        req.session.error = 'Failed to update profile. Please try again.';
        res.redirect('/provider/profile');
    } finally {
        client.release();
    }
};


// Route to display the edit profile page
router.get('/profile', isAuthenticated, async (req, res) => {
    try {
        const providerId = req.session.user.providerId;
        
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
        
        // Fetch categories
        const categoriesResult = await pool.query(`
            SELECT category_name
            FROM service_categories
            WHERE provider_id = $1
        `, [providerId]);
        
        // Fetch services
        const servicesResult = await pool.query(`
            SELECT service_name
            FROM services_offered
            WHERE provider_id = $1
        `, [providerId]);
        
        // Add categories and services to provider object
        provider.categories = categoriesResult.rows;
        provider.services = servicesResult.rows;
        
        res.render('provider/edit-profile', {
            title: 'Edit Profile',
            provider: provider
        });
        
    } catch (error) {
        console.error('Error fetching provider details:', error);
        req.session.error = 'Failed to load profile. Please try again.';
        res.redirect('/provider/dashboard');
    }
});

// Route to handle the profile update
router.post('/profile/update', isAuthenticated, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const providerId = req.session.user.providerId;
        const { businessName, phoneNumber, categories, services } = req.body;
        
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
        
        // Insert new categories
        if (categories && Array.isArray(categories)) {
            for (const category of categories) {
                if (category.trim()) { // Skip empty categories
                    await client.query(
                        'INSERT INTO service_categories (provider_id, category_name) VALUES ($1, $2)',
                        [providerId, category.trim()]
                    );
                }
            }
        }
        
        // Insert new services
        if (services && Array.isArray(services)) {
            for (const service of services) {
                if (service.trim()) { // Skip empty services
                    await client.query(
                        'INSERT INTO services_offered (provider_id, service_name) VALUES ($1, $2)',
                        [providerId, service.trim()]
                    );
                }
            }
        }
        
        await client.query('COMMIT');
        
        req.session.success = 'Profile updated successfully';
        res.redirect('/provider/dashboard');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating profile:', error);
        req.session.error = 'Failed to update profile. Please try again.';
        res.redirect('/provider/profile');
    } finally {
        client.release();
    }
});

// Add this to your provider.js routes
router.get('/test-session', (req, res) => {
    res.json({
        sessionExists: !!req.session,
        user: req.session.user || 'No user in session',
        sessionID: req.sessionID
    });
});

// const getBookings = async (req, res) => {
//     res.render('provider/bookings', {
//         title: 'Provider Bookings',
//         bookings: []
//     });
// };

// const getReviews = async (req, res) => {
//     res.render('provider/reviews', {
//         title: 'Provider Reviews',
//         reviews: []
//     });
// };

// const getEarnings = async (req, res) => {
//     res.render('provider/earnings', {
//         title: 'Provider Earnings',
//         earnings: []
//     });
// };

// const updateProfile = async (req, res) => {
//     const client = await pool.connect();
//     try {
//         const { business_name, phone_number } = req.body;

//         await client.query(`
//             UPDATE service_providers 
//             SET business_name = $1, phone_number = $2, updated_at = NOW()
//             WHERE user_id = $3
//         `, [business_name, phone_number, req.session.user.id]);

//         req.session.success = 'Profile updated successfully';
//         res.redirect('/provider/profile');
//     } catch (err) {
//         console.error('Update error:', err);
//         req.session.error = 'Failed to update profile';
//         res.redirect('/provider/profile');
//     } finally {
//         client.release();
//     }
// };

// Routes
router.get('/', isProvider, (req, res) => res.redirect('/provider/dashboard'));
router.get('/dashboard', isProvider, getDashboard);
router.get('/profile', isProvider, getProfile);
router.post('/profile/update', isProvider, updateProfile);

router.get('/dashboard', isProvider, debugSession, getDashboard);

// router.get('/bookings', isProvider, getBookings);


export default router;