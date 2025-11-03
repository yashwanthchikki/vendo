const jwt = require("jsonwebtoken");
const SECRET_KEY = process.env.JWT_SECRET || "itachi"; 

function socketAuth(socket, next) {
  const cookieHeader = socket.handshake.headers.cookie; // raw cookie string
  if (!cookieHeader) {
    socket.disconnect();
    return next(new Error("No cookie sent"));
  }

  const match = cookieHeader.match(/token=([^;]+)/);
  if (!match) {
    socket.disconnect();
    return next(new Error("No token in cookie"));
  }

  const token = match[1];

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    socket.user = { uid: decoded.id, username: decoded.username };
    next();
  } catch (err) {
    socket.disconnect();
    next(new Error("Invalid token: " + err.message));
  }
}


module.exports = socketAuth;
