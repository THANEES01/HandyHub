import express from 'express';
import pool from './config/database.js';
import nodemailer from 'nodemailer';

const router = express.Router();

const isAdmin = (req, res, next) => {
   if (req.session.user?.userType === 'admin') return next();
   res.redirect('/auth/admin-login');
};

const transporter = nodemailer.createTransport({
   service: 'gmail',
   auth: {
     user: process.env.EMAIL,
     password: process.env.EMAIL_PASSWORD
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
            SELECT sp.*, u.email 
            FROM service_providers sp 
            JOIN users u ON sp.user_id = u.id 
            WHERE sp.is_verified = false
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
            customers: customersQuery.rows // This should now contain your customer data
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
        const provider = await pool.query(`
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

        if (provider.rows.length === 0) {
            return res.status(404).json({ error: 'Provider not found' });
        }

        res.json(provider.rows[0]);
    } catch (err) {
        console.error('Error in getProviderDetails:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

const updateVerificationStatus = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const result = await client.query(
            'UPDATE service_providers SET is_verified = $1 WHERE id = $2 RETURNING *',
            [req.body.status === 'approve', req.params.id]
        );

        const providerEmail = await client.query(
            'SELECT email FROM users WHERE id = $1',
            [result.rows[0].user_id]
        );

        const emailContent = req.body.status === 'approve' 
            ? 'Your service provider account has been approved. You can now login to HandyHub.'
            : `Your account verification was rejected. Reason: ${req.body.rejectionReason}`;

        await transporter.sendMail({
            from: process.env.EMAIL,
            to: providerEmail.rows[0].email,
            subject: `HandyHub Verification ${req.body.status === 'approve' ? 'Approved' : 'Rejected'}`,
            text: emailContent
        });

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error in updateVerificationStatus:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
};

// Customer Details
const getCustomerDetails = async (req, res) => {
    try {
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

        if (result.rows.length === 0) {
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
        res.status(500).json({ error: 'Server error' });
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