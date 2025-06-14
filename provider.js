import express from 'express';
import pool from './config/database.js';

const router = express.Router();

const isProvider = (req, res, next) => {
    if (req.session?.user && req.session.user.userType === 'provider') {
        return next();
    }
    req.session.error = 'Please login as a service provider';
    res.redirect('/auth/provider-login');
};

const isAuthenticated = (req, res, next) => {
    if (req.session?.user && req.session.user.userType === 'provider') {
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

        // Get provider's coverage areas
        const coverageAreasResult = await pool.query(`
            SELECT pc.id, pc.city_id, c.city_name, s.id as state_id, s.state_name
            FROM provider_coverage pc
            JOIN cities c ON pc.city_id = c.id
            JOIN states s ON c.state_id = s.id
            WHERE pc.provider_id = $1
            ORDER BY s.state_name, c.city_name
        `, [providerResult.rows[0].id]);

        // Combine all data
        const providerData = {
            ...providerResult.rows[0],
            services: servicesResult.rows,
            categories: categoriesResult.rows,
            availability: availabilityResult.rows,
            coverageAreas: coverageAreasResult.rows
        };

        // Get recent bookings for the provider
        const bookingsResult = await pool.query(`
            SELECT sb.id, sb.customer_id, c.first_name || ' ' || c.last_name AS customer_name, 
                sb.service_type, sb.issue_description, sb.service_address,
                sb.time_slot, sb.status, sb.preferred_date
            FROM service_bookings sb
            JOIN customers c ON sb.customer_id = c.user_id
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

        // Clear session messages after rendering
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
            slotDuration,
            coverageAreas = '[]'
        } = req.body;
        
        console.log('Update request data:', {
            businessName,
            phoneNumber,
            categories,
            services,
            baseFees,
            feeTypes,
            availableDays,
            slotDuration,
            coverageAreas
        });
        
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
                if (category.trim()) {
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
                if (service.trim()) {
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
        
        // Handle coverage areas update
        // First, delete existing coverage areas
        await client.query('DELETE FROM provider_coverage WHERE provider_id = $1', [providerId]);
        
        // Parse coverage areas JSON
        let coverageAreasArray = [];
        try {
            coverageAreasArray = JSON.parse(coverageAreas);
            console.log('Parsed coverage areas:', coverageAreasArray);
        } catch (e) {
            console.error('Error parsing coverage areas JSON:', e);
            coverageAreasArray = [];
        }
        
        // Insert new coverage areas
        let insertedCoverageAreas = 0;
        if (Array.isArray(coverageAreasArray) && coverageAreasArray.length > 0) {
            for (const area of coverageAreasArray) {
                if (area && area.cityId) {
                    await client.query(
                        'INSERT INTO provider_coverage (provider_id, city_id) VALUES ($1, $2)',
                        [providerId, area.cityId]
                    );
                    insertedCoverageAreas++;
                    console.log(`Inserted coverage area: City ID ${area.cityId}`);
                }
            }
        }
        
        console.log(`Updated profile with ${insertedCategories} categories, ${insertedServices} services, 7 availability records, and ${insertedCoverageAreas} coverage areas`);
        
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

// FIXED: Function to handle booking acceptance
const acceptBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const providerId = req.session.user.providerId;
        
        console.log(`Attempting to accept booking ${bookingId} by provider ${providerId}`);
        
        // Verify booking belongs to this provider
        const checkResult = await pool.query(
            'SELECT id, status FROM service_bookings WHERE id = $1 AND provider_id = $2',
            [bookingId, providerId]
        );
        
        if (checkResult.rows.length === 0) {
            console.log(`Booking not found or not authorized: ${bookingId}`);
            req.session.error = 'Booking not found or you are not authorized to accept this booking';
            return res.redirect('/provider/bookings');
        }
        
        console.log(`Found booking with status: ${checkResult.rows[0].status}`);
        
        // Check if booking can be accepted
        if (!['New', 'Confirmed', 'Pending'].includes(checkResult.rows[0].status)) {
            req.session.error = 'This booking cannot be accepted anymore';
            return res.redirect('/provider/booking/' + bookingId);
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
        
        console.log(`Successfully accepted booking ${bookingId}`);
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
        console.log('Raw categories data:', categoriesResult.rows);
        
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
        
        // 5. Fetch coverage areas with proper state and city information
        const coverageAreasResult = await pool.query(`
            SELECT 
                pc.id, 
                pc.city_id, 
                c.city_name, 
                c.state_id, 
                s.state_name
            FROM provider_coverage pc
            JOIN cities c ON pc.city_id = c.id
            JOIN states s ON c.state_id = s.id
            WHERE pc.provider_id = $1
            ORDER BY s.state_name, c.city_name
        `, [providerId]);
        
        console.log('Coverage areas found:', coverageAreasResult.rows.length);
        console.log('Raw coverage areas:', coverageAreasResult.rows);
        
        // 6. Format the data for the frontend
        
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
        
        // Format availability - ensure consistent structure and proper time formatting
        const formattedAvailability = availabilityResult.rows.map(day => {
            // Format time values properly
            let start_time = day.start_time;
            let end_time = day.end_time;
            
            // Ensure proper time format (HH:MM)
            if (typeof start_time === 'string' && start_time.includes(':')) {
                const [hours, minutes] = start_time.split(':');
                const hoursInt = parseInt(hours, 10);
                start_time = `${hoursInt < 10 ? '0' + hoursInt : hoursInt}:${minutes}`;
            }
            
            if (typeof end_time === 'string' && end_time.includes(':')) {
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
        
        // Format coverage areas with proper structure
        const formattedCoverageAreas = coverageAreasResult.rows.map(area => ({
            id: area.id,
            city_id: area.city_id,
            state_id: area.state_id,
            city_name: area.city_name,
            state_name: area.state_name
        }));
        
        // Log the formatted data for debugging
        console.log('Formatted categories:', formattedCategories);
        console.log('Formatted services:', formattedServices);
        console.log('Formatted availability:', formattedAvailability);
        console.log('Formatted coverage areas:', formattedCoverageAreas);
        
        // 7. Add the formatted data to the provider object
        provider.categories = formattedCategories;
        provider.services = formattedServices;
        provider.availability = formattedAvailability;
        provider.coverageAreas = formattedCoverageAreas;
        
        // 8. Create selected categories array for easier template processing
        const selectedCategories = formattedCategories.map(cat => cat.category_name);
        provider.selectedCategories = selectedCategories;
        
        console.log('Selected categories for template:', selectedCategories);
        
        // 9. Render the template with the complete provider data
        res.render('provider/edit-profile', {
            title: 'Edit Profile',
            provider: provider,
            currentPage: 'dashboard',
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages after rendering
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
                sb.time_slot, 
                CASE 
                    WHEN sb.status = 'Confirmed' THEN 'New' 
                    ELSE sb.status 
                END AS status,
                sb.preferred_date, sb.customer_email, sb.customer_phone,
                sb.images, sb.access_instructions, sb.created_at
            FROM service_bookings sb
            JOIN customers c ON sb.customer_id = c.user_id
            WHERE sb.provider_id = $1
        `;
        
        const queryParams = [providerId];
        
        // Add status filter if provided
        if (statusFilter) {
            if (statusFilter === 'New') {
                // When filtering by 'New', include both 'New' and 'Confirmed' statuses
                query += ` AND (sb.status = 'New' OR sb.status = 'Confirmed')`;
            } else {
                query += ` AND sb.status = $2`;
                queryParams.push(statusFilter);
            }
        }
        
        // Add order by clause - prioritize New/Confirmed, then Accepted, then others
        query += ` ORDER BY CASE 
                     WHEN sb.status = 'New' OR sb.status = 'Confirmed' THEN 1
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
        
        // Clear session messages after rendering
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        console.error('Error fetching bookings:', error);
        req.session.error = 'Failed to load bookings. Please try again.';
        res.redirect('/provider/dashboard');
    }
});

// FIXED: Route for viewing booking details
router.get('/booking/:bookingId', isProvider, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const providerId = req.session.user.providerId;
        
        // Get booking details with customer information
        const bookingResult = await pool.query(`
            SELECT 
                sb.*,
                c.first_name || ' ' || c.last_name AS customer_name
            FROM service_bookings sb
            JOIN customers c ON sb.customer_id = c.user_id
            WHERE sb.id = $1 AND sb.provider_id = $2
        `, [bookingId, providerId]);
        
        if (bookingResult.rows.length === 0) {
            console.log('No booking found for ID:', bookingId);
            req.session.error = 'Booking not found or you are not authorized to view this booking';
            return res.redirect('/provider/bookings');
        }

        console.log('Found booking:', bookingResult.rows[0]);
        
        // Format booking data
        let booking = bookingResult.rows[0];
        
        // Convert 'Confirmed' status to 'New' for display purposes
        if (booking.status === 'Confirmed') {
            booking.status = 'New';
        }
        
        // Handle images if they exist
        if (booking.images) {
            try {
                if (typeof booking.images === 'string' && booking.images.startsWith('[')) {
                    booking.images = JSON.parse(booking.images);
                } else {
                    booking.images = booking.images
                        .split(',')
                        .map(img => img.trim())
                        .filter(img => img);
                }
            } catch(err) {
                console.error('Error parsing images JSON:', err);
                booking.images = [];
            }
        }
        
        res.render('provider/booking-detail', {
            title: `Booking #${bookingId}`,
            booking: booking,
            statusHistory: [], // Empty array since we're not fetching history
            currentPage: 'bookings',
            error: req.session.error,
            success: req.session.success
        });

        // Clear session messages after rendering
        delete req.session.error;
        delete req.session.success;

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

// FIXED: Function to handle booking status updates (start service)
const startBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const providerId = req.session.user.providerId;
        
        console.log(`Attempting to start booking ${bookingId} by provider ${providerId}`);
        
        // Verify booking belongs to this provider
        const checkResult = await pool.query(
            'SELECT id, status FROM service_bookings WHERE id = $1 AND provider_id = $2',
            [bookingId, providerId]
        );
        
        if (checkResult.rows.length === 0) {
            console.log(`Booking not found or not authorized: ${bookingId}`);
            req.session.error = 'Booking not found or you are not authorized to start this booking';
            return res.redirect('/provider/booking/' + bookingId);
        }
        
        console.log(`Found booking with status: ${checkResult.rows[0].status}`);
        
        // Check if booking can be started
        if (!['Accepted'].includes(checkResult.rows[0].status)) {
            req.session.error = 'This booking cannot be started at this time';
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
        
        console.log(`Successfully started booking ${bookingId}`);
        req.session.success = 'Service marked as In Progress';
        res.redirect('/provider/booking/' + bookingId);
        
    } catch (error) {
        console.error('Error starting service:', error);
        req.session.error = 'Failed to start service. Please try again.';
        res.redirect('/provider/booking/' + bookingId);
    }
};

// FIXED: Function to handle booking completion
const completeBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const providerId = req.session.user.providerId;
        
        console.log(`Attempting to complete booking ${bookingId} by provider ${providerId}`);
        
        // Verify booking belongs to this provider
        const checkResult = await pool.query(
            'SELECT id, status FROM service_bookings WHERE id = $1 AND provider_id = $2',
            [bookingId, providerId]
        );
        
        if (checkResult.rows.length === 0) {
            console.log(`Booking not found or not authorized: ${bookingId}`);
            req.session.error = 'Booking not found or you are not authorized to complete this booking';
            return res.redirect('/provider/bookings');
        }
        
        console.log(`Found booking with status: ${checkResult.rows[0].status}`);
        
        // Check if booking can be completed
        if (!['Accepted', 'In Progress'].includes(checkResult.rows[0].status)) {
            req.session.error = 'This booking cannot be completed at this time';
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
        
        console.log(`Successfully completed booking ${bookingId}`);
        req.session.success = 'Service marked as completed successfully';
        res.redirect('/provider/bookings');
        
    } catch (error) {
        console.error('Error completing service:', error);
        req.session.error = 'Failed to complete service. Please try again.';
        res.redirect('/provider/bookings');
    }
};

// Route for earnings page
router.get('/earnings', isProvider, async (req, res) => {
    try {
        const providerId = req.session.user.providerId;
        const { period, startDate, endDate, highlight } = req.query;
        
        // Get current date information for filtering
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const currentMonthName = now.toLocaleString('default', { month: 'long' });
        
        // Set up date filters based on query params
        let dateFilter = '';
        let queryParams = [providerId];
        let filterStartDate, filterEndDate;
        
        if (period === 'month') {
            // Filter for current month
            filterStartDate = new Date(currentYear, currentMonth, 1);
            filterEndDate = new Date(currentYear, currentMonth + 1, 0);
            
            dateFilter = ' AND (sb.completed_at >= $2 OR sb.updated_at >= $2) AND (sb.completed_at <= $3 OR sb.updated_at <= $3)';
            queryParams.push(filterStartDate, filterEndDate);
        } else if (period === 'week') {
            // Filter for current week
            const dayOfWeek = now.getDay();
            const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust for Sunday
            
            filterStartDate = new Date(now.setDate(diff));
            filterStartDate.setHours(0, 0, 0, 0);
            
            filterEndDate = new Date(filterStartDate);
            filterEndDate.setDate(filterStartDate.getDate() + 6);
            filterEndDate.setHours(23, 59, 59, 999);
            
            dateFilter = ' AND (sb.completed_at >= $2 OR sb.updated_at >= $2) AND (sb.completed_at <= $3 OR sb.updated_at <= $3)';
            queryParams.push(filterStartDate, filterEndDate);
        } else if (startDate && endDate) {
            // Custom date range
            filterStartDate = new Date(startDate);
            filterStartDate.setHours(0, 0, 0, 0);
            
            filterEndDate = new Date(endDate);
            filterEndDate.setHours(23, 59, 59, 999);
            
            dateFilter = ' AND (sb.completed_at >= $2 OR sb.updated_at >= $2) AND (sb.completed_at <= $3 OR sb.updated_at <= $3)';
            queryParams.push(filterStartDate, filterEndDate);
        }
        
        // Get all completed bookings for this provider
        const bookingsQuery = `
        SELECT 
            sb.id, 
            sb.service_type, 
            sb.preferred_date,
            sb.completed_at,
            sb.updated_at,
            sb.base_fee,
            sb.fee_type,
            c.first_name || ' ' || c.last_name AS customer_name
        FROM service_bookings sb
        JOIN customers c ON sb.customer_id = c.user_id
        WHERE sb.provider_id = $1 
        AND sb.status = 'Completed'
        ${dateFilter}
        ORDER BY COALESCE(sb.completed_at, sb.updated_at) DESC
    `;
        
        const bookingsResult = await pool.query(bookingsQuery, queryParams);
        const completedBookings = bookingsResult.rows;
        
        // Calculate total earnings (all time)
        const totalEarningsQuery = `
            SELECT SUM(base_fee) as total
            FROM service_bookings
            WHERE provider_id = $1 AND status = 'Completed'
        `;
        
        const totalEarningsResult = await pool.query(totalEarningsQuery, [providerId]);
        const totalEarnings = parseFloat(totalEarningsResult.rows[0]?.total || 0);
        
        // Calculate monthly earnings
        const monthStartDate = new Date(currentYear, currentMonth, 1);
        const monthEndDate = new Date(currentYear, currentMonth + 1, 0);
        
        const monthlyEarningsQuery = `
            SELECT SUM(base_fee) as total
            FROM service_bookings
            WHERE provider_id = $1 
            AND status = 'Completed'
            AND (completed_at >= $2 OR updated_at >= $2)
            AND (completed_at <= $3 OR updated_at <= $3)
        `;
        
        const monthlyEarningsResult = await pool.query(
            monthlyEarningsQuery,
            [providerId, monthStartDate, monthEndDate]
        );
        
        const monthlyEarnings = parseFloat(monthlyEarningsResult.rows[0]?.total || 0);
        
        // Calculate filtered earnings total
        const filteredEarnings = completedBookings.reduce(
            (total, booking) => total + parseFloat(booking.base_fee || 0), 
            0
        );
        
        res.render('provider/earnings', {
            title: 'Earnings',
            completedBookings,
            totalEarnings,
            monthlyEarnings,
            filteredEarnings,
            currentMonthName,
            currentYear,
            period,
            startDate: startDate || '',
            endDate: endDate || '',
            highlightBookingId: highlight ? parseInt(highlight) : null,
            currentPage: 'earnings',
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages after rendering
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        console.error('Error fetching earnings:', error);
        req.session.error = 'Failed to load earnings. Please try again.';
        res.redirect('/provider/dashboard');
    }
});

// FIXED: Route for cancelling a booking (confirmation page)
router.get('/booking/:bookingId/cancel', isProvider, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const providerId = req.session.user.providerId;
        
        console.log(`Loading cancellation page for booking ${bookingId} by provider ${providerId}`);
        
        // Get booking details - Allow cancellation for New, Confirmed, Pending, and Accepted statuses
        const bookingResult = await pool.query(`
            SELECT 
                sb.*,
                c.first_name || ' ' || c.last_name AS customer_name
            FROM service_bookings sb
            JOIN customers c ON sb.customer_id = c.user_id
            WHERE sb.id = $1 AND sb.provider_id = $2 AND sb.status IN ('New', 'Confirmed', 'Pending', 'Accepted')
        `, [bookingId, providerId]);
        
        if (bookingResult.rows.length === 0) {
            console.error(`Booking ${bookingId} not found, not authorized, or cannot be cancelled`);
            req.session.error = 'Booking not found, not authorized, or cannot be cancelled';
            return res.redirect('/provider/bookings');
        }
        
        console.log(`Found cancellable booking:`, bookingResult.rows[0]);
        
        res.render('provider/cancel-booking', {
            title: 'Cancel Booking',
            booking: bookingResult.rows[0],
            currentPage: 'bookings',
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages after rendering
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        console.error('Error loading cancellation page:', error);
        req.session.error = 'Failed to load cancellation page. Please try again.';
        res.redirect('/provider/bookings');
    }
});

// FIXED: Route for processing the actual cancellation (POST)
router.post('/booking/:bookingId/cancel', isProvider, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const providerId = req.session.user.providerId;
        const { cancellationReason } = req.body;
        
        console.log(`Processing cancellation for booking ${bookingId} by provider ${providerId}`);
        console.log(`Cancellation reason: ${cancellationReason}`);
        
        // Verify booking belongs to this provider and can be cancelled
        const checkResult = await pool.query(
            'SELECT id, status FROM service_bookings WHERE id = $1 AND provider_id = $2',
            [bookingId, providerId]
        );
        
        if (checkResult.rows.length === 0) {
            console.log(`Booking not found or not authorized: ${bookingId}`);
            req.session.error = 'Booking not found or you are not authorized to cancel this booking';
            return res.redirect('/provider/bookings');
        }
        
        const currentStatus = checkResult.rows[0].status;
        console.log(`Current booking status: ${currentStatus}`);
        
        // Check if booking can be cancelled
        if (!['New', 'Confirmed', 'Pending', 'Accepted'].includes(currentStatus)) {
            req.session.error = 'This booking cannot be cancelled anymore';
            return res.redirect('/provider/booking/' + bookingId);
        }
        
        // Update booking status to Cancelled
        await pool.query(
            'UPDATE service_bookings SET status = $1, updated_at = NOW(), cancellation_reason = $2, cancelled_at = NOW(), cancelled_by = $3 WHERE id = $4',
            ['Cancelled', cancellationReason || 'Cancelled by service provider', 'provider', bookingId]
        );
        
        // Add status history record
        await pool.query(
            'INSERT INTO booking_status_history (booking_id, status, notes, created_by) VALUES ($1, $2, $3, $4)',
            [bookingId, 'Cancelled', `Booking cancelled by provider. Reason: ${cancellationReason || 'Not specified'}`, req.session.user.id]
        );
        
        console.log(`Successfully cancelled booking ${bookingId}`);
        req.session.success = 'Booking has been cancelled successfully';
        res.redirect('/provider/bookings');
        
    } catch (error) {
        console.error('Error cancelling booking:', error);
        req.session.error = 'Failed to cancel booking. Please try again.';
        res.redirect('/provider/booking/' + req.params.bookingId);
    }
});

// API endpoint to get cities by state ID
router.get('/api/cities', isProvider, async (req, res) => {
    try {
        const stateId = req.query.state_id;
        
        if (!stateId) {
            return res.status(400).json({ error: 'State ID is required' });
        }
        
        // Query to get cities for the given state
        const citiesResult = await pool.query(
            'SELECT id, city_name FROM cities WHERE state_id = $1 ORDER BY city_name',
            [stateId]
        );
        
        res.json(citiesResult.rows);
        
    } catch (error) {
        console.error('Error fetching cities:', error);
        res.status(500).json({ error: 'Failed to fetch cities' });
    }
});

// Debug route to check bookings directly
router.get('/debug-bookings', isProvider, async (req, res) => {
    try {
        console.log('Session user data:', req.session.user);
        const providerId = req.session.user.providerId || 13; // Fallback to 13 for testing
        
        // Direct query without JOIN to see if bookings exist
        const rawResult = await pool.query(`
            SELECT * FROM service_bookings 
            WHERE provider_id = $1
        `, [providerId]);
        
        // Query with fixed JOIN
        const fixedResult = await pool.query(`
            SELECT sb.id, sb.service_type, sb.status, 
                   c.first_name || ' ' || c.last_name AS customer_name
            FROM service_bookings sb
            JOIN customers c ON sb.customer_id = c.user_id
            WHERE sb.provider_id = $1
        `, [providerId]);

        // Query with old JOIN for comparison
        const oldResult = await pool.query(`
            SELECT sb.id, sb.service_type, sb.status, 
                   c.first_name || ' ' || c.last_name AS customer_name
            FROM service_bookings sb
            JOIN customers c ON sb.customer_id = c.id
            WHERE sb.provider_id = $1
        `, [providerId]);
        
        // Output results in JSON format for easy debugging
        res.json({
            session_provider_id: providerId,
            direct_query: {
                count: rawResult.rows.length,
                bookings: rawResult.rows
            },
            fixed_join_query: {
                count: fixedResult.rows.length,
                bookings: fixedResult.rows
            },
            old_join_query: {
                count: oldResult.rows.length,
                bookings: oldResult.rows
            }
        });
    } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route for viewing all reviews for a provider
router.get('/reviews', isProvider, async (req, res) => {
    try {
        const providerId = req.session.user.providerId;
        console.log('Loading reviews for provider ID:', providerId);
        
        // Get provider details
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
        
        // Get provider services for stats
        const servicesResult = await pool.query(`
            SELECT service_name 
            FROM services_offered 
            WHERE provider_id = $1
        `, [providerResult.rows[0].id]);
        
        // Combine provider data with services
        const provider = {
            ...providerResult.rows[0],
            services: servicesResult.rows
        };
        
        // Get all reviews for this provider with customer names
        const reviewsQuery = `
            SELECT 
                br.id, 
                br.rating, 
                br.review_text, 
                br.created_at,
                br.booking_id,
                c.first_name,
                c.last_name,
                sb.service_type,
                sb.preferred_date
            FROM booking_reviews br
            JOIN customers c ON br.customer_id = c.user_id
            LEFT JOIN service_bookings sb ON br.booking_id = sb.id
            WHERE br.provider_id = $1
            ORDER BY br.created_at DESC
        `;
        
        const reviewsResult = await pool.query(reviewsQuery, [providerId]);
        console.log(`Found ${reviewsResult.rows.length} reviews for provider ID: ${providerId}`);
        
        // Calculate average rating
        const avgRatingResult = await pool.query(`
            SELECT AVG(rating) as average_rating, COUNT(*) as review_count
            FROM booking_reviews
            WHERE provider_id = $1
        `, [providerId]);
        
        const averageRating = avgRatingResult.rows[0].average_rating || 0;
        const reviewCount = parseInt(avgRatingResult.rows[0].review_count) || 0;
        
        // Calculate rating breakdown (count of each star rating)
        const ratingBreakdownQuery = `
            SELECT rating, COUNT(*) as count
            FROM booking_reviews
            WHERE provider_id = $1
            GROUP BY rating
            ORDER BY rating DESC
        `;
        
        const ratingBreakdownResult = await pool.query(ratingBreakdownQuery, [providerId]);
        
        // Format the rating breakdown for easier display
        const ratingBreakdown = Array(5).fill(0);
        ratingBreakdownResult.rows.forEach(row => {
            const ratingValue = parseInt(row.rating);
            if (ratingValue >= 1 && ratingValue <= 5) {
                ratingBreakdown[ratingValue - 1] = parseInt(row.count);
            }
        });
        
        // Calculate rating percentage for each star level
        const ratingPercentages = ratingBreakdown.map(count => {
            return reviewCount > 0 ? Math.round((count / reviewCount) * 100) : 0;
        });
        
        // Get monthly review stats for chart
        const monthlyStatsQuery = `
            SELECT 
                TO_CHAR(created_at, 'YYYY-MM') as month,
                COUNT(*) as review_count,
                AVG(rating) as average_rating
            FROM booking_reviews
            WHERE provider_id = $1
            GROUP BY month
            ORDER BY month ASC
            LIMIT 12
        `;
        
        const monthlyStatsResult = await pool.query(monthlyStatsQuery, [providerId]);
        
        res.render('provider/reviews', {
            title: 'Reviews & Ratings',
            provider: provider,
            reviews: reviewsResult.rows,
            averageRating: parseFloat(averageRating).toFixed(1),
            reviewCount: reviewCount,
            ratingBreakdown: ratingBreakdown,
            ratingPercentages: ratingPercentages,
            monthlyStats: monthlyStatsResult.rows,
            currentPage: 'reviews',
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages after rendering
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        console.error('Error fetching provider reviews:', error);
        req.session.error = 'Failed to load reviews';
        res.redirect('/provider/dashboard');
    }
});

// ROUTE DEFINITIONS - All the main routes
router.get('/', isProvider, (req, res) => res.redirect('/provider/dashboard'));
router.get('/dashboard', isProvider, getDashboard);
router.post('/profile/update', isProvider, updateProfile);

// Booking related routes
router.post('/booking/:bookingId/accept', isProvider, acceptBooking);
router.post('/booking/:bookingId/start', isProvider, startBooking);
router.post('/booking/:bookingId/complete', isProvider, completeBooking);

export default router;