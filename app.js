const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const path = require("path");

const authServiceRoutes = require("./authservice/index");
const message = require("./chat/index");
const socketAuth = require("./Middleware/socketauth");
const authentication = require("./Middleware/authentication");
const err_handaling = require("./Middleware/err_handaling");

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Routes
// This is your initial entry point. It serves temp.html unconditionally.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "temp.html"));
});

// This line correctly applies the auth service router.
app.use("/authservice", authServiceRoutes);

// The /main route is protected by the authentication middleware.
app.get("/main", authentication, (req, res) => {
  console.log("i failed");
  const filePath = path.join(__dirname, "public", "main.html");
  console.log("Attempting to send file from:");
  res.sendFile(filePath);
});

// Attach HTTP server
const server = http.createServer(app);

// Create Socket.IO server
const io = new Server(server);

// Socket.IO authentication middleware
io.use(socketAuth);

// Socket.IO connection handler
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id, "User:", socket.user.username);
  message.handlesocket(socket, io);
});

// Error handling middleware
app.use(err_handaling);

// Start server
server.listen(3000, () => {
  console.log("App is up and running at port 3000");
});