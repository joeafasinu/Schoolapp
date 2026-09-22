require("dotenv").config();
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const methodOverride = require("method-override");
const expressLayouts = require("express-ejs-layouts");
const path = require("path");

const db = require("./db");
const { injectUser } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    store: new pgSession({ pool: db.pool, tableName: "user_sessions", createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12 hours
  })
);

app.use(injectUser);

app.use("/", require("./routes/auth"));
app.use("/dashboard", require("./routes/dashboard"));
app.use("/setup", require("./routes/setup"));
app.use("/scores", require("./routes/scores"));
app.use("/attendance", require("./routes/attendance"));
app.use("/broadsheet", require("./routes/broadsheet"));
app.use("/reportcard", require("./routes/reportcard"));
app.use("/platform", require("./routes/platform"));

app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.redirect("/login");
});

app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found.", user: req.session.user || null });
});

// central error handler so a rejected async route doesn't crash the process
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", { message: "Something went wrong on our end. Please try again.", user: req.session.user || null });
});

async function start() {
  await db.initSchema();
  app.listen(PORT, () => {
    console.log(`SchoolApp running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
