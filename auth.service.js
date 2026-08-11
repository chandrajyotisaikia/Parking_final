// services/auth.service.js — login, password changes, and gatekeeper account management
const bcrypt = require('bcryptjs');
const { pool } = require('../db/db');

async function login(username, password) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
  const user = rows[0];
  if (!user) return null;
  const match = await bcrypt.compare(password, user.password_hash);
  return match ? { username: user.username, role: user.role } : null;
}

async function changePassword(username, oldPassword, newPassword) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
  const user = rows[0];
  if (!user) throw new Error('User not found');
  const match = await bcrypt.compare(oldPassword, user.password_hash);
  if (!match) throw new Error('Current password is incorrect');
  const newHash = await bcrypt.hash(newPassword, 10);
  await pool.query(`UPDATE users SET password_hash = $1 WHERE username = $2`, [newHash, username]);
  return true;
}

async function createGatekeeper(username, password) {
  const existing = await pool.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing.rows.length > 0) throw new Error('That username is already taken');
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'gatekeeper') RETURNING username, role, created_at`,
    [username, hash]
  );
  return rows[0];
}

async function listGatekeepers() {
  const { rows } = await pool.query(`SELECT username, created_at FROM users WHERE role = 'gatekeeper' ORDER BY created_at DESC`);
  return rows;
}

async function deleteGatekeeper(username) {
  await pool.query(`DELETE FROM users WHERE username = $1 AND role = 'gatekeeper'`, [username]);
}

module.exports = { login, changePassword, createGatekeeper, listGatekeepers, deleteGatekeeper };
