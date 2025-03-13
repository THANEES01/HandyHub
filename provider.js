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

        // Store providerId in session if not already present
        if (!req.session.user.providerId) {
            req.session.user.providerId = providerResult.rows[0].id;
            // Save session to persist the providerId
            req.session.save();
        }

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

        // Get provider's availability
        const availabilityResult = await pool.query(`
            SELECT day_of_week, start_time, end_time, slot_duration, is_available
            FROM provider_availability
            WHERE provider_id = $1
            ORDER BY CASE
                WHEN day_of_week = 'Monday' THEN 1
                WHEN day_of_week = 'Tuesday' THEN 2
                WHEN day_of_week = 'Wednesday' THEN 3
                WHEN day_of_week = 'Thursday' THEN 4
                WHEN day_of_week = 'Friday' THEN 5
                WHEN day_of_week = 'Saturday' THEN 6
                WHEN day_of_week = 'Sunday' THEN 7
            END
        `, [providerResult.rows[0].id]);

        // Log categories and availability for debugging
        console.log('Provider categories for dashboard:', categoriesResult.rows);
        console.log('Provider availability for dashboard:', availabilityResult.rows);

        // Combine all data
        const providerData = {
            ...providerResult.rows[0],
            services: servicesResult.rows,
            categories: categoriesResult.rows,
            availability: availabilityResult.rows
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
        console.log('Using provider ID for update:', providerId);
        
        const { 
            businessName, 
            phoneNumber, 
            categories = [], 
            services = [],
            baseFees = {},
            feeTypes = {},
            availableDays = [],
            slotDuration
        } = req.body;
        
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

        // Handle availability update
        // First, delete existing availability
        await client.query('DELETE FROM provider_availability WHERE provider_id = $1', [providerId]);
        
        // Get all days of the week
        const allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        
        // Insert new availability for each day
        for (const day of allDays) {
            // Check if this day is available
            const isAvailable = Array.isArray(availableDays) ? availableDays.includes(day) : false;
            
            // Get start and end times for this day
            const startTime = req.body[`startTime_${day}`] || '09:00';
            const endTime = req.body[`endTime_${day}`] || '17:00';
            
            // Insert the availability record
            await client.query(`
                INSERT INTO provider_availability 
                (provider_id, day_of_week, start_time, end_time, slot_duration, is_available)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [providerId, day, startTime, endTime, slotDuration || 60, isAvailable]);
            
            console.log(`Inserted availability for ${day}: ${isAvailable ? 'Available' : 'Not available'} from ${startTime} to ${endTime}`);
        }
        
        console.log(`Updated profile with ${insertedCategories} categories, ${insertedServices} services, and 7 availability records`);
        
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
router.get('/edit-profile', isAuthenticated, debugSession, async (req, res) => {
    try {
        const providerId = req.session.user.providerId;
        
        console.log('Loading edit profile for provider ID:', providerId);
        
        // 1. Fetch basic provider details
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
        
        // 2. Fetch service categories with pricing details
        const categoriesResult = await pool.query(`
            SELECT 
                category_name, 
                base_fee, 
                fee_type
            FROM service_categories
            WHERE provider_id = $1
        `, [providerId]);
        
        console.log('Categories found:', categoriesResult.rows.length);
        
        // 3. Fetch services offered
        const servicesResult = await pool.query(`
            SELECT service_name
            FROM services_offered
            WHERE provider_id = $1
        `, [providerId]);
        
        console.log('Services found:', servicesResult.rows.length);
        
        // 4. Fetch provider availability
        const availabilityResult = await pool.query(`
            SELECT 
                day_of_week, 
                start_time, 
                end_time, 
                slot_duration, 
                is_available
            FROM provider_availability
            WHERE provider_id = $1
            ORDER BY CASE
                WHEN day_of_week = 'Monday' THEN 1
                WHEN day_of_week = 'Tuesday' THEN 2
                WHEN day_of_week = 'Wednesday' THEN 3
                WHEN day_of_week = 'Thursday' THEN 4
                WHEN day_of_week = 'Friday' THEN 5
                WHEN day_of_week = 'Saturday' THEN 6
                WHEN day_of_week = 'Sunday' THEN 7
            END
        `, [providerId]);
        
        console.log('Availability records found:', availabilityResult.rows.length);
        
        // 5. Format the data for the frontend
        
        // Format categories - ensure consistent structure
        const formattedCategories = categoriesResult.rows.map(cat => ({
            category_name: cat.category_name,
            base_fee: parseFloat(cat.base_fee || 0),
            fee_type: cat.fee_type || 'per visit'
        }));
        
        // Format services - ensure consistent structure
        const formattedServices = servicesResult.rows.map(service => ({
            service_name: service.service_name
        }));
        
        // Format availability - ensure consistent structure and types
        const formattedAvailability = availabilityResult.rows.map(day => ({
            day_of_week: day.day_of_week,
            start_time: day.start_time,
            end_time: day.end_time,
            slot_duration: parseInt(day.slot_duration || 60),
            is_available: day.is_available === true
        }));
        
        // Log the formatted data for debugging
        console.log('Formatted categories:', formattedCategories);
        console.log('Formatted services:', formattedServices);
        console.log('Formatted availability:', formattedAvailability);
        
        // 6. Add the formatted data to the provider object
        provider.categories = formattedCategories;
        provider.services = formattedServices;
        provider.availability = formattedAvailability;
        
        // 7. Render the template with the complete provider data
        res.render('provider/edit-profile', {
            title: 'Edit Profile',
            provider: provider,
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