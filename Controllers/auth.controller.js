import bcrypt from 'bcrypt';
import supabase from '../config/supabase.js';

export const showCustomerLogin = (req, res) => {
    res.render('authentication/customer-login');
};

export const showCustomerRegister = (req, res) => {
    res.render('authentication/customer-register');
};

export const customerRegister = async (req, res) => {
    try {
        const { firstName, lastName, email, phoneNumber, password } = req.body;

        // Check if user exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (existingUser) {
            req.session.error = 'Email already registered';
            return res.redirect('/authentication/customer-register');
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const { data: newUser, error } = await supabase
            .from('users')
            .insert([{
                email,
                password: hashedPassword,
                first_name: firstName,
                last_name: lastName,
                phone_number: phoneNumber,
                user_type: 'customer'
            }])
            .select()
            .single();

        if (error) {
            console.error('Registration error:', error);
            req.session.error = 'Registration failed. Please try again.';
            return res.redirect('/authentication/customer-register');
        }

        req.session.success = 'Registration successful! Please login.';
        res.redirect('/authentication/customer-login');

    } catch (err) {
        console.error('Registration error:', err);
        req.session.error = 'Registration failed. Please try again.';
        res.redirect('/authentication/customer-register');
    }
};

export const customerLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Get user from database
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .eq('user_type', 'customer')
            .single();

        if (error || !user) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/authentication/customer-login');
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            req.session.error = 'Invalid email or password';
            return res.redirect('/authentication/customer-login');
        }

        // Set session
        req.session.user = {
            id: user.id,
            email: user.email,
            name: `${user.first_name} ${user.last_name}`,
            userType: 'customer'
        };

        res.redirect('/customer/dashboard');

    } catch (err) {
        console.error('Login error:', err);
        req.session.error = 'Login failed. Please try again.';
        res.redirect('/authentication/customer-login');
    }
};

export const logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Logout error:', err);
        res.redirect('/authentication/customer-login');
    });
};