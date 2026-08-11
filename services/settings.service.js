// services/settings.service.js — app-wide display settings, editable from the admin dashboard
const { pool } = require('../db/db');

const DEFAULTS = { button_size: 'normal', minimal_mode: 'false' };

async function getSettings() {
  const { rows } = await pool.query(`SELECT key, value FROM app_settings`);
  const settings = { ...DEFAULTS };
  rows.forEach(r => { settings[r.key] = r.value; });
  return settings;
}

async function updateSettings(newSettings) {
  for (const [key, value] of Object.entries(newSettings)) {
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value)]
    );
  }
  return getSettings();
}

module.exports = { getSettings, updateSettings };
