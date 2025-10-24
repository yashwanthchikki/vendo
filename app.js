const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cookieParser = require("cookie-parser");

const authServiceRoutes = require("./authservice/index");
const setup = require("./setup/index");
const message = require("./chat/index");
const socketAuth = require("./Middleware/socketauth");
const authentication = require("./Middleware/authentication");
const err_handaling = require("./Middleware/err_handaling");
const app = express()


// Middleware
app.use(express.json());
app.use(cookieParser());


// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "temp.html"));
});



app.use(express.static(path.join(__dirname, "public")));

app.use("/authservice", authServiceRoutes);

app.get("/main", authentication, (req, res) => {
  const filePath = path.join(__dirname, "public", "main.html");
  res.sendFile(filePath);
});

app.get("/getcontact", authentication, setup.getcontact);

// HTTP server
const server = http.createServer(app);

// Socket.IO
const io = new Server(server);
io.use(socketAuth);

io.on("connection", (socket) => {
  message.handlesocket(socket, io);
});

// Error handling
app.use(err_handaling);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`App is running on port ${PORT}`);
});

