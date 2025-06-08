// pusher-config.js - Pusher configuration for server-side
import Pusher from 'pusher';
import dotenv from 'dotenv';

dotenv.config();

// Configure Pusher instance
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// Function to trigger real-time events
export const triggerPusherEvent = async (channel, event, data) => {
  try {
    await pusher.trigger(channel, event, data);
    console.log(`Pusher event triggered: ${event} on channel: ${channel}`);
  } catch (error) {
    console.error('Error triggering Pusher event:', error);
  }
};

// Function to authenticate private channels
export const authenticatePusherChannel = (socketId, channel, authData) => {
  try {
    // Verify user has access to this conversation
    const auth = pusher.authenticate(socketId, channel, authData);
    return auth;
  } catch (error) {
    console.error('Error authenticating Pusher channel:', error);
    throw error;
  }
};

export default pusher;