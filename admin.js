import express from 'express';
import pool from './config/database.js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Create Mailtrap transporter
const transporter = nodemailer.createTransport({
    host: "sandbox.smtp.mailtrap.io",
    port: 2525,
    auth: {
        user: process.env.MAILTRAP_USER,
        pass: process.env.MAILTRAP_PASSWORD
    }
});

// Verify connection configuration
transporter.verify(function(error, success) {
    if (error) {
        console.log('SMTP verification error:', error);
    } else {
        console.log('SMTP server is ready to take our messages');
    }
});

const isAdmin = (req, res, next) => {
    if (req.session?.user && req.session.user.userType === 'admin') {
        return next();
    }
    req.session.error = 'Access denied';
    res.redirect('/auth/admin-login');
};

const getDashboard = async (req, res) => {
   try {
        console.log('Starting getDashboard function');

        // Get total providers count
        const providersCountQuery = await pool.query('SELECT COUNT(*) FROM service_providers');

        // Get total customers count
        const customersCountQuery = await pool.query('SELECT COUNT(*) FROM customers');

        // Get all providers (pending, approved, and rejected) with availability information
        const providersQuery = await pool.query(`
            SELECT 
                sp.id, 
                sp.business_name, 
                sp.phone_number, 
                sp.is_verified,
                u.email,
                ARRAY_AGG(DISTINCT sc.category_name) FILTER (WHERE sc.category_name IS NOT NULL) as categories,
                (
                    SELECT COUNT(*) 
                    FROM provider_availability pa 
                    WHERE pa.provider_id = sp.id AND pa.is_available = true
                ) as available_days_count
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            LEFT JOIN service_categories sc ON sp.id = sc.provider_id
            GROUP BY sp.id, sp.business_name, sp.phone_number, sp.is_verified, u.email
            ORDER BY sp.is_verified, sp.id
        `);

        // Get all customers
        const customersQuery = await pool.query(`
            SELECT 
                c.id,
                c.user_id,
                c.first_name,
                c.last_name,
                c.phone_number,
                u.email,
                u.created_at
            FROM customers c
            JOIN users u ON c.user_id = u.id
            WHERE u.user_type = 'customer'
            ORDER BY c.id ASC
        `);

        console.log('Customers data:', customersQuery.rows);

        const templateData = {
            totalProviders: parseInt(providersCountQuery.rows[0].count),
            totalCustomers: parseInt(customersCountQuery.rows[0].count),
            providers: providersQuery.rows,
            customers: customersQuery.rows
        };

        console.log('Data being sent to template:', templateData);

        return res.render('admin/dashboard', templateData);

    } catch (error) {
        console.error('Dashboard Error:', error);
        console.error('Error stack:', error.stack);
        return res.render('admin/dashboard', {
            totalProviders: 0,
            totalCustomers: 0,
            providers: [],
            customers: []
        });
    }
};

const getProviderDetails = async (req, res) => {
     try {
        // Updated query to include pricing, availability, and coverage information with correct GROUP BY handling
        const query = `
            SELECT 
                sp.id,
                sp.business_name,
                sp.phone_number,
                sp.is_verified,
                sp.certification_url,
                u.email,
                COALESCE(
                    ARRAY_AGG(DISTINCT sc.category_name) FILTER (WHERE sc.category_name IS NOT NULL),
                    ARRAY[]::text[]
                ) as categories,
                (
                    SELECT ARRAY_AGG(so.service_name)
                    FROM services_offered so
                    WHERE so.provider_id = sp.id
                ) as services,
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'category', sc_pricing.category_name,
                            'base_fee', sc_pricing.base_fee,
                            'fee_type', sc_pricing.fee_type
                        )
                    )
                    FROM service_categories sc_pricing
                    WHERE sc_pricing.provider_id = sp.id
                ) as pricing,
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'day_of_week', pa.day_of_week,
                            'start_time', pa.start_time,
                            'end_time', pa.end_time,
                            'slot_duration', pa.slot_duration,
                            'is_available', pa.is_available
                        )
                    )
                    FROM (
                        SELECT * FROM provider_availability
                        WHERE provider_id = sp.id
                        ORDER BY CASE
                            WHEN day_of_week = 'Monday' THEN 1
                            WHEN day_of_week = 'Tuesday' THEN 2
                            WHEN day_of_week = 'Wednesday' THEN 3
                            WHEN day_of_week = 'Thursday' THEN 4
                            WHEN day_of_week = 'Friday' THEN 5
                            WHEN day_of_week = 'Saturday' THEN 6
                            WHEN day_of_week = 'Sunday' THEN 7
                        END
                    ) pa
                ) as availability,
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'city_id', c.id,
                            'city_name', c.city_name,
                            'state_id', s.id,
                            'state_name', s.state_name
                        )
                    )
                    FROM provider_coverage pc
                    JOIN cities c ON pc.city_id = c.id
                    JOIN states s ON c.state_id = s.id
                    WHERE pc.provider_id = sp.id
                ) as coverage_locations
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            LEFT JOIN service_categories sc ON sc.provider_id = sp.id
            WHERE sp.id = $1
            GROUP BY 
                sp.id, 
                sp.business_name, 
                sp.phone_number, 
                sp.is_verified, 
                sp.certification_url, 
                u.email
        `;

        const provider = await pool.query(query, [req.params.id]);

        if (provider.rows.length === 0) {
            return res.status(404).json({ error: 'Provider not found' });
        }

        const providerData = provider.rows[0];
        
        // Add extensive logging to debug data
        console.log('Provider ID:', providerData.id);
        console.log('Coverage locations data:', JSON.stringify(providerData.coverage_locations, null, 2));
        
        // Handle Cloudinary URLs - no need to modify path as Cloudinary returns full URLs
        if (providerData.certification_url) {
            // Check if it's already a full Cloudinary URL
            if (providerData.certification_url.startsWith('http')) {
                // It's already a full URL from Cloudinary
                providerData.certification_file = providerData.certification_url;
            } else {
                // Legacy local file path - keep existing logic for backward compatibility
                const cleanPath = providerData.certification_url.replace(/^\/uploads\/certifications\//, '');
                providerData.certification_file = `/uploads/certifications/${cleanPath}`;
            }
        }

        // Send the response
        res.json(providerData);
    } catch (err) {
        console.error('Error in getProviderDetails:', err);
        res.status(500).json({ 
            error: 'Server error', 
            details: err.message 
        });
    }
};

// Delete a service provider
router.delete('/provider/:id/delete', isAdmin, async (req, res) => {
   const providerId = req.params.id;
    const client = await pool.connect();
    
    try {
        console.log(`Starting deletion process for provider ID: ${providerId}`);
        
        await client.query('BEGIN');
        
        // Get the user_id associated with this provider
        const providerResult = await client.query(
            'SELECT user_id, business_name FROM service_providers WHERE id = $1',
            [providerId]
        );
        
        if (providerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            console.log(`Provider with ID ${providerId} not found`);
            return res.status(404).json({ 
                success: false, 
                error: 'Service provider not found' 
            });
        }
        
        const userId = providerResult.rows[0].user_id;
        const businessName = providerResult.rows[0].business_name;
        
        console.log(`Found provider: ${businessName}, User ID: ${userId}`);
        
        // Delete related records in proper order to maintain referential integrity
        
        // 1. Delete provider availability
        console.log('Deleting provider availability...');
        await client.query('DELETE FROM provider_availability WHERE provider_id = $1', [providerId]);
        
        // 2. Delete provider coverage
        console.log('Deleting provider coverage...');
        await client.query('DELETE FROM provider_coverage WHERE provider_id = $1', [providerId]);
        
        // 3. Delete service categories
        console.log('Deleting service categories...');
        await client.query('DELETE FROM service_categories WHERE provider_id = $1', [providerId]);
        
        // 4. Delete services offered
        console.log('Deleting services offered...');
        await client.query('DELETE FROM services_offered WHERE provider_id = $1', [providerId]);
        
        // 5. Handle bookings and related data
        console.log('Getting bookings for provider...');
        const bookingResults = await client.query(
            'SELECT id FROM service_bookings WHERE provider_id = $1',
            [providerId]
        );
        
        const bookingIds = bookingResults.rows.map(row => row.id);
        console.log(`Found ${bookingIds.length} bookings to handle`);
        
        if (bookingIds.length > 0) {
            // 5a. Delete reviews related to these bookings
            console.log('Deleting reviews...');
            await client.query('DELETE FROM reviews WHERE booking_id = ANY($1::int[])', [bookingIds]);
            
            // 5b. Delete payment records related to these bookings
            console.log('Deleting payment records...');
            await client.query('DELETE FROM payments WHERE booking_id = ANY($1::int[])', [bookingIds]);
            
            // 5c. Delete booking services if the table exists
            try {
                console.log('Attempting to delete booking services...');
                await client.query('DELETE FROM booking_services WHERE booking_id = ANY($1::int[])', [bookingIds]);
            } catch (bookingServicesError) {
                // If booking_services table doesn't exist, just log and continue
                console.log('booking_services table may not exist, continuing...');
            }
            
            // 5d. Finally delete the bookings
            console.log('Deleting bookings...');
            await client.query('DELETE FROM service_bookings WHERE id = ANY($1::int[])', [bookingIds]);
        }
        
        // 6. Delete provider record
        console.log('Deleting provider record...');
        await client.query('DELETE FROM service_providers WHERE id = $1', [providerId]);
        
        // 7. Delete user account
        console.log('Deleting user account...');
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
        
        await client.query('COMMIT');
        
        console.log(`Successfully deleted provider: ${businessName}`);
        
        res.json({ 
            success: true, 
            message: `Service provider "${businessName}" deleted successfully` 
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting service provider:', error);
        console.error('Error stack:', error.stack);
        
        // Return a more detailed error response
        res.status(500).json({ 
            success: false, 
            error: `Failed to delete service provider: ${error.message}`,
            details: error.stack
        });
    } finally {
        client.release();
    }
});

// Verification Email Function
const sendVerificationEmail = async (provider) => {
    try {
        const mailOptions = {
            from: '"HandyHub" <admin@handyhub.com>',
            to: provider.email,
            subject: 'HandyHub - Service Provider Account Verified',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4;">
                    <div style="background-color: #0077be; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
                        <h1>Account Verification Successful</h1>
                    </div>
                    <div style="background-color: white; padding: 20px; border-radius: 0 0 10px 10px;">
                        <p>Dear ${provider.business_name},</p>
                        
                        <p>Congratulations! Your service provider account on HandyHub has been successfully verified.</p>
                        
                        <h3>Your Verified Details:</h3>
                        <ul>
                            <li><strong>Business Name:</strong> ${provider.business_name}</li>
                            <li><strong>Email:</strong> ${provider.email}</li>
                            <li><strong>Phone:</strong> ${provider.phone_number}</li>
                        </ul>

                        <h3>Verified Categories:</h3>
                        <p>${provider.categories ? provider.categories.join(', ') : 'No categories specified'}</p>

                        <p>You can now log in and start using HandyHub.</p>
                        
                        <p>Best regards,<br>HandyHub Team</p>
                    </div>
                </div>
            `
        };

        // Send email
        const info = await transporter.sendMail(mailOptions);
        
        console.log('Verification email sent successfully:', {
            messageId: info.messageId,
            previewURL: nodemailer.getTestMessageUrl(info)
        });
        
        return info;

    } catch (error) {
        console.error('Verification Email Sending Error:', {
            message: error.message,
            stack: error.stack
        });
        throw error;
    }
};

// Add this new function for rejection email
const sendRejectionEmail = async (provider, rejectionReason) => {
    try {
        const mailOptions = {
            from: '"HandyHub" <admin@handyhub.com>',
            to: provider.email,
            subject: 'HandyHub - Service Provider Registration Review',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4;">
                    <div style="background-color: #dc3545; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
                        <h1>Registration Review Outcome</h1>
                    </div>
                    <div style="background-color: white; padding: 20px; border-radius: 0 0 10px 10px;">
                        <p>Dear ${provider.business_name},</p>
                        
                        <p>We regret to inform you that your service provider registration has been rejected.</p>
                        
                        <h3>Reason for Rejection:</h3>
                        <p style="background-color: #f8d7da; padding: 15px; border-radius: 5px; color: #721c24;">
                            ${rejectionReason}
                        </p>

                        <h3>Next Steps:</h3>
                        <ul>
                            <li>Please review the feedback carefully</li>
                            <li>Make necessary corrections to your application</li>
                            <li>Re-submit your registration with updated information</li>
                        </ul>

                        <p>If you have any questions, please contact our support team.</p>
                        
                        <p>Best regards,<br>HandyHub Team</p>
                    </div>
                </div>
            `
        };

        // Send email
        const info = await transporter.sendMail(mailOptions);
        
        console.log('Rejection email sent successfully:', {
            messageId: info.messageId,
            previewURL: nodemailer.getTestMessageUrl(info)
        });
        
        return info;

    } catch (error) {
        console.error('Rejection Email Sending Error:', {
            message: error.message,
            stack: error.stack
        });
        throw error;
    }
};

// In your updateVerificationStatus function
const updateVerificationStatus = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Correctly destructure the status and rejectionReason
        const { status, rejectionReason } = req.body;
        
        // Log the received data for debugging
        console.log('Received status:', status);
        console.log('Received rejection reason:', rejectionReason);

        // Ensure status is defined
        if (!status) {
            return res.status(400).json({ 
                error: 'Status is required', 
                details: 'No status provided in the request' 
            });
        }

        // Update provider's verification status
        const result = await client.query(
            'UPDATE service_providers SET is_verified = $1, verification_status = $2 WHERE id = $3 RETURNING *',
            [
                status === 'approve', 
                status === 'approve' ? 'approved' : 'rejected', 
                req.params.id
            ]
        );

        // Fetch provider's complete details
        const providerQuery = await client.query(`
            SELECT 
                sp.id, 
                sp.business_name, 
                sp.phone_number, 
                u.email,
                ARRAY_AGG(DISTINCT sc.category_name) as categories
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            LEFT JOIN service_categories sc ON sp.id = sc.provider_id
            WHERE sp.id = $1
            GROUP BY sp.id, sp.business_name, sp.phone_number, u.email
        `, [req.params.id]);

        const provider = providerQuery.rows[0];

        // If approving, send verification email
        if (status === 'approve') {
            try {
                await sendVerificationEmail(provider);
            } catch (emailError) {
                console.error('Approval email sending failed:', emailError);
                // Continue with the process even if email fails
            }
        } 
        // If rejecting, send rejection email
        else if (status === 'reject' && rejectionReason) {
            try {
                await sendRejectionEmail(provider, rejectionReason);
            } catch (emailError) {
                console.error('Rejection email sending failed:', emailError);
                // Continue with the process even if email fails
            }
        }

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            message: status === 'approve' 
                ? 'Provider approved and verification email sent' 
                : 'Provider rejected and notification email sent' 
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error in updateVerificationStatus:', err);
        res.status(500).json({ 
            error: 'Server error', 
            details: err.message 
        });
    } finally {
        client.release();
    }
};

// Customer Details
const getCustomerDetails = async (req, res) => {
    try {
        console.log('Fetching customer details for ID:', req.params.id);

        const result = await pool.query(`
            SELECT 
                c.id,
                c.first_name,
                c.last_name,
                c.phone_number,
                u.email,
                u.created_at
            FROM customers c
            JOIN users u ON c.user_id = u.id
            WHERE c.id = $1 AND u.user_type = 'customer'
        `, [req.params.id]);

        console.log('Query result:', result.rows);

        if (result.rows.length === 0) {
            console.log('No customer found with this ID');
            return res.status(404).json({ error: 'Customer not found' });
        }

        const customerData = {
            id: result.rows[0].id,
            name: `${result.rows[0].first_name} ${result.rows[0].last_name}`,
            email: result.rows[0].email,
            phone_number: result.rows[0].phone_number,
            joined_date: result.rows[0].created_at
        };

        res.json(customerData);
    } catch (error) {
        console.error('Error fetching customer details:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
};

const getBookings = async (req, res) => {
    try {
        console.log('Starting getBookings function');
        
        // Get status filter if any
        const statusFilter = req.query.status || null;
        console.log('Status filter:', statusFilter); // Add this log to debug
        
        // Build query using only existing columns confirmed from logs
        let queryText = `
            SELECT 
                b.id,
                b.customer_id,
                b.provider_id,
                b.preferred_date,
                b.time_slot,
                b.service_type,
                b.status,
                b.payment_status,
                b.service_address,
                b.issue_description,
                b.created_at,
                b.updated_at,
                b.payment_method,
                b.payment_reference,
                b.base_fee,
                b.fee_type,
                b.completed_at,
                b.cancellation_reason,
                b.cancelled_at,
                b.cancelled_by,
                b.images,
                b.access_instructions,
                b.customer_name,
                b.customer_phone,
                b.customer_email,
                sp.business_name as provider_name,
                sp.phone_number as provider_phone,
                pu.email as provider_email
            FROM service_bookings b
            JOIN service_providers sp ON b.provider_id = sp.id
            JOIN users pu ON sp.user_id = pu.id
        `;
        
        // Declare the bookingsQuery variable first
        let bookingsQuery;
        
        // Add status filter if provided
        if (statusFilter) {
            // Special case for 'New' filter to include 'Confirmed' status as well
            if (statusFilter === 'New') {
                queryText += ` WHERE (b.status = 'New' OR b.status = 'Confirmed')`;
                console.log('Using special New filter query:', queryText);
                bookingsQuery = await pool.query(queryText + ` ORDER BY b.preferred_date DESC`);
            } else {
                queryText += ` WHERE b.status = $1`;
                console.log('Using standard filter query:', queryText);
                bookingsQuery = await pool.query(queryText + ` ORDER BY b.preferred_date DESC`, [statusFilter]);
            }
        } else {
            console.log('No filter applied, showing all bookings');
            bookingsQuery = await pool.query(queryText + ` ORDER BY b.preferred_date DESC`);
        }
        
        console.log(`Found ${bookingsQuery.rows.length} bookings`);
        
        // Log the first booking for debugging
        if (bookingsQuery.rows.length > 0) {
            console.log('First booking sample:', JSON.stringify(bookingsQuery.rows[0], null, 2));
        }
        
        // Calculate booking statistics
        const completedBookings = bookingsQuery.rows.filter(booking => booking.status === 'Completed').length;
        
        const upcomingBookings = bookingsQuery.rows.filter(booking => {
            const bookingDate = new Date(booking.preferred_date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return bookingDate >= today && (booking.status === 'New' || booking.status === 'Confirmed' || booking.status === 'Accepted' || booking.status === 'Pending');
        }).length;
        
        return res.render('admin/bookings', {
            title: 'Bookings',
            bookings: bookingsQuery.rows,
            totalBookings: bookingsQuery.rows.length,
            completedBookings: completedBookings,
            upcomingBookings: upcomingBookings,
            statusFilter: statusFilter
        });
        
    } catch (error) {
        console.error('Bookings Error:', error);
        console.error('Error stack:', error.stack);
        
        // Send a more detailed error message
        return res.render('admin/bookings', {
            title: 'Bookings',
            bookings: [],
            totalBookings: 0,
            completedBookings: 0,
            upcomingBookings: 0,
            statusFilter: null,
            error: `Failed to load bookings: ${error.message}. Please check the server logs for more details.`
        });
    }
};

const getBookingDetails = async (req, res) => {
    try {
        const bookingId = req.params.id;
        console.log('Fetching details for booking ID:', bookingId);
        
        // Updated query to join with payments table to get payment details
        // Fixed the customers JOIN condition
        const bookingQuery = await pool.query(`
            SELECT 
                b.id,
                b.customer_id,
                b.provider_id,
                b.preferred_date,
                b.time_slot,
                b.service_type,
                b.status,
                b.payment_status,
                b.service_address,
                b.issue_description,
                b.created_at,
                b.updated_at,
                b.payment_method,
                b.payment_reference,
                b.base_fee,
                b.fee_type,
                b.service_charge,
                b.total_amount,
                b.completed_at,
                b.cancellation_reason,
                b.cancelled_at,
                b.cancelled_by,
                b.images,
                b.access_instructions,
                b.customer_name,
                b.customer_phone,
                b.customer_email,
                sp.business_name as provider_name,
                sp.phone_number as provider_phone,
                pu.email as provider_email,
                p.base_fee as payment_base_fee,
                p.service_charge as payment_service_charge,
                p.amount as payment_total_amount
            FROM service_bookings b
            JOIN service_providers sp ON b.provider_id = sp.id
            JOIN users pu ON sp.user_id = pu.id
            LEFT JOIN payments p ON b.id = p.booking_id
            WHERE b.id = $1
        `, [bookingId]);
        
        if (bookingQuery.rows.length === 0) {
            console.log('No booking found with ID:', bookingId);
            return res.status(404).json({ error: 'Booking not found' });
        }
        
        // Process the booking data to ensure correct values
        const booking = bookingQuery.rows[0];
        
        // First try to use values from the payments table if available
        // Otherwise fall back to service_bookings table fields
        if (booking.payment_service_charge === null && booking.service_charge !== null) {
            booking.payment_service_charge = booking.service_charge;
        }
        
        if (booking.payment_base_fee === null && booking.base_fee !== null) {
            booking.payment_base_fee = booking.base_fee;
        }
        
        if (booking.payment_total_amount === null && booking.total_amount !== null) {
            booking.payment_total_amount = booking.total_amount;
        }
        
        // If we still don't have service charge but have base fee, calculate it
        if (booking.payment_service_charge === null && booking.payment_base_fee !== null) {
            booking.payment_service_charge = parseFloat(booking.payment_base_fee) * 0.05;
        }
        
        // If we still don't have total amount but have base fee and service charge, calculate it
        if (booking.payment_total_amount === null && 
            booking.payment_base_fee !== null && 
            booking.payment_service_charge !== null) {
            booking.payment_total_amount = parseFloat(booking.payment_base_fee) + 
                                          parseFloat(booking.payment_service_charge);
        }
        
        console.log('Successfully retrieved booking details');
        
        // Return booking details as JSON
        res.json(booking);
        
    } catch (error) {
        console.error('Error fetching booking details:', error);
        res.status(500).json({ 
            error: 'Server error', 
            details: error.message 
        });
    }
};

// Function to handle the earnings page
const getEarnings = async (req, res) => {
    try {
        console.log('Starting getEarnings function');
        
        // Get filter parameters
        const timeFilter = req.query.timeFilter || null;
        const fromDate = req.query.fromDate || null;
        const toDate = req.query.toDate || null;
        
        console.log('Filter parameters:', { timeFilter, fromDate, toDate });
        
        // Build the base query - CORRECTED JOIN between payments and customers tables
        let queryText = `
            SELECT 
                p.id,
                p.booking_id,
                p.customer_id,
                p.amount,
                p.base_fee,
                p.service_charge,
                p.payment_method,
                p.payment_reference,
                p.status,
                p.created_at,
                sb.service_type,
                c.first_name || ' ' || c.last_name as customer_name,
                sp.business_name as provider_name
            FROM payments p
            JOIN service_bookings sb ON p.booking_id = sb.id
            JOIN customers c ON p.customer_id = c.user_id  -- FIXED JOIN condition
            JOIN service_providers sp ON sb.provider_id = sp.id
            WHERE p.status = 'Completed'
        `;
        
        // Add date filtering based on parameters
        const queryParams = [];
        let paramIndex = 1;
        
        if (timeFilter === 'month') {
            // Filter for current month
            const now = new Date();
            const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            
            queryText += ` AND p.created_at >= $${paramIndex}`;
            queryParams.push(firstDayOfMonth.toISOString());
            paramIndex++;
        } else if (timeFilter === 'week') {
            // Filter for current week (last 7 days)
            const now = new Date();
            const oneWeekAgo = new Date(now);
            oneWeekAgo.setDate(now.getDate() - 7);
            
            queryText += ` AND p.created_at >= $${paramIndex}`;
            queryParams.push(oneWeekAgo.toISOString());
            paramIndex++;
        } else if (fromDate && toDate) {
            // Custom date range filter
            const startDate = new Date(fromDate);
            // Add one day to end date to include the full day
            const endDate = new Date(toDate);
            endDate.setDate(endDate.getDate() + 1);
            
            queryText += ` AND p.created_at >= $${paramIndex} AND p.created_at < $${paramIndex + 1}`;
            queryParams.push(startDate.toISOString(), endDate.toISOString());
            paramIndex += 2;
        } else if (fromDate) {
            // Only from date specified
            const startDate = new Date(fromDate);
            
            queryText += ` AND p.created_at >= $${paramIndex}`;
            queryParams.push(startDate.toISOString());
            paramIndex++;
        } else if (toDate) {
            // Only to date specified
            const endDate = new Date(toDate);
            endDate.setDate(endDate.getDate() + 1); // Include full day
            
            queryText += ` AND p.created_at < $${paramIndex}`;
            queryParams.push(endDate.toISOString());
            paramIndex++;
        }
        
        // Complete the query with sorting
        queryText += ` ORDER BY p.created_at DESC`;
        
        console.log('Final query:', queryText);
        console.log('Query params:', queryParams);
        
        // Execute the query with debug logs
        const earningsResult = await pool.query(queryText, queryParams);
        
        console.log(`Found ${earningsResult.rows.length} earning records`);
        if (earningsResult.rows.length > 0) {
            console.log('Sample earning record:', earningsResult.rows[0]);
        }
        
        // Calculate total earnings (sum of service charges) with proper null handling
        let displayTotalEarnings = 0;
        earningsResult.rows.forEach(earning => {
            // Check if service_charge is a valid number before adding
            const serviceCharge = earning.service_charge ? parseFloat(earning.service_charge) : 0;
            if (!isNaN(serviceCharge)) {
                displayTotalEarnings += serviceCharge;
            }
        });
        
        // Get total earnings (all time) - FIXED QUERY with proper null handling
        const totalEarningsQuery = await pool.query(`
            SELECT COALESCE(SUM(service_charge), 0) as total_earnings, COUNT(*) as booking_count
            FROM payments
            WHERE status = 'Completed'
        `);
        
        console.log('Total earnings query result:', totalEarningsQuery.rows[0]);
        
        const totalEarnings = parseFloat(totalEarningsQuery.rows[0].total_earnings) || 0;
        const totalBookings = parseInt(totalEarningsQuery.rows[0].booking_count) || 0;
        
        // Get current month earnings - FIXED QUERY
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const currentMonthEarningsQuery = await pool.query(`
            SELECT COALESCE(SUM(service_charge), 0) as month_earnings
            FROM payments
            WHERE status = 'Completed' AND created_at >= $1
        `, [firstDayOfMonth.toISOString()]);
        
        console.log('Current month earnings query result:', currentMonthEarningsQuery.rows[0]);
        
        const currentMonthEarnings = parseFloat(currentMonthEarningsQuery.rows[0].month_earnings) || 0;
        
        console.log('Data being sent to template:', {
            earnings: earningsResult.rows.length,
            displayTotalEarnings,
            totalEarnings,
            currentMonthEarnings,
            totalBookings
        });
        
        // Render the earnings page
        return res.render('admin/earnings', {
            title: 'Platform Earnings',
            earnings: earningsResult.rows,
            displayTotalEarnings: displayTotalEarnings,
            totalEarnings: totalEarnings,
            currentMonthEarnings: currentMonthEarnings,
            totalBookings: totalBookings,
            timeFilter: timeFilter,
            fromDate: fromDate || '',
            toDate: toDate || ''
        });
        
    } catch (error) {
        console.error('Earnings Error:', error);
        console.error('Error stack:', error.stack);
        
        // Send a more detailed error message
        return res.render('admin/earnings', {
            title: 'Platform Earnings',
            earnings: [],
            displayTotalEarnings: 0,
            totalEarnings: 0,
            currentMonthEarnings: 0,
            totalBookings: 0,
            timeFilter: null,
            fromDate: '',
            toDate: '',
            error: `Failed to load earnings: ${error.message}. Please check the server logs for more details.`
        });
    }
};

// Add a debug route to directly check the payments table
router.get('/debug-earnings', isAdmin, async (req, res) => {
    try {
        // Direct query to get all payment records
        const rawPaymentsQuery = await pool.query(`
            SELECT * FROM payments
            ORDER BY created_at DESC
        `);
        
        // Query with the corrected JOIN
        const joinedPaymentsQuery = await pool.query(`
            SELECT 
                p.id, p.booking_id, p.customer_id, 
                p.amount, p.service_charge,
                c.id as customer_table_id, 
                c.user_id as customer_user_id,
                c.first_name, c.last_name
            FROM payments p
            LEFT JOIN customers c ON p.customer_id = c.user_id
            ORDER BY p.created_at DESC
        `);
        
        // Query the service_bookings table for comparison
        const serviceBookingsQuery = await pool.query(`
            SELECT 
                id, base_fee, service_charge, total_amount, payment_status
            FROM service_bookings
            WHERE payment_status = 'Paid'
            ORDER BY id DESC
        `);
        
        res.json({
            raw_payments: {
                count: rawPaymentsQuery.rows.length,
                records: rawPaymentsQuery.rows
            },
            correct_join: {
                count: joinedPaymentsQuery.rows.length,
                records: joinedPaymentsQuery.rows.map(row => ({
                    payment_id: row.id,
                    booking_id: row.booking_id,
                    customer_id: row.customer_id,
                    customer_table_id: row.customer_table_id,
                    customer_user_id: row.customer_user_id,
                    customer_name: row.first_name ? `${row.first_name} ${row.last_name}` : null
                }))
            },
            service_bookings: {
                count: serviceBookingsQuery.rows.length,
                records: serviceBookingsQuery.rows
            }
        });
    } catch (error) {
        console.error('Debug earnings error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin logout route
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }
        res.redirect('/auth/admin-login');
    });
});

// Routes
router.get('/dashboard', isAdmin, getDashboard);
router.get('/provider/:id/details', isAdmin, getProviderDetails);
router.get('/customer/:id/details', isAdmin, getCustomerDetails);
router.post('/provider/:id/verify', isAdmin, updateVerificationStatus);
// Add these routes to the router
// Make sure to add these routes before exporting the router
router.get('/bookings', isAdmin, getBookings);
router.get('/booking/:id/details', isAdmin, getBookingDetails);
//Earnings router
router.get('/earnings', isAdmin, getEarnings);


export default router;