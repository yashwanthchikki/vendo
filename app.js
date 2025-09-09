const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");


const authServiceRoutes = require('./authservice/routes');


const message = require('./chat/index');
const socketAuth = require("./Middleware/socketauth");
const authentication = require("./Middleware/authentication");
const err_handaling = require("./Middleware/err_handaling");

const app = express();
app.use(express.json());

// Apply CORS for Express routes
app.use(cors({
    origin: "http://127.0.0.1:5500", // frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));


app.use('/authservice', authServiceRoutes);
const server = http.createServer(app);

app.use(authentication );

// Create Socket.IO server attached to HTTP server
const io = new Server(server, {
    cors: { origin: "http://127.0.0.1:5500" } // allow frontend to connect
});

// Apply Socket.IO authentication middleware
io.use(socketAuth);

// Socket.IO connection handler
io.on('connection', (socket) => {
    console.log("Socket connected:", socket.id, "User:", socket.user.username);
    message.handlesocket(socket, io);
});

// Error handling middleware for Express
app.use(err_handaling);

// Start server
server.listen(3000, () => {
    console.log("App is up and running at port 3000");
});
