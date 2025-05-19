import express from 'express';
import pool from './config/database.js';

const router = express.Router();

// Middleware to check if user is authenticated
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

// Middleware to check if user is logged in as provider
const isProviderAuth = (req, res, next) => {
    if (req.session.user && req.session.user.userType === 'provider') {
        next();
    } else {
        res.redirect('/auth/provider-login');
    }
};

/**
 * Route to initiate a conversation with a provider from the provider details page
 * This handles the "Message Provider" button click
 */
router.get('/customer/start-chat/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const customerId = req.session.user.id;
        const providerId = req.params.providerId;
        
        // Check if a conversation already exists
        const conversationResult = await pool.query(`
            SELECT id FROM chat_conversations
            WHERE customer_id = $1 AND provider_id = $2
        `, [customerId, providerId]);
        
        let conversationId;
        
        if (conversationResult.rows.length > 0) {
            // Conversation exists, use existing conversation
            conversationId = conversationResult.rows[0].id;
        } else {
            // Create a new conversation
            const newConversationResult = await pool.query(`
                INSERT INTO chat_conversations (customer_id, provider_id)
                VALUES ($1, $2)
                RETURNING id
            `, [customerId, providerId]);
            
            conversationId = newConversationResult.rows[0].id;
        }
        
        // Redirect to the chat page
        res.redirect(`/customer/chat/${providerId}`);
        
    } catch (error) {
        console.error('Error starting chat:', error);
        req.session.error = 'Failed to start chat with provider';
        res.redirect(`/customer/provider/${req.params.providerId}`);
    }
});

// Get all conversations for a customer
router.get('/customer/conversations', isCustomerAuth, async (req, res) => {
    try {
        const customerId = req.session.user.id;
        
        // Get all conversations for this customer with provider information
        const conversationsQuery = `
            SELECT 
                cc.id as conversation_id,
                cc.provider_id,
                sp.business_name as provider_name,
                (SELECT message_text FROM chat_messages 
                 WHERE conversation_id = cc.id 
                 ORDER BY created_at DESC LIMIT 1) as last_message,
                (SELECT created_at FROM chat_messages 
                 WHERE conversation_id = cc.id 
                 ORDER BY created_at DESC LIMIT 1) as last_message_time,
                (SELECT COUNT(*) FROM chat_messages 
                 WHERE conversation_id = cc.id 
                 AND sender_type = 'provider' 
                 AND is_read = false) as unread_count
            FROM chat_conversations cc
            JOIN service_providers sp ON cc.provider_id = sp.id
            WHERE cc.customer_id = $1
            ORDER BY cc.last_message_at DESC
        `;
        
        const conversationsResult = await pool.query(conversationsQuery, [customerId]);
        
        res.render('customer/conversations', {
            title: 'My Conversations',
            conversations: conversationsResult.rows,
            user: req.session.user,
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        console.error('Error fetching conversations:', error);
        req.session.error = 'Failed to load conversations';
        res.redirect('/customer/dashboard');
    }
});

// Get all conversations for a provider
router.get('/provider/conversations', isProviderAuth, async (req, res) => {
    try {
        const providerId = req.session.user.providerId;
        
        // Get all conversations for this provider with customer information
        const conversationsQuery = `
            SELECT 
                cc.id as conversation_id,
                cc.customer_id,
                c.first_name || ' ' || c.last_name as customer_name,
                (SELECT message_text FROM chat_messages 
                 WHERE conversation_id = cc.id 
                 ORDER BY created_at DESC LIMIT 1) as last_message,
                (SELECT created_at FROM chat_messages 
                 WHERE conversation_id = cc.id 
                 ORDER BY created_at DESC LIMIT 1) as last_message_time,
                (SELECT COUNT(*) FROM chat_messages 
                 WHERE conversation_id = cc.id 
                 AND sender_type = 'customer' 
                 AND is_read = false) as unread_count
            FROM chat_conversations cc
            JOIN customers c ON cc.customer_id = c.user_id
            WHERE cc.provider_id = $1
            ORDER BY cc.last_message_at DESC
        `;
        
        const conversationsResult = await pool.query(conversationsQuery, [providerId]);
        
        res.render('provider/conversations', {
            title: 'My Conversations',
            conversations: conversationsResult.rows,
            user: req.session.user,
            error: req.session.error,
            success: req.session.success,
            currentPage: 'conversations'
        });
        
        // Clear session messages
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        console.error('Error fetching conversations:', error);
        req.session.error = 'Failed to load conversations';
        res.redirect('/provider/dashboard');
    }
});

// Get or create a conversation with a provider (for customer)
router.get('/customer/chat/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const customerId = req.session.user.id;
        const providerId = req.params.providerId;
        
        // Get provider details
        const providerResult = await pool.query(`
            SELECT sp.id, sp.business_name, sp.is_verified
            FROM service_providers sp
            WHERE sp.id = $1
        `, [providerId]);
        
        if (providerResult.rows.length === 0) {
            req.session.error = 'Service provider not found';
            return res.redirect('/customer/dashboard');
        }
        
        const provider = providerResult.rows[0];
        
        // Check if a conversation already exists
        const conversationResult = await pool.query(`
            SELECT id FROM chat_conversations
            WHERE customer_id = $1 AND provider_id = $2
        `, [customerId, providerId]);
        
        let conversationId;
        
        if (conversationResult.rows.length > 0) {
            // Conversation exists
            conversationId = conversationResult.rows[0].id;
        } else {
            // Create a new conversation
            const newConversationResult = await pool.query(`
                INSERT INTO chat_conversations (customer_id, provider_id)
                VALUES ($1, $2)
                RETURNING id
            `, [customerId, providerId]);
            
            conversationId = newConversationResult.rows[0].id;
        }
        
        // Get messages for this conversation
        const messagesResult = await pool.query(`
            SELECT 
                id, 
                sender_id,
                sender_type,
                message_text,
                created_at,
                is_read
            FROM chat_messages
            WHERE conversation_id = $1
            ORDER BY created_at ASC
        `, [conversationId]);
        
        // Mark messages as read if they are from the provider
        if (messagesResult.rows.some(msg => msg.sender_type === 'provider' && !msg.is_read)) {
            await pool.query(`
                UPDATE chat_messages
                SET is_read = true
                WHERE conversation_id = $1 AND sender_type = 'provider' AND is_read = false
            `, [conversationId]);
        }
        
        res.render('customer/chat', {
            title: `Chat with ${provider.business_name}`,
            user: req.session.user,
            provider: provider,
            conversationId: conversationId,
            messages: messagesResult.rows,
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        console.error('Error loading chat:', error);
        req.session.error = 'Failed to load chat';
        res.redirect('/customer/conversations');
    }
});

// Get conversation details for a provider
router.get('/provider/chat/:conversationId', isProviderAuth, async (req, res) => {
    try {
        const providerId = req.session.user.providerId;
        const conversationId = req.params.conversationId;
        
        // Verify this conversation belongs to this provider
        const conversationResult = await pool.query(`
            SELECT 
                cc.id, 
                cc.customer_id,
                c.first_name || ' ' || c.last_name as customer_name
            FROM chat_conversations cc
            JOIN customers c ON cc.customer_id = c.user_id
            WHERE cc.id = $1 AND cc.provider_id = $2
        `, [conversationId, providerId]);
        
        if (conversationResult.rows.length === 0) {
            req.session.error = 'Conversation not found';
            return res.redirect('/provider/conversations');
        }
        
        const conversation = conversationResult.rows[0];
        
        // Get messages for this conversation
        const messagesResult = await pool.query(`
            SELECT 
                id, 
                sender_id,
                sender_type,
                message_text,
                created_at,
                is_read
            FROM chat_messages
            WHERE conversation_id = $1
            ORDER BY created_at ASC
        `, [conversationId]);
        
        // Mark messages as read if they are from the customer
        if (messagesResult.rows.some(msg => msg.sender_type === 'customer' && !msg.is_read)) {
            await pool.query(`
                UPDATE chat_messages
                SET is_read = true
                WHERE conversation_id = $1 AND sender_type = 'customer' AND is_read = false
            `, [conversationId]);
        }
        
        res.render('provider/chat', {
            title: `Chat with ${conversation.customer_name}`,
            user: req.session.user,
            conversation: conversation,
            messages: messagesResult.rows,
            currentPage: 'conversations',
            error: req.session.error,
            success: req.session.success
        });
        
        // Clear session messages
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        console.error('Error loading chat:', error);
        req.session.error = 'Failed to load chat';
        res.redirect('/provider/conversations');
    }
});

// API endpoint to send a message (for both customer and provider)
router.post('/api/send-message', isAuthenticated, async (req, res) => {
   try {
        console.log('Message API called with body:', req.body);
        console.log('Session user:', req.session.user);
        
        const { conversationId, message } = req.body;
        const userId = req.session.user.id;
        const userType = req.session.user.userType;
        
        console.log('Parsed request data:', { conversationId, message, userId, userType });
        
        if (!conversationId || !message) {
            console.warn('Missing required fields:', { conversationId, message });
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields' 
            });
        }
        
        // Verify the conversation exists and belongs to this user
        let conversationQuery;
        let queryParams;
        
        if (userType === 'customer') {
            conversationQuery = `
                SELECT id FROM chat_conversations
                WHERE id = $1 AND customer_id = $2
            `;
            queryParams = [conversationId, userId];
        } else if (userType === 'provider') {
            // For providers, we need to use providerId which might be stored differently
            const providerId = req.session.user.providerId;
            console.log('Provider ID for conversation query:', providerId);
            
            conversationQuery = `
                SELECT id FROM chat_conversations
                WHERE id = $1 AND provider_id = $2
            `;
            queryParams = [conversationId, providerId];
        } else {
            console.warn('Invalid user type:', userType);
            return res.status(403).json({ 
                success: false, 
                error: 'Unauthorized: Invalid user type' 
            });
        }
        
        console.log('Executing conversation query:', conversationQuery, 'with params:', queryParams);
        
        const conversationResult = await pool.query(conversationQuery, queryParams);
        console.log('Conversation query result:', conversationResult.rows);
        
        if (conversationResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Conversation not found or not authorized' 
            });
        }
        
        // Insert the message
        console.log('Inserting message into database');
        const messageResult = await pool.query(`
            INSERT INTO chat_messages 
            (conversation_id, sender_id, sender_type, message_text)
            VALUES ($1, $2, $3, $4)
            RETURNING id, created_at
        `, [conversationId, userId, userType, message]);
        
        console.log('Message inserted, result:', messageResult.rows[0]);
        
        // Update the last_message_at timestamp
        await pool.query(`
            UPDATE chat_conversations
            SET last_message_at = NOW()
            WHERE id = $1
        `, [conversationId]);
        
        // Log success
        console.log('Message sent successfully');
        
        // Prepare response
        const messageData = {
            id: messageResult.rows[0].id,
            sender_id: userId,
            sender_type: userType,
            message_text: message,
            created_at: messageResult.rows[0].created_at,
            is_read: false
        };
        
        // Send successful response
        res.json({
            success: true,
            message: messageData
        });
        
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to send message: ' + error.message 
        });
    }
});

// API endpoint to get new messages
router.get('/api/messages/:conversationId', isAuthenticated, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { lastMessageId } = req.query;
        const userId = req.session.user.id;
        const userType = req.session.user.userType;
        
        // Verify the conversation exists and belongs to this user
        let conversationQuery;
        let queryParams;
        
        if (userType === 'customer') {
            conversationQuery = `
                SELECT id FROM chat_conversations
                WHERE id = $1 AND customer_id = $2
            `;
            queryParams = [conversationId, userId];
        } else if (userType === 'provider') {
            const providerId = req.session.user.providerId;
            conversationQuery = `
                SELECT id FROM chat_conversations
                WHERE id = $1 AND provider_id = $2
            `;
            queryParams = [conversationId, providerId];
        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        const conversationResult = await pool.query(conversationQuery, queryParams);
        
        if (conversationResult.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        
        // Get new messages
        let messagesQuery = `
            SELECT 
                id, 
                sender_id,
                sender_type,
                message_text,
                created_at,
                is_read
            FROM chat_messages
            WHERE conversation_id = $1
        `;
        
        let messagesParams = [conversationId];
        
        if (lastMessageId) {
            messagesQuery += ` AND id > $2`;
            messagesParams.push(lastMessageId);
        }
        
        messagesQuery += ` ORDER BY created_at ASC`;
        
        const messagesResult = await pool.query(messagesQuery, messagesParams);
        
        // Mark messages as read if they are from the other user
        const otherUserType = userType === 'customer' ? 'provider' : 'customer';
        
        if (messagesResult.rows.some(msg => msg.sender_type === otherUserType && !msg.is_read)) {
            await pool.query(`
                UPDATE chat_messages
                SET is_read = true
                WHERE conversation_id = $1 AND sender_type = $2 AND is_read = false
            `, [conversationId, otherUserType]);
        }
        
        res.json({
            success: true,
            messages: messagesResult.rows
        });
        
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// API endpoint to check for unread messages (for notification badge)
router.get('/api/unread-count', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const userType = req.session.user.userType;
        
        let unreadQuery;
        let queryParams;
        
        if (userType === 'customer') {
            unreadQuery = `
                SELECT COUNT(*) as unread_count
                FROM chat_messages cm
                JOIN chat_conversations cc ON cm.conversation_id = cc.id
                WHERE cc.customer_id = $1 
                AND cm.sender_type = 'provider' 
                AND cm.is_read = false
            `;
            queryParams = [userId];
        } else if (userType === 'provider') {
            const providerId = req.session.user.providerId;
            unreadQuery = `
                SELECT COUNT(*) as unread_count
                FROM chat_messages cm
                JOIN chat_conversations cc ON cm.conversation_id = cc.id
                WHERE cc.provider_id = $1 
                AND cm.sender_type = 'customer' 
                AND cm.is_read = false
            `;
            queryParams = [providerId];
        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        const unreadResult = await pool.query(unreadQuery, queryParams);
        const unreadCount = parseInt(unreadResult.rows[0].unread_count) || 0;
        
        res.json({
            success: true,
            unreadCount: unreadCount
        });
        
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({ error: 'Failed to fetch unread count' });
    }
});

export default router;