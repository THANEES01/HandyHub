// Socket.io implementation for real-time messaging
import { Server } from 'socket.io';
import pool from './config/database.js';

export default function setupSocketIO(server, sessionMiddleware) {
    const io = new Server(server);
    
    // Convert express session middleware to Socket.IO middleware
    const wrap = middleware => (socket, next) => {
        middleware(socket.request, {}, next);
    };
    
    // Apply session middleware to Socket.IO
    if (sessionMiddleware) {
        io.use(wrap(sessionMiddleware));
    }
    
    // Middleware to handle authentication
    io.use((socket, next) => {
        // Extract auth data from handshake (for clients without session)
        const userType = socket.handshake.auth.userType;
        const conversationId = socket.handshake.auth.conversationId;
        
        // Try to get user from session first
        if (socket.request.session && socket.request.session.user) {
            socket.userId = socket.request.session.user.id;
            socket.userType = socket.request.session.user.userType;
            socket.providerId = socket.request.session.user.providerId;
            socket.conversationId = conversationId;
            console.log(`Authenticated user from session: ${socket.userId} (${socket.userType})`);
            return next();
        }
        
        // Fall back to auth from handshake
        if (userType) {
            socket.userType = userType;
            socket.conversationId = conversationId;
            console.log(`User authenticated from handshake: (${socket.userType})`);
            return next();
        }
        
        // Allow connection even without auth for public functions
        console.log('Socket connection without full authentication');
        next();
    });
    
    io.on('connection', (socket) => {
        console.log(`Socket connected. UserType: ${socket.userType}, ConversationId: ${socket.conversationId}`);
        
        // Join user to their own room if they have a userId
        if (socket.userId) {
            socket.join(`user:${socket.userId}`);
        }
        
        // Join provider to their provider room if applicable
        if (socket.userType === 'provider' && socket.providerId) {
            socket.join(`provider:${socket.providerId}`);
        }
        
        // Handle joining a specific conversation
        socket.on('join-conversation', async (data) => {
            try {
                const conversationId = data.conversationId || socket.conversationId;
                
                if (!conversationId) {
                    console.warn('No conversation ID provided for join-conversation');
                    return;
                }
                
                // Create room name for this conversation
                const roomName = `conversation:${conversationId}`;
                
                // Join the conversation room
                socket.join(roomName);
                console.log(`User joined conversation room: ${roomName}`);
                
                // If we have user authentication, also verify access to conversation
                if (socket.userId) {
                    // Verify this user has access to this conversation
                    let conversationQuery;
                    let queryParams;
                    
                    if (socket.userType === 'customer') {
                        conversationQuery = `
                            SELECT id FROM chat_conversations
                            WHERE id = $1 AND customer_id = $2
                        `;
                        queryParams = [conversationId, socket.userId];
                    } else if (socket.userType === 'provider') {
                        conversationQuery = `
                            SELECT id FROM chat_conversations
                            WHERE id = $1 AND provider_id = $2
                        `;
                        queryParams = [conversationId, socket.providerId];
                    } else {
                        return;
                    }
                    
                    try {
                        const conversationResult = await pool.query(conversationQuery, queryParams);
                        
                        if (conversationResult.rows.length === 0) {
                            console.warn(`User ${socket.userId} (${socket.userType}) attempted to join unauthorized conversation ${conversationId}`);
                            socket.leave(roomName);
                        } else {
                            console.log(`${socket.userType} ${socket.userId} joined conversation ${conversationId}`);
                        }
                    } catch (dbError) {
                        console.error('Database error on conversation verification:', dbError);
                    }
                }
                
            } catch (error) {
                console.error('Error joining conversation:', error);
            }
        });
        
        // Handle sending a message
        socket.on('send-message', async (data) => {
              try {
        const { conversationId, message } = data;
        
        if (!conversationId || !message) {
            console.warn('Missing data in send-message event:', { conversationId, messageExists: !!message });
            return;
        }
        
        console.log(`User sending message to conversation ${conversationId}`);
        
        // Create room name for this conversation
        const roomName = `conversation:${conversationId}`;
        
        // Emit to the conversation room (excluding sender)
        socket.to(roomName).emit('receive-message', message);
        
        // If we have database connection, retrieve conversation participants for notification
        try {
            // Get the other user in this conversation to notify them
            const conversationQuery = `
                SELECT customer_id, provider_id
                FROM chat_conversations
                WHERE id = $1
            `;
            
            const conversationResult = await pool.query(conversationQuery, [conversationId]);
            
            if (conversationResult.rows.length === 0) {
                console.warn(`Conversation ${conversationId} not found in database`);
                return;
            }
            
            const conversation = conversationResult.rows[0];
            
            // Broadcast a general notification for users who might be viewing other pages
            const recipientType = socket.userType === 'customer' ? 'provider' : 'customer';
            const recipientId = socket.userType === 'customer' ? conversation.provider_id : conversation.customer_id;
            
            if (recipientType === 'provider') {
                io.to(`provider:${recipientId}`).emit('new-message', {
                    conversationId: conversationId,
                    to_user_type: recipientType,
                    has_attachment: message.has_attachment
                });
            } else {
                io.to(`user:${recipientId}`).emit('new-message', {
                    conversationId: conversationId,
                    to_user_type: recipientType,
                    has_attachment: message.has_attachment
                });
            }
            
            console.log(`Notification sent to ${recipientType} ${recipientId}`);
            
        } catch (dbError) {
            console.error('Database error when sending message:', dbError);
        }
        
    } catch (error) {
        console.error('Error sending message via socket:', error);
    }
        });
        
        // Handle typing indicator
        socket.on('typing', async (data) => {
            try {
                const conversationId = data.conversationId || socket.conversationId;
                
                if (!conversationId) {
                    console.warn('No conversation ID provided for typing event');
                    return;
                }
                
                // Create room name for this conversation
                const roomName = `conversation:${conversationId}`;
                
                // Emit to everyone in the conversation room except the sender
                socket.to(roomName).emit('typing', {
                    sender_type: socket.userType || data.sender_type
                });
                
            } catch (error) {
                console.error('Error with typing indicator:', error);
            }
        });
        
        // Handle marking messages as read
        socket.on('mark-as-read', async (data) => {
            try {
                const conversationId = data.conversationId || socket.conversationId;
                
                if (!conversationId) {
                    console.warn('No conversation ID provided for mark-as-read event');
                    return;
                }
                
                // Create room name for this conversation
                const roomName = `conversation:${conversationId}`;
                
                // Update database if we have user authentication
                if (socket.userId && socket.userType) {
                    try {
                        // Determine the sender type to mark as read
                        const senderType = socket.userType === 'customer' ? 'provider' : 'customer';
                        
                        // Update the database
                        await pool.query(`
                            UPDATE chat_messages
                            SET is_read = true
                            WHERE conversation_id = $1 AND sender_type = $2 AND is_read = false
                        `, [conversationId, senderType]);
                        
                        console.log(`Marked messages as read for conversation ${conversationId}`);
                    } catch (dbError) {
                        console.error('Database error when marking messages as read:', dbError);
                    }
                }
                
                // Emit to everyone in the conversation room
                io.to(roomName).emit('message-read', {
                    conversationId: conversationId
                });
                
            } catch (error) {
                console.error('Error marking messages as read:', error);
            }
        });
        
        // Handle disconnection
        socket.on('disconnect', () => {
            console.log(`Socket disconnected. UserType: ${socket.userType}`);
        });
    });
    
    return io;
}