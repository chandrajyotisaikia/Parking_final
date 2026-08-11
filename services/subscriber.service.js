// services/subscriber.service.js — everything to do with checking/managing subscribers
const { pool } = require('../db/db');

async function checkSubscriber(vehicleNumber) {
  const plate = vehicleNumber.toUpperCase().replace(/\s+/g, '');
  const { rows } = await pool.query(
    `SELECT * FROM subscribers WHERE vehicle_number = $1 AND subscription_end >= CURRENT_DATE`,
    [plate]
  );
  return rows[0] || null;
}

async function addSubscriber({ vehicleNumber, ownerName, phone, vehicleType, subscriptionStart, subscriptionEnd, amountDue, amountPaid, paymentStatus }) {
  const plate = vehicleNumber.toUpperCase().replace(/\s+/g, '');
  const { rows } = await pool.query(
    `INSERT INTO subscribers (vehicle_number, owner_name, phone, vehicle_type, subscription_start, subscription_end, amount_due, amount_paid, payment_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [plate, ownerName, phone || '', vehicleType.toUpperCase(), subscriptionStart, subscriptionEnd, amountDue, amountPaid, paymentStatus || 'PAID']
  );
  return rows[0];
}

async function listSubscribers() {
  const { rows } = await pool.query(`SELECT * FROM subscribers ORDER BY subscription_end DESC`);
  return rows;
}

// Upgrade: subscription renewal reminders — subscribers expiring within N days
async function listExpiringSubscribers(days = 7) {
  const { rows } = await pool.query(
    `SELECT * FROM subscribers
     WHERE subscription_end >= CURRENT_DATE AND subscription_end <= CURRENT_DATE + ($1 || ' days')::interval
     ORDER BY subscription_end ASC`,
    [days]
  );
  return rows;
}

module.exports = { checkSubscriber, addSubscriber, listSubscribers, listExpiringSubscribers };
