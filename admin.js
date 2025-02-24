import express from 'express';
import pool from './config/database.js';
import nodemailer from 'nodemailer';
// const { MailtrapClient } = require('mailtrap');
// import { MailtrapClient } from 'mailtrap';

const router = express.Router();

const isAdmin = (req, res, next) => {
   if (req.session.user?.userType === 'admin') return next();
   res.redirect('/auth/admin-login');
};

// Create Mailtrap client
// const client = new MailtrapClient({ token: process.env.MAILTRAP_TOKEN });
// const sender = { 
//     name: 'HandyHub', 
//     email: process.env.MAILTRAP_SENDER_EMAIL 
// };

// Create a transporter using SMTP
// const createTransporter = () => {
//     return nodemailer.createTransport({
//         service: 'gmail',
//         auth: {
//             user: process.env.EMAIL_USER,
//             pass: process.env.EMAIL_PASS
//         }
//     });
// };

// Create a transporter using Gmail SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

const getDashboard = async (req, res) => {
    try {
        console.log('Starting getDashboard function');

        // Get total providers count
        const providersCountQuery = await pool.query('SELECT COUNT(*) FROM service_providers');

        // Get total customers count
        const customersCountQuery = await pool.query('SELECT COUNT(*) FROM customers');

        // Get pending providers
        const pendingProvidersQuery = await pool.query(`
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
            WHERE sp.is_verified = false
            GROUP BY sp.id, sp.business_name, sp.phone_number, sp.is_verified, u.email
        `);

        // Get all customers - Using the exact same query that works in test-db
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
            pendingProviders: pendingProvidersQuery.rows,
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
        console.log('Provider ID:', req.params.id);

        const query = `
            SELECT 
                sp.id,
                sp.business_name,
                sp.phone_number,
                sp.is_verified,
                sp.certification_url,
                u.email,
                ARRAY_AGG(DISTINCT sc.category_name) as categories,
                (
                    SELECT ARRAY_AGG(so.service_name)
                    FROM services_offered so
                    WHERE so.provider_id = sp.id
                ) as services
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            LEFT JOIN service_categories sc ON sc.provider_id = sp.id
            WHERE sp.id = $1
            GROUP BY sp.id, sp.business_name, sp.phone_number, sp.is_verified, sp.certification_url, u.email
        `;

        const provider = await pool.query(query, [req.params.id]);

        if (provider.rows.length === 0) {
            return res.status(404).json({ error: 'Provider not found' });
        }

        console.log('Provider details:', provider.rows[0]);
        res.json(provider.rows[0]);
    } catch (err) {
        console.error('Error in getProviderDetails:', err);
        res.status(500).json({ error: 'Server error' });
    }
    };

// Email sending function

// Updated Email sending function
const sendVerificationEmail = async (provider) => {
    try {
        // Log email attempt
        console.log('Attempting to send verification email to:', provider.email);

        const info = await transporter.sendMail({
            from: '"HandyHub" <handyhubinfo01@gmail.com>',
            to: provider.email,
            subject: "HandyHub - Service Provider Account Verified",
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
        });

        console.log('Email sent successfully:', info);
        return info;

    } catch (error) {
        console.error('Email sending failed:', error);
        if (error.response) {
            console.error('Error details:', error.response.data);
        }
        return null;
    }
};

// In your updateVerificationStatus function
const updateVerificationStatus = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Update provider's verification status
        const result = await client.query(
            'UPDATE service_providers SET is_verified = $1 WHERE id = $2 RETURNING *',
            [req.body.status === 'approve', req.params.id]
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

        // If approving, send email
        if (req.body.status === 'approve') {
            try {
                await sendVerificationEmail(provider);
            } catch (emailError) {
                console.error('Email sending failed in route:', emailError);
                // Continue with the process even if email fails
            }
        }

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            message: req.body.status === 'approve' 
                ? 'Provider approved and email sent' 
                : 'Provider rejected' 
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


// Test route to verify database connection and data
// router.get('/test-db', async (req, res) => {
//     try {
//         // Test users table
//         const usersResult = await pool.query('SELECT * FROM users WHERE user_type = $1', ['customer']);
//         console.log('Users:', usersResult.rows);

//         // Test customers table
//         const customersResult = await pool.query('SELECT * FROM customers');
//         console.log('Customers:', customersResult.rows);

//         // Test joined query
//         const joinedResult = await pool.query(`
//             SELECT 
//                 c.id,
//                 c.user_id,
//                 c.first_name,
//                 c.last_name,
//                 c.phone_number,
//                 u.email,
//                 u.created_at
//             FROM customers c
//             JOIN users u ON c.user_id = u.id
//             WHERE u.user_type = 'customer'
//         `);
//         console.log('Joined result:', joinedResult.rows);

//         res.json({
//             users: usersResult.rows,
//             customers: customersResult.rows,
//             joined: joinedResult.rows
//         });
//     } catch (error) {
//         console.error('Test DB Error:', error);
//         res.status(500).json({ error: error.message });
//     }
// });

// Routes
router.get('/dashboard', isAdmin, getDashboard);
router.get('/provider/:id/details', isAdmin, getProviderDetails);
router.get('/customer/:id/details', isAdmin, getCustomerDetails);
router.post('/provider/:id/verify', isAdmin, updateVerificationStatus);

export default router;