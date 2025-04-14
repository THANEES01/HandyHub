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

// Create upload directory if it doesn't exist and check permissions
const uploadDir = 'C:\\Users\\ASUS\\OneDrive\\Desktop\\HandyHub_fyp\\public\\uploads\\booking_images\\';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log(`Created upload directory: ${uploadDir}`);
}
// Check permissions
try {
    fs.accessSync(uploadDir, fs.constants.W_OK);
    console.log(`Upload directory ${uploadDir} is writable`);
} catch (err) {
    console.error(`Upload directory ${uploadDir} is not writable:`, err);
}

// Configure storage for Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
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
        
        console.log(`Loading booking form for provider ${providerId}, category: ${categoryName}`);
        
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
            
            // Log for debugging
            console.log(`Selected category ${categoryName} pricing:`, categoriesResult.rows);
        } else {
            // Otherwise get all categories offered by this provider
            categoriesResult = await pool.query(`
                SELECT category_name, base_fee, fee_type
                FROM service_categories
                WHERE provider_id = $1
                ORDER BY category_name ASC
            `, [providerId]);
        }
        
        // Get services
        const servicesResult = await pool.query(`
            SELECT service_name 
            FROM services_offered 
            WHERE provider_id = $1
        `, [providerId]);
        
        // Render the template with the selected category
        res.render('customer/book-service', { 
            title: `Book Service - ${provider.business_name}`,
            user: req.session.user,
            provider: provider,
            categories: categoriesResult.rows,
            selectedCategory: categoryName, // Pass to the template
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
            baseFee,     // Get from hidden field
            feeType,     // Get from hidden field
            bookingHours, // Add this new parameter
            totalFee,    // Add this new parameter
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
        
        // Add validation for hourly bookings
        if (feeType === 'per hour' && (!bookingHours || bookingHours < 1)) {
            req.session.error = 'Please specify how many hours you need for the service';
            return res.redirect(`/customer/book-service/${providerId}`);
        }
        
        // Log the received values for debugging
        console.log(`Booking received: ServiceType=${serviceType}, BaseFee=${baseFee}, FeeType=${feeType}, Hours=${bookingHours}`);
        
        // If baseFee is not provided, retrieve it from the database
        let finalBaseFee = baseFee;
        let finalFeeType = feeType;
        
        if (!finalBaseFee || !finalFeeType) {
            try {
                const categoryResult = await pool.query(`
                    SELECT base_fee, fee_type 
                    FROM service_categories 
                    WHERE provider_id = $1 AND category_name = $2
                    LIMIT 1
                `, [providerId, serviceType]);
                
                if (categoryResult.rows.length > 0) {
                    finalBaseFee = categoryResult.rows[0].base_fee;
                    finalFeeType = categoryResult.rows[0].fee_type;
                    console.log(`Retrieved from DB: Fee=${finalBaseFee}, Type=${finalFeeType}`);
                }
            } catch (error) {
                console.error('Error retrieving fee information:', error);
            }
        }
        
        // Calculate the final fee based on fee type
        let calculatedFee = parseFloat(finalBaseFee) || 0;
        if (finalFeeType === 'per hour' && bookingHours) {
            calculatedFee = calculatedFee * parseInt(bookingHours);
            console.log(`Calculated hourly fee: ${calculatedFee} (${finalBaseFee} × ${bookingHours} hours)`);
        }
        
        // Process uploaded files
        console.log('Files received:', req.files); // Debug uploaded files

        let imageFiles = [];
        if (req.files && req.files.length > 0) {
            // Make sure paths are correct for web access
            imageFiles = req.files.map(file => {
                // Extract the filename from the full path
                const filename = file.filename;
                
                // Use a consistent web path format starting with /
                return `/uploads/booking_images/${filename}`;
            });
            
            console.log('Processed image files:', imageFiles); // Debug processed paths
        }

        // Format full address
        const fullAddress = `${streetAddress}, ${city}, ${state} ${zipCode}`;

        // Convert the imageFiles array to a JSON string for storage
        const imageFilesJson = JSON.stringify(imageFiles);
        console.log('Images JSON to be stored:', imageFilesJson);

        // Insert the booking into the database with fee information
        const bookingResult = await pool.query(`
            INSERT INTO service_bookings 
            (customer_id, provider_id, service_type, issue_description, service_address, 
            access_instructions, preferred_date, time_slot, customer_name, 
            customer_phone, customer_email, status, created_at, images, 
            base_fee, fee_type, booking_hours)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15, $16)
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
            imageFilesJson, // Store the stringified JSON
            calculatedFee, // Store the calculated fee
            finalFeeType || 'per visit',
            finalFeeType === 'per hour' ? parseInt(bookingHours) : null // Only store hours for hourly services
        ]);
                        
        // If booking was successful, redirect to payment page
        if (bookingResult.rows.length > 0) {
            const bookingId = bookingResult.rows[0].id;
            
            // Store in session for payment
            req.session.paymentInfo = {
                bookingId: bookingId,
                providerId: providerId,
                serviceType: serviceType,
                baseFee: parseFloat(finalBaseFee) || 0,
                calculatedFee: calculatedFee, // Add calculated fee to session
                feeType: finalFeeType || 'per visit',
                bookingHours: finalFeeType === 'per hour' ? parseInt(bookingHours) : null, // Add hours if relevant
                customerName: fullName,
                customerEmail: email
            };
            
            console.log('Payment info stored in session:', req.session.paymentInfo);
            
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
        
        // Get all bookings for this customer - UPDATED QUERY
        const bookingsResult = await pool.query(`
            SELECT sb.id, sb.service_type, sb.preferred_date, sb.time_slot, sb.status, 
                   sb.payment_status, sb.created_at, sp.business_name as provider_name
            FROM service_bookings sb
            JOIN service_providers sp ON sb.provider_id = sp.id
            WHERE sb.customer_id = $1
            ORDER BY sb.preferred_date DESC
        `, [customerId]);
        
        res.render('customer/view-bookings', {
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
        
        // MODIFY THIS PART - Add the stripePublicKey variable
        res.render('customer/payment', {
            title: 'Complete Payment',
            user: req.session.user,
            paymentInfo: req.session.paymentInfo,
            stripePublicKey:'pk_test_51R6MosL59baH2MzbAr4fPTWSuAy3kSy1yLiBsZKPDQ5RObTm02IMqS4wJx9M1F8EMUZD99j6MfiM4k0xGt3jD0DT009djlkwqP', 
            // Replace with your actual key from Stripe dashboard
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
            bookingId, // This is the ID passed from the form
            paymentMethod,
            cardNumber,
            cardExpiry,
            cardCvc
        } = req.body;
        
        // Validate payment info
        if (!bookingId) {
            req.session.error = 'Payment information is incomplete';
            return res.redirect(`/customer/payment/${bookingId}`);
        }
        
        // Generate a payment reference
        const paymentReference = 'payment_' + Date.now();
        
        // Update booking status to 'Confirmed' with payment information
        const updateResult = await pool.query(`
            UPDATE service_bookings
            SET status = 'Confirmed', 
                payment_status = 'Paid',
                payment_method = $1,
                payment_reference = $2,
                updated_at = NOW()
            WHERE id = $3 AND customer_id = $4
        `, [paymentMethod || 'card', paymentReference, bookingId, req.session.user.id]);
        
        console.log('Rows updated:', updateResult.rowCount);
        
        // Clear payment info from session
        delete req.session.paymentInfo;
        
        // Set success message
        req.session.success = 'Payment successful! Your booking has been confirmed.';
        
        // Redirect to the confirmation page
        return res.redirect('/customer/booking-confirmation');
        
    } catch (error) {
        console.error('Payment processing error:', error);
        req.session.error = 'Failed to process payment. Please try again.';
        return res.redirect(`/customer/payment/${req.body.bookingId}`);
    }
});

router.get('/customer/booking-confirmation/:bookingId?', isCustomerAuth, async (req, res) => {
    try {
        const bookingId = req.params.bookingId;
        const customerId = req.session.user.id;
        
        // Get detailed booking information with provider name and pricing
        const bookingResult = await pool.query(`
            SELECT sb.*, sp.business_name as provider_name, 
                   sc.base_fee, sc.fee_type
            FROM service_bookings sb
            JOIN service_providers sp ON sb.provider_id = sp.id
            LEFT JOIN service_categories sc ON sp.id = sc.provider_id AND LOWER(sc.category_name) = LOWER(sb.service_type)
            WHERE sb.id = $1 AND sb.customer_id = $2
            LIMIT 1
        `, [bookingId, customerId]);
        
        if (bookingResult.rows.length === 0) {
            req.session.error = 'Booking not found';
            return res.redirect('/customer/bookings');
        }
        
        const booking = bookingResult.rows[0];
        
        // If booking is cancelled, redirect to the cancellation page
        if (booking.status === 'Cancelled') {
            return res.redirect(`/customer/booking-cancelled/${bookingId}`);
        }
        
        // Otherwise render the normal confirmation page
        res.render('customer/booking-confirmation', {
            title: 'Booking Confirmation',
            user: req.session.user,
            booking: booking,
            success: req.session.success,
            error: req.session.error
        });
        
        // Clear session messages
        delete req.session.success;
        delete req.session.error;
        
    } catch (error) {
        console.error('Error loading booking confirmation:', error);
        req.session.error = 'Failed to load booking confirmation';
        res.redirect('/customer/bookings');
    }
});

// Add this test route to your booking.js file
router.get('/test-payment-update/:bookingId', isCustomerAuth, async (req, res) => {
    try {
        const bookingId = req.params.bookingId;
        
        // Direct update query
        const result = await pool.query(`
            UPDATE service_bookings
            SET payment_status = 'Paid',
                payment_method = 'Test Method',
                payment_reference = 'Test_Reference_${Date.now()}'
            WHERE id = $1
            RETURNING *
        `, [bookingId]);
        
        // Log the complete result
        console.log('Test update result:', JSON.stringify(result.rows[0], null, 2));
        
        // Send the result to the browser
        res.send({
            success: result.rowCount > 0,
            message: result.rowCount > 0 ? 'Update successful' : 'No rows updated',
            data: result.rows[0]
        });
        
    } catch (error) {
        console.error('Test update error:', error);
        res.status(500).send({
            success: false,
            error: error.message
        });
    }
});

// View customer's bookings
router.get('/customer/bookings', isCustomerAuth, async (req, res) => {
    try {
        const customerId = req.session.user.id;
        
        // Get all bookings for this customer with cancellation fields
        const bookingsResult = await pool.query(`
            SELECT sb.id, sb.service_type, sb.preferred_date, sb.time_slot, sb.status, 
                   sb.payment_status, sb.service_address, sb.created_at, 
                   sb.cancelled_at, sb.cancelled_by, sb.cancellation_reason,
                   sp.business_name as provider_name
            FROM service_bookings sb
            JOIN service_providers sp ON sb.provider_id = sp.id
            WHERE sb.customer_id = $1
            ORDER BY 
                CASE 
                    WHEN sb.status = 'Confirmed' THEN 1
                    WHEN sb.status = 'Pending' THEN 2
                    WHEN sb.status = 'Completed' THEN 3
                    WHEN sb.status = 'Cancelled' THEN 4
                    ELSE 5
                END,
                sb.preferred_date DESC
        `, [customerId]);
        
        res.render('customer/view-bookings', {
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

// API endpoint to get available time slots
router.get('/api/available-slots', isCustomerAuth, async (req, res) => {
    try {
        const { providerId, date, dayOfWeek } = req.query;
        
        if (!providerId || !date) {
            return res.status(400).json({ error: 'Provider ID and date are required' });
        }
        
        // Parse the date to get the day of week if not provided
        const selectedDate = new Date(date);
        const dayName = dayOfWeek || ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][selectedDate.getDay()];
        
        // Get provider's availability for this day
        const availabilityResult = await pool.query(
            'SELECT * FROM provider_availability WHERE provider_id = $1 AND day_of_week = $2 AND is_available = true',
            [providerId, dayName]
        );
        
        if (availabilityResult.rows.length === 0) {
            return res.json({ 
                slots: [],
                message: `No availability for ${dayName}`
            });
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
        const slotDuration = parseInt(availability.slot_duration) || 60; // in minutes
        
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
        
        res.json({ 
            slots: availableSlots,
            dayOfWeek: dayName,
            slotDuration: slotDuration
        });
        
    } catch (error) {
        console.error('Error getting available slots:', error);
        res.status(500).json({ error: 'Failed to get available time slots' });
    }
});

// Debug endpoint to examine image storage
router.get('/debug-images/:bookingId', isCustomerAuth, async (req, res) => {
    try {
        const bookingId = req.params.bookingId;
        const result = await pool.query(
            'SELECT id, images FROM service_bookings WHERE id = $1',
            [bookingId]
        );
        
        if (result.rows.length === 0) {
            return res.send(`<h1>Booking #${bookingId} not found</h1>`);
        }
        
        const booking = result.rows[0];
        let parsedImages = [];
        
        try {
            if (typeof booking.images === 'string') {
                parsedImages = JSON.parse(booking.images);
            } else if (Array.isArray(booking.images)) {
                parsedImages = booking.images;
            }
        } catch (e) {
            // Nothing to do
        }
        
        // Create a simple HTML page to display the information and test image paths
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Debug Images - Booking #${bookingId}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                h1 { color: #333; }
                pre { background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto; }
                .image-debug { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
                .image-item { margin: 10px 0; border: 1px solid #eee; padding: 10px; }
                img { max-width: 300px; border: 1px solid #ddd; }
                .error { color: red; }
            </style>
        </head>
        <body>
            <h1>Debug Images for Booking #${bookingId}</h1>
            
            <h2>Raw Data</h2>
            <pre>${JSON.stringify({ 
                id: booking.id,
                rawImagesType: typeof booking.images,
                rawImages: booking.images,
                parsedImages: parsedImages
            }, null, 2)}</pre>
            
            <div class="image-debug">
                <h2>Image Test</h2>
                ${parsedImages.length > 0 ? 
                    parsedImages.map((path, index) => `
                        <div class="image-item">
                            <h3>Image ${index + 1}</h3>
                            <p>Path: ${path}</p>
                            <p>Try to load image:</p>
                            <img src="${path}" alt="Test Image ${index}" onerror="this.onerror=null; this.nextElementSibling.style.display='block'; this.style.display='none';">
                            <p class="error" style="display:none;">❌ Image failed to load! Path is invalid or inaccessible.</p>
                        </div>
                    `).join('') 
                    : '<p>No images found for this booking.</p>'
                }
            </div>
        </body>
        </html>
        `;
        
        res.send(html);
    } catch (error) {
        res.send(`<h1>Error</h1><pre>${error.message}\n${error.stack}</pre>`);
    }
});

router.get('/customer/test-bookings', async (req, res) => {
    try {
      const customerId = req.session?.user?.id || 1; // Fallback for testing
      
      const bookingsResult = await pool.query(`
        SELECT sb.id, sb.service_type, sb.preferred_date, sb.time_slot, sb.status, 
               sb.payment_status, sb.service_address, sb.created_at, 
               sp.business_name as provider_name
        FROM service_bookings sb
        JOIN service_providers sp ON sb.provider_id = sp.id
        WHERE sb.customer_id = $1
      `, [customerId]);
      
      res.render('customer/view-bookings', {
        title: 'Test Bookings View',
        user: req.session.user,
        bookings: bookingsResult.rows,
      });
    } catch (error) {
      console.error('Error in test route:', error);
      res.send('Error: ' + error.message);
    }
  });

  // Route to view booking cancellation details
  router.get('/customer/booking-cancelled/:bookingId', isCustomerAuth, async (req, res) => {
    try {
        const bookingId = req.params.bookingId;
        const customerId = req.session.user.id;
        
        // Get detailed booking information with provider name, cancellation details
        const bookingResult = await pool.query(`
            SELECT sb.*, sp.business_name as provider_name, 
                   sc.base_fee, sc.fee_type
            FROM service_bookings sb
            JOIN service_providers sp ON sb.provider_id = sp.id
            LEFT JOIN service_categories sc ON sp.id = sc.provider_id AND LOWER(sc.category_name) = LOWER(sb.service_type)
            WHERE sb.id = $1 AND sb.customer_id = $2 AND sb.status = 'Cancelled'
            LIMIT 1
        `, [bookingId, customerId]);
        
        if (bookingResult.rows.length === 0) {
            req.session.error = 'Booking not found or not cancelled';
            return res.redirect('/customer/bookings');
        }
        
        // Render the cancellation page with detailed booking information
        res.render('customer/booking-cancellation', {
            title: 'Booking Cancelled',
            user: req.session.user,
            booking: bookingResult.rows[0],
            success: req.session.success,
            error: req.session.error
        });
        
        // Clear session messages
        delete req.session.success;
        delete req.session.error;
        
    } catch (error) {
        console.error('Error loading booking cancellation:', error);
        req.session.error = 'Failed to load booking cancellation details';
        res.redirect('/customer/bookings');
    }
});

  // Add this route to booking.js
    router.get('/debug-booking/:bookingId', isCustomerAuth, async (req, res) => {
        try {
            const bookingId = req.params.bookingId;
            const result = await pool.query(
                'SELECT id, images, service_type FROM service_bookings WHERE id = $1',
                [bookingId]
            );
            
            if (result.rows.length === 0) {
                return res.json({ error: 'Booking not found' });
            }
            
            const booking = result.rows[0];
            let parsedImages = null;
            
            try {
                if (typeof booking.images === 'string') {
                    parsedImages = JSON.parse(booking.images);
                } else {
                    parsedImages = booking.images;
                }
            } catch (e) {
                console.error('Error parsing images:', e);
            }
            
            res.json({
                bookingId: booking.id,
                serviceType: booking.service_type,
                imagesType: typeof booking.images,
                rawImages: booking.images,
                parsedImages: parsedImages
            });
        } catch (error) {
            res.status(500).json({ error: error.message, stack: error.stack });
        }
    });

// Debug route to check if images are accessible
router.get('/check-image-path', (req, res) => {
    const imagePath = req.query.path;
    
    if (!imagePath) {
        return res.status(400).json({ error: 'No image path provided' });
    }
    
    // Try to resolve the physical path
    const resolvedPath = path.join(__dirname, '..', imagePath.startsWith('/') ? imagePath.substring(1) : imagePath);
    
    // Check if file exists
    const fileExists = fs.existsSync(resolvedPath);
    
    res.json({
        requestedPath: imagePath,
        resolvedPath: resolvedPath,
        fileExists: fileExists,
        serverRoot: path.join(__dirname, '..'),
        staticServing: 'Check if these paths match your Express static middleware configuration'
    });
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