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
        const [providersResult, customersResult, pendingProvidersResult] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM service_providers'),
            pool.query('SELECT COUNT(*) FROM customers'),
            pool.query(`
                SELECT sp.id, sp.business_name, sp.phone_number, sp.is_verified,
                       u.email, 
                       ARRAY_AGG(DISTINCT sc.category_name) as categories,
                       ARRAY_AGG(DISTINCT so.service_name) as services
                FROM service_providers sp
                JOIN users u ON sp.user_id = u.id
                LEFT JOIN service_categories sc ON sp.id = sc.provider_id
                LEFT JOIN services_offered so ON sp.id = so.provider_id
                WHERE sp.is_verified = false
                GROUP BY sp.id, sp.business_name, sp.phone_number, sp.is_verified, u.email
            `)
        ]);

        res.render('admin/dashboard', {
            totalProviders: providersResult.rows[0].count,
            totalCustomers: customersResult.rows[0].count,
            pendingProviders: pendingProvidersResult.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).render('error', { message: 'Server error' });
    }
};

const getProviderDetails = async (req, res) => {
    try {
        const provider = await pool.query(`
            SELECT DISTINCT sp.*, u.email,
            ARRAY_AGG(DISTINCT sc.category_name) as categories,
            ARRAY_AGG(DISTINCT so.service_name) as services
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            LEFT JOIN service_categories sc ON sp.id = sc.provider_id
            LEFT JOIN services_offered so ON sp.id = so.provider_id
            WHERE sp.id = $1
            GROUP BY sp.id, u.email
        `, [req.params.id]);

        res.json(provider.rows[0]);
    } catch (err) {
        console.error(err);
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
       console.error(err);
       res.status(500).json({ error: 'Server error' });
   } finally {
       client.release();
   }
};

router.get('/dashboard', isAdmin, getDashboard);
router.get('/provider/:id/details', isAdmin, getProviderDetails);
router.post('/provider/:id/verify', isAdmin, updateVerificationStatus);

export default router;