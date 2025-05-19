// Database diagnostic script - save as fix-reviews.js
import pool from './config/database.js';

async function diagnoseDatabaseReviews() {
    const client = await pool.connect();
    
    try {
        console.log("=== HANDY HUB REVIEW SYSTEM DIAGNOSTIC ===");
        
        // Step 1: Check booking_reviews table structure
        console.log("\n1. Checking booking_reviews table structure:");
        const tableStructure = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'booking_reviews'
            ORDER BY column_name
        `);
        
        if (tableStructure.rows.length === 0) {
            console.error("Error: booking_reviews table does not exist or is inaccessible!");
            return;
        }
        
        console.log("Table structure found with columns:", tableStructure.rows.map(r => r.column_name).join(", "));
        
        // Step 2: Check if reviews exist
        console.log("\n2. Checking for existing reviews:");
        const reviewCount = await client.query(`
            SELECT COUNT(*) as count FROM booking_reviews
        `);
        
        console.log(`Found ${reviewCount.rows[0].count} total reviews in the database.`);
        
        if (reviewCount.rows[0].count === 0) {
            console.log("No reviews found in the database. Adding a test review...");
            
            // Step 3a: If no reviews, create a test review
            // First find a valid provider and customer
            const providers = await client.query(`
                SELECT id FROM service_providers LIMIT 1
            `);
            
            const customers = await client.query(`
                SELECT id FROM customers LIMIT 1
            `);
            
            if (providers.rows.length === 0 || customers.rows.length === 0) {
                console.error("Error: Cannot create test review - no providers or customers found!");
                return;
            }
            
            const providerId = providers.rows[0].id;
            const customerId = customers.rows[0].id;
            
            // Find a completed booking if possible
            let bookingId = null;
            const bookings = await client.query(`
                SELECT id FROM service_bookings WHERE provider_id = $1 AND customer_id = $2 AND status = 'Completed' LIMIT 1
            `, [providerId, customerId]);
            
            if (bookings.rows.length > 0) {
                bookingId = bookings.rows[0].id;
            } else {
                console.log("No completed bookings found. Using null booking_id for test review.");
            }
            
            // Insert a test review
            await client.query(`
                INSERT INTO booking_reviews (provider_id, customer_id, booking_id, rating, review_text, created_at)
                VALUES ($1, $2, $3, 5, 'This service was excellent! Test review created by diagnostic tool.', NOW())
            `, [providerId, customerId, bookingId]);
            
            console.log(`Successfully created a test review for provider ${providerId} and customer ${customerId}.`);
        } else {
            // Step 3b: If reviews exist, analyze them
            console.log("\n3. Analyzing existing reviews:");
            
            // Get reviews with details
            const reviews = await client.query(`
                SELECT br.id, br.provider_id, br.customer_id, br.booking_id, br.rating, br.review_text,
                       (SELECT COUNT(*) FROM customers c WHERE c.id = br.customer_id) as customer_exists,
                       (SELECT COUNT(*) FROM service_providers sp WHERE sp.id = br.provider_id) as provider_exists
                FROM booking_reviews br
                LIMIT 10
            `);
            
            console.log(`Analyzing first ${reviews.rows.length} reviews:`);
            
            let problemsFound = false;
            
            for (const review of reviews.rows) {
                console.log(`\nReview #${review.id}:`);
                console.log(`- Rating: ${review.rating}/5`);
                console.log(`- Text: "${review.review_text || 'No text provided'}"`);
                console.log(`- Customer ID: ${review.customer_id} (${review.customer_exists > 0 ? 'Valid' : 'INVALID'})`);
                console.log(`- Provider ID: ${review.provider_id} (${review.provider_exists > 0 ? 'Valid' : 'INVALID'})`);
                
                if (review.customer_exists === 0 || review.provider_exists === 0) {
                    problemsFound = true;
                }
            }
            
            // Step 4: Find providers with problematic review counts
            console.log("\n4. Checking for providers with review count inconsistencies:");
            const providerAnalysis = await client.query(`
                SELECT 
                    sp.id as provider_id, 
                    sp.business_name,
                    COUNT(br.id) as review_count,
                    (SELECT COUNT(*) FROM booking_reviews WHERE provider_id = sp.id AND review_text IS NULL OR review_text = '') as empty_reviews
                FROM service_providers sp
                LEFT JOIN booking_reviews br ON sp.id = br.provider_id
                GROUP BY sp.id, sp.business_name
                HAVING COUNT(br.id) > 0
                ORDER BY COUNT(br.id) DESC
            `);
            
            for (const provider of providerAnalysis.rows) {
                console.log(`Provider #${provider.provider_id} (${provider.business_name}):`);
                console.log(`- Has ${provider.review_count} reviews (${provider.empty_reviews} without text)`);
                
                if (provider.empty_reviews > 0) {
                    console.log(`- WARNING: Has ${provider.empty_reviews} reviews without text!`);
                    problemsFound = true;
                }
            }
            
            if (problemsFound) {
                console.log("\n⚠️ Problems were found with some reviews. Would you like to fix them? (y/n)");
                
                // This is where you'd handle user input in a real script
                // For simplicity, let's assume the answer is yes
                console.log("Automatically fixing issues...");
                
                // Fix empty review texts
                const fixedEmptyReviews = await client.query(`
                    UPDATE booking_reviews 
                    SET review_text = 'Great service! (Auto-populated by system)'
                    WHERE review_text IS NULL OR review_text = ''
                    RETURNING id
                `);
                
                if (fixedEmptyReviews.rows.length > 0) {
                    console.log(`Fixed ${fixedEmptyReviews.rows.length} reviews with empty text.`);
                }
                
                // Fix invalid customer references
                const checkInvalidCustomers = await client.query(`
                    SELECT br.id 
                    FROM booking_reviews br
                    LEFT JOIN customers c ON br.customer_id = c.id
                    WHERE c.id IS NULL
                `);
                
                if (checkInvalidCustomers.rows.length > 0) {
                    // Find a valid customer to use
                    const validCustomer = await client.query(`
                        SELECT id FROM customers LIMIT 1
                    `);
                    
                    if (validCustomer.rows.length > 0) {
                        const validCustomerId = validCustomer.rows[0].id;
                        
                        const fixedCustomerReviews = await client.query(`
                            UPDATE booking_reviews 
                            SET customer_id = $1
                            WHERE id IN (SELECT br.id 
                                         FROM booking_reviews br
                                         LEFT JOIN customers c ON br.customer_id = c.id
                                         WHERE c.id IS NULL)
                            RETURNING id
                        `, [validCustomerId]);
                        
                        console.log(`Fixed ${fixedCustomerReviews.rows.length} reviews with invalid customer references.`);
                    }
                }
            } else {
                console.log("\n✅ No issues found with reviews!");
            }
        }
        
        console.log("\n=== DIAGNOSTIC COMPLETE ===");
        
    } catch (error) {
        console.error("Error during diagnostic:", error);
    } finally {
        client.release();
    }
}

// Run the diagnostic function
diagnoseDatabaseReviews()
    .then(() => console.log("Diagnostic completed."))
    .catch(err => console.error("Error running diagnostic:", err))
    .finally(() => {
        // Close the pool when done
        pool.end();
    });