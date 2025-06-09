import express from 'express';
import pool from './config/database.js';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import dotenv from 'dotenv';
import { triggerPusherEvent } from './pusher-config.js';

// Load environment variables
dotenv.config();

const router = express.Router();

// Configure Cloudinary
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

// Middleware to check if provider is authenticated
const isProvider = (req, res, next) => {
    console.log('isProvider middleware check:', {
        isSessionActive: !!req.session,
        user: req.session?.user,
        userType: req.session?.user?.userType,
        providerId: req.session?.user?.providerId
    });
    
    if (req.session.user && req.session.user.userType === 'provider') {
        console.log('Provider authenticated, continuing...');
        next();
    } else {
        console.log('Provider authentication failed, redirecting...');
        req.session.error = 'Please login as a service provider';
        res.redirect('/auth/provider-login');
    }
};

// Debug session endpoint
router.get('/debug-session', (req, res) => {
    res.json({
        session: req.session,
        user: req.session.user,
        isProvider: req.session.user?.userType === 'provider',
        providerId: req.session.user?.providerId
    });
});

// New combined route for integrated conversations and chat view
router.get('/conversations', isProvider, async (req, res) => {
     try {
        const providerId = req.session.user.providerId;
        const requestedConversationId = req.query.conversation;
        
        // Get all conversations for this provider
        const conversationsQuery = `
            SELECT 
                cc.id as conversation_id,
                cc.id,
                cc.created_at,
                cc.last_message_at as last_message_time,
                cust.first_name || ' ' || cust.last_name AS customer_name,
                COUNT(CASE WHEN cm.is_read = false AND cm.sender_type = 'customer' THEN 1 END) as unread_count,
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
            JOIN customers cust ON cc.customer_id = cust.user_id
            LEFT JOIN chat_messages cm ON cc.id = cm.conversation_id
            WHERE cc.provider_id = $1
            GROUP BY cc.id, cc.created_at, cc.last_message_at, cust.first_name, cust.last_name
            ORDER BY cc.last_message_at DESC NULLS LAST
        `;
        
        const conversationsResult = await pool.query(conversationsQuery, [providerId]);
        const conversations = conversationsResult.rows;
        
        let activeConversation = null;
        let messages = [];
        
        // If a conversation is requested, fetch its details and messages
        if (requestedConversationId) {
            const conversationQuery = `
                SELECT 
                    cc.id,
                    cc.created_at,
                    cc.customer_id,
                    cust.first_name || ' ' || cust.last_name AS customer_name
                FROM chat_conversations cc
                JOIN customers cust ON cc.customer_id = cust.user_id
                WHERE cc.id = $1 AND cc.provider_id = $2
            `;
            
            const conversationResult = await pool.query(conversationQuery, [requestedConversationId, providerId]);
            
            if (conversationResult.rows.length > 0) {
                activeConversation = conversationResult.rows[0];
                
                const messagesQuery = `
                    SELECT *
                    FROM chat_messages
                    WHERE conversation_id = $1
                    ORDER BY created_at ASC
                `;
                
                const messagesResult = await pool.query(messagesQuery, [requestedConversationId]);
                messages = messagesResult.rows;
                
                // Mark unread messages as read
                if (messages.some(m => m.sender_type === 'customer' && !m.is_read)) {
                    await pool.query(`
                        UPDATE chat_messages
                        SET is_read = true
                        WHERE conversation_id = $1 AND sender_type = 'customer' AND is_read = false
                    `, [requestedConversationId]);
                    
                    // Update the unread count for this conversation in our result set
                    conversations.forEach(conv => {
                        if (conv.conversation_id == requestedConversationId) {
                            conv.unread_count = 0;
                        }
                    });

                    // **PUSHER: Trigger read receipt**
                    try {
                        await triggerPusherEvent(`conversation-${requestedConversationId}`, 'messages-read', {
                            conversationId: requestedConversationId,
                            readBy: 'provider'
                        });
                    } catch (pusherError) {
                        console.error('Error triggering read receipt:', pusherError);
                    }
                }
            }
        }
        
        res.render('provider/integrated-messaging', {
            title: 'Messages',
            conversations: conversations,
            activeConversation: activeConversation,
            messages: messages,
            currentPage: 'conversations',
            error: req.session.error,
            success: req.session.success,
            // Add Pusher configuration for frontend
            pusherKey: process.env.PUSHER_KEY,
            pusherCluster: process.env.PUSHER_CLUSTER
        });
        
        delete req.session.error;
        delete req.session.success;
        
    } catch (error) {
        console.error('Error fetching conversations:', error);
        req.session.error = 'Failed to load messages. Please try again.';
        res.redirect('/provider/dashboard');
    }
});

// API endpoint to get unread message count
router.get('/api/unread-count', isProvider, async (req, res) => {
     try {
        const providerId = req.session.user.providerId;
        
        const countQuery = `
            SELECT COUNT(*) as unread_count
            FROM chat_messages cm
            JOIN chat_conversations cc ON cm.conversation_id = cc.id
            WHERE cc.provider_id = $1 AND cm.sender_type = 'customer' AND cm.is_read = false
        `;
        
        const countResult = await pool.query(countQuery, [providerId]);
        const unreadCount = parseInt(countResult.rows[0].unread_count || 0);
        
        res.json({
            success: true,
            unreadCount: unreadCount
        });
        
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.json({
            success: false,
            error: 'Failed to fetch unread count'
        });
    }
});

// API endpoint to get new messages
router.get('/api/messages/:conversationId', isProvider, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { lastMessageId } = req.query;
        const providerId = req.session.user.providerId;
        
        const verifyQuery = `
            SELECT id FROM chat_conversations
            WHERE id = $1 AND provider_id = $2
        `;
        
        const verifyResult = await pool.query(verifyQuery, [conversationId, providerId]);
        
        if (verifyResult.rows.length === 0) {
            return res.json({
                success: false,
                error: 'Conversation not found or not authorized'
            });
        }
        
        const messagesQuery = `
            SELECT *
            FROM chat_messages
            WHERE conversation_id = $1
            ${lastMessageId ? 'AND id > $3' : ''}
            ORDER BY created_at ASC
        `;
        
        const queryParams = lastMessageId 
            ? [conversationId, providerId, lastMessageId]
            : [conversationId, providerId];
            
        const messagesResult = await pool.query(messagesQuery, queryParams);
        const messages = messagesResult.rows;
        
        // Mark new messages as read
        if (messages.some(m => m.sender_type === 'customer' && !m.is_read)) {
            await pool.query(`
                UPDATE chat_messages
                SET is_read = true
                WHERE conversation_id = $1 AND sender_type = 'customer' AND is_read = false
            `, [conversationId]);

            // **PUSHER: Trigger read receipt**
            try {
                await triggerPusherEvent(`conversation-${conversationId}`, 'messages-read', {
                    conversationId: conversationId,
                    readBy: 'provider'
                });
            } catch (pusherError) {
                console.error('Error triggering read receipt:', pusherError);
            }
        }
        
        res.json({
            success: true,
            messages: messages
        });
        
    } catch (error) {
        console.error('Error fetching new messages:', error);
        res.json({
            success: false,
            error: 'Failed to fetch new messages'
        });
    }
});

// API endpoint to send a text message
// router.post('/api/send-message', isProvider, async (req, res) => {
//     try {
//         const providerId = req.session.user.providerId;
//         const { conversationId, message } = req.body;
        
//         if (!message || !conversationId) {
//             return res.json({
//                 success: false,
//                 error: 'Message and conversation ID are required'
//             });
//         }
        
//         // Verify the conversation belongs to this provider
//         const verifyQuery = `
//             SELECT cc.id, cc.customer_id, cc.provider_id FROM chat_conversations cc
//             WHERE cc.id = $1 AND cc.provider_id = $2
//         `;
        
//         const verifyResult = await pool.query(verifyQuery, [conversationId, providerId]);
        
//         if (verifyResult.rows.length === 0) {
//             return res.json({
//                 success: false,
//                 error: 'Conversation not found or not authorized'
//             });
//         }

//         const conversation = verifyResult.rows[0];
//         const messageText = message || '';
        
//         // Insert the message
//         const insertQuery = `
//             INSERT INTO chat_messages 
//             (conversation_id, sender_id, sender_type, message_text, has_attachment, 
//              attachment_url, attachment_type, attachment_name, created_at, is_read)
//             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
//             RETURNING id, created_at, is_read
//         `;
        
//         const queryParams = [
//             conversationId,
//             req.session.user.id,
//             'provider',
//             messageText,
//             false, // has_attachment
//             null, // attachment_url
//             null, // attachment_type
//             null, // attachment_name
//             false // is_read
//         ];
        
//         const insertResult = await pool.query(insertQuery, queryParams);
//         const newMessage = {
//             id: insertResult.rows[0].id,
//             sender_id: req.session.user.id,
//             sender_type: 'provider',
//             message_text: messageText,
//             created_at: insertResult.rows[0].created_at,
//             is_read: insertResult.rows[0].is_read || false,
//             has_attachment: false,
//             attachment_url: null,
//             attachment_type: null,
//             attachment_name: null
//         };
        
//         // Update conversation timestamp
//         await pool.query(`
//             UPDATE chat_conversations
//             SET last_message_at = NOW()
//             WHERE id = $1
//         `, [conversationId]);

//         // **PUSHER: Trigger real-time event**
//         try {
//             // Send to conversation channel
//             await triggerPusherEvent(`conversation-${conversationId}`, 'new-message', newMessage);
            
//             // Send notification to customer
//             await triggerPusherEvent(`user-customer-${conversation.customer_id}`, 'message-notification', {
//                 conversationId: conversationId,
//                 from_user_type: 'provider',
//                 has_attachment: false,
//                 messagePreview: messageText.substring(0, 50)
//             });
            
//             console.log('Pusher events triggered successfully');
//         } catch (pusherError) {
//             console.error('Error triggering Pusher events:', pusherError);
//         }
        
//         res.json({
//             success: true,
//             message: newMessage
//         });
        
//     } catch (error) {
//         console.error('Error sending message:', error);
//         res.json({
//             success: false,
//             error: 'Failed to send message: ' + error.message
//         });
//     }
// });

// API endpoint to send a message with file attachment
// router.post('/api/send-message-with-attachment', isProvider, upload.single('attachment'), handleMulterErrors, logUploadDetails, async (req, res) => {
//     try {
//         const providerId = req.session.user.providerId;
//         const { conversationId, message } = req.body;
        
//         if (!conversationId) {
//             return res.json({
//                 success: false,
//                 error: 'Conversation ID is required'
//             });
//         }
        
//         if (!req.file && (!message || message.trim() === '')) {
//             return res.json({
//                 success: false,
//                 error: 'Message or attachment is required'
//             });
//         }
        
//         // Verify the conversation belongs to this provider
//         const verifyQuery = `
//             SELECT cc.id, cc.customer_id, cc.provider_id FROM chat_conversations cc
//             WHERE cc.id = $1 AND cc.provider_id = $2
//         `;
        
//         const verifyResult = await pool.query(verifyQuery, [conversationId, providerId]);
        
//         if (verifyResult.rows.length === 0) {
//             return res.json({
//                 success: false,
//                 error: 'Conversation not found or not authorized'
//             });
//         }

//         const conversation = verifyResult.rows[0];
        
//         // Process file attachment
//         let hasAttachment = false;
//         let attachmentUrl = null;
//         let attachmentType = null;
//         let attachmentName = null;
//         let messageText = message || '';
        
//         if (req.file) {
//             hasAttachment = true;
//             attachmentUrl = req.file.path;
//             attachmentType = req.file.mimetype;
//             attachmentName = req.file.originalname;
            
//             if (!messageText || messageText.trim() === '') {
//                 if (attachmentType.startsWith('image/')) {
//                     messageText = "📷 Image";
//                 } else if (attachmentType.includes('pdf')) {
//                     messageText = "📄 PDF Document";
//                 } else if (attachmentType.includes('word') || attachmentType.includes('doc')) {
//                     messageText = "📝 Document";
//                 } else if (attachmentType.includes('excel') || attachmentType.includes('sheet')) {
//                     messageText = "📊 Spreadsheet";
//                 } else {
//                     messageText = "📎 File attachment";
//                 }
//             }
            
//             console.log('Cloudinary attachment processed:', {
//                 url: attachmentUrl,
//                 type: attachmentType,
//                 name: attachmentName,
//                 messageText: messageText
//             });
//         }
        
//         // Insert the message with attachment information
//         const insertQuery = `
//             INSERT INTO chat_messages 
//             (conversation_id, sender_id, sender_type, message_text, has_attachment, 
//              attachment_url, attachment_type, attachment_name, created_at, is_read)
//             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
//             RETURNING id, created_at, is_read
//         `;
        
//         const queryParams = [
//             conversationId,
//             req.session.user.id,
//             'provider',
//             messageText,
//             hasAttachment,
//             attachmentUrl,
//             attachmentType,
//             attachmentName,
//             false // is_read
//         ];
        
//         const insertResult = await pool.query(insertQuery, queryParams);
        
//         // Prepare response message data
//         const newMessage = {
//             id: insertResult.rows[0].id,
//             sender_id: req.session.user.id,
//             sender_type: 'provider',
//             message_text: messageText,
//             created_at: insertResult.rows[0].created_at,
//             is_read: insertResult.rows[0].is_read || false,
//             has_attachment: hasAttachment,
//             attachment_url: attachmentUrl,
//             attachment_type: attachmentType,
//             attachment_name: attachmentName
//         };
        
//         // Update conversation timestamp
//         await pool.query(`
//             UPDATE chat_conversations
//             SET last_message_at = NOW()
//             WHERE id = $1
//         `, [conversationId]);

//         // **PUSHER: Trigger real-time event**
//         try {
//             // Send to conversation channel
//             await triggerPusherEvent(`conversation-${conversationId}`, 'new-message', newMessage);
            
//             // Send notification to customer
//             await triggerPusherEvent(`user-customer-${conversation.customer_id}`, 'message-notification', {
//                 conversationId: conversationId,
//                 from_user_type: 'provider',
//                 has_attachment: hasAttachment,
//                 messagePreview: messageText.substring(0, 50)
//             });
            
//             console.log('Pusher events triggered successfully');
//         } catch (pusherError) {
//             console.error('Error triggering Pusher events:', pusherError);
//         }
        
//         res.json({
//             success: true,
//             message: newMessage
//         });
        
//     } catch (error) {
//         console.error('Error sending message with attachment:', error);
        
//         // If there was an error, try to delete the uploaded file from Cloudinary if it exists
//         if (req.file && req.file.path) {
//             try {
//                 const publicId = req.file.filename;
//                 await cloudinary.uploader.destroy(publicId);
//                 console.log(`Deleted file ${publicId} from Cloudinary due to error`);
//             } catch (deleteError) {
//                 console.error('Error deleting file from Cloudinary:', deleteError);
//             }
//         }
        
//         res.json({
//             success: false,
//             error: 'Failed to send message: ' + error.message
//         });
//     }
// });

// Replace the existing /api/send-message endpoint with this unified one
router.post('/api/send-message', isProvider, upload.single('attachment'), handleMulterErrors, logUploadDetails, async (req, res) => {
    try {
        const providerId = req.session.user.providerId;
        const { conversationId, message } = req.body;
        
        console.log('Provider unified send-message called:', { conversationId, message, hasFile: !!req.file });
        
        if (!conversationId) {
            return res.json({
                success: false,
                error: 'Conversation ID is required'
            });
        }
        
        if (!req.file && (!message || message.trim() === '')) {
            return res.json({
                success: false,
                error: 'Message or attachment is required'
            });
        }
        
        // Verify the conversation belongs to this provider
        const verifyQuery = `
            SELECT cc.id, cc.customer_id, cc.provider_id FROM chat_conversations cc
            WHERE cc.id = $1 AND cc.provider_id = $2
        `;
        
        const verifyResult = await pool.query(verifyQuery, [conversationId, providerId]);
        
        if (verifyResult.rows.length === 0) {
            return res.json({
                success: false,
                error: 'Conversation not found or not authorized'
            });
        }

        const conversation = verifyResult.rows[0];
        
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
            
            if (!messageText || messageText.trim() === '') {
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
        
        // Insert the message with or without attachment
        const insertQuery = `
            INSERT INTO chat_messages 
            (conversation_id, sender_id, sender_type, message_text, has_attachment, 
             attachment_url, attachment_type, attachment_name, created_at, is_read)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
            RETURNING id, created_at, is_read
        `;
        
        const queryParams = [
            conversationId,
            req.session.user.id,
            'provider',
            messageText,
            hasAttachment,
            attachmentUrl,
            attachmentType,
            attachmentName,
            false // is_read
        ];
        
        const insertResult = await pool.query(insertQuery, queryParams);
        
        // Prepare response message data
        const newMessage = {
            id: insertResult.rows[0].id,
            sender_id: req.session.user.id,
            sender_type: 'provider',
            message_text: messageText,
            created_at: insertResult.rows[0].created_at,
            is_read: insertResult.rows[0].is_read || false,
            has_attachment: hasAttachment,
            attachment_url: attachmentUrl,
            attachment_type: attachmentType,
            attachment_name: attachmentName
        };
        
        // Update conversation timestamp
        await pool.query(`
            UPDATE chat_conversations
            SET last_message_at = NOW()
            WHERE id = $1
        `, [conversationId]);

        // **PUSHER: Trigger real-time event**
        try {
            // Send to conversation channel
            await triggerPusherEvent(`conversation-${conversationId}`, 'new-message', newMessage);
            
            // Send notification to customer
            await triggerPusherEvent(`user-customer-${conversation.customer_id}`, 'message-notification', {
                conversationId: conversationId,
                from_user_type: 'provider',
                has_attachment: hasAttachment,
                messagePreview: messageText.substring(0, 50)
            });
            
            console.log('Pusher events triggered successfully');
        } catch (pusherError) {
            console.error('Error triggering Pusher events:', pusherError);
        }
        
        res.json({
            success: true,
            message: newMessage
        });
        
    } catch (error) {
        console.error('Error sending message:', error);
        
        // If there was an error, try to delete the uploaded file from Cloudinary if it exists
        if (req.file && req.file.path) {
            try {
                const publicId = req.file.filename;
                await cloudinary.uploader.destroy(publicId);
                console.log(`Deleted file ${publicId} from Cloudinary due to error`);
            } catch (deleteError) {
                console.error('Error deleting file from Cloudinary:', deleteError);
            }
        }
        
        res.json({
            success: false,
            error: 'Failed to send message: ' + error.message
        });
    }
});

// API endpoint to mark messages as read
router.post('/api/mark-messages-read', isProvider, async (req, res) => {
    try {
        const providerId = req.session.user.providerId;
        const { conversationId } = req.body;
        
        if (!conversationId) {
            return res.json({
                success: false,
                error: 'Conversation ID is required'
            });
        }
        
        const verifyQuery = `
            SELECT id FROM chat_conversations
            WHERE id = $1 AND provider_id = $2
        `;
        
        const verifyResult = await pool.query(verifyQuery, [conversationId, providerId]);
        
        if (verifyResult.rows.length === 0) {
            return res.json({
                success: false,
                error: 'Conversation not found or not authorized'
            });
        }
        
        // Mark messages as read
        await pool.query(`
            UPDATE chat_messages
            SET is_read = true
            WHERE conversation_id = $1 AND sender_type = 'customer' AND is_read = false
        `, [conversationId]);

        // **PUSHER: Trigger read receipt**
        try {
            await triggerPusherEvent(`conversation-${conversationId}`, 'messages-read', {
                conversationId: conversationId,
                readBy: 'provider'
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
        res.json({
            success: false,
            error: 'Failed to mark messages as read'
        });
    }
});

export default router;