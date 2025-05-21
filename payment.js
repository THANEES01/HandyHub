import express from 'express';
import pool from './config/database.js';
import dotenv from 'dotenv';
import Stripe from 'stripe';

// Load environment variables
dotenv.config();

// Initialize Stripe with your secret key from .env file
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_yourTestSecretKey');

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
        
        console.log(`Loading payment page for booking ID: ${bookingId}`);
        console.log('Session payment info:', req.session.paymentInfo);
        
        // Check if payment info exists in session
        if (!req.session.paymentInfo || req.session.paymentInfo.bookingId != bookingId) {
            console.log('Payment info not in session, retrieving from database');
            
            // Get booking info from database if not in session
            const bookingResult = await pool.query(`
                SELECT sb.*, sp.business_name as provider_name
                FROM service_bookings sb
                JOIN service_providers sp ON sb.provider_id = sp.id
                WHERE sb.id = $1 AND sb.customer_id = $2
                LIMIT 1
            `, [bookingId, req.session.user.id]);
            
            if (bookingResult.rows.length === 0) {
                req.session.error = 'Booking not found';
                return res.redirect('/customer/bookings');
            }
            
            const booking = bookingResult.rows[0];
            console.log('Retrieved booking:', booking);
            
            // If the booking record has base_fee, use it; otherwise, retrieve it
            let baseFee = booking.base_fee;
            let feeType = booking.fee_type;
            
            // If base_fee isn't stored in the booking, look it up in service_categories
            if (!baseFee) {
                const serviceInfo = await pool.query(`
                    SELECT base_fee, fee_type
                    FROM service_categories
                    WHERE provider_id = $1 AND LOWER(category_name) = LOWER($2)
                    LIMIT 1
                `, [booking.provider_id, booking.service_type]);
                
                baseFee = serviceInfo.rows.length > 0 ? serviceInfo.rows[0].base_fee : 0;
                feeType = serviceInfo.rows.length > 0 ? serviceInfo.rows[0].fee_type : 'per visit';
                
                console.log(`Retrieved fee: ${baseFee} for service type: ${booking.service_type}`);
            }
            
            // Create payment info
            req.session.paymentInfo = {
                bookingId: booking.id,
                providerId: booking.provider_id,
                serviceType: booking.service_type,
                baseFee: baseFee || 0,
                feeType: feeType || 'per visit',
                customerName: booking.customer_name,
                customerEmail: booking.customer_email
            };
            
            console.log('Created payment info in session:', req.session.paymentInfo);
        }
        
        // Continue with rendering the payment page
        const stripePublicKey = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51R6MosL59baH2MzbAr4fPTWSuAy3kSy1yLiBsZKPDQ5RObTm02IMqS4wJx9M1F8EMUZD99j6MfiM4k0xGt3jD0DT009djlkwqP';
        
        console.log('Rendering payment page with info:', {
            paymentInfo: req.session.paymentInfo,
            stripePublicKey: stripePublicKey
        });
        
        res.render('customer/payment', {
            title: 'Complete Payment',
            user: req.session.user,
            paymentInfo: req.session.paymentInfo,
            stripePublicKey: stripePublicKey,
            error: req.session.error
        });
        
        delete req.session.error;
    } catch (error) {
        console.error('Error loading payment page:', error);
        req.session.error = 'Failed to load payment page: ' + error.message;
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
        const { payment_intent, payment_intent_client_secret, redirect_status, bookingId } = req.query;
        
        console.log('Stripe redirect received:');
        console.log('Payment Intent:', payment_intent);
        console.log('Status:', redirect_status);
        console.log('Booking ID:', bookingId);
        
        // If payment was successful
        if (redirect_status === 'succeeded' && payment_intent) {
            // Process the successful payment
            const updateResult = await pool.query(`
                UPDATE service_bookings
                SET status = 'Confirmed', 
                    payment_status = 'Paid',
                    payment_method = 'Stripe',
                    payment_reference = $1,
                    updated_at = NOW()
                WHERE id = $2 AND customer_id = $3
                RETURNING *
            `, [payment_intent, bookingId, req.session.user.id]);
            
            console.log('Database update result:', updateResult.rowCount > 0 ? 'Success' : 'Failed');
            if (updateResult.rows.length > 0) {
                console.log('Updated booking:', updateResult.rows[0].id);
            }
            
            // Record the payment in payments table
            if (req.session.paymentInfo) {
                try {
                    await pool.query(`
                        INSERT INTO payments (
                            booking_id, customer_id, amount, base_fee, service_charge, payment_method, 
                            payment_reference, status, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                    `, [
                        bookingId, 
                        req.session.user.id, 
                        parseFloat(req.session.paymentInfo.baseFee) * 1.05, // Total amount
                        parseFloat(req.session.paymentInfo.baseFee),        // Base fee
                        parseFloat(req.session.paymentInfo.baseFee) * 0.05, // Service charge
                        'Stripe',
                        payment_intent,
                        'Completed'
                    ]);
                    console.log('Payment record created');
                } catch (paymentError) {
                    console.error('Error recording payment:', paymentError);
                }
            }
            
            // Clear payment info and set success message
            delete req.session.paymentInfo;
            req.session.success = 'Payment successful! Your booking has been confirmed.';
        } else {
            req.session.error = 'Payment was not completed. Please try again.';
            console.log('Payment not successful. Status:', redirect_status);
        }
        
        // Redirect to booking confirmation or bookings page
        return res.redirect('/customer/booking-confirmation');
        
    } catch (error) {
        console.error('Error processing payment redirect:', error);
        req.session.error = 'Error processing payment. Please contact support.';
        return res.redirect('/customer/bookings');
    }
});

// Handle redirect from Stripe for completed payments
router.get('/process-payment', isCustomerAuth, async (req, res) => {
    try {
        const { payment_intent, payment_intent_client_secret, redirect_status, bookingId } = req.query;
        
        console.log('Stripe redirect received:');
        console.log('Payment Intent:', payment_intent);
        console.log('Status:', redirect_status);
        console.log('Booking ID:', bookingId);
        
        // If payment was successful
        if (redirect_status === 'succeeded' && payment_intent) {
            // Process the successful payment
            const updateResult = await pool.query(`
                UPDATE service_bookings
                SET status = 'Confirmed', 
                    payment_status = 'Paid',
                    payment_method = 'Stripe',
                    payment_reference = $1,
                    updated_at = NOW()
                WHERE id = $2 AND customer_id = $3
                RETURNING *
            `, [payment_intent, bookingId, req.session.user.id]);
            
            console.log('Database update result:', updateResult.rowCount > 0 ? 'Success' : 'Failed');
            if (updateResult.rows.length > 0) {
                console.log('Updated booking:', updateResult.rows[0].id);
            }
            
            // Record the payment in payments table
            if (req.session.paymentInfo) {
                    try {
                        // Get values from session, or calculate if not available
                        const baseFee = parseFloat(req.session.paymentInfo.calculatedFee || req.session.paymentInfo.baseFee || 0);
                        const serviceCharge = req.session.paymentInfo.serviceCharge || (baseFee * 0.05);
                        const totalAmount = req.session.paymentInfo.totalAmount || (baseFee + serviceCharge);
                        
                        await pool.query(`
                            INSERT INTO payments (
                                booking_id, customer_id, amount, base_fee, service_charge, payment_method, 
                                payment_reference, status, created_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                        `, [
                            bookingId, 
                            req.session.user.id, 
                            totalAmount,         // Total amount including service charge
                            baseFee,             // Base fee 
                            serviceCharge,       // Service charge
                            'Stripe',
                            payment_intent,
                            'Completed'
                        ]);
                        console.log('Payment record created with all fee details');
                    } catch (paymentError) {
                        console.error('Error recording payment:', paymentError);
                    }
                }
            
            // Clear payment info and set success message
            delete req.session.paymentInfo;
            req.session.success = 'Payment successful! Your booking has been confirmed.';
            
            // Redirect to the booking confirmation page with the booking ID
            return res.redirect(`/customer/booking-confirmation/${bookingId}`);
        } else {
            req.session.error = 'Payment was not completed. Please try again.';
            console.log('Payment not successful. Status:', redirect_status);
            return res.redirect('/customer/bookings');
        }
        
    } catch (error) {
        console.error('Error processing payment redirect:', error);
        req.session.error = 'Error processing payment. Please contact support.';
        return res.redirect('/customer/bookings');
    }
});

router.get('/test-update-payment/:bookingId', isCustomerAuth, async (req, res) => {
    try {
        const bookingId = req.params.bookingId;
        
        // Try a direct update
        const result = await pool.query(`
            UPDATE service_bookings
            SET payment_status = 'Paid',
                payment_method = 'Test Direct',
                payment_reference = 'Test_Ref_${Date.now()}',
                status = 'Confirmed',
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, payment_status, payment_method, payment_reference, status
        `, [bookingId]);
        
        // Send the result as JSON
        res.json({
            success: result.rowCount > 0,
            message: result.rowCount > 0 ? 'Update successful' : 'No records updated',
            booking: result.rows[0] || null,
            sql: `UPDATE service_bookings SET payment_status = 'Paid', payment_method = 'Test Direct', payment_reference = 'Test_Ref_${Date.now()}', status = 'Confirmed', updated_at = NOW() WHERE id = ${bookingId}`
        });
        
    } catch (error) {
        console.error('Test update error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

export default router;