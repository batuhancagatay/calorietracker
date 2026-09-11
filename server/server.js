require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const cors = require('cors');
const path = require('path');

const foodRoutes = require('./routes/food');
const whoopRoutes = require('./routes/whoop');

const app = express();
const PORT = process.env.PORT || 3000;

// Require SESSION_SECRET in production
if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production environment');
  }
  console.warn('WARNING: SESSION_SECRET not set. Using development default.');
}

// Security middleware
app.use(require('helmet')());

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || ['http://localhost:3000', 'http://localhost:8888'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '10mb' }));

// Session configuration
app.use(cookieSession({
  name: 'session',
  keys: process.env.SESSION_SECRET ? [process.env.SESSION_SECRET] : ['dev-insecure-key'],
  maxAge: 24 * 60 * 60 * 1000,
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  sameSite: 'strict'
}));

// Prevent unauthorized access to API
app.use('/api/food-log', require('./middleware/auth'));
app.use('/api/whoop/disconnect', require('./middleware/auth'));

app.use(foodRoutes);
app.use(whoopRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Calorie tracker running at http://localhost:${PORT}`);
});
