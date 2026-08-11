// server.js — starts the app: connects the database, serves the frontend, and the API
const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/parking.routes');
const { initDb } = require('./db/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', apiRoutes);
app.use(express.static(path.join(__dirname, 'public')));

async function start() {
  try {
    await initDb();
    console.log('Database connected and tables ready.');
  } catch (err) {
    console.error('Could not connect to the database:', err.message);
    console.error('Check that the DATABASE_URL environment variable is set correctly on Render.');
  }
  app.listen(PORT, () => {
    console.log(`Smart Parking System running on port ${PORT}`);
  });
}

start();
