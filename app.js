const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// Importing services
const register = require('./authservice'); // fixed folder name
const message = require('./chat');
const socketAuth = require("./Middleware/socetauth");
const authentication = require("./Middleware/authentication");
const err_handaling = require("./Middleware/err_handaling");

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } 
});


io.use(socketAuth);

io.on('connection', (socket) => {
    console.log("Socket connected:", socket.id, "User:", socket.user.username);
    message.handlesocket(socket, io);
});

server.listen(3000, () => {
    console.log("App is up and running at port 3000");
});
