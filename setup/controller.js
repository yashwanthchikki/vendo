const connect = require("../authservice/db.js")

const getcontact = async (req, res, next) => {
  const { username } = req.query;  // use req.query for ?username=xyz

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  let db;
  try {
    db = await connect();
  } catch (err) {
    return next(new Error("Database connection error: " + err.message));
  }

  try {
    const row = await db.get(
      "SELECT uid, username FROM users WHERE username = ?",
      [username]
    );
    console.log("Searching for username:", username);
    console.log("Row returned:", row);

    if (!row) {
      return res.status(404).json({ error: "User not found" });
    }

    // success
    return res.status(200).json({
      uid: row.uid,
      username: row.username,
    });

  } catch (err) {
    return next(new Error("DB query error: " + err.message));
  }
};

module.exports = getcontact;
