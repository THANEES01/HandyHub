export const isAuth = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    req.flash('error', 'Please login to access this page');
    res.redirect('/authentication/customer-login');
};

export const isGuest = (req, res, next) => {
    if (!req.session.user) {
        return next();
    }
    const redirectMap = {
        customer: '/customer/dashboard',
        provider: '/provider/dashboard',
        admin: '/admin/dashboard'
    };
    res.redirect(redirectMap[req.session.user.userType] || '/');
};

export const isCustomer = (req, res, next) => {
    if (req.session.user && req.session.user.userType === 'customer') {
        return next();
    }
    req.flash('error', 'Access denied');
    res.redirect('/authentication/customer-login');
};