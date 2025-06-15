import express from 'express';
import pool from './config/database.js';

const router = express.Router();

// Middleware to check if user is logged in
const isCustomerAuth = (req, res, next) => {
    if (req.session?.user && req.session.user.userType === 'customer') {
        next();
    } else {
        req.session.error = 'Please login as a customer to access this page';
        res.redirect('/auth/customer-login');
    }
};

const isAuthenticated = (req, res, next) => {
    if (req.session?.user) {
        next();
    } else {
        req.session.error = 'Please login to access this page';
        res.redirect('/auth/customer-login');
    }
};

// Category normalization function
const normalizeCategories = (categories) => {
    // Comprehensive mapping for all possible category variations
    const categoryMapping = {
        // Home Cleaning variations
        'cleaning': 'home_cleaning',
        'home cleaning': 'home_cleaning',
        'homecleaning': 'home_cleaning',
        'house cleaning': 'home_cleaning',
        'home_cleaning': 'home_cleaning',
        
        // Plumbing variations
        'plumbing': 'plumbing',
        'plumber': 'plumbing',
        
        // Appliance Service variations
        'appliance service': 'appliance_service',
        'appliance repair': 'appliance_service',
        'appliance': 'appliance_service',
        'appliance_service': 'appliance_service',
        
        // Pest Control variations
        'pest control': 'pest_control',
        'pest management': 'pest_control',
        'pest_control': 'pest_control',
        
        // Electrical variations
        'electrical': 'electrical',
        'electrical repairs': 'electrical',
        'electrical repair': 'electrical',
        
        // AC Service variations
        'ac service': 'ac_service',
        'ac': 'ac_service',
        'ac_service': 'ac_service',
        'air conditioning': 'ac_service',
        
        // Carpentry variations
        'carpentry': 'carpentry',
        'carpentry services': 'carpentry',
        'carpentry service': 'carpentry',
        
        // Landscaping variations
        'landscaping': 'landscaping',
        'landscape': 'landscaping',
        'garden': 'landscaping',
        
        // Roofing variations
        'roofing': 'roofing',
        'roof repairs': 'roofing',
        'roof repair': 'roofing',
        'roof_repairs': 'roofing'
    };
    
    // Standardized display names
    const displayNames = {
        'home_cleaning': 'Home Cleaning',
        'plumbing': 'Plumbing',
        'appliance_service': 'Appliance Service',
        'pest_control': 'Pest Control',
        'landscaping': 'Landscaping',
        'electrical': 'Electrical Repairs',
        'ac_service': 'AC Service',
        'carpentry': 'Carpentry',
        'roofing': 'Roof Repairs'
    };
    
    // Process categories and remove duplicates
    const processedCategories = new Map(); // Use Map to ensure uniqueness
    
    categories.forEach(category => {
        if (!category || !category.category_name) {
            console.warn('Invalid category found:', category);
            return;
        }
        
        // Get the category name and convert to lowercase for comparison
        const categoryName = category.category_name.toLowerCase().trim();
        
        // Find the normalized key for this category
        let normalizedKey = categoryMapping[categoryName] || categoryName;
        
        // Clean up any remaining underscores for keys not in our mapping
        if (!categoryMapping[categoryName]) {
            normalizedKey = categoryName.replace(/[^a-z0-9]/g, '_');
        }
        
        // Only add if we haven't seen this normalized category before
        if (!processedCategories.has(normalizedKey)) {
            processedCategories.set(normalizedKey, {
                category_name: normalizedKey,
                display_name: displayNames[normalizedKey] || 
                             (categoryName.charAt(0).toUpperCase() + categoryName.slice(1).replace(/_/g, ' '))
            });
        }
    });
    
    // Convert Map back to array and log for debugging
    const result = Array.from(processedCategories.values());
    
    console.log('=== NORMALIZATION DEBUG ===');
    console.log('Input categories:', categories.map(c => c.category_name));
    console.log('Processed categories:', result.map(c => c.category_name));
    console.log('=== END DEBUG ===');
    
    return result;
};

// Add more routes as needed
router.get('/', isAuthenticated, (req, res) => {
    res.redirect('/customer/dashboard');
});

router.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        const customerId = req.session.user.id;
        
        // Get booking statistics
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_bookings,
                COUNT(CASE WHEN status = 'Confirmed' OR status = 'In Progress' THEN 1 END) as active_services,
                COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed_bookings,
                COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN 
                    CASE 
                        WHEN total_amount IS NOT NULL THEN total_amount 
                        WHEN service_charge IS NOT NULL THEN base_fee + service_charge
                        ELSE base_fee 
                    END
                ELSE 0 END), 0) as total_spent
            FROM service_bookings
            WHERE customer_id = $1
        `, [customerId]);
        
        // FIXED: Get all service categories from VERIFIED providers only
        const categoriesResult = await pool.query(`
            SELECT DISTINCT sc.category_name 
            FROM service_categories sc
            JOIN service_providers sp ON sc.provider_id = sp.id
            WHERE sp.is_verified = true
            ORDER BY sc.category_name
        `);
        
        console.log('=== DASHBOARD DEBUG ===');
        console.log('Customer ID:', customerId);
        console.log('Raw categories from database:', categoriesResult.rows);
        console.log('Number of categories found:', categoriesResult.rows.length);
        
        // Normalize categories to prevent duplicates
        const normalizedCategories = normalizeCategories(categoriesResult.rows);
        
        console.log('Normalized categories:', normalizedCategories);
        console.log('Number of normalized categories:', normalizedCategories.length);
        
        // Create a better mapping for category names to ensure consistency
        const finalCategories = normalizedCategories.map(category => {
            // Ensure we have both category_name and display_name
            return {
                category_name: category.category_name,
                display_name: category.display_name || category.category_name
            };
        });
        
        console.log('Final categories being sent to template:', finalCategories);
        
        // Render dashboard with statistics and normalized categories
        res.render('customer/customer-dashboard', {
            title: 'Customer Dashboard',
            user: req.session.user,
            totalBookings: statsResult.rows[0].total_bookings || 0,
            activeServices: statsResult.rows[0].active_services || 0,
            completedBookings: statsResult.rows[0].completed_bookings || 0,
            totalSpent: statsResult.rows[0].total_spent || 0,
            categories: finalCategories // Use the processed categories
        });
    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).render('error', { 
            message: 'Failed to load dashboard',
            error: error
        });
    }
});

router.get('/categories', isCustomerAuth, async (req, res) => {
    try {
        // Get all unique categories from the service_categories table
        const categoriesResult = await pool.query(`
            SELECT DISTINCT category_name 
            FROM service_categories 
            ORDER BY category_name ASC
        `);
        
        res.render('customer/service-categories', { 
            title: 'Service Categories',
            user: req.session.user,
            categories: categoriesResult.rows
        });
    } catch (error) {
        console.error('Error fetching categories:', error);
        req.session.error = 'Failed to load service categories';
        res.redirect('/customer/dashboard');
    }
});

// View service providers by category with optional location filtering
router.get('/category/:categoryName', isCustomerAuth, async (req, res) => {
    try {
        let categoryName = req.params.categoryName;
        
        // Define a mapping to handle normalized category names
        const categoryMapping = {
            'home_cleaning': ['cleaning', 'home cleaning', 'homecleaning', 'house cleaning', 'Home Cleaning'],
            'appliance_service': ['appliance', 'appliance service', 'appliance repair', 'Appliance Service'],
            'pest_control': ['pest control', 'pest management', 'Pest Control'],
            'roofing': ['roof repairs', 'Roof Repairs', 'roofing', 'Roofing', 'roof repair'],
            'plumbing': ['plumbing', 'Plumbing', 'plumber'],
            'electrical': ['electrical', 'Electrical', 'electrical repairs'],
            'ac_service': ['ac service', 'AC Service', 'ac_service'],
            'carpentry': ['carpentry', 'Carpentry', 'carpentry services']
            
            // Add more mappings as needed
        };
        

        // Find all variations of the category name to include in the query
        let categoryVariations = [categoryName];
        
        // Check if this category has variations defined in our mapping
        for (const [normalized, variations] of Object.entries(categoryMapping)) {
            if (normalized === categoryName) {
                // Use all variations for this normalized category
                categoryVariations = variations;
                break;
            }
            
            // Also check if the provided category is one of the variations
            if (variations.includes(categoryName.toLowerCase())) {
                // Use the normalized name and its variations
                categoryName = normalized; // Update to normalized version
                categoryVariations = variations;
                break;
            }
        }
        
        const stateId = req.query.state || null;
        const cityId = req.query.city || null;
        
        // Fetch all states for the filter dropdown
        const statesResult = await pool.query(`
            SELECT id, state_name
            FROM states
            ORDER BY state_name ASC
        `);
        
        // Fetch cities for the selected state (if a state is selected)
        let citiesResult = { rows: [] };
        if (stateId) {
            citiesResult = await pool.query(`
                SELECT id, city_name
                FROM cities
                WHERE state_id = $1
                ORDER BY city_name ASC
            `, [stateId]);
        }
        
        // Build the query for providers based on filters and category variations
        let providersQuery = `
            SELECT DISTINCT sp.id, sp.business_name, sp.phone_number, 
                   u.email, sp.is_verified, sc.base_fee, sc.fee_type, sc.category_name
            FROM service_providers sp
            JOIN users u ON sp.user_id = u.id
            JOIN service_categories sc ON sp.id = sc.provider_id
            WHERE (
        `;
        
        // Add each category variation as an OR condition
        const queryParams = [];
        categoryVariations.forEach((variation, index) => {
            if (index > 0) {
                providersQuery += ' OR ';
            }
            queryParams.push(variation);
            providersQuery += `LOWER(sc.category_name) = LOWER($${queryParams.length})`;
        });
        
        providersQuery += `) AND sp.is_verified = true`;
        
        // Add location filter if specified
        if (cityId) {
            queryParams.push(cityId);
            providersQuery += `
                AND sp.id IN (
                    SELECT provider_id
                    FROM provider_coverage
                    WHERE city_id = $${queryParams.length}
                )
            `;
        } else if (stateId) {
            queryParams.push(stateId);
            providersQuery += `
                AND sp.id IN (
                    SELECT provider_id
                    FROM provider_coverage pc
                    JOIN cities c ON pc.city_id = c.id
                    WHERE c.state_id = $${queryParams.length}
                )
            `;
        }
        
        providersQuery += ` ORDER BY sp.business_name ASC`;
        
        const providersResult = await pool.query(providersQuery, queryParams);
        
        // For each provider, get their services in this category
        const providers = [];
        for (const provider of providersResult.rows) {
            // Get services offered by this provider in any of the category variations
            let servicesQuery = `
                SELECT so.service_name
                FROM services_offered so
                JOIN service_categories sc ON so.provider_id = sc.provider_id
                WHERE so.provider_id = $1 AND (
            `;
            
            // Add each category variation as an OR condition
            const serviceQueryParams = [provider.id];
            categoryVariations.forEach((variation, index) => {
                if (index > 0) {
                    servicesQuery += ' OR ';
                }
                serviceQueryParams.push(variation);
                servicesQuery += `LOWER(sc.category_name) = LOWER($${serviceQueryParams.length})`;
            });
            
            servicesQuery += `)`;
            
            const servicesResult = await pool.query(servicesQuery, serviceQueryParams);
            
            // Get coverage areas for this provider
            const coverageResult = await pool.query(`
                SELECT c.city_name, s.state_name
                FROM provider_coverage pc
                JOIN cities c ON pc.city_id = c.id
                JOIN states s ON c.state_id = s.id
                WHERE pc.provider_id = $1
                ORDER BY s.state_name, c.city_name
            `, [provider.id]);
            
            providers.push({
                ...provider,
                services: servicesResult.rows,
                coverage: coverageResult.rows
            });
        }
        
        // Get display name for the category
        const displayNames = {
            'home_cleaning': 'Home Cleaning',
            'plumbing': 'Plumbing',
            'appliance_service': 'Appliance Service',
            'pest_control': 'Pest Control',
            'landscaping': 'Landscaping',
            'electrical': 'Electrical Repairs',
            'ac_service': 'AC Services',
            'carpentry': 'Carpentry Services',
            'roofing': 'Roof Repairs'
        };
        
        const categoryDisplayName = displayNames[categoryName] || 
            (categoryName.charAt(0).toUpperCase() + categoryName.slice(1));
        
        res.render('customer/providers-by-category', { 
            title: `${categoryDisplayName} Service Providers`,
            user: req.session.user,
            category: categoryName,
            categoryDisplay: categoryDisplayName,
            providers: providers,
            states: statesResult.rows,
            cities: citiesResult.rows,
            selectedState: stateId,
            selectedCity: cityId,
            locationFilterActive: !!(stateId || cityId)
        });
    } catch (error) {
        console.error('Error fetching providers by category:', error);
        req.session.error = 'Failed to load service providers';
        res.redirect('/customer/categories');
    }
});

// API endpoint to get cities by state_id
router.get('/api/cities', isCustomerAuth, async (req, res) => {
    try {
        const stateId = req.query.state_id;
        
        if (!stateId) {
            return res.status(400).json({ error: 'State ID is required' });
        }
        
        const citiesResult = await pool.query(`
            SELECT id, city_name
            FROM cities
            WHERE state_id = $1
            ORDER BY city_name ASC
        `, [stateId]);
        
        res.json(citiesResult.rows);
    } catch (error) {
        console.error('Error fetching cities:', error);
        res.status(500).json({ error: 'Failed to fetch cities' });
    }
});

// Submit a review for a completed booking
router.post('/submit-review', isCustomerAuth, async (req, res) => {
     try {
        const userId = req.session.user.id; // This is the user_id from the session
        const { booking_id, provider_id, rating, review_text } = req.body;
        
        console.log('Review submission received:');
        console.log('User ID:', userId);
        console.log('Form data:', req.body);
        console.log('Review text:', review_text);
        
        // Validate input
        if (!booking_id || !provider_id || !rating) {
            console.error('Missing required fields:', { booking_id, provider_id, rating });
            req.session.error = 'Missing required fields';
            return res.redirect('/customer/bookings');
        }
        
        // Verify this is a valid booking for this customer and it's completed
        const bookingResult = await pool.query(`
            SELECT sb.*
            FROM service_bookings sb
            WHERE sb.id = $1 AND sb.customer_id = $2 AND sb.status = 'Completed'
        `, [booking_id, userId]);
        
        console.log('Booking verification result rows:', bookingResult.rows.length);
        
        if (bookingResult.rows.length === 0) {
            req.session.error = 'Invalid booking or not eligible for review';
            return res.redirect('/customer/bookings');
        }
        
        // Check if a review already exists for this booking
        const existingReviewResult = await pool.query(`
            SELECT id FROM booking_reviews WHERE booking_id = $1
        `, [booking_id]);
        
        if (existingReviewResult.rows.length > 0) {
            req.session.error = 'You have already submitted a review for this booking';
            return res.redirect('/customer/bookings');
        }
        
        // Insert the review - NOTE: Using userId directly as the customer_id
        // since based on the database structure, booking_reviews.customer_id references users.id
        console.log('Inserting review with customer_id (user_id):', userId);
        console.log('Review text being inserted:', review_text || null);
        
        const insertResult = await pool.query(`
            INSERT INTO booking_reviews 
            (provider_id, customer_id, booking_id, rating, review_text, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id, review_text
        `, [provider_id, userId, booking_id, rating, review_text || null]);
        
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

// View service provider details
router.get('/provider/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const providerId = req.params.providerId;
        const categoryParam = req.query.category;
        
        console.log(`Loading provider details for provider ID: ${providerId}`);
        
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
        
        // Get all categories offered by this provider
        const categoriesResult = await pool.query(`
            SELECT category_name, base_fee, fee_type
            FROM service_categories
            WHERE provider_id = $1
            ORDER BY category_name ASC
        `, [providerId]);
        
        // Get all services offered by this provider
        const servicesResult = await pool.query(`
            SELECT service_name
            FROM services_offered
            WHERE provider_id = $1
            ORDER BY service_name ASC
        `, [providerId]);
        
        // Get coverage areas for this provider
        const coverageResult = await pool.query(`
            SELECT c.city_name, s.state_name
            FROM provider_coverage pc
            JOIN cities c ON pc.city_id = c.id
            JOIN states s ON c.state_id = s.id
            WHERE pc.provider_id = $1
            ORDER BY s.state_name, c.city_name
        `, [providerId]);
        
        // FIXED REVIEW QUERY: Join with customers table to get names
        const reviewsQuery = `
            SELECT 
                br.id, 
                br.rating, 
                br.review_text, 
                br.created_at,
                c.first_name,
                c.last_name
            FROM booking_reviews br
            JOIN customers c ON br.customer_id = c.user_id
            WHERE br.provider_id = $1
            ORDER BY br.created_at DESC
            LIMIT 4
        `;
        
        const reviewsResult = await pool.query(reviewsQuery, [providerId]);
        
        console.log(`Found ${reviewsResult.rows.length} reviews for provider ID: ${providerId}`);
        
        // Calculate average rating
        const avgRatingResult = await pool.query(`
            SELECT AVG(rating) as average_rating, COUNT(*) as review_count
            FROM booking_reviews
            WHERE provider_id = $1
        `, [providerId]);
        
        const averageRating = avgRatingResult.rows[0].average_rating || 0;
        const reviewCount = parseInt(avgRatingResult.rows[0].review_count) || 0;
        
        console.log(`Average rating: ${averageRating}, Total reviews: ${reviewCount}`);
        
        // Find the selected category from the query parameter
        let selectedCategory = null;
        
        if (categoryParam && categoriesResult.rows.length > 0) {
            selectedCategory = categoriesResult.rows.find(
                cat => cat.category_name.toLowerCase() === categoryParam.toLowerCase()
            );
        }
        
        // If no match found or no parameter provided, use the first category
        if (!selectedCategory && categoriesResult.rows.length > 0) {
            selectedCategory = categoriesResult.rows[0];
        }
        
        res.render('customer/provider-details', { 
            title: provider.business_name,
            user: req.session.user,
            provider: provider,
            categories: categoriesResult.rows,
            selectedCategory: selectedCategory,
            services: servicesResult.rows,
            coverage: coverageResult.rows,
            reviews: reviewsResult.rows,
            averageRating: parseFloat(averageRating).toFixed(1),
            reviewCount: reviewCount
        });
    } catch (error) {
        console.error('Error fetching provider details:', error);
        req.session.error = 'Failed to load provider details';
        res.redirect('/customer/categories');
    }
});

// View all reviews for a provider (separate page)
router.get('/provider-reviews/:providerId', isCustomerAuth, async (req, res) => {
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
        
        // CORRECTED QUERY: Properly join with customers table
        const reviewsQuery = `
            SELECT 
                br.id, 
                br.rating, 
                br.review_text, 
                br.created_at,
                c.first_name,
                c.last_name
            FROM booking_reviews br
            JOIN customers c ON br.customer_id = c.user_id
            WHERE br.provider_id = $1
            ORDER BY br.created_at DESC
        `;
        
        const reviewsResult = await pool.query(reviewsQuery, [providerId]);
        
        // Calculate average rating
        const avgRatingResult = await pool.query(`
            SELECT AVG(rating) as average_rating, COUNT(*) as review_count
            FROM booking_reviews
            WHERE provider_id = $1
        `, [providerId]);
        
        const averageRating = avgRatingResult.rows[0].average_rating || 0;
        const reviewCount = avgRatingResult.rows[0].review_count || 0;
        
        console.log(`Found ${reviewsResult.rows.length} reviews for all reviews page, provider ID: ${providerId}`);
        
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

// Submit a review for a completed booking
router.post('/submit-review', isCustomerAuth, async (req, res) => {
    try {
        const userId = req.session.user.id; // This is the user_id from the session
        const { booking_id, provider_id, rating, review_text } = req.body;
        
        console.log('Review submission received:');
        console.log('User ID:', userId);
        console.log('Form data:', req.body);
        console.log('Review text:', review_text);
        
        // Step 1: Find the customer record that corresponds to this user_id
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
        
        // Validate input
        if (!booking_id || !provider_id || !rating) {
            console.error('Missing required fields:', { booking_id, provider_id, rating });
            req.session.error = 'Missing required fields';
            return res.redirect('/customer/bookings');
        }
        
        // Verify this is a valid booking for this customer and it's completed
        const bookingResult = await pool.query(`
            SELECT sb.*
            FROM service_bookings sb
            WHERE sb.id = $1 AND sb.customer_id = $2 AND sb.status = 'Completed'
        `, [booking_id, userId]);
        
        console.log('Booking verification result rows:', bookingResult.rows.length);
        
        if (bookingResult.rows.length === 0) {
            req.session.error = 'Invalid booking or not eligible for review';
            return res.redirect('/customer/bookings');
        }
        
        // Check if a review already exists for this booking
        const existingReviewResult = await pool.query(`
            SELECT id FROM booking_reviews WHERE booking_id = $1
        `, [booking_id]);
        
        if (existingReviewResult.rows.length > 0) {
            req.session.error = 'You have already submitted a review for this booking';
            return res.redirect('/customer/bookings');
        }
        
        // Insert the review - use the actual user ID from the session
        // This is what links to the customers table via user_id
        console.log('Inserting review with user ID:', userId);
        console.log('Review text being inserted:', review_text || null);
        
        const insertResult = await pool.query(`
            INSERT INTO booking_reviews 
            (provider_id, customer_id, booking_id, rating, review_text, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id, review_text
        `, [provider_id, userId, booking_id, rating, review_text || null]);
        
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

// View all reviews for a provider (separate page)
router.get('/provider-reviews/:providerId', isCustomerAuth, async (req, res) => {
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
        
        // CORRECTED QUERY: Get all reviews for this provider with correct join to users table
        const reviewsQuery = `
            SELECT 
                br.id, 
                br.rating, 
                br.review_text, 
                br.created_at,
                u.first_name,
                u.last_name
            FROM booking_reviews br
            JOIN users u ON br.customer_id = u.id
            WHERE br.provider_id = $1
            ORDER BY br.created_at DESC
        `;
        
        const reviewsResult = await pool.query(reviewsQuery, [providerId]);
        
        // Calculate average rating
        const avgRatingResult = await pool.query(`
            SELECT AVG(rating) as average_rating, COUNT(*) as review_count
            FROM booking_reviews
            WHERE provider_id = $1
        `, [providerId]);
        
        const averageRating = avgRatingResult.rows[0].average_rating || 0;
        const reviewCount = avgRatingResult.rows[0].review_count || 0;
        
        console.log(`Found ${reviewsResult.rows.length} reviews for all reviews page, provider ID: ${providerId}`);
        
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

export default router;