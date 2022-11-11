const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const mysql = require("mysql");
const { use } = require("passport");
const sessionMiddleware = session({ secret: "secret", resave: false, saveUninitialized: true });

server.listen(process.env.PORT || 3000, () => {
  console.log("SERVER LISTENING!");
});

// Connect to MySQL database
const connection = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "password",
  database: "Yellowchat"
});

connection.connect((err) => {
  if (err) {
    return console.error("Error: ", err.message);
  }
  console.log("CONNECTED TO MYSQL SERVER");
  connection.query("SELECT * FROM users", (err, result) => {
    console.log("DATABASE RESULT", result);
  });
});

app.set("view engine", "ejs");
app.use(express.static(__dirname));
app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(passport.initialize());
app.use(passport.session());

const CURRENT_USERS = [];

passport.serializeUser((user, done) => {
  CURRENT_USERS.push({ USER_ID: user[0].user_id, USERNAME: user[0].username });
  done(null, user[0].user_id);
  console.log("LIST", CURRENT_USERS);
});

passport.deserializeUser((id, done) => {
  connection.query("SELECT * FROM users WHERE user_id = ?", [id], (err, result) => {
    done(err, result[0]);
  });
});

passport.use(
  new LocalStrategy((username, password, done) => {
    connection.query("SELECT * FROM users WHERE username = ?", [username], (err, result) => {
      if (err) {
        return done(err);
      }
      if (result[0] === undefined) {
        return done(null, false, { message: "WRONG USERNAME" });
      }
      bcrypt.compare(password, result[0].user_password, (err, res) => {
        if (err) {
          return done(err);
        }
        if (!res) {
          return done(null, false, { message: "WRONG PWD" });
        }
        return done(null, result);
      });
    });
  })
);

function loggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

function loggedOut(req, res, next) {
  if (!req.isAuthenticated()) {
    return next();
  }
  res.redirect("/");
}

app.get("/", loggedIn, (req, res) => {
  connection.query("SELECT username FROM users WHERE user_id = ?", [req.session.passport.user], (err, result) => {
    if (err) {
      console.log(err);
    }
    res.render("index", { username: result[0].username, userlist: CURRENT_USERS });
  });
});

app.get("/getUserList", (req, res) => {
  res.json(CURRENT_USERS);
});

app.get("/login", loggedOut, (req, res) => {
  res.render("login", { error: req.query.error });
});

app.get("/create", (req, res) => {
  res.render("create", { error: req.query.error });
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login?error=true"
  })
);

app.post("/create-account", (req, res) => {
  console.log(req.body);
  const { createUsername, createPassword } = req.body;
  console.log(createUsername);
  console.log(createPassword);

  connection.query("SELECT username FROM users WHERE username = ? ", [createUsername], (err, result) => {
    if (err) {
      console.log("CHECK USERNAME EXISTS ERROR:", err);
    }
    if (result[0] === undefined) {
      console.log("Username available!!!");
      bcrypt.genSalt(10, (err, salt) => {
        if (err) {
          return next(err);
        }
        bcrypt.hash(createPassword, salt, (err, hash) => {
          if (err) {
            return next(err);
          }
          const newUserSQL = `INSERT INTO users (username, user_password) VALUES ('${createUsername}','${hash}')`;
          connection.query(newUserSQL, (err) => {
            if (err) {
              console.log("CREATE ACCOUNT ERROR:", err);
            }
            console.log("NEW USER ACCOUNT CREATED");
          });
        });
      });
      res.redirect("/login");
    } else {
      console.log("Username exists!!!");
      res.redirect("/create?error=true");
    }
  });
});

const wrap = (middleware) => (socket, next) => middleware(socket.request, {}, next);

io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

io.use((socket, next) => {
  if (socket.request.user) {
    next();
  } else {
    next(new Error("unauthorized"));
  }
});

io.on("connection", (socket) => {
  console.log("IO Connected");

  app.get("/logout", (req, res) => {
    socket.emit("someoneLoggedOut", getUserName(req.session.passport.user));

    for (let i = 0; i < CURRENT_USERS.length; i++) {
      if (CURRENT_USERS[i].USER_ID === req.session.passport.user) {
        CURRENT_USERS.splice(i, 1);
      }
    }

    req.logout((err) => {
      if (err) {
        return next(err);
      }
      res.redirect("/");
    });
  });

  socket.broadcast.emit("someoneLoggedIn", getUserName(socket.request.session.passport.user));

  socket.on("logout", (usr) => {
    io.emit("logout", usr);
  });

  socket.on("chatMessage", (msg, time) => {
    console.log(`'${msg}', AT ${time}`);
    socket.broadcast.emit("chatMessage", msg, time, getUserName(socket.request.session.passport.user));
  });
});

function getUserName(id) {
  for (const userPacket of CURRENT_USERS) {
    if (userPacket.USER_ID === id) {
      return userPacket.USERNAME;
    }
  }
}
