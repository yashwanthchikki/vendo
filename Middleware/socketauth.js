const jwt = require('jsonwebtoken');
const SECRET_KEY = "itachi"; // same as authservice

function socketAuth(socket, next) {
    try {
        const token = socket.handshake.auth?.token; // sent by client
        if (!token) {
            return next(new Error("No token provided"));
        }

        const user = jwt.verify(token, SECRET_KEY);
        socket.user = user; // attach decoded user info
        next();
    } catch (err) {
        next(new Error("Authentication error"));
    }
}

module.exports = socketAuth;
