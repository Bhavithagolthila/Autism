const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const db = new sqlite3.Database("./autism.db");

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: "secret-key",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(express.static(path.join(__dirname, "public")));

// Tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    username TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    password TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS child_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    child_name TEXT,
    child_age INTEGER,
    gender TEXT,
    symptoms TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    q1 TEXT, q2 TEXT, q3 TEXT, q4 TEXT, q5 TEXT,
    q6 TEXT, q7 TEXT, q8 TEXT, q9 TEXT, q10 TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER,
    likelihood TEXT,
    percentage REAL,
    recommendations TEXT,
    FOREIGN KEY (child_id) REFERENCES child_info(id)
  )`);
});

// Routes
app.post("/register", async (req, res) => {
  const { name, username, email, phone, password, "confirm-password": confirm } = req.body;

  if (!name || !username || !email || !phone || !password || !confirm) {
    return res.status(400).send("All fields required");
  }
  if (password !== confirm) return res.status(400).send("Passwords do not match");

  const hashed = await bcrypt.hash(password, 10);
  db.run(
    "INSERT INTO users (name, username, email, phone, password) VALUES (?,?,?,?,?)",
    [name, username, email, phone, hashed],
    function (err) {
      if (err) return res.status(400).send("User already exists");
      res.redirect("/login.html");
    }
  );
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (err || !user) return res.status(400).send("Invalid email or password");
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).send("Invalid email or password");

    req.session.user_id = user.id;
    res.redirect("/child_info.html");
  });
});

// Protect routes middleware
function authRequired(req, res, next) {
  if (!req.session.user_id) return res.redirect("/login.html");
  next();
}

// 🚨 UPDATED CHILD INFO ROUTE
app.post("/child_info", authRequired, (req, res) => {
  const { "child-name": name, "child-age": age, "child-gender": gender, symptoms } = req.body;

  db.run(
    "INSERT INTO child_info (user_id, child_name, child_age, gender, symptoms) VALUES (?,?,?,?,?)",
    [req.session.user_id, name, age, gender, symptoms],
    function (err) {
      if (err) return res.status(500).send("Error saving child info");

      req.session.child_id = this.lastID;

      // If user selects "No" → skip questionnaires
      if (symptoms.toLowerCase() === "no") {
        return res.redirect("/thankyou");
      }

      // Otherwise → continue to questionnaires
      res.redirect("/questionaries.html");
    }
  );
});

// ✅ GET thankyou route
app.get("/thankyou", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "thankyou.html"));
});

app.post("/questionaries", authRequired, (req, res) => {
  const answers = req.body;
  db.run(
    `INSERT INTO questions 
     (user_id, q1,q2,q3,q4,q5,q6,q7,q8,q9,q10) 
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      req.session.user_id,
      answers.q1, answers.q2, answers.q3, answers.q4, answers.q5,
      answers.q6, answers.q7, answers.q8, answers.q9, answers.q10,
    ],
    function (err) {
      if (err) return res.status(500).send("Error saving answers");

      // Calculate score
      const mapping = { often: 3, sometimes: 2, rarely: 1, never: 0 };
      let score = 0;
      Object.values(answers).forEach(a => (score += mapping[a] || 0));
      const percentage = (score / (10 * 3)) * 100;
      let likelihood = "Low";
      if (percentage > 60) likelihood = "High";
      else if (percentage > 30) likelihood = "Medium";

      const recommendations =
        likelihood === "High"
          ? "Consult a specialist and consider therapies."
          : likelihood === "Medium"
          ? "Monitor child behavior, consult doctor if needed."
          : "No major concerns, keep observing.";

      db.run(
        "INSERT INTO results (child_id, likelihood, percentage, recommendations) VALUES (?,?,?,?)",
        [req.session.child_id, likelihood, percentage, recommendations],
        function (err) {
          if (err) return res.status(500).send("Error saving results");
          req.session.result_id = this.lastID;
          res.redirect("/questionaries_result.html");
        }
      );
    }
  );
});

app.get("/results", authRequired, (req, res) => {
  db.get("SELECT * FROM results WHERE id = ?", [req.session.result_id], (err, row) => {
    if (err || !row) return res.status(404).send("No results found");
    res.json(row);
  });
});

app.listen(3000, () => console.log("🚀 Server running on http://localhost:3000"));
