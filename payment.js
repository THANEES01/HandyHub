import express from 'express';
import pool from './config/database.js';
import dotenv from 'dotenv';
import Stripe from 'stripe';

// Load environment variables
dotenv.config();

// Initialize Stripe with your secret key from .env file
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

// Middleware to check if user is logged in as customer
const isCustomerAuth = (req, res, next) => {
    if (req.session.user && req.session.user.userType === 'customer') {
        next();
    } else {
        req.session.error = 'Please login as a customer to access this page';
        res.redirect('/auth/customer-login');
    }
};

// Payment page route
router.get('/payment/:bookingId', isCustomerAuth, async (req, res) => {
    try {
        const bookingId = req.params.bookingId;
        
        // Check if payment info exists in session
        if (!req.session.paymentInfo || req.session.paymentInfo.bookingId != bookingId) {
            // Get booking info from database if not in session
            const bookingResult = await pool.query(`
                SELECT sb.*, sp.business_name as provider_name, 
                       sc.base_fee, sc.fee_type
                FROM service_bookings sb
                JOIN service_providers sp ON sb.provider_id = sp.id
                LEFT JOIN service_categories sc ON sp.id = sc.provider_id AND LOWER(sc.category_name) = LOWER(sb.service_type)
                WHERE sb.id = $1 AND sb.customer_id = $2
                LIMIT 1
            `, [bookingId, req.session.user.id]);
            
            if (bookingResult.rows.length === 0) {
                req.session.error = 'Booking not found';
                return res.redirect('/customer/bookings');
            }
            
            const booking = bookingResult.rows[0];
            
            // Create payment info
            req.session.paymentInfo = {
                bookingId: booking.id,
                providerId: booking.provider_id,
                serviceType: booking.service_type,
                baseFee: booking.base_fee || 0,
                feeType: booking.fee_type || 'flat',
                customerName: booking.customer_name,
                customerEmail: booking.customer_email
            };
        }

        // Pass Stripe publishable key to the template
        res.render('customer/payment', {
            title: 'Complete Payment',
            user: req.session.user,
            paymentInfo: req.session.paymentInfo,
            stripePublicKey: process.env.STRIPE_PUBLISHABLE_KEY,
            error: req.session.error
        });
        
        // Clear error message
        delete req.session.error;
        
    } catch (error) {
        console.error('Error loading payment page:', error);
        req.session.error = 'Failed to load payment page';
        res.redirect('/customer/bookings');
    }
});

// Create a Stripe payment intent
router.post('/create-payment-intent', isCustomerAuth, async (req, res) => {
    try {
        const { bookingId } = req.body;
        
        // Verify booking belongs to the customer
        const bookingCheck = await pool.query(
            'SELECT id FROM service_bookings WHERE id = $1 AND customer_id = $2',
            [bookingId, req.session.user.id]
        );
        
        if (bookingCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Unauthorized access to this booking' });
        }
        
        if (!req.session.paymentInfo || req.session.paymentInfo.bookingId != bookingId) {
            return res.status(400).json({ error: 'Payment information not found' });
        }
        
        // Calculate the amount to charge
        const baseFee = parseFloat(req.session.paymentInfo.baseFee);
        const serviceFee = baseFee * 0.05; // 5% service fee
        const totalAmount = Math.round((baseFee + serviceFee) * 100); // Convert to cents for Stripe
        
        // Create a PaymentIntent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: totalAmount,
            currency: 'myr', // Malaysian Ringgit
            automatic_payment_methods: {
                enabled: true, // This enables all payment methods available for Malaysia
            },
            description: `Payment for booking #${bookingId} - ${req.session.paymentInfo.serviceType}`,
            receipt_email: req.session.paymentInfo.customerEmail,
            metadata: {
                booking_id: bookingId,
                customer_id: req.session.user.id,
                service_type: req.session.paymentInfo.serviceType
            }
        });
        
        // Send publishable key and PaymentIntent details to client
        res.json({
            clientSecret: paymentIntent.client_secret
        });
        
    } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).json({ error: 'Failed to process payment request' });
    }
});

// Handle successful payment
router.post('/process-payment', isCustomerAuth, async (req, res) => {
    try {
        const { bookingId, paymentIntentId, paymentMethod } = req.body;
        
        // Verify the payment with Stripe
        if (paymentIntentId) {
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            
            // Check if payment was successful
            if (paymentIntent.status !== 'succeeded') {
                req.session.error = 'Payment has not been completed';
                return res.redirect(`/customer/payment/${bookingId}`);
            }
            
            // Get the payment method type that was used
            const paymentMethodType = paymentIntent.payment_method_type || paymentMethod || 'unknown';
            
            // Update booking status to 'Confirmed' (payment completed)
            await pool.query(`
                UPDATE service_bookings
                SET status = 'Confirmed', 
                    payment_status = 'Paid',
                    payment_method = $1,
                    payment_reference = $2,
                    updated_at = NOW()
                WHERE id = $3 AND customer_id = $4
            `, [paymentMethodType, paymentIntentId, bookingId, req.session.user.id]);
            
            // Save payment record
            await pool.query(`
                INSERT INTO payments (
                    booking_id, customer_id, amount, payment_method, 
                    payment_reference, status, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            `, [
                bookingId, 
                req.session.user.id, 
                parseFloat(req.session.paymentInfo.baseFee) * 1.05, // Base fee + 5% service fee
                paymentMethodType,
                paymentIntentId,
                'Completed'
            ]);
            
            // Clear payment info from session
            delete req.session.paymentInfo;
            
            // Set success message
            req.session.success = 'Payment successful! Your booking has been confirmed.';
            
            // Redirect to bookings page
            return res.redirect('/customer/bookings');
        } else {
            throw new Error('Payment intent ID not provided');
        }
        
    } catch (error) {
        console.error('Payment processing error:', error);
        req.session.error = 'Failed to process payment. Please try again.';
        return res.redirect(`/customer/payment/${req.body.bookingId}`);
    }
});

// Handle payment webhook from Stripe (for asynchronous payment methods)
router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    
    let event;
    
    try {
        // Verify webhook signature
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error(`Webhook signature verification failed:`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Handle the event
    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        
        // Extract metadata
        const bookingId = paymentIntent.metadata.booking_id;
        const customerId = paymentIntent.metadata.customer_id;
        
        try {
            // Get payment method type
            const paymentMethodType = paymentIntent.payment_method_type || 'stripe';
            
            // Update booking status
            await pool.query(`
                UPDATE service_bookings
                SET status = 'Confirmed', 
                    payment_status = 'Paid',
                    payment_method = $1,
                    payment_reference = $2,
                    updated_at = NOW()
                WHERE id = $3
            `, [paymentMethodType, paymentIntent.id, bookingId]);
            
            // Save payment record
            await pool.query(`
                INSERT INTO payments (
                    booking_id, customer_id, amount, payment_method, 
                    payment_reference, status, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            `, [
                bookingId, 
                customerId, 
                paymentIntent.amount / 100, // Convert cents to RM
                paymentMethodType,
                paymentIntent.id,
                'Completed'
            ]);
            
            console.log(`Payment for booking #${bookingId} completed via webhook`);
        } catch (error) {
            console.error('Error processing webhook payment:', error);
        }
    }
    
    // Return a response to acknowledge receipt of the event
    res.json({received: true});
});

export default router;