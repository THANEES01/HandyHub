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
    if (req.session.user && req.session.user.userType === 'admin') {
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

        // Get all providers (pending, approved, and rejected)
        const providersQuery = await pool.query(`
            SELECT 
                sp.id, 
                sp.business_name, 
                sp.phone_number, 
                sp.is_verified,
                u.email,
                ARRAY_AGG(DISTINCT sc.category_name) as categories
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
            pendingProviders: [],
            customers: []
        });
    }
};

const getProviderDetails = async (req, res) => {
    try {
        // Updated query to include pricing and availability information
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
                COALESCE(
                    (
                        SELECT ARRAY_AGG(so.service_name)
                        FROM services_offered so
                        WHERE so.provider_id = sp.id
                    ),
                    ARRAY[]::text[]
                ) as services,
                COALESCE(
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
                    ),
                    '[]'::jsonb
                ) as pricing,
                COALESCE(
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
                        FROM provider_availability pa
                        WHERE pa.provider_id = sp.id
                    ),
                    '[]'::jsonb
                ) as availability
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
        
        // Remove the duplicate '/uploads/certifications/' prefix
        if (providerData.certification_url) {
            const cleanPath = providerData.certification_url.replace(/^\/uploads\/certifications\//, '');
            providerData.certification_file = `/uploads/certifications/${cleanPath}`;
        }

        console.log('Provider Availability Data:', providerData.availability);

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
        await client.query('BEGIN');
        
        // Get the user_id associated with this provider
        const providerResult = await client.query(
            'SELECT user_id FROM service_providers WHERE id = $1',
            [providerId]
        );
        
        if (providerResult.rows.length === 0) {
            throw new Error('Service provider not found');
        }
        
        const userId = providerResult.rows[0].user_id;
        
        // Delete related records in order to maintain referential integrity
        
        // 1. Delete service categories
        await client.query('DELETE FROM service_categories WHERE provider_id = $1', [providerId]);
        
        // 2. Delete services offered
        await client.query('DELETE FROM services_offered WHERE provider_id = $1', [providerId]);
        
        // 3. Delete bookings (if any)
        // First get booking IDs to delete related booking_services
        // const bookingResults = await client.query(
        //     'SELECT id FROM bookings WHERE provider_id = $1',
        //     [providerId]
        // );
        
        // const bookingIds = bookingResults.rows.map(row => row.id);
        
        // if (bookingIds.length > 0) {
        //     // 3a. Delete booking_services
        //     await client.query('DELETE FROM booking_services WHERE booking_id = ANY($1::int[])', [bookingIds]);
            
        //     // 3b. Delete reviews related to these bookings
        //     await client.query('DELETE FROM reviews WHERE booking_id = ANY($1::int[])', [bookingIds]);
            
        //     // 3c. Delete payment records related to these bookings
        //     await client.query('DELETE FROM payments WHERE booking_id = ANY($1::int[])', [bookingIds]);
            
        //     // 3d. Finally delete the bookings
        //     await client.query('DELETE FROM bookings WHERE id = ANY($1::int[])', [bookingIds]);
        // }
        
        // 4. Delete provider record
        await client.query('DELETE FROM service_providers WHERE id = $1', [providerId]);
        
        // 5. Delete user account
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
        
        await client.query('COMMIT');
        
        res.json({ success: true, message: 'Service provider deleted successfully' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting service provider:', error);
        res.status(500).json({ success: false, error: error.message });
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


export default router;