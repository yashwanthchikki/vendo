const jwt = require("jsonwebtoken");
const SECRET_KEY = "itachi"; 

function socketAuth(socket, next) {
  try {
    const token = socket.handshake.auth?.token; 
    if (!token) {
      return next(new Error("No token provided"));
    }

    // Verify token and decode payload
    const decoded = jwt.verify(token, SECRET_KEY);

    // Attach full user info (id + username) to socket
    socket.user = {
      uid: decoded.id,
      username: decoded.username,
    };

    next();
  } catch (err) {
    next(new Error("Authentication error for socket: " + err.message));
  }
}

module.exports = socketAuth;
