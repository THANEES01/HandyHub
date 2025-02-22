import express from 'express';
import pool from './config/database.js';

const router = express.Router();

// Middleware
const isProvider = (req, res, next) => {
    if (req.session.user?.userType === 'provider') {
        return next();
    }
    req.session.error = 'Please login as a service provider';
    res.redirect('/auth/provider-login');
};

// Controllers
const getDashboard = async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        const providerResult = await pool.query(
            'SELECT * FROM service_providers WHERE user_id = $1', 
            [userId]
        );

        const servicesResult = await pool.query(
            'SELECT service_name FROM services_offered WHERE provider_id = $1',
            [providerResult.rows[0].id]
        );

        res.render('provider/dashboard', {
            provider: providerResult.rows[0],
            services: servicesResult.rows,  // Note this line
            title: 'Dashboard'
        });
    } catch (err) {
        console.error(err);
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

        res.render('provider/profile', {
            profile: result.rows[0],
            title: 'Provider Profile'
        });
    } catch (err) {
        console.error('Profile error:', err);
        res.status(500).render('error', {
            message: 'Error loading profile',
            error: err
        });
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
// router.get('/profile', isProvider, getProfile);
// router.post('/profile/update', isProvider, updateProfile);


export default router;