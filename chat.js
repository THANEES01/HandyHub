import express from 'express';
import pool from './config/database.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import dotenv from 'dotenv';
import { triggerPusherEvent } from './pusher-config.js';

// Load environment variables
dotenv.config();

// Get current file path (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure Cloudinary with credentials from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Create storage engine for multer with Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'chat_attachments',
    resource_type: 'auto',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx'],
    transformation: [
      { width: 1000, height: 1000, crop: 'limit' }
    ]
  }
});

// Configure Multer with Cloudinary storage
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max file size
    },
    fileFilter: (req, file, cb) => {
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
    }
});

// Middleware to handle Multer errors
const handleMulterErrors = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        let errorMessage = 'An error occurred during file upload.';
        
        if (err.code === 'LIMIT_FILE_SIZE') {
            errorMessage = 'File size exceeds the 5MB limit.';
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            errorMessage = 'Unexpected field name for file upload.';
        }
        
        return res.status(400).json({ success: false, error: errorMessage });
    } else if (err) {
        return res.status(500).json({ success: false, error: err.message || 'An unexpected error occurred.' });
    }
    
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

// Enhanced logging for Cloudinary uploads
const logUploadDetails = async (req, res, next) => {
  if (req.file) {
    console.log('========== CLOUDINARY UPLOAD DETAILS ==========');
    console.log('File received:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      cloudinaryUrl: req.file.path,
      publicId: req.file.filename
    });
    console.log('=========================================');
  }
  next();
};

/**
 * Route to initiate a conversation with a provider from the provider details page
 */
router.get('/customer/start-chat/:providerId', isCustomerAuth, async (req, res) => {
    try {
        const customerId = req.session.user.id;
        const providerId = req.params.providerId;
        
        const conversationResult = await pool.query(`
            SELECT id FROM chat_conversations
            WHERE customer_id = $1 AND provider_id = $2
        `, [customerId, providerId]);
        
        let conversationId;
        
        if (conversationResult.rows.length > 0) {
            conversationId = conversationResult.rows[0].id;
        } else {
            const newConversationResult = await pool.query(`
                INSERT INTO chat_conversations (customer_id, provider_id, created_at, last_message_at)
                VALUES ($1, $2, NOW(), NOW())
                RETURNING id
            `, [customerId, providerId]);
            
            conversationId = newConversationResult.rows[0].id;
        }
        
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
        
        let activeProvider = null;
        let conversationId = null;
        let messages = [];
        
        if (requestedProviderId) {
            const providerResult = await pool.query(`
                SELECT sp.id, sp.business_name, sp.is_verified
                FROM service_providers sp
                WHERE sp.id = $1
            `, [requestedProviderId]);
            
            if (providerResult.rows.length > 0) {
                activeProvider = providerResult.rows[0];
                
                const conversationResult = await pool.query(`
                    SELECT id FROM chat_conversations
                    WHERE customer_id = $1 AND provider_id = $2
                `, [userId, requestedProviderId]);
                
                if (conversationResult.rows.length > 0) {
                    conversationId = conversationResult.rows[0].id;
                } else {
                    const newConversationResult = await pool.query(`
                        INSERT INTO chat_conversations (customer_id, provider_id, created_at, last_message_at)
                        VALUES ($1, $2, NOW(), NOW())
                        RETURNING id
                    `, [userId, requestedProviderId]);
                    
                    conversationId = newConversationResult.rows[0].id;
                }
                
                const messagesResult = await pool.query(`
                    SELECT *
                    FROM chat_messages
                    WHERE conversation_id = $1
                    ORDER BY created_at ASC
                `, [conversationId]);
                
                messages = messagesResult.rows;
                
                if (messages.some(m => m.sender_type === 'provider' && !m.is_read)) {
                    await pool.query(`
                        UPDATE chat_messages
                        SET is_read = true
                        WHERE conversation_id = $1 AND sender_type = 'provider' AND is_read = false
                    `, [conversationId]);
                    
                    conversations.forEach(conv => {
                        if (conv.provider_id == requestedProviderId) {
                            conv.unread_count = 0;
                        }
                    });
                }
            }
        }
        
        res.render('customer/integrated-messaging', {
            title: 'My Conversations',
            user: req.session.user,
            conversations: conversations,
            activeProvider: activeProvider,
            conversationId: conversationId,
            messages: messages,
            success: req.session.success,
            error: req.session.error,
            // Add Pusher configuration for frontend
            pusherKey: process.env.PUSHER_KEY,
            pusherCluster: process.env.PUSHER_CLUSTER
        });
        
        delete req.session.success;
        delete req.session.error;
        
    } catch (error) {
        console.error('Error fetching conversations:', error);
        req.session.error = 'Failed to load conversations. Please try again.';
        res.redirect('/customer/dashboard');
    }
});

// API endpoint to send a message with file attachment (for both customer and provider)
router.post('/api/send-message', isAuthenticated, upload.single('attachment'), handleMulterErrors, logUploadDetails, async (req, res) => {
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
                SELECT cc.id, cc.provider_id, cc.customer_id FROM chat_conversations cc
                WHERE cc.id = $1 AND cc.customer_id = $2
            `;
            queryParams = [conversationId, userId];
        } else if (userType === 'provider') {
            const providerId = req.session.user.providerId;
            console.log('Provider ID for conversation query:', providerId);
            
            conversationQuery = `
                SELECT cc.id, cc.provider_id, cc.customer_id FROM chat_conversations cc
                WHERE cc.id = $1 AND cc.provider_id = $2
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

        const conversation = conversationResult.rows[0];
        
        // Process file attachment if present
        let hasAttachment = false;
        let attachmentUrl = null;
        let attachmentType = null;
        let attachmentName = null;
        let messageText = message || '';
        
        if (req.file) {
            hasAttachment = true;
            attachmentUrl = req.file.path;
            attachmentType = req.file.mimetype;
            attachmentName = req.file.originalname;
            
            if (!messageText) {
                if (attachmentType.startsWith('image/')) {
                    messageText = "📷 Image";
                } else if (attachmentType.includes('pdf')) {
                    messageText = "📄 PDF Document";
                } else if (attachmentType.includes('word') || attachmentType.includes('doc')) {
                    messageText = "📝 Document";
                } else if (attachmentType.includes('excel') || attachmentType.includes('sheet')) {
                    messageText = "📊 Spreadsheet";
                } else {
                    messageText = "📎 File attachment";
                }
            }
            
            console.log('Cloudinary attachment processed:', {
                url: attachmentUrl,
                type: attachmentType,
                name: attachmentName,
                messageText: messageText
            });
        }
        
        console.log('Inserting message into database with message_text:', messageText);
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
            messageText,
            hasAttachment,
            attachmentUrl,
            attachmentType,
            attachmentName,
            false
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
            message_text: messageText,
            created_at: messageResult.rows[0].created_at,
            is_read: messageResult.rows[0].is_read || false,
            has_attachment: hasAttachment,
            attachment_url: attachmentUrl,
            attachment_type: attachmentType,
            attachment_name: attachmentName
        };

        // **PUSHER: Trigger real-time event**
        try {
            // Send to conversation channel
            await triggerPusherEvent(`conversation-${conversationId}`, 'new-message', messageData);
            
            // Send notification to the recipient
            const recipientType = userType === 'customer' ? 'provider' : 'customer';
            const recipientId = userType === 'customer' ? conversation.provider_id : conversation.customer_id;
            
            await triggerPusherEvent(`user-${recipientType}-${recipientId}`, 'message-notification', {
                conversationId: conversationId,
                from_user_type: userType,
                has_attachment: hasAttachment,
                messagePreview: messageText.substring(0, 50)
            });
            
            console.log('Pusher events triggered successfully');
        } catch (pusherError) {
            console.error('Error triggering Pusher events:', pusherError);
            // Continue execution even if Pusher fails
        }
        
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
        
        const otherUserType = userType === 'customer' ? 'provider' : 'customer';
        
        if (messagesResult.rows.some(msg => msg.sender_type === otherUserType && !msg.is_read)) {
            await pool.query(`
                UPDATE chat_messages
                SET is_read = true
                WHERE conversation_id = $1 AND sender_type = $2 AND is_read = false
            `, [conversationId, otherUserType]);

            // **PUSHER: Trigger read receipt**
            try {
                await triggerPusherEvent(`conversation-${conversationId}`, 'messages-read', {
                    conversationId: conversationId,
                    readBy: userType
                });
            } catch (pusherError) {
                console.error('Error triggering read receipt:', pusherError);
            }
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
        
        const otherParty = userType === 'customer' ? 'provider' : 'customer';
        
        await pool.query(`
            UPDATE chat_messages
            SET is_read = true
            WHERE conversation_id = $1 AND sender_type = $2 AND is_read = false
        `, [conversationId, otherParty]);

        // **PUSHER: Trigger read receipt**
        try {
            await triggerPusherEvent(`conversation-${conversationId}`, 'messages-read', {
                conversationId: conversationId,
                readBy: userType
            });
        } catch (pusherError) {
            console.error('Error triggering read receipt:', pusherError);
        }
        
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

// Pusher authentication endpoint for private channels
router.post('/pusher/auth', isAuthenticated, (req, res) => {
    try {
        const socketId = req.body.socket_id;
        const channel = req.body.channel_name;
        const userId = req.session.user.id;
        const userType = req.session.user.userType;
        
        console.log('Pusher auth request:', { socketId, channel, userId, userType });
        
        // Verify user has access to this channel
        if (channel.startsWith('conversation-')) {
            const conversationId = channel.split('-')[1];
            
            // Here you could add additional verification that the user has access to this conversation
            // For now, we'll trust that the middleware has verified authentication
            
            const authData = {
                user_id: userId,
                user_info: {
                    type: userType,
                    id: userId
                }
            };
            
            const auth = pusher.authenticate(socketId, channel, authData);
            res.send(auth);
        } else if (channel.startsWith(`user-${userType}-${userId}`)) {
            // User's personal notification channel
            const authData = {
                user_id: userId,
                user_info: {
                    type: userType,
                    id: userId
                }
            };
            
            const auth = pusher.authenticate(socketId, channel, authData);
            res.send(auth);
        } else {
            res.status(403).json({ error: 'Unauthorized channel access' });
        }
    } catch (error) {
        console.error('Error authenticating Pusher channel:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// Utility function to delete a file from Cloudinary if needed
const deleteFileFromCloudinary = async (publicId) => {
    if (!publicId) return;
    
    try {
        let id = publicId;
        if (publicId.includes('cloudinary.com')) {
            const parts = publicId.split('/');
            id = parts[parts.length - 1];
            if (id.includes('/')) {
                id = 'chat_attachments/' + id.split('/').pop();
            }
        }
        
        console.log(`Attempting to delete file with public ID: ${id}`);
        const result = await cloudinary.uploader.destroy(id);
        console.log('Cloudinary delete result:', result);
        return result;
    } catch (error) {
        console.error('Error deleting file from Cloudinary:', error);
    }
};

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