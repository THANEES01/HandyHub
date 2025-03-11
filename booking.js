import express from 'express';
import pool from './config/database.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';

// Get current file path (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure storage for Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../public/uploads/booking_images/');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename with timestamp
        const timestamp = Date.now();
        const originalName = file.originalname.replace(/\s+/g, '_');
        cb(null, `${timestamp}_${originalName}`);
    }
});

// File filter to only allow images
const fileFilter = (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

// Create the Multer middleware
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max file size
    },
    fileFilter: fileFilter
});

// Middleware to handle Multer errors
const handleMulterErrors = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // A Multer error occurred during file upload
        let errorMessage = 'An error occurred during file upload.';
        
        if (err.code === 'LIMIT_FILE_SIZE') {
            errorMessage = 'File size exceeds the 10MB limit.';
        } else if (err.code === 'LIMIT_FILE_COUNT') {
            errorMessage = 'Too many files. Maximum 5 files allowed.';
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            errorMessage = 'Unexpected field name for file upload.';
        }
        
        req.session.error = errorMessage;
        return res.redirect(`/customer/book-service/${req.body.providerId}`);
    } else if (err) {
        // Other errors
        req.session.error = err.message || 'An unexpected error occurred.';
        return res.redirect(`/customer/book-service/${req.body.providerId}`);
    }
    
    // If no error, continue
    next();
};

// Middleware to check if user is logged in
const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/auth/login');
    }
};

// Middleware to check if user is logged in as customer
const isCustomerAuth = (req, res, next) => {
    if (req.session.user && req.session.user.userType === 'customer') {
        next();
    } else {
        res.redirect('/auth/customer-login');
    }
};

// Get booking form
router.get('/customer/book-service/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const providerId = req.params.providerId;
        const categoryName = req.query.category; // Get the category from query parameter
        
        // Get provider details
        const providerResult = await pool.query(`
            SELECT sp.id, sp.business_name, sp.phone_number, u.email,
                   sp.certification_url, sp.is_verified
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            WHERE sp.id = $1 AND sp.is_verified = true
        `, [providerId]);
        
        if (providerResult.rows.length === 0) {
            req.session.error = 'Service provider not found';
            return res.redirect('/customer/categories');
        }
        
        const provider = providerResult.rows[0];
        
        // If category is specified, get only that category's pricing
        let categoriesResult;
        if (categoryName) {
            categoriesResult = await pool.query(`
                SELECT category_name, base_fee, fee_type
                FROM service_categories
                WHERE provider_id = $1 AND category_name = $2
                LIMIT 1
            `, [providerId, categoryName]);
        } else {
            // Otherwise get all categories offered by this provider
            categoriesResult = await pool.query(`
                SELECT category_name, base_fee, fee_type
                FROM service_categories
                WHERE provider_id = $1
                ORDER BY category_name ASC
            `, [providerId]);
        }
        
        // Get all services offered by this provider
        const servicesResult = await pool.query(`
            SELECT service_name
            FROM services_offered
            WHERE provider_id = $1
            ORDER BY service_name ASC
        `, [providerId]);
        
        res.render('customer/book-service', { 
            title: `Book Service - ${provider.business_name}`,
            user: req.session.user,
            provider: provider,
            categories: categoriesResult.rows,
            selectedCategory: categoryName,
            services: servicesResult.rows,
            error: req.session.error
        });
        
        // Clear session error
        delete req.session.error;
    } catch (error) {
        console.error('Error loading booking form:', error);
        req.session.error = 'Failed to load booking form';
        res.redirect(`/customer/provider/${req.params.providerId}`);
    }
});

// Handle service booking submission with Multer
router.post('/customer/book-service', isCustomerAuth, upload.array('problemImages', 5), handleMulterErrors, async (req, res) => {
    try {
        const { 
            providerId, 
            serviceType, 
            issueDescription,
            streetAddress,
            city,
            state,
            zipCode,
            accessInstructions,
            preferredDate,
            timeSlot,
            fullName,
            phoneNumber,
            email
        } = req.body;
        
        const customerId = req.session.user.id;
        
        // Validate the required inputs
        if (!providerId || !serviceType || !issueDescription || !streetAddress || 
            !city || !state || !zipCode || !preferredDate || !timeSlot || 
            !fullName || !phoneNumber || !email) {
            req.session.error = 'Please fill out all required fields';
            return res.redirect(`/customer/book-service/${providerId}`);
        }
        
        // Process uploaded files
        let imageFiles = [];
        if (req.files && req.files.length > 0) {
            imageFiles = req.files.map(file => `/uploads/booking_images/${file.filename}`);
        }
        
        // Format full address
        const fullAddress = `${streetAddress}, ${city}, ${state} ${zipCode}`;
        
        // Insert the booking into the database
        const bookingResult = await pool.query(`
            INSERT INTO service_bookings 
            (customer_id, provider_id, service_type, issue_description, service_address, 
             access_instructions, preferred_date, time_slot, customer_name, 
             customer_phone, customer_email, status, created_at, images)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13)
            RETURNING id
        `, [
            customerId, 
            providerId, 
            serviceType, 
            issueDescription, 
            fullAddress,
            accessInstructions || '', 
            preferredDate, 
            timeSlot, 
            fullName, 
            phoneNumber, 
            email, 
            'Pending',
            JSON.stringify(imageFiles)
        ]);
        
        // If booking was successful, redirect to payment page
        if (bookingResult.rows.length > 0) {
            const bookingId = bookingResult.rows[0].id;
            
            // Get service price information for the payment
            const serviceInfo = await pool.query(`
                SELECT sc.base_fee, sc.fee_type
                FROM service_categories sc
                JOIN service_providers sp ON sc.provider_id = sp.id
                WHERE sp.id = $1 AND LOWER(sc.category_name) = LOWER($2)
                LIMIT 1
            `, [providerId, serviceType]);
            
            // Store essential payment info in session
            req.session.paymentInfo = {
                bookingId: bookingId,
                providerId: providerId,
                serviceType: serviceType,
                baseFee: serviceInfo.rows.length > 0 ? serviceInfo.rows[0].base_fee : 0,
                feeType: serviceInfo.rows.length > 0 ? serviceInfo.rows[0].fee_type : 'flat',
                customerName: fullName,
                customerEmail: email
            };
            
            // Redirect to payment page
            return res.redirect(`/customer/payment/${bookingId}`);
        } else {
            throw new Error('Failed to create booking');
        }
    } catch (error) {
        console.error('Error booking service:', error);
        req.session.error = 'Failed to book service. Please try again later.';
        return res.redirect(`/customer/book-service/${req.body.providerId}`);
    }
});

// View customer's bookings
router.get('/customer/bookings', isCustomerAuth, async (req, res) => {
    try {
        const customerId = req.session.user.id;
        
        // Get all bookings for this customer
        const bookingsResult = await pool.query(`
            SELECT sb.id, sb.service_type, sb.booking_date, sb.status, 
                   sb.created_at, sp.business_name as provider_name
            FROM service_bookings sb
            JOIN service_providers sp ON sb.provider_id = sp.id
            WHERE sb.customer_id = $1
            ORDER BY sb.booking_date DESC
        `, [customerId]);
        
        res.render('customer/my-bookings', {
            title: 'My Bookings',
            user: req.session.user,
            bookings: bookingsResult.rows,
            success: req.session.success,
            error: req.session.error
        });
        
        // Clear session messages
        delete req.session.success;
        delete req.session.error;
    } catch (error) {
        console.error('Error fetching bookings:', error);
        req.session.error = 'Failed to load your bookings';
        res.redirect('/customer/dashboard');
    }
});

// Payment page route
router.get('/customer/payment/:bookingId', isCustomerAuth, async (req, res) => {
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
        
        // Render payment page with payment info
        res.render('customer/payment', {
            title: 'Complete Payment',
            user: req.session.user,
            paymentInfo: req.session.paymentInfo,
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

// Process payment submission
router.post('/customer/process-payment', isCustomerAuth, async (req, res) => {
    try {
        const { 
            bookingId, 
            paymentMethod,
            cardNumber,
            cardExpiry,
            cardCvc
        } = req.body;
        
        // Validate payment info
        if (!bookingId || !paymentMethod) {
            req.session.error = 'Payment information is incomplete';
            return res.redirect(`/customer/payment/${bookingId}`);
        }
        
        // For credit/debit card payments, validate card details
        if (paymentMethod === 'card' && (!cardNumber || !cardExpiry || !cardCvc)) {
            req.session.error = 'Please provide all card details';
            return res.redirect(`/customer/payment/${bookingId}`);
        }
        
        // In a real application, you would process the payment with a payment gateway here
        // For this example, we'll just update the booking status
        
        // Update booking status to 'Confirmed' (payment completed)
        await pool.query(`
            UPDATE service_bookings
            SET status = 'Confirmed', updated_at = NOW()
            WHERE id = $1 AND customer_id = $2
        `, [bookingId, req.session.user.id]);
        
        // Clear payment info from session
        delete req.session.paymentInfo;
        
        // Set success message
        req.session.success = 'Payment successful! Your booking has been confirmed.';
        
        // Redirect to bookings page
        res.redirect('/customer/bookings');
        
    } catch (error) {
        console.error('Payment processing error:', error);
        req.session.error = 'Failed to process payment. Please try again.';
        return res.redirect(`/customer/payment/${req.body.bookingId}`);
    }
});

// API endpoint to get available time slots
router.get('/api/available-slots', isCustomerAuth, async (req, res) => {
    try {
        const { providerId, date } = req.query;
        
        if (!providerId || !date) {
            return res.status(400).json({ error: 'Provider ID and date are required' });
        }
        
        // Parse the date to get the day of week
        const selectedDate = new Date(date);
        const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][selectedDate.getDay()];
        
        // Get provider's availability for this day
        const availabilityResult = await pool.query(
            'SELECT * FROM provider_availability WHERE provider_id = $1 AND day_of_week = $2 AND is_available = true',
            [providerId, dayOfWeek]
        );
        
        if (availabilityResult.rows.length === 0) {
            return res.json({ slots: [] }); // No availability for this day
        }
        
        const availability = availabilityResult.rows[0];
        
        // Get existing bookings for this provider and date
        const bookingsResult = await pool.query(
            'SELECT time_slot FROM service_bookings WHERE provider_id = $1 AND preferred_date = $2',
            [providerId, date]
        );
        
        const bookedSlots = bookingsResult.rows.map(row => row.time_slot);
        
        // Generate available time slots based on availability and booked slots
        const startTime = new Date(`${date}T${availability.start_time}`);
        const endTime = new Date(`${date}T${availability.end_time}`);
        const slotDuration = availability.slot_duration; // in minutes
        
        const availableSlots = [];
        let currentTime = new Date(startTime);
        
        while (currentTime < endTime) {
            const slotEndTime = new Date(currentTime);
            slotEndTime.setMinutes(slotEndTime.getMinutes() + slotDuration);
            
            if (slotEndTime <= endTime) {
                const timeSlot = `${formatTime(currentTime)} - ${formatTime(slotEndTime)}`;
                
                // Check if this slot is not already booked
                if (!bookedSlots.includes(timeSlot)) {
                    availableSlots.push(timeSlot);
                }
            }
            
            // Move to next slot
            currentTime.setMinutes(currentTime.getMinutes() + slotDuration);
        }
        
        res.json({ slots: availableSlots });
        
    } catch (error) {
        console.error('Error getting available slots:', error);
        res.status(500).json({ error: 'Failed to get available time slots' });
    }
});

// Helper function to format time as "HH:MM AM/PM"
function formatTime(date) {
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    
    hours = hours % 12;
    hours = hours ? hours : 12; // Convert 0 to 12
    
    return `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

export default router;