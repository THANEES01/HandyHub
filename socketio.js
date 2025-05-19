import { Server } from 'socket.io';

export default function setupSocketIO(server, sessionMiddleware) {
  // Initialize Socket.IO
  const io = new Server(server);
  
  // Use session middleware with Socket.IO
  const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
  io.use(wrap(sessionMiddleware));
  
  // Socket connection handling
  io.on('connection', (socket) => {
    console.log('New Socket.IO connection established');
    
    // Get user info from session
    const session = socket.request.session;
    const userType = socket.handshake.auth.userType;
    const conversationId = socket.handshake.auth.conversationId;
    
    console.log(`User connected: ${userType}, ConversationId: ${conversationId}`);
    
    // Handle joining a conversation room
    socket.on('join-conversation', (data) => {
      const roomId = `conversation_${data.conversationId}`;
      socket.join(roomId);
      console.log(`User joined room: ${roomId}`);
    });
    
    // Handle sending a message
    socket.on('send-message', (data) => {
      console.log('Socket received message:', data);
      
      const roomId = `conversation_${data.conversationId}`;
      
      // Broadcast the message to others in the room
      socket.to(roomId).emit('receive-message', data.message);
      
      // Also broadcast to user type rooms for notifications
      if (userType === 'customer') {
        io.to('providers').emit('new-message', {
          conversationId: data.conversationId,
          from_user_type: 'customer',
          to_user_type: 'provider'
        });
      } else if (userType === 'provider') {
        io.to('customers').emit('new-message', {
          conversationId: data.conversationId,
          from_user_type: 'provider',
          to_user_type: 'customer'
        });
      }
    });
    
    // Handle typing indicator
    socket.on('typing', (data) => {
      console.log('User typing:', data);
      
      const roomId = `conversation_${data.conversationId}`;
      socket.to(roomId).emit('typing', {
        sender_type: data.sender_type
      });
    });
    
    // Handle marking messages as read
    socket.on('mark-as-read', (data) => {
      console.log('Marking message as read:', data);
      
      const roomId = `conversation_${data.conversationId}`;
      socket.to(roomId).emit('message-read', {
        messageId: data.messageId
      });
    });
    
    // Join user type room for broadcast notifications
    if (userType === 'customer') {
      socket.join('customers');
    } else if (userType === 'provider') {
      socket.join('providers');
    }
    
    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('Socket.IO client disconnected');
    });
  });
  
  return io;
}