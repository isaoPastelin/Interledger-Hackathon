require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const kidbankRoutes = require('./routes/kidbank');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Routes
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect('/kidbank');
  } else {
    res.redirect('/auth/login');
  }
});

app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/kidbank', kidbankRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Open Payments Application is ready!');
});
