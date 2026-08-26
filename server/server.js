require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const cors = require('cors');
const path = require('path');

const foodRoutes = require('./routes/food');
const whoopRoutes = require('./routes/whoop');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set. Set one in server/.env before real use.');
}

app.use(cors());
app.use(express.json());
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'dev-only-insecure-secret'],
  maxAge: 24 * 60 * 60 * 1000
}));

app.use(foodRoutes);
app.use(whoopRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Calorie tracker running at http://localhost:${PORT}`);
});
