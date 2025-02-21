import express from 'express';
import supabase from './config/database.js';

const router = express.Router();

// Middleware
const isProvider = (req, res, next) => {
    console.log('Session in middleware:', req.session); // Debug log
    if (req.session.user && req.session.user.userType === 'provider') {
        next();
    } else {
        req.session.error = 'Please login as a service provider';
        res.redirect('/auth/provider-login');
    }
};

// Controllers
const getDashboard = async (req, res) => {
    try {
        console.log('User in dashboard:', req.session.user); // Debug log

        // Get provider details
        const { data: providerData, error: providerError } = await supabase
            .from('users')
            .select(`
                id,
                email,
                service_providers!inner (
                    id,
                    business_name,
                    phone_number,
                    verification_status
                )
            `)
            .eq('id', req.session.user.id)
            .single();

        if (providerError) {
            console.error('Provider data error:', providerError);
            throw providerError;
        }

        console.log('Provider data:', providerData); // Debug log

        // Get services offered
        const { data: services, error: servicesError } = await supabase
            .from('services_offered')
            .select('service_name')
            .eq('provider_id', providerData.service_providers[0].id);

        if (servicesError) {
            console.error('Services error:', servicesError);
            throw servicesError;
        }

        // Get service categories
        const { data: categories, error: categoriesError } = await supabase
            .from('service_categories')
            .select('category_name')
            .eq('provider_id', providerData.service_providers[0].id);

        if (categoriesError) {
            console.error('Categories error:', categoriesError);
            throw categoriesError;
        }

        const provider = {
            id: providerData.id,
            business_name: providerData.service_providers[0].business_name,
            email: providerData.email,
            phone_number: providerData.service_providers[0].phone_number,
            verification_status: providerData.service_providers[0].verification_status
        };

        console.log('Rendering dashboard with:', { provider, services, categories }); // Debug log

        res.render('provider/dashboard', {
            provider,
            services: services || [],
            categories: categories || [],
            title: 'Provider Dashboard'
        });

    } catch (err) {
        console.error('Error fetching provider dashboard:', err);
        res.status(500).render('error', { 
            message: 'Error loading dashboard',
            error: err
        });
    }
};

const getProfile = async (req, res) => {
    try {
        // Get provider profile details
        const { data: profile, error } = await supabase
            .from('service_providers')
            .select(`
                *,
                users!inner (
                    email
                )
            `)
            .eq('user_id', req.session.user.id)
            .single();

        if (error) throw error;

        res.render('provider/profile', {
            profile,
            title: 'Provider Profile'
        });
    } catch (err) {
        console.error('Error fetching provider profile:', err);
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

const updateProfile = async (req, res) => {
    try {
        const { business_name, phone_number } = req.body;

        const { error } = await supabase
            .from('service_providers')
            .update({
                business_name,
                phone_number,
                updated_at: new Date()
            })
            .eq('user_id', req.session.user.id);

        if (error) throw error;

        req.session.success = 'Profile updated successfully';
        res.redirect('/provider/profile');
    } catch (err) {
        console.error('Error updating profile:', err);
        req.session.error = 'Failed to update profile';
        res.redirect('/provider/profile');
    }
};

// Routes
router.get('/', isProvider, (req, res) => res.redirect('/provider/dashboard'));
router.get('/dashboard', isProvider, getDashboard);
router.get('/profile', isProvider, getProfile);
// router.get('/bookings', isProvider, getBookings);
// router.get('/reviews', isProvider, getReviews);
// router.get('/earnings', isProvider, getEarnings);
router.post('/profile/update', isProvider, updateProfile);

export default router;