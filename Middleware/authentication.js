const jwt = require('jsonwebtoken');
const SECRET_KEY = "itachi";
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) return res.status(403).json({ message: 'No token provided' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });

        req.user = user; // attach decoded payload
        next();
    });
};

module.exports=authMiddleware
