import express from 'express';
import pool from './config/database.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get current file path (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '../public/uploads/chat_attachments/');
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
        // Generate unique filename with timestamp and preserve file extension
        const timestamp = Date.now();
        const originalName = path.parse(file.originalname).name.replace(/\s+/g, '_');
        const extension = path.extname(file.originalname);
        cb(null, `${timestamp}_${originalName}${extension}`);
    }
});

// File filter to limit file types
const fileFilter = (req, file, cb) => {
    // Accept only images and common document types
    const allowedFileTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (allowedFileTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('File type not allowed. Please upload images, PDFs, or documents.'), false);
    }
};

// Create the Multer middleware
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max file size
    },
    fileFilter: fileFilter
});

// Middleware to handle Multer errors
const handleMulterErrors = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // A Multer error occurred during file upload
        let errorMessage = 'An error occurred during file upload.';
        
        if (err.code === 'LIMIT_FILE_SIZE') {
            errorMessage = 'File size exceeds the 5MB limit.';
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            errorMessage = 'Unexpected field name for file upload.';
        }
        
        return res.status(400).json({ success: false, error: errorMessage });
    } else if (err) {
        // Other errors
        return res.status(500).json({ success: false, error: err.message || 'An unexpected error occurred.' });
    }
    
    // If no error, continue
    next();
};

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
                INSERT INTO chat_conversations (customer_id, provider_id, created_at, last_message_at)
                VALUES ($1, $2, NOW(), NOW())
                RETURNING id
            `, [customerId, providerId]);
            
            conversationId = newConversationResult.rows[0].id;
        }
        
        // Redirect to the chat page
        res.redirect(`/customer/conversations?provider=${providerId}`);
        
    } catch (error) {
        console.error('Error starting chat:', error);
        req.session.error = 'Failed to start chat with provider';
        res.redirect(`/customer/provider/${req.params.providerId}`);
    }
});

router.get('/customer/conversations', isCustomerAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const requestedProviderId = req.query.provider;
        
        // Get all conversations for this customer with unread count and last message
        const conversationsQuery = `
            SELECT 
                cc.id as conversation_id,
                cc.id,
                cc.created_at,
                cc.last_message_at as last_message_time,
                sp.id as provider_id,
                sp.business_name as provider_name,
                sp.is_verified,
                COUNT(CASE WHEN cm.is_read = false AND cm.sender_type = 'provider' THEN 1 END) as unread_count,
                (SELECT message_text FROM chat_messages 
                WHERE conversation_id = cc.id 
                ORDER BY created_at DESC LIMIT 1) as last_message,
                (SELECT has_attachment FROM chat_messages
                WHERE conversation_id = cc.id
                ORDER BY created_at DESC LIMIT 1) as last_message_has_attachment,
                (SELECT attachment_type FROM chat_messages
                WHERE conversation_id = cc.id
                ORDER BY created_at DESC LIMIT 1) as last_message_attachment_type
            FROM chat_conversations cc
            JOIN service_providers sp ON cc.provider_id = sp.id
            LEFT JOIN chat_messages cm ON cc.id = cm.conversation_id
            WHERE cc.customer_id = $1
            GROUP BY cc.id, cc.created_at, cc.last_message_at, sp.id, sp.business_name, sp.is_verified
            HAVING COUNT(cm.id) > 0 OR cc.provider_id = $2
            ORDER BY cc.last_message_at DESC NULLS LAST
        `;
        
        const conversationsResult = await pool.query(conversationsQuery, [userId, requestedProviderId || -1]);
        const conversations = conversationsResult.rows;
        
        // Variables for active provider, conversation, and messages
        let activeProvider = null;
        let conversationId = null;
        let messages = [];
        
        // If a provider is requested, fetch conversation details and messages
        if (requestedProviderId) {
            // First get the provider details
            const providerResult = await pool.query(`
                SELECT sp.id, sp.business_name, sp.is_verified
                FROM service_providers sp
                WHERE sp.id = $1
            `, [requestedProviderId]);
            
            if (providerResult.rows.length > 0) {
                activeProvider = providerResult.rows[0];
                
                // Get or create a conversation with this provider
                const conversationResult = await pool.query(`
                    SELECT id FROM chat_conversations
                    WHERE customer_id = $1 AND provider_id = $2
                `, [userId, requestedProviderId]);
                
                if (conversationResult.rows.length > 0) {
                    // Existing conversation
                    conversationId = conversationResult.rows[0].id;
                } else {
                    // Create a new conversation
                    const newConversationResult = await pool.query(`
                        INSERT INTO chat_conversations (customer_id, provider_id, created_at, last_message_at)
                        VALUES ($1, $2, NOW(), NOW())
                        RETURNING id
                    `, [userId, requestedProviderId]);
                    
                    conversationId = newConversationResult.rows[0].id;
                }
                
                // Get messages for this conversation
                const messagesResult = await pool.query(`
                    SELECT *
                    FROM chat_messages
                    WHERE conversation_id = $1
                    ORDER BY created_at ASC
                `, [conversationId]);
                
                messages = messagesResult.rows;
                
                // Mark unread messages as read
                if (messages.some(m => m.sender_type === 'provider' && !m.is_read)) {
                    await pool.query(`
                        UPDATE chat_messages
                        SET is_read = true
                        WHERE conversation_id = $1 AND sender_type = 'provider' AND is_read = false
                    `, [conversationId]);
                    
                    // Update the unread count for this conversation in our result set
                    conversations.forEach(conv => {
                        if (conv.provider_id == requestedProviderId) {
                            conv.unread_count = 0;
                        }
                    });
                }
            }
        }
        
        // Render the integrated messaging template
        res.render('customer/integrated-messaging', {
            title: 'My Conversations',
            user: req.session.user,
            conversations: conversations,
            activeProvider: activeProvider,
            conversationId: conversationId,
            messages: messages,
            success: req.session.success,
            error: req.session.error
        });
        
        // Clear session messages
        delete req.session.success;
        delete req.session.error;
        
    } catch (error) {
        console.error('Error fetching conversations:', error);
        req.session.error = 'Failed to load conversations. Please try again.';
        res.redirect('/customer/dashboard');
    }
});

// Provider chat routes
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
                (SELECT has_attachment FROM chat_messages
                 WHERE conversation_id = cc.id
                 ORDER BY created_at DESC LIMIT 1) as last_message_has_attachment,
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
                is_read,
                has_attachment,
                attachment_url,
                attachment_type,
                attachment_name
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

// API endpoint to send a message with file attachment (for both customer and provider)
router.post('/api/send-message', isAuthenticated, upload.single('attachment'), handleMulterErrors, async (req, res) => {
     try {
        console.log('Message API called with body:', req.body);
        console.log('Session user:', req.session.user);
        
        const { conversationId, message } = req.body;
        const userId = req.session.user.id;
        const userType = req.session.user.userType;
        
        console.log('Parsed request data:', { conversationId, message, userId, userType });
        console.log('File attachment:', req.file);
        
        if (!conversationId) {
            console.warn('Missing required field:', { conversationId });
            return res.status(400).json({ 
                success: false, 
                error: 'Missing conversation ID' 
            });
        }
        
        // Allow empty message if file is attached
        if (!message && !req.file) {
            console.warn('Missing message and no file attached');
            return res.status(400).json({ 
                success: false, 
                error: 'Please include either a message or an attachment' 
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
            // For providers, we need to use providerId
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
        
        // Process file attachment if present
        let hasAttachment = false;
        let attachmentUrl = null;
        let attachmentType = null;
        let attachmentName = null;
        
        if (req.file) {
            hasAttachment = true;
            
            // Create a web-accessible path for the attachment
            attachmentUrl = `/uploads/chat_attachments/${req.file.filename}`;
            attachmentType = req.file.mimetype;
            attachmentName = req.file.originalname;
            
            console.log('Attachment processed:', {
                url: attachmentUrl,
                type: attachmentType,
                name: attachmentName
            });
        }
        
        // Insert the message with attachment information if present
        console.log('Inserting message into database');
        const messageResult = await pool.query(`
            INSERT INTO chat_messages 
            (conversation_id, sender_id, sender_type, message_text, has_attachment, 
             attachment_url, attachment_type, attachment_name, created_at, is_read)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
            RETURNING id, created_at, is_read
        `, [
            conversationId, 
            userId, 
            userType, 
            message || null, 
            hasAttachment,
            attachmentUrl,
            attachmentType,
            attachmentName,
            false // Messages are unread by default
        ]);
        
        console.log('Message inserted, result:', messageResult.rows[0]);
        
        // Update the last_message_at timestamp in the conversation
        await pool.query(`
            UPDATE chat_conversations
            SET last_message_at = NOW()
            WHERE id = $1
        `, [conversationId]);
        
        // Prepare response
        const messageData = {
            id: messageResult.rows[0].id,
            sender_id: userId,
            sender_type: userType,
            message_text: message || null,
            created_at: messageResult.rows[0].created_at,
            is_read: messageResult.rows[0].is_read || false,
            has_attachment: hasAttachment,
            attachment_url: attachmentUrl,
            attachment_type: attachmentType,
            attachment_name: attachmentName
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
                is_read,
                has_attachment,
                attachment_url,
                attachment_type,
                attachment_name
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

// Endpoint to mark messages as read
router.post('/api/mark-messages-read', isAuthenticated, async (req, res) => {
    try {
        const { conversationId } = req.body;
        const userId = req.session.user.id;
        const userType = req.session.user.userType;
        
        if (!conversationId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing conversation ID' 
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
            const providerId = req.session.user.providerId;
            conversationQuery = `
                SELECT id FROM chat_conversations
                WHERE id = $1 AND provider_id = $2
            `;
            queryParams = [conversationId, providerId];
        } else {
            return res.status(403).json({ 
                success: false, 
                error: 'Unauthorized: Invalid user type' 
            });
        }
        
        const conversationResult = await pool.query(conversationQuery, queryParams);
        
        if (conversationResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Conversation not found or not authorized' 
            });
        }
        
        // Mark messages as read from the other party
        const otherParty = userType === 'customer' ? 'provider' : 'customer';
        
        await pool.query(`
            UPDATE chat_messages
            SET is_read = true
            WHERE conversation_id = $1 AND sender_type = $2 AND is_read = false
        `, [conversationId, otherParty]);
        
        res.json({
            success: true,
            message: 'Messages marked as read'
        });
        
    } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to mark messages as read: ' + error.message 
        });
    }
});

// Debug endpoint to view messages for a conversation
router.get('/debug-messages/:conversationId', isCustomerAuth, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const result = await pool.query(
            'SELECT * FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
            [conversationId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;