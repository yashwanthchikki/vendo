const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { ulid } = require("ulid");

const SECRET_KEY = "itachi";
const connect = require("./db.js"); // Make sure db.js exports a function that connects to your DB

// ---------------- SIGNUP ----------------
const signup = async (req, res, next) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  let db;
  try {
    db = await connect();
  } catch (err) {
    return next(new Error("Database connection error: " + err.message));
  }

  try {
    const existingUser = await db.get(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }
  } catch (err) {
    return next(new Error("Error checking user: " + err.message));
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const uid = ulid();

  try {
    await db.run(
      "INSERT INTO users (uid, username, hashedPassword) VALUES (?, ?, ?)",
      [uid, username, hashedPassword]
    );
    return res.status(201).json({ message: "New user created successfully" });
  } catch (err) {
    return next(new Error("Error inserting user: " + err.message));
  }
};


// ---------------- SIGNIN ----------------
const signin = async (req, res, next) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  let db;
  try {
    db = await connect();
  } catch (err) {
    return next(new Error("Database connection error: " + err.message));
  }

  let user;
  try {
    user = await db.get("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) {
      return res.status(404).json({ error: "No user with such name" });
    }
  } catch (err) {
    return next(new Error("Error finding user: " + err.message));
  }

  const validPassword = await bcrypt.compare(password, user.hashedPassword);
  if (!validPassword) {
    return res.status(401).json({ error: "Wrong password" });
  }

  // Create JWT
  const token = jwt.sign(
    { id: user.uid, username: user.username },
    SECRET_KEY,
    { expiresIn: "1h" }
  );

  // Send token in HTTP-only cookie
  res.cookie("token", token, {
    httpOnly: true,
    secure: false, // set to true in production with HTTPS
    sameSite: "lax",
    maxAge: 3600 * 1000
  });

  return res.json({ 
    message: "Login successful", 
    uid: user.uid,
    username: user.username
  });
};
// ---------------- DELETE ACCOUNT ----------------
const deleteaccount = async (req, res, next) => {
  
  const { id } = req.user; // from JWT payload, where you stored uid

let db;
try {
  db = await connect();
} catch (err) {
  return next(new Error("Database connection error: " + err.message));
}

try {
  const result = await db.run("DELETE FROM users WHERE uid = ?", [id]);
  if (result.changes === 0) {
    return res.status(404).json({ message: "User not found" });
  }
  return res.status(200).json({ message: "User deleted successfully" });
} catch (err) {
  return next(new Error("Error deleting user: " + err.message));
}

};



module.exports = { signup, signin, deleteaccount };
