const jwt = require("jsonwebtoken");
const SECRET_KEY = "itachi";

const authMiddleware = (req, res, next) => {
    // Try header first, then cookie
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];

    if (!token && req.cookies.token) {
        token = req.cookies.token;
    }

    if (!token) return res.status(403).json({ message: "No token provided" });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: "Invalid token" });

        req.user = user;
        next();
    });
};

module.exports = authMiddleware;
