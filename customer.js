import express from 'express';
import pool from './config/database.js';

const router = express.Router();

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

// Category normalization function
const normalizeCategories = (categories) => {
    // Map of similar category names to be consolidated
    const categoryMapping = {
        'cleaning': 'home_cleaning',
        'home cleaning': 'home_cleaning',
        'homecleaning': 'home_cleaning',
        'house cleaning': 'home_cleaning',
        
        'plumbing': 'plumbing',
        'plumber': 'plumbing',
        
        'appliance service': 'appliance_service',
        'appliance repair': 'appliance_service',
        'appliance': 'appliance_service',
        
        'pest control': 'pest_control',
        'pest management': 'pest_control'
        
        // Add more mappings as needed
    };
    
    // Map of standardized category names to display names
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
        // Add more display names as needed
    };
    
    // Create a new array for normalized categories
    const normalizedCategories = [];
    const processedCategories = new Set();
    
    categories.forEach(category => {
        // Get the category name and convert to lowercase for comparison
        const categoryName = category.category_name.toLowerCase();
        
        // Find the normalized key for this category
        let normalizedKey = categoryMapping[categoryName] || categoryName;
        
        // Skip if we've already processed this normalized category
        if (processedCategories.has(normalizedKey)) {
            return;
        }
        
        // Mark this category as processed
        processedCategories.add(normalizedKey);
        
        // Create a new normalized category object
        normalizedCategories.push({
            category_name: normalizedKey,
            display_name: displayNames[normalizedKey] || 
                          (categoryName.charAt(0).toUpperCase() + categoryName.slice(1))
        });
    });
    
    return normalizedCategories;
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
                COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN base_fee ELSE 0 END), 0) as total_spent
            FROM service_bookings
            WHERE customer_id = $1
        `, [customerId]);
        
        // Get all service categories
        const categoriesResult = await pool.query(`
            SELECT DISTINCT category_name 
            FROM service_categories 
            ORDER BY category_name
        `);
        
        // Normalize categories to prevent duplicates
        const normalizedCategories = normalizeCategories(categoriesResult.rows);
        
        console.log('Original categories:', categoriesResult.rows);
        console.log('Normalized categories:', normalizedCategories);
        
        // Render dashboard with statistics and normalized categories
        res.render('customer/customer-dashboard', {
            title: 'Customer Dashboard',
            user: req.session.user,
            totalBookings: statsResult.rows[0].total_bookings || 0,
            activeServices: statsResult.rows[0].active_services || 0,
            completedBookings: statsResult.rows[0].completed_bookings || 0,
            totalSpent: statsResult.rows[0].total_spent || 0,
            categories: normalizedCategories
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

// View service provider details
router.get('/provider/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const providerId = req.params.providerId;
        const categoryParam = req.query.category; // Get category from query param
        
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
            coverage: coverageResult.rows
        });
    } catch (error) {
        console.error('Error fetching provider details:', error);
        req.session.error = 'Failed to load provider details';
        res.redirect('/customer/categories');
    }
});

// Submit a review for a completed booking
router.post('/submit-review', isCustomerAuth, async (req, res) => {
    try {
        const customerId = req.session.user.id;
        const { booking_id, provider_id, rating, review_text } = req.body;
        
        // Validate input
        if (!booking_id || !provider_id || !rating) {
            req.session.error = 'Missing required fields';
            return res.redirect('/customer/bookings');
        }
        
        // Verify this is a valid booking for this customer and it's completed
        const bookingResult = await pool.query(`
            SELECT sb.*
            FROM service_bookings sb
            WHERE sb.id = $1 AND sb.customer_id = $2 AND sb.status = 'Completed'
        `, [booking_id, customerId]);
        
        if (bookingResult.rows.length === 0) {
            req.session.error = 'Invalid booking or not eligible for review';
            return res.redirect('/customer/bookings');
        }
        
        // Check if a review already exists for this booking
        const existingReviewResult = await pool.query(`
            SELECT id FROM provider_reviews WHERE booking_id = $1
        `, [booking_id]);
        
        if (existingReviewResult.rows.length > 0) {
            req.session.error = 'You have already submitted a review for this booking';
            return res.redirect('/customer/bookings');
        }
        
        // Insert the review
        await pool.query(`
            INSERT INTO provider_reviews 
            (provider_id, customer_id, booking_id, rating, review_text)
            VALUES ($1, $2, $3, $4, $5)
        `, [provider_id, customerId, booking_id, rating, review_text || null]);
        
        req.session.success = 'Thank you for your review!';
        return res.redirect('/customer/bookings');
        
    } catch (error) {
        console.error('Error submitting review:', error);
        req.session.error = 'Failed to submit review';
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
        
        // Get all reviews for this provider with customer names
        const reviewsResult = await pool.query(`
            SELECT 
                pr.id, 
                pr.rating, 
                pr.review_text, 
                pr.created_at,
                c.first_name,
                c.last_name
            FROM provider_reviews pr
            JOIN customers c ON pr.customer_id = c.id
            WHERE pr.provider_id = $1
            ORDER BY pr.created_at DESC
        `, [providerId]);
        
        // Calculate average rating
        const avgRatingResult = await pool.query(`
            SELECT AVG(rating) as average_rating, COUNT(*) as review_count
            FROM provider_reviews
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

export default router;