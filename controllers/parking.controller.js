// controllers/parking.controller.js — receives requests, calls services, sends responses
const { pool } = require('../db/db');
const { calculateCharge, calculateSubscriptionAmount } = require('../services/pricing.service');
const { checkSubscriber, addSubscriber, listSubscribers, listExpiringSubscribers } = require('../services/subscriber.service');
const { addExpense, listExpenses, totalExpenses } = require('../services/expense.service');
const { getSettings, updateSettings } = require('../services/settings.service');
const authService = require('../services/auth.service');

// POST /api/verify-and-log
async function verifyAndLog(req, res) {
  const { vehicleNumber, vehicleType, attendantName, paymentChoice, duplicateConfirmed } = req.body;
  if (!vehicleNumber || !vehicleType) {
    return res.status(400).json({ success: false, error: 'vehicleNumber and vehicleType are required' });
  }
  const plate = vehicleNumber.toUpperCase().replace(/\s+/g, '');
  if (!PLATE_REGEX.test(plate)) {
    return res.status(400).json({ success: false, error: 'Vehicle number must be in format AB01CD2345' });
  }
  try {
    // Rush-hour safety net: warn (don't silently allow) if this plate is already checked in and not yet exited
    if (!duplicateConfirmed) {
      const dupRes = await pool.query(`SELECT * FROM daily_entries WHERE vehicle_number = $1 AND status = 'ACTIVE'`, [plate]);
      if (dupRes.rows.length > 0) {
        return res.json({ success: true, duplicate: true, activeEntry: dupRes.rows[0] });
      }
    }

    const subscriber = await checkSubscriber(plate);
    const isSubscriber = !!subscriber;
    const amount = calculateCharge(vehicleType, isSubscriber);

    // Payment is collected once, at entry. If it's a paying (non-subscriber) vehicle and no
    // payment choice has been made yet, return the amount so the app can show Cash/UPI/Later —
    // nothing is saved to the database until a choice comes back in the next call.
    if (!isSubscriber && !paymentChoice) {
      return res.json({ success: true, needsPayment: true, amount, isSubscriber: false });
    }

    let paymentStatus;
    if (isSubscriber) paymentStatus = 'SUBSCRIBER';
    else if (paymentChoice === 'LATER') paymentStatus = 'UNPAID';
    else paymentStatus = `PAID/${paymentChoice === 'UPI' ? 'UPI' : 'CASH'}`;

    const { rows } = await pool.query(
      `INSERT INTO daily_entries (vehicle_number, vehicle_type, is_subscriber, amount_charged, attendant_name, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [plate, vehicleType.toUpperCase(), isSubscriber, amount, attendantName || '', paymentStatus]
    );
    const entry = rows[0];

    // Check for unpaid dues from previous visits by this same vehicle
    const duesRes = await pool.query(
      `SELECT COALESCE(SUM(amount_charged),0) as total, COUNT(*) as cnt
       FROM daily_entries WHERE vehicle_number = $1 AND payment_status = 'UNPAID' AND id != $2`,
      [plate, entry.id]
    );
    const previousDues = parseFloat(duesRes.rows[0].total);
    const previousDuesCount = parseInt(duesRes.rows[0].cnt, 10);

    return res.status(201).json({
      success: true,
      entryId: entry.id,
      vehicleNumber: plate,
      vehicleType: vehicleType.toUpperCase(),
      isSubscriber,
      subscriberName: subscriber ? subscriber.owner_name : null,
      amount,
      entryTime: entry.entry_time,
      attendantName: attendantName || '',
      paymentStatus,
      previousDues,
      previousDuesCount,
      message: isSubscriber ? 'Subscriber — no charge' : `Entry logged. Charge: ₹${amount}`,
    });
  } catch (err) {
    console.error('[verifyAndLog]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/check-subscriber/:plate
async function quickCheckSubscriber(req, res) {
  const subscriber = await checkSubscriber(req.params.plate);
  return res.json({
    success: true,
    isSubscriber: !!subscriber,
    ownerName: subscriber ? subscriber.owner_name : null,
    vehicleType: subscriber ? subscriber.vehicle_type : null,
  });
}

// GET /api/entries
async function getEntries(req, res) {
  const { rows } = await pool.query(`SELECT * FROM daily_entries ORDER BY entry_time DESC LIMIT 20`);
  return res.json({ success: true, entries: rows });
}

// Indian plate format: 2 letters, 2 digits, 2 letters, 4 digits — e.g. AB01CD2345
const PLATE_REGEX = /^[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}$/;

// POST /api/subscribers
async function postSubscriber(req, res) {
  const { vehicleNumber, ownerName, phone, vehicleType, subscriptionStart, subscriptionEnd, paymentStatus, amountPaid, paymentMethod } = req.body;
  if (!vehicleNumber || !ownerName || !vehicleType || !subscriptionStart || !subscriptionEnd) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  const plate = vehicleNumber.toUpperCase().replace(/\s+/g, '');
  if (!PLATE_REGEX.test(plate)) {
    return res.status(400).json({ success: false, error: 'Vehicle number must be in format AB01CD2345' });
  }
  try {
    const amountDue = calculateSubscriptionAmount(vehicleType, subscriptionStart, subscriptionEnd);
    const status = paymentStatus || 'PAID';
    let finalPaid = 0;
    if (status === 'PAID') {
      finalPaid = amountDue;
    } else if (status === 'CREDIT') {
      finalPaid = 0;
    } else if (status === 'PARTIAL') {
      finalPaid = parseFloat(amountPaid) || 0;
      if (finalPaid <= 0 || finalPaid >= amountDue) {
        return res.status(400).json({ success: false, error: 'Partial payment must be between 0 and the total amount due' });
      }
    }
    // Encode the payment method into the same status field instead of a new column — e.g. "PAID/CASH", "PARTIAL/UPI"
    const method = paymentMethod === 'UPI' ? 'UPI' : 'CASH';
    const storedStatus = status === 'CREDIT' ? 'CREDIT' : `${status}/${method}`;

    const sub = await addSubscriber({ vehicleNumber: plate, ownerName, phone, vehicleType, subscriptionStart, subscriptionEnd, amountDue, amountPaid: finalPaid, paymentStatus: storedStatus });
    return res.status(201).json({ success: true, subscriber: sub, amountDue, amountPaid: finalPaid, remaining: amountDue - finalPaid });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
}

// GET /api/subscribers
async function getSubscribers(req, res) {
  return res.json({ success: true, subscribers: await listSubscribers() });
}

// GET /api/subscribers/expiring?days=7 — Upgrade: renewal reminders
async function getExpiringSubscribers(req, res) {
  const days = parseInt(req.query.days) || 7;
  return res.json({ success: true, subscribers: await listExpiringSubscribers(days) });
}

// POST /api/expenses
async function postExpense(req, res) {
  const { amount, description, expenseDate, attendantName } = req.body;
  if (!amount || !description || !expenseDate) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  await addExpense({ amount, description, expenseDate, attendantName });
  return res.status(201).json({ success: true });
}

// GET /api/expenses
async function getExpenses(req, res) {
  return res.json({ success: true, expenses: await listExpenses() });
}

// GET /api/summary — totals for the desktop dashboard
async function getSummary(req, res) {
  const { rows } = await pool.query(`SELECT COALESCE(SUM(amount_charged),0) as total FROM daily_entries`);
  const income = parseFloat(rows[0].total);
  const expenses = await totalExpenses();
  const collectableRes = await pool.query(`SELECT COALESCE(SUM(amount_charged),0) as total, COUNT(*) as cnt FROM daily_entries WHERE payment_status = 'UNPAID' AND status = 'ACTIVE'`);
  const collectableNow = parseFloat(collectableRes.rows[0].total);
  const collectableCount = parseInt(collectableRes.rows[0].cnt, 10);
  const historicalRes = await pool.query(`SELECT COALESCE(SUM(amount_charged),0) as total, COUNT(*) as cnt FROM daily_entries WHERE payment_status = 'UNPAID' AND status = 'EXITED'`);
  const historicalDues = parseFloat(historicalRes.rows[0].total);
  const historicalCount = parseInt(historicalRes.rows[0].cnt, 10);
  const parkedRes = await pool.query(`SELECT COUNT(*) as cnt FROM daily_entries WHERE status = 'ACTIVE'`);
  const currentlyParked = parseInt(parkedRes.rows[0].cnt, 10);
  const settings = await getSettings();
  const lotCapacity = settings.lot_capacity ? parseInt(settings.lot_capacity, 10) : null;
  return res.json({
    success: true, totalIncome: income, totalExpenses: expenses, net: income - expenses,
    collectableNow, collectableCount, historicalDues, historicalCount,
    currentlyParked, lotCapacity,
  });
}

// GET /api/export?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD — max 31 days
async function exportReport(req, res) {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, error: 'startDate and endDate are required (YYYY-MM-DD)' });
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end) || start > end) {
    return res.status(400).json({ success: false, error: 'Invalid date range' });
  }
  const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  if (diffDays > 31) {
    return res.status(400).json({ success: false, error: 'Date range cannot exceed 31 days' });
  }

  const entriesRes = await pool.query(
    `SELECT * FROM daily_entries WHERE entry_time >= $1 AND entry_time < ($2::date + INTERVAL '1 day') ORDER BY entry_time`,
    [startDate, endDate]
  );
  const expensesRes = await pool.query(
    `SELECT * FROM expenses WHERE expense_date >= $1 AND expense_date <= $2 ORDER BY expense_date`,
    [startDate, endDate]
  );
  const entries = entriesRes.rows;
  const expenses = expensesRes.rows;

  const rows = [];
  rows.push(['Type', 'Date/Time', 'Vehicle/Description', 'Category', 'Payment', 'Attendant', 'Amount (Rs)']);
  entries.forEach(e => {
    rows.push(['Income', e.entry_time, e.vehicle_number, e.is_subscriber ? 'Subscriber' : e.vehicle_type, e.payment_status || '', e.attendant_name || '', e.amount_charged]);
  });
  expenses.forEach(e => {
    rows.push(['Expense', e.expense_date, e.description, '-', '-', e.attendant_name || '', -e.amount]);
  });

  const totalIncome = entries.reduce((s, e) => s + parseFloat(e.amount_charged), 0);
  const totalExpense = expenses.reduce((s, e) => s + parseFloat(e.amount), 0);
  const cashTotal = entries.filter(e => (e.payment_status || '').includes('CASH')).reduce((s, e) => s + parseFloat(e.amount_charged), 0);
  const upiTotal = entries.filter(e => (e.payment_status || '').includes('UPI')).reduce((s, e) => s + parseFloat(e.amount_charged), 0);
  const unpaidTotal = entries.filter(e => e.payment_status === 'UNPAID').reduce((s, e) => s + parseFloat(e.amount_charged), 0);
  rows.push([]);
  rows.push(['', '', '', '', '', 'Cash Collected', cashTotal]);
  rows.push(['', '', '', '', '', 'UPI Collected', upiTotal]);
  rows.push(['', '', '', '', '', 'Still Unpaid', unpaidTotal]);
  rows.push(['', '', '', '', '', 'Total Income', totalIncome]);
  rows.push(['', '', '', '', '', 'Total Expenses', totalExpense]);
  rows.push(['', '', '', '', '', 'Net', totalIncome - totalExpense]);

  const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const filename = `parking_report_${startDate}_to_${endDate}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
}

// GET /api/entries/active — vehicles currently parked (for the exit picker)
async function getActiveEntries(req, res) {
  const { rows } = await pool.query(
    `SELECT * FROM daily_entries WHERE status = 'ACTIVE' ORDER BY entry_time DESC`
  );
  return res.json({ success: true, entries: rows });
}

// POST /api/entries/:id/exit — marks a vehicle as exited. Only updates payment status if a
// new one is given (e.g. collecting an outstanding due on the way out) — otherwise leaves
// whatever was already recorded at check-in untouched.
async function markExit(req, res) {
  const { id } = req.params;
  const { paymentStatus } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE daily_entries SET status = 'EXITED', exit_time = NOW(), payment_status = COALESCE($2, payment_status)
       WHERE id = $1 AND status = 'ACTIVE' RETURNING *`,
      [id, paymentStatus || null]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Vehicle not found or already exited' });
    }
    return res.json({ success: true, entry: rows[0] });
  } catch (err) {
    console.error('[markExit]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/entries/:id/collect-payment — mark payment collected without exiting the vehicle
// (for collecting from a car that deferred payment at entry, while it's still parked)
async function collectPayment(req, res) {
  const { id } = req.params;
  const { method } = req.body; // 'CASH' or 'UPI'
  if (!method || !['CASH', 'UPI'].includes(method)) {
    return res.status(400).json({ success: false, error: 'method must be CASH or UPI' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE daily_entries SET payment_status = $2 WHERE id = $1 AND status = 'ACTIVE' RETURNING *`,
      [id, `PAID/${method}`]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Vehicle not found or already exited' });
    }
    return res.json({ success: true, entry: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// DELETE /api/entries/:id — undo a mis-tapped entry. Only allowed within 2 minutes of creation
// and only if the vehicle hasn't already exited, so it can't be used to erase real history.
async function undoEntry(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `DELETE FROM daily_entries
       WHERE id = $1 AND status = 'ACTIVE' AND entry_time > NOW() - INTERVAL '2 minutes'
       RETURNING *`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'This entry can no longer be undone (too old, or already exited).' });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/settings — current display settings
async function getSettingsHandler(req, res) {
  return res.json({ success: true, settings: await getSettings() });
}

// POST /api/settings — update display settings (used by the admin dashboard)
async function postSettingsHandler(req, res) {
  const updated = await updateSettings(req.body);
  return res.json({ success: true, settings: updated });
}

// POST /api/auth/login
async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required' });
  }
  const user = await authService.login(username, password);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Incorrect username or password' });
  }
  return res.json({ success: true, username: user.username, role: user.role });
}

// POST /api/auth/change-password
async function changePassword(req, res) {
  const { username, oldPassword, newPassword } = req.body;
  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'All fields are required' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ success: false, error: 'New password must be at least 4 characters' });
  }
  try {
    await authService.changePassword(username, oldPassword, newPassword);
    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
}

// POST /api/auth/gatekeepers — admin creates a new gatekeeper account
async function createGatekeeper(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required' });
  }
  if (password.length < 4) {
    return res.status(400).json({ success: false, error: 'Password must be at least 4 characters' });
  }
  try {
    const gk = await authService.createGatekeeper(username, password);
    return res.status(201).json({ success: true, gatekeeper: gk });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
}

// GET /api/auth/gatekeepers
async function getGatekeepers(req, res) {
  return res.json({ success: true, gatekeepers: await authService.listGatekeepers() });
}

// DELETE /api/auth/gatekeepers/:username
async function removeGatekeeper(req, res) {
  await authService.deleteGatekeeper(req.params.username);
  return res.json({ success: true });
}

module.exports = {
  verifyAndLog, quickCheckSubscriber, getEntries,
  postSubscriber, getSubscribers, getExpiringSubscribers,
  postExpense, getExpenses, getSummary, exportReport,
  getActiveEntries, markExit, undoEntry, collectPayment,
  getSettingsHandler, postSettingsHandler,
  login, changePassword, createGatekeeper, getGatekeepers, removeGatekeeper,
};
