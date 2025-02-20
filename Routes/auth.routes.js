import express from 'express';
import { isGuest } from '../Middleware/auth.middleware.js';
import { 
    showCustomerLogin, 
    showCustomerRegister, 
    customerLogin, 
    customerRegister, 
    logout 
} from '../Controllers/auth.controller.js';

const router = express.Router();

// Customer authentication routes
router.get('/customer-login', isGuest, showCustomerLogin);
router.post('/customer-login', isGuest, customerLogin);
router.get('/customer-register', isGuest, showCustomerRegister);
router.post('/customer-register', isGuest, customerRegister);

// Logout route
router.get('/logout', logout);

export default router;