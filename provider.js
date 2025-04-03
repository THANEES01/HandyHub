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

        // Combine all data
        const providerData = {
            ...providerResult.rows[0],
            services: servicesResult.rows,
            categories: categoriesResult.rows,
            availability: availabilityResult.rows
        };

        // Get recent bookings for the provider
        const bookingsResult = await pool.query(`
            SELECT sb.id, sb.customer_id, c.first_name || ' ' || c.last_name AS customer_name, 
                sb.service_type, sb.issue_description, sb.service_address,
                sb.time_slot, sb.status, sb.preferred_date
            FROM service_bookings sb
            JOIN customers c ON sb.customer_id = c.id
            WHERE sb.provider_id = $1
            ORDER BY sb.id DESC
            LIMIT 5
        `, [providerResult.rows[0].id]);

        res.render('provider/dashboard', {
            provider: providerData,
            services: servicesResult.rows,
            bookings: bookingsResult.rows || [],
            title: 'Provider Dashboard',
            currentPage: 'dashboard',
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

// Function to handle booking acceptance
const acceptBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const providerId = req.session.user.providerId;
        
        // Verify booking belongs to this provider
        const checkResult = await pool.query(
            'SELECT id FROM service_bookings WHERE id = $1 AND provider_id = $2',
            [bookingId, providerId]
        );
        
        if (checkResult.rows.length === 0) {
            req.session.error = 'Booking not found or not authorized';
            return res.redirect('/provider/bookings');
        }
        
        // Update booking status
        await pool.query(
            'UPDATE service_bookings SET status = $1, updated_at = NOW() WHERE id = $2',
            ['Accepted', bookingId]
        );
        
        // Add status history record
        await pool.query(
            'INSERT INTO booking_status_history (booking_id, status, notes, created_by) VALUES ($1, $2, $3, $4)',
            [bookingId, 'Accepted', 'Booking accepted by service provider', req.session.user.id]
        );
        
        req.session.success = 'Booking accepted successfully';
        res.redirect('/provider/booking/' + bookingId);
        
    } catch (error) {
        console.error('Error accepting booking:', error);
        req.session.error = 'Failed to accept booking. Please try again.';
        res.redirect('/provider/bookings');
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
        const formattedAvailability = availabilityResult.rows.map(day => {
            // Format start_time to ensure it's in the correct format (HH:MM)
            let start_time = day.start_time;
            if (typeof start_time === 'string' && start_time.includes(':')) {
                // Ensure hours part is two digits (09:00 not 9:00)
                const [hours, minutes] = start_time.split(':');
                const hoursInt = parseInt(hours, 10);
                start_time = `${hoursInt < 10 ? '0' + hoursInt : hoursInt}:${minutes}`;
            }
            
            // Format end_time to ensure it's in the correct format
            let end_time = day.end_time;
            if (typeof end_time === 'string' && end_time.includes(':')) {
                // Ensure hours part is two digits
                const [hours, minutes] = end_time.split(':');
                const hoursInt = parseInt(hours, 10);
                end_time = `${hoursInt < 10 ? '0' + hoursInt : hoursInt}:${minutes}`;
            }
            
            return {
                day_of_week: day.day_of_week,
                start_time: start_time,
                end_time: end_time,
                slot_duration: parseInt(day.slot_duration || 60, 10),
                is_available: day.is_available === true
            };
        });
        
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
            currentPage: 'dashboard',
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

// Route to get all bookings for the provider
router.get('/bookings', isProvider, async (req, res) => {
    try {
        const providerId = req.session.user.providerId;
        const statusFilter = req.query.status;
        
        let query = `
            SELECT sb.id, sb.customer_id, c.first_name || ' ' || c.last_name AS customer_name, 
                   sb.service_type, sb.issue_description, sb.service_address,
                   sb.time_slot, sb.status, sb.preferred_date, sb.customer_email, sb.customer_phone,
                   sb.images, sb.access_instructions, sb.created_at
            FROM service_bookings sb
            JOIN customers c ON sb.customer_id = c.id
            WHERE sb.provider_id = $1
        `;
        
        const queryParams = [providerId];
        
        // Add status filter if provided
        if (statusFilter) {
            query += ` AND sb.status = $2`;
            queryParams.push(statusFilter);
        }
        
        // Add order by clause - prioritize New, then Accepted, then others
        query += ` ORDER BY CASE 
                     WHEN sb.status = 'New' THEN 1
                     WHEN sb.status = 'Accepted' THEN 2
                     WHEN sb.status = 'Completed' THEN 3
                     WHEN sb.status = 'Cancelled' THEN 4
                     ELSE 5
                   END, sb.id DESC`;
        
        const bookingsResult = await pool.query(query, queryParams);
        
        console.log('Bookings query executed successfully. Found', bookingsResult.rows.length, 'bookings.');
        
        res.render('provider/bookings', {
            title: statusFilter ? `${statusFilter} Bookings` : 'All Bookings',
            bookings: bookingsResult.rows,
            statusFilter: statusFilter,
            currentPage: 'bookings',
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        console.error('Error fetching bookings:', error);
        req.session.error = 'Failed to load bookings. Please try again.';
        res.redirect('/provider/dashboard');
    }
});
// Route for viewing booking details - Add this BEFORE other routes
router.get('/booking/:bookingId', isProvider, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const providerId = req.session.user.providerId;
        
        // Get only booking details without status history
        const bookingResult = await pool.query(`
            SELECT 
                sb.*,
                c.first_name || ' ' || c.last_name AS customer_name
            FROM service_bookings sb
            JOIN customers c ON sb.customer_id = c.id
            WHERE sb.id = $1 AND sb.provider_id = $2
        `, [bookingId, providerId]);
        
        if (bookingResult.rows.length === 0) {
            console.log('No booking found for ID:', bookingId);
            req.session.error = 'Booking not found or not authorized';
            return res.redirect('/provider/bookings');
        }

        console.log('Found booking:', bookingResult.rows[0]);
        
        res.render('provider/booking-detail', {
            title: `Booking #${bookingId}`,
            booking: bookingResult.rows[0],
            statusHistory: [], // Empty array since we're not fetching history
            currentPage: 'bookings',
            error: req.session.error,
            success: req.session.success
        });

    } catch (error) {
        console.error('Error fetching booking details:', error);
        req.session.error = 'Failed to load booking details. Please try again.';
        res.redirect('/provider/bookings');
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

// Function to get booking details
const getBookingDetails = async (req, res) => {
    const client = await pool.connect(); // Get database client

    try {
        const { bookingId } = req.params;
        const providerId = req.session.user.providerId;
        
        await client.query('BEGIN'); // Start transaction

        // Get booking details with customer information
        const bookingResult = await client.query(`
            SELECT 
                sb.*,
                c.first_name || ' ' || c.last_name AS customer_name,
                c.email AS customer_email,
                c.phone AS customer_phone
            FROM service_bookings sb
            JOIN customers c ON sb.customer_id = c.id
            WHERE sb.id = $1 AND sb.provider_id = $2
        `, [bookingId, providerId]);
        
        if (bookingResult.rows.length === 0) {
            req.session.error = 'Booking not found or not authorized';
            return res.redirect('/provider/bookings');
        }

        // Get booking status history
        const historyResult = await client.query(`
            SELECT 
                bsh.*,
                COALESCE(u.name, sp.business_name, c.first_name || ' ' || c.last_name) AS created_by_name
            FROM booking_status_history bsh
            LEFT JOIN users u ON bsh.created_by = u.id
            LEFT JOIN service_providers sp ON u.id = sp.user_id
            LEFT JOIN customers c ON u.id = c.user_id
            WHERE bsh.booking_id = $1
            ORDER BY bsh.created_at DESC
        `, [bookingId]);
        
        // Get payment information
        const paymentResult = await client.query(`
            SELECT 
                payment_status,
                payment_method,
                payment_reference,
                base_fee,
                fee_type
            FROM service_bookings
            WHERE id = $1
        `, [bookingId]);

        await client.query('COMMIT'); // Commit transaction

        console.log('Booking details:', bookingResult.rows[0]);
        console.log('Status history:', historyResult.rows);
        console.log('Payment info:', paymentResult.rows[0]);

        // Format image paths if they exist
        let booking = bookingResult.rows[0];
        if (booking.images) {
            // Ensure images is an array and remove any empty strings
            booking.images = booking.images
                .split(',')
                .map(img => img.trim())
                .filter(img => img);
        }

        // Check for time slot and format if needed
        if (booking.time_slot) {
            // Ensure time slot is properly formatted
            booking.time_slot = booking.time_slot.trim();
        }

        res.render('provider/booking-detail', {
            title: `Booking #${bookingId}`,
            booking: {
                ...booking,
                payment: paymentResult.rows[0] // Add payment info to booking object
            },
            statusHistory: historyResult.rows,
            currentPage: 'bookings',
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        await client.query('ROLLBACK'); // Rollback transaction on error
        console.error('Error fetching booking details:', error);
        req.session.error = 'Failed to load booking details. Please try again.';
        res.redirect('/provider/bookings');
    } finally {
        client.release(); // Release database client
    }
};

// Function to handle booking status updates (start service)
const startBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const providerId = req.session.user.providerId;
        
        // Verify booking belongs to this provider and has the correct status
        const checkResult = await pool.query(
            'SELECT id FROM service_bookings WHERE id = $1 AND provider_id = $2 AND status = $3',
            [bookingId, providerId, 'Accepted']
        );
        
        if (checkResult.rows.length === 0) {
            req.session.error = 'Booking not found, not authorized, or has the wrong status';
            return res.redirect('/provider/booking/' + bookingId);
        }
        
        // Update booking status
        await pool.query(
            'UPDATE service_bookings SET status = $1, updated_at = NOW() WHERE id = $2',
            ['In Progress', bookingId]
        );
        
        // Add status history record
        await pool.query(
            'INSERT INTO booking_status_history (booking_id, status, notes, created_by) VALUES ($1, $2, $3, $4)',
            [bookingId, 'In Progress', 'Service started by provider', req.session.user.id]
        );
        
        req.session.success = 'Service marked as In Progress';
        res.redirect('/provider/booking/' + bookingId);
        
    } catch (error) {
        console.error('Error starting service:', error);
        req.session.error = 'Failed to update booking status. Please try again.';
        res.redirect('/provider/booking/' + bookingId);
    }
};

// Function to handle booking completion
const completeBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const providerId = req.session.user.providerId;
        
        // Verify booking belongs to this provider and has the correct status
        const checkResult = await pool.query(
            'SELECT id FROM service_bookings WHERE id = $1 AND provider_id = $2 AND status = $3',
            [bookingId, providerId, 'Accepted']
        );
        
        if (checkResult.rows.length === 0) {
            req.session.error = 'Booking not found, not authorized, or has the wrong status';
            return res.redirect('/provider/booking/' + bookingId);
        }
        
        // Update booking status
        await pool.query(
            'UPDATE service_bookings SET status = $1, updated_at = NOW(), completed_at = NOW() WHERE id = $2',
            ['Completed', bookingId]
        );
        
        // Add status history record
        await pool.query(
            'INSERT INTO booking_status_history (booking_id, status, notes, created_by) VALUES ($1, $2, $3, $4)',
            [bookingId, 'Completed', 'Service completed by provider', req.session.user.id]
        );
        
        req.session.success = 'Service marked as Completed';
        res.redirect('/provider/booking/' + bookingId);
        
    } catch (error) {
        console.error('Error completing service:', error);
        req.session.error = 'Failed to update booking status. Please try again.';
        res.redirect('/provider/bookings');
    }
};

// Route for viewing booking details
router.get('/booking/:bookingId', isProvider, getBookingDetails);

// Route for booking acceptance
router.post('/booking/:bookingId/accept', isProvider, acceptBooking);

// Route for starting service
router.post('/booking/:bookingId/start', isProvider, startBooking);

// Route for completing service
router.post('/booking/:bookingId/complete', isProvider, completeBooking);

// Routes
router.get('/', isProvider, (req, res) => res.redirect('/provider/dashboard'));
router.get('/dashboard', isProvider, getDashboard);
router.post('/profile/update', isProvider, updateProfile);

export default router;