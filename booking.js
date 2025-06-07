import express from 'express';
import pool from './config/database.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { bookingStorage } from './config/cloudinary.js'; // Import booking-specific Cloudinary storage

// Get current file path (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Create upload directory if it doesn't exist and check permissions
// const uploadDir = 'C:\\Users\\ASUS\\OneDrive\\Desktop\\HandyHub_fyp\\public\\uploads\\booking_images\\';
// if (!fs.existsSync(uploadDir)) {
//     fs.mkdirSync(uploadDir, { recursive: true });
//     console.log(`Created upload directory: ${uploadDir}`);
// }
// // Check permissions
// try {
//     fs.accessSync(uploadDir, fs.constants.W_OK);
//     console.log(`Upload directory ${uploadDir} is writable`);
// } catch (err) {
//     console.error(`Upload directory ${uploadDir} is not writable:`, err);
// }

// Configure storage for Multer
// const storage = multer.diskStorage({
//     destination: function (req, file, cb) {
//         cb(null, uploadDir);
//     },
//     filename: function (req, file, cb) {
//         // Generate unique filename with timestamp
//         const timestamp = Date.now();
//         const originalName = file.originalname.replace(/\s+/g, '_');
//         cb(null, `${timestamp}_${originalName}`);
//     }
// });

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
// const upload = multer({
//     storage: storage,
//     limits: {
//         fileSize: 10 * 1024 * 1024 // 10MB max file size
//     },
//     fileFilter: fileFilter
// });

// Configure Multer to use Cloudinary storage
const upload = multer({
    storage: bookingStorage, // Use booking-specific Cloudinary storage
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max file size
    },
    fileFilter: (req, file, cb) => {
        // Accept only image files
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
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
        
        // Calculate service charge and total amount
        const serviceCharge = calculatedFee * 0.05; // 5% service charge
        const totalAmount = calculatedFee + serviceCharge;

        console.log(`Calculated fees: Base=${calculatedFee}, Service=${serviceCharge}, Total=${totalAmount}`);
        
        // Process uploaded files from Cloudinary
        console.log('Cloudinary files received:', req.files); // Debug uploaded files

        let imageFiles = [];
        if (req.files && req.files.length > 0) {
            // Extract Cloudinary URLs from uploaded files
            imageFiles = req.files.map(file => {
                // Cloudinary provides the secure_url in the file object
                return file.path; // This is the Cloudinary URL
            });
            
            console.log('Processed Cloudinary image URLs:', imageFiles); // Debug processed URLs
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
            base_fee, fee_type, booking_hours, service_charge, total_amount)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15, $16, $17, $18)
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
            imageFilesJson, // Store the stringified JSON with Cloudinary URLs
            calculatedFee, // Store the calculated fee
            finalFeeType || 'per visit',
            finalFeeType === 'per hour' ? parseInt(bookingHours) : null, // Only store hours for hourly services
            serviceCharge,  // Add service charge
            totalAmount     // Add total amount
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
                serviceCharge: serviceCharge,  // Add service charge to session
                totalAmount: totalAmount,      // Add total amount to session
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
        
        // Get all bookings for this customer with provider information
        const bookingsResult = await pool.query(`
            SELECT 
                sb.id, 
                sb.service_type, 
                sb.preferred_date, 
                sb.time_slot, 
                sb.status, 
                sb.payment_status,
                sb.cancellation_reason,
                sb.base_fee,
                sb.provider_id,
                sp.business_name as provider_name
            FROM service_bookings sb
            JOIN service_providers sp ON sb.provider_id = sp.id
            WHERE sb.customer_id = $1
            ORDER BY 
                CASE 
                    WHEN sb.status = 'Pending' THEN 1
                    WHEN sb.status = 'Confirmed' THEN 2
                    WHEN sb.status = 'In Progress' THEN 3
                    WHEN sb.status = 'Completed' THEN 4
                    WHEN sb.status = 'Cancelled' THEN 5
                    ELSE 6
                END,
                sb.preferred_date DESC
        `, [customerId]);
        
        // For each booking, check if a review has been submitted
        const bookings = bookingsResult.rows;
        
        // Get the list of booking IDs
        const bookingIds = bookings.map(booking => booking.id);
        
        // If there are bookings, check which ones have reviews
        if (bookingIds.length > 0) {
            const reviewsResult = await pool.query(`
                SELECT booking_id 
                FROM booking_reviews 
                WHERE booking_id = ANY($1)
            `, [bookingIds]);
            
            // Create a Set of booking IDs that have reviews for quick lookup
            const reviewedBookingIds = new Set(reviewsResult.rows.map(r => r.booking_id));
            
            // Add a has_review flag to each booking
            bookings.forEach(booking => {
                booking.has_review = reviewedBookingIds.has(booking.id);
            });
        }
        
        res.render('customer/view-bookings', {
            title: 'My Bookings',
            bookings: bookings,
            user: req.session.user,
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

// View a specific provider with reviews
router.get('/customer/provider-reviews/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const providerId = req.params.providerId;
        
        // Get provider details
        const providerResult = await pool.query(`
            SELECT sp.id, sp.business_name
            FROM service_providers sp
            WHERE sp.id = $1 AND sp.is_verified = true
        `, [providerId]);
        
        if (providerResult.rows.length === 0) {
            req.session.error = 'Service provider not found';
            return res.redirect('/customer/categories');
        }
        
        // Get all reviews for this provider with customer names
        const reviewsResult = await pool.query(`
            SELECT 
                pr.id, 
                pr.rating, 
                pr.review_text, 
                pr.created_at,
                c.first_name,
                c.last_name
            FROM booking_reviews pr
            JOIN customers c ON pr.customer_id = c.id
            WHERE pr.provider_id = $1
            ORDER BY pr.created_at DESC
        `, [providerId]);
        
        // Calculate average rating
        const avgRatingResult = await pool.query(`
            SELECT AVG(rating) as average_rating, COUNT(*) as review_count
            FROM booking_reviews
            WHERE provider_id = $1
        `, [providerId]);
        
        const averageRating = avgRatingResult.rows[0].average_rating || 0;
        const reviewCount = avgRatingResult.rows[0].review_count || 0;
        
        res.render('customer/provider-reviews', {
            title: `Reviews for ${providerResult.rows[0].business_name}`,
            user: req.session.user,
            provider: providerResult.rows[0],
            reviews: reviewsResult.rows,
            averageRating: parseFloat(averageRating).toFixed(1),
            reviewCount: reviewCount
        });
        
    } catch (error) {
        console.error('Error fetching provider reviews:', error);
        req.session.error = 'Failed to load provider reviews';
        res.redirect('/customer/categories');
    }
});

// Write a review form
router.get('/customer/write-review/:bookingId', isCustomerAuth, async (req, res) => {
    try {
        const customerId = req.session.user.id;
        const bookingId = req.params.bookingId;
        
        // Verify this is a valid booking for this customer and it's completed
        const bookingResult = await pool.query(`
            SELECT 
                sb.id, 
                sb.service_type, 
                sb.preferred_date,
                sb.provider_id,
                sp.business_name as provider_name
            FROM service_bookings sb
            JOIN service_providers sp ON sb.provider_id = sp.id
            WHERE sb.id = $1 AND sb.customer_id = $2 AND sb.status = 'Completed'
        `, [bookingId, customerId]);
        
        if (bookingResult.rows.length === 0) {
            req.session.error = 'Invalid booking or not eligible for review';
            return res.redirect('/customer/bookings');
        }
        
        const booking = bookingResult.rows[0];
        
        // Check if a review already exists for this booking
        const existingReviewResult = await pool.query(`
            SELECT id FROM booking_reviews WHERE booking_id = $1
        `, [bookingId]);
        
        if (existingReviewResult.rows.length > 0) {
            req.session.error = 'You have already submitted a review for this booking';
            return res.redirect('/customer/bookings');
        }
        
        res.render('customer/write-review', {
            title: 'Write a Review',
            user: req.session.user,
            booking: booking
        });
        
    } catch (error) {
        console.error('Error loading review form:', error);
        req.session.error = 'Failed to load review form';
        res.redirect('/customer/bookings');
    }
});

// Submit a review for a completed booking (POST)
router.post('/customer/submit-review', isCustomerAuth, async (req, res) => {
     try {
        const userId = req.session.user.id; // This is the user_id from the session
        const { booking_id, provider_id, rating, review_text } = req.body;
        
        console.log('Review submission received:');
        console.log('User ID:', userId);
        console.log('Form data:', req.body);
        console.log('Review text:', review_text);
        
        // Step 1: Find the correct customer_id that corresponds to this user_id
        const customerResult = await pool.query(`
            SELECT id FROM customers WHERE user_id = $1
        `, [userId]);
        
        if (customerResult.rows.length === 0) {
            console.error('No customer record found for user ID:', userId);
            req.session.error = 'Customer record not found';
            return res.redirect('/customer/bookings');
        }
        
        const customerId = customerResult.rows[0].id;
        console.log('Found customer ID:', customerId, 'for user ID:', userId);
        
        // Step 2: Validate input
        if (!booking_id || !provider_id || !rating) {
            console.error('Missing required fields:', { booking_id, provider_id, rating });
            req.session.error = 'Missing required fields';
            return res.redirect('/customer/bookings');
        }
        
        // Step 3: Verify this is a valid booking for this customer and it's completed
        const bookingResult = await pool.query(`
            SELECT sb.*
            FROM service_bookings sb
            WHERE sb.id = $1 AND sb.customer_id = $2 AND sb.status = 'Completed'
        `, [booking_id, customerId]);
        
        console.log('Booking verification result rows:', bookingResult.rows.length);
        
        if (bookingResult.rows.length === 0) {
            req.session.error = 'Invalid booking or not eligible for review';
            return res.redirect('/customer/bookings');
        }
        
        // Step 4: Check if a review already exists for this booking
        const existingReviewResult = await pool.query(`
            SELECT id FROM booking_reviews WHERE booking_id = $1
        `, [booking_id]);
        
        if (existingReviewResult.rows.length > 0) {
            req.session.error = 'You have already submitted a review for this booking';
            return res.redirect('/customer/bookings');
        }
        
        // Step 5: Insert the review with the correct customer_id - ensure text is properly saved
        console.log('Inserting review with customer_id:', customerId);
        console.log('Review text being inserted:', review_text || null);
        
        const insertResult = await pool.query(`
            INSERT INTO booking_reviews 
            (provider_id, customer_id, booking_id, rating, review_text, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id, review_text
        `, [provider_id, customerId, booking_id, rating, review_text || null]);
        
        console.log('Review inserted successfully, ID:', insertResult.rows[0].id);
        console.log('Saved review_text:', insertResult.rows[0].review_text);
        
        // After submitting the review, redirect to the provider details page to see it
        req.session.success = 'Thank you for your review!';
        return res.redirect(`/customer/provider/${provider_id}`);
        
    } catch (error) {
        console.error('Error submitting review:', error);
        req.session.error = 'Failed to submit review: ' + error.message;
        res.redirect('/customer/bookings');
    }
});

// View all reviews for a provider
router.get('/customer/provider-reviews/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const providerId = req.params.providerId;
        
        // Get provider details
        const providerResult = await pool.query(`
            SELECT sp.id, sp.business_name
            FROM service_providers sp
            WHERE sp.id = $1 AND sp.is_verified = true
        `, [providerId]);
        
        if (providerResult.rows.length === 0) {
            req.session.error = 'Service provider not found';
            return res.redirect('/customer/categories');
        }
        
        // Get all reviews for this provider with customer names
        const reviewsResult = await pool.query(`
            SELECT 
                pr.id, 
                pr.rating, 
                pr.review_text, 
                pr.created_at,
                c.first_name,
                c.last_name
            FROM booking_reviews pr
            JOIN customers c ON pr.customer_id = c.id
            WHERE pr.provider_id = $1
            ORDER BY pr.created_at DESC
        `, [providerId]);
        
        // Calculate average rating
        const avgRatingResult = await pool.query(`
            SELECT AVG(rating) as average_rating, COUNT(*) as review_count
            FROM booking_reviews
            WHERE provider_id = $1
        `, [providerId]);
        
        const averageRating = avgRatingResult.rows[0].average_rating || 0;
        const reviewCount = avgRatingResult.rows[0].review_count || 0;
        
        res.render('customer/provider-reviews', {
            title: `Reviews for ${providerResult.rows[0].business_name}`,
            user: req.session.user,
            provider: providerResult.rows[0],
            reviews: reviewsResult.rows,
            averageRating: parseFloat(averageRating).toFixed(1),
            reviewCount: reviewCount
        });
        
    } catch (error) {
        console.error('Error fetching provider reviews:', error);
        req.session.error = 'Failed to load provider reviews';
        res.redirect('/customer/categories');
    }
});

// Find eligible booking for review (completed booking without review)
router.get('/customer/find-eligible-booking/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const customerId = req.session.user.id;
        const providerId = req.params.providerId;
        
        // Find completed bookings for this provider that don't have reviews yet
        const bookingsResult = await pool.query(`
            SELECT sb.id, sb.service_type, sb.preferred_date, sb.provider_id
            FROM service_bookings sb
            LEFT JOIN booking_reviews pr ON sb.id = pr.booking_id
            WHERE sb.customer_id = $1 
              AND sb.provider_id = $2 
              AND sb.status = 'Completed'
              AND pr.id IS NULL
            ORDER BY sb.preferred_date DESC
            LIMIT 1
        `, [customerId, providerId]);
        
        if (bookingsResult.rows.length === 0) {
            // No eligible bookings found, check if user has any completed bookings with this provider
            const completedBookingsResult = await pool.query(`
                SELECT COUNT(*) as count
                FROM service_bookings
                WHERE customer_id = $1 
                  AND provider_id = $2 
                  AND status = 'Completed'
            `, [customerId, providerId]);
            
            const hasCompletedBookings = parseInt(completedBookingsResult.rows[0].count) > 0;
            
            if (hasCompletedBookings) {
                req.session.error = 'You have already reviewed all your completed bookings with this provider.';
            } else {
                req.session.error = 'You need to complete a service with this provider before writing a review.';
            }
            
            return res.redirect(`/customer/provider/${providerId}`);
        }
        
        // Found an eligible booking, redirect to the review form
        const booking = bookingsResult.rows[0];
        res.redirect(`/customer/write-review/${booking.id}`);
        
    } catch (error) {
        console.error('Error finding eligible booking:', error);
        req.session.error = 'Failed to check eligible bookings for review.';
        res.redirect(`/customer/provider/${req.params.providerId}`);
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
            SELECT 
                sb.*, 
                sp.business_name as provider_name
            FROM service_bookings sb
            JOIN service_providers sp ON sb.provider_id = sp.id
            WHERE sb.id = $1 AND sb.customer_id = $2
            LIMIT 1
        `, [bookingId, customerId]);
        
        if (bookingResult.rows.length === 0) {
            req.session.error = 'Booking not found';
            return res.redirect('/customer/bookings');
        }
        
        const booking = bookingResult.rows[0];
        
        // Ensure all necessary payment fields exist with fallback values
        booking.base_fee = booking.base_fee || 0;
        booking.service_charge = booking.service_charge || (booking.base_fee * 0.05);
        booking.total_amount = booking.total_amount || (parseFloat(booking.base_fee) + parseFloat(booking.service_charge));
        
        console.log('Booking details:', {
            id: booking.id,
            base_fee: booking.base_fee,
            service_charge: booking.service_charge,
            total_amount: booking.total_amount
        });
        
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
        const { providerId, date, dayOfWeek, serviceType, bookingHours } = req.query;
        
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
        
        // Get ALL existing bookings for this provider and date, regardless of status
        const bookingsResult = await pool.query(
            `SELECT time_slot, service_type, booking_hours FROM service_bookings 
             WHERE provider_id = $1 AND preferred_date = $2 
             AND status NOT IN ('Cancelled')`,
            [providerId, date]
        );
        
        console.log(`Found ${bookingsResult.rows.length} existing bookings for ${date}:`, bookingsResult.rows);
        
        // Generate all possible 1-hour time slots for the day
        const startTime = new Date(`${date}T${availability.start_time}`);
        const endTime = new Date(`${date}T${availability.end_time}`);
        const slotDuration = parseInt(availability.slot_duration) || 60; // in minutes
        
        // Create a Set to track all occupied 1-hour slots
        const occupiedSlots = new Set();
        
        // Process each existing booking to determine which 1-hour slots it occupies
        bookingsResult.rows.forEach(booking => {
            const timeSlot = booking.time_slot;
            const bookingHours = booking.booking_hours || 1;
            const isHomeCleaningMultiHour = booking.service_type === 'Home Cleaning' && bookingHours > 1;
            
            if (isHomeCleaningMultiHour) {
                // For multi-hour Home Cleaning bookings, parse the time slot and mark all occupied hours
                const [startTimeStr, endTimeStr] = timeSlot.split(' - ');
                const bookingStartTime = parseTimeString(startTimeStr, date);
                const bookingEndTime = parseTimeString(endTimeStr, date);
                
                // Mark each 1-hour slot within this booking as occupied
                let currentSlotTime = new Date(bookingStartTime);
                while (currentSlotTime < bookingEndTime) {
                    const slotEndTime = new Date(currentSlotTime);
                    slotEndTime.setMinutes(slotEndTime.getMinutes() + slotDuration);
                    
                    const oneHourSlot = `${formatTime(currentSlotTime)} - ${formatTime(slotEndTime)}`;
                    occupiedSlots.add(oneHourSlot);
                    
                    currentSlotTime.setMinutes(currentSlotTime.getMinutes() + slotDuration);
                }
                
                console.log(`Multi-hour booking ${timeSlot} occupies slots:`, 
                    Array.from(occupiedSlots).filter(slot => {
                        const slotStart = parseTimeString(slot.split(' - ')[0], date);
                        return slotStart >= bookingStartTime && slotStart < bookingEndTime;
                    })
                );
            } else {
                // For single-hour bookings, just mark the exact slot as occupied
                occupiedSlots.add(timeSlot);
            }
        });
        
        console.log(`Total occupied 1-hour slots:`, Array.from(occupiedSlots));
        
        // Create all potential 1-hour time slots that are not occupied
        const availableOneHourSlots = [];
        let currentTime = new Date(startTime);
        
        while (currentTime < endTime) {
            const slotEndTime = new Date(currentTime);
            slotEndTime.setMinutes(slotEndTime.getMinutes() + slotDuration);
            
            if (slotEndTime <= endTime) {
                const timeSlot = `${formatTime(currentTime)} - ${formatTime(slotEndTime)}`;
                
                // Check if this slot is not occupied
                if (!occupiedSlots.has(timeSlot)) {
                    availableOneHourSlots.push({
                        slot: timeSlot,
                        startTimeObj: new Date(currentTime),
                        endTimeObj: new Date(slotEndTime)
                    });
                }
            }
            
            // Move to next slot
            currentTime.setMinutes(currentTime.getMinutes() + slotDuration);
        }
        
        console.log(`Available 1-hour slots: ${availableOneHourSlots.length}`);
        
        let availableSlots = [];
        
        // Special handling for Home Cleaning with multiple hours
        if (serviceType === 'Home Cleaning' && bookingHours && bookingHours > 1) {
            const hoursNeeded = parseInt(bookingHours);
            const usedStartTimes = new Set();
            
            // Find slots that have enough consecutive availability
            for (let i = 0; i < availableOneHourSlots.length; i++) {
                const currentStartTime = availableOneHourSlots[i].startTimeObj.getTime();
                if (usedStartTimes.has(currentStartTime)) {
                    continue;
                }
                
                // Check if we have enough consecutive slots from this position
                if (i + hoursNeeded <= availableOneHourSlots.length) {
                    let hasConsecutiveSlots = true;
                    
                    // Check each consecutive slot
                    for (let j = 0; j < hoursNeeded - 1; j++) {
                        const currentSlotEnd = availableOneHourSlots[i + j].endTimeObj;
                        const nextSlotStart = availableOneHourSlots[i + j + 1].startTimeObj;
                        
                        // Check if slots are consecutive
                        if (currentSlotEnd.getTime() !== nextSlotStart.getTime()) {
                            hasConsecutiveSlots = false;
                            break;
                        }
                    }
                    
                    if (hasConsecutiveSlots) {
                        // This is a valid starting slot for the requested hours
                        const startSlot = availableOneHourSlots[i].slot.split(' - ')[0];
                        const endSlot = availableOneHourSlots[i + hoursNeeded - 1].slot.split(' - ')[1];
                        const combinedSlot = `${startSlot} - ${endSlot}`;
                        
                        availableSlots.push(combinedSlot);
                        
                        // Mark all the time slots used by this multi-hour booking as unavailable
                        for (let k = 0; k < hoursNeeded; k++) {
                            if (i + k < availableOneHourSlots.length) {
                                usedStartTimes.add(availableOneHourSlots[i + k].startTimeObj.getTime());
                            }
                        }
                    }
                }
            }
            
            console.log(`Found ${availableSlots.length} non-overlapping ${hoursNeeded}-hour slots for Home Cleaning`);
        } else {
            // For other services or 1-hour bookings, use the available 1-hour slots
            availableSlots = availableOneHourSlots.map(slot => slot.slot);
        }
        
        res.json({ 
            slots: availableSlots,
            dayOfWeek: dayName,
            slotDuration: slotDuration,
            providerHours: `${formatTime(startTime)} - ${formatTime(endTime)}`,
            isHomeCleaningMultiHour: serviceType === 'Home Cleaning' && bookingHours > 1,
            hoursRequested: bookingHours || 1
        });
        
    } catch (error) {
        console.error('Error getting available slots:', error);
        res.status(500).json({ error: 'Failed to get available time slots' });
    }
});

// Helper function to parse time string like "9:00 AM" into a Date object
function parseTimeString(timeStr, dateStr) {
    const [time, period] = timeStr.trim().split(' ');
    const [hours, minutes] = time.split(':').map(Number);
    
    let hour24 = hours;
    if (period === 'PM' && hours !== 12) {
        hour24 += 12;
    } else if (period === 'AM' && hours === 12) {
        hour24 = 0;
    }
    
    const date = new Date(dateStr);
    date.setHours(hour24, minutes, 0, 0);
    return date;
}

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