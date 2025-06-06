import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configure Cloudinary with credentials from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Create storage engine for multer specifically for booking images
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'booking_images', // Store booking images in this folder on Cloudinary
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif'], // Only allow image formats for booking
    resource_type: 'image', // Specifically handle images
    // Add optional transformation for images
    transformation: [
      { width: 1200, height: 1200, crop: 'limit' }, // Resize large images to reasonable dimensions
      { quality: 'auto', fetch_format: 'auto' } // Optimize quality and format
    ],
    // Generate a unique filename
    public_id: (req, file) => {
      const timestamp = Date.now();
      const originalName = file.originalname.replace(/\.[^/.]+$/, ""); // Remove extension
      const sanitizedName = originalName.replace(/[^a-zA-Z0-9]/g, '_'); // Replace special chars
      return `booking_${timestamp}_${sanitizedName}`;
    }
  }
});

// Create storage for chat attachments (if you need it elsewhere)
const chatStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'chat_attachments',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx'],
    resource_type: 'auto',
    transformation: [
      { width: 1000, height: 1000, crop: 'limit' }
    ]
  }
});

export { cloudinary, storage, chatStorage };