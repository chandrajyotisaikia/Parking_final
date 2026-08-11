// services/expense.service.js — logging and totaling daily expenses
const { pool } = require('../db/db');

async function addExpense({ amount, description, expenseDate, attendantName }) {
  const { rows } = await pool.query(
    `INSERT INTO expenses (amount, description, expense_date, attendant_name) VALUES ($1,$2,$3,$4) RETURNING *`,
    [amount, description, expenseDate, attendantName || '']
  );
  return rows[0];
}

async function listExpenses() {
  const { rows } = await pool.query(`SELECT * FROM expenses ORDER BY expense_date DESC, id DESC`);
  return rows;
}

async function totalExpenses() {
  const { rows } = await pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM expenses`);
  return parseFloat(rows[0].total);
}

module.exports = { addExpense, listExpenses, totalExpenses };
