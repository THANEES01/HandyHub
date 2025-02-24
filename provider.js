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

const updateProfile = async (req, res) => {
    const client = await pool.connect();
    try {
        const { business_name, phone_number } = req.body;

        await client.query(`
            UPDATE service_providers 
            SET business_name = $1, 
                phone_number = $2, 
                updated_at = NOW()
            WHERE user_id = $3
        `, [business_name, phone_number, req.session.user.id]);

        req.session.success = 'Profile updated successfully';
        res.redirect('/provider/profile');
    } catch (err) {
        console.error('Update profile error:', err);
        req.session.error = 'Failed to update profile';
        res.redirect('/provider/profile');
    } finally {
        client.release();
    }
};


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
// router.get('/bookings', isProvider, getBookings);


export default router;