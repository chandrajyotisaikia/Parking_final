// admin.js — handles login, dashboard data loading, subscriber/expense forms, reports, and gatekeeper accounts

let adminUsername = '';

function tryLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  if (!username || !password) {
    errEl.textContent = 'Please enter both username and password.';
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Logging in...';
  errEl.textContent = '';
  fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
    .then(res => res.json())
    .then(data => {
      if (!data.success) { errEl.textContent = data.error || 'Login failed.'; return; }
      if (data.role !== 'admin') { errEl.textContent = 'This account is not an admin account.'; return; }
      adminUsername = data.username;
      sessionStorage.setItem('adminLoggedIn', 'true');
      sessionStorage.setItem('adminUsername', data.username);
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('dashboard').style.display = 'block';
      loadAll();
    })
    .catch(() => { errEl.textContent = 'Could not reach the server — try again.'; })
    .finally(() => { btn.disabled = false; btn.textContent = 'Login'; });
}

if (sessionStorage.getItem('adminLoggedIn') === 'true') {
  adminUsername = sessionStorage.getItem('adminUsername') || '';
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  loadAll();
}

function openAdminChangePassword() {
  document.getElementById('adminChangePasswordCard').style.display = 'block';
}
function closeAdminChangePassword() {
  document.getElementById('adminChangePasswordCard').style.display = 'none';
  document.getElementById('adminOldPassword').value = '';
  document.getElementById('adminNewPassword').value = '';
  document.getElementById('adminChangePasswordResult').innerHTML = '';
}
async function submitAdminChangePassword() {
  const oldPassword = document.getElementById('adminOldPassword').value;
  const newPassword = document.getElementById('adminNewPassword').value;
  const resultEl = document.getElementById('adminChangePasswordResult');
  if (!oldPassword || !newPassword) {
    resultEl.innerHTML = `<div class="result paid">Please fill in both fields.</div>`;
    return;
  }
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: adminUsername, oldPassword, newPassword }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to update password');
    resultEl.innerHTML = `<div class="result sub">Password updated.</div>`;
    setTimeout(closeAdminChangePassword, 1200);
  } catch (err) {
    resultEl.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}

// ---- Gatekeeper account management ----
async function loadGatekeepers() {
  const res = await fetch('/api/auth/gatekeepers');
  const data = await res.json();
  document.getElementById('gatekeepersBody').innerHTML = data.gatekeepers.map(g => `
    <tr><td>${g.username}</td><td>${new Date(g.created_at).toLocaleDateString('en-IN')}</td>
    <td><button class="secondary" onclick="deleteGatekeeper('${g.username}')">Remove</button></td></tr>
  `).join('') || '<tr><td colspan="3">No gatekeeper accounts yet.</td></tr>';
}

async function createGatekeeper() {
  const username = document.getElementById('newGkUsername').value.trim();
  const password = document.getElementById('newGkPassword').value;
  const resultEl = document.getElementById('createGkResult');
  if (!username || !password) {
    resultEl.innerHTML = `<div class="result paid">Please enter a username and password.</div>`;
    return;
  }
  try {
    const res = await fetch('/api/auth/gatekeepers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to create account');
    resultEl.innerHTML = `<div class="result sub">Gatekeeper account created.</div>`;
    document.getElementById('newGkUsername').value = '';
    document.getElementById('newGkPassword').value = '';
    loadGatekeepers();
  } catch (err) {
    resultEl.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}

async function deleteGatekeeper(username) {
  if (!confirm(`Remove gatekeeper account "${username}"?`)) return;
  await fetch(`/api/auth/gatekeepers/${encodeURIComponent(username)}`, { method: 'DELETE' });
  loadGatekeepers();
}

function showAdminTab(tab) {
  const panels = { entries: 'entriesPanel', subs: 'subsPanel', addsub: 'addsubPanel', expenses: 'expensesPanel', export: 'exportPanel', display: 'displayPanel', gatekeepers: 'gatekeepersPanel' };
  const tabs = { entries: 'tabEntries', subs: 'tabSubs', addsub: 'tabAddSub', expenses: 'tabExpenses', export: 'tabExport', display: 'tabDisplay', gatekeepers: 'tabGatekeepers' };
  Object.keys(panels).forEach(key => {
    document.getElementById(panels[key]).style.display = key === tab ? 'block' : 'none';
    document.getElementById(tabs[key]).classList.toggle('active', key === tab);
  });
}

async function loadAll() {
  await loadSummary();
  await loadEntries();
  await loadSubscribers();
  await loadExpenses();
  await loadRenewalReminders();
}

async function loadSummary() {
  const res = await fetch('/api/summary');
  const data = await res.json();
  document.getElementById('sumIncome').textContent = `₹${data.totalIncome}`;
  document.getElementById('sumExpense').textContent = `₹${data.totalExpenses}`;
  document.getElementById('sumNet').textContent = `₹${data.net}`;
  document.getElementById('sumParked').textContent = data.lotCapacity ? `${data.currentlyParked} / ${data.lotCapacity}` : data.currentlyParked;
  document.getElementById('sumCollectable').textContent = `₹${data.collectableNow || 0} (${data.collectableCount || 0})`;
  document.getElementById('sumHistorical').textContent = `₹${data.historicalDues || 0} (${data.historicalCount || 0})`;
}

async function loadEntries() {
  const res = await fetch('/api/entries');
  const data = await res.json();
  document.getElementById('entriesBody').innerHTML = data.entries.map(e => {
    const payLabel = e.payment_status === 'UNPAID' ? '<span style="color:#ef4444;">Unpaid</span>' : (e.payment_status || (e.is_subscriber ? 'Subscriber' : 'Pending'));
    return `<tr><td>${e.vehicle_number}</td><td>${e.vehicle_type}</td><td>₹${e.amount_charged}</td><td>${payLabel}</td><td>${e.attendant_name || '-'}</td><td>${new Date(e.entry_time).toLocaleString('en-IN')}</td></tr>`;
  }).join('');
}

async function loadSubscribers() {
  const res = await fetch('/api/subscribers');
  const data = await res.json();
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('subsBody').innerHTML = data.subscribers.map(s => {
    const expDate = new Date(s.subscription_end).toISOString().split('T')[0];
    const expired = expDate < today;
    const method = (s.payment_status || '').split('/')[1] || '-';
    return `<tr class="${expired ? 'expired' : ''}"><td>${s.vehicle_number}</td><td>${s.owner_name}</td><td>${s.phone || ''}</td><td>${expDate}</td><td>₹${s.amount_due || 0}</td><td>${method}</td></tr>`;
  }).join('');
}

async function loadExpenses() {
  const res = await fetch('/api/expenses');
  const data = await res.json();
  document.getElementById('expensesBody').innerHTML = data.expenses.map(e => `
    <tr><td>${new Date(e.expense_date).toISOString().split('T')[0]}</td><td>${e.description}</td><td>${e.attendant_name || '-'}</td><td>₹${e.amount}</td></tr>
  `).join('');
}

// Upgrade: renewal reminders — subscribers expiring within 7 days
async function loadRenewalReminders() {
  const res = await fetch('/api/subscribers/expiring?days=7');
  const data = await res.json();
  const banner = document.getElementById('renewalBanner');
  if (!data.subscribers || data.subscribers.length === 0) {
    banner.innerHTML = '';
    return;
  }
  const names = data.subscribers.map(s => `${s.vehicle_number} (${s.owner_name})`).join(', ');
  banner.innerHTML = `<div class="card" style="border-color:#F5C518; background:#2a2410;">
    ⚠️ <strong>${data.subscribers.length} subscription(s) expiring within 7 days:</strong> ${names}
  </div>`;
}

// Subscription pricing preview — mirrors the server's rates so the admin sees the cost
// before submitting. The server recalculates authoritatively, so this is display-only.

let selectedNewMethod = 'CASH';
function selectNewMethod(method) {
  selectedNewMethod = method;
  document.getElementById('newMethodCash').classList.toggle('selected', method === 'CASH');
  document.getElementById('newMethodUpi').classList.toggle('selected', method === 'UPI');
}

async function addSubscriber() {
  const vehicleNumber = document.getElementById('newPlate').value.trim();
  const ownerName = document.getElementById('newOwner').value.trim();
  const phone = document.getElementById('newPhone').value.trim();
  const vehicleType = document.getElementById('newType').value;
  const subscriptionStart = document.getElementById('newStart').value;
  const subscriptionEnd = document.getElementById('newEnd').value;
  const amountDue = document.getElementById('newAmount').value;
  const resultEl = document.getElementById('addSubResult');

  if (!vehicleNumber || !ownerName || !subscriptionStart || !subscriptionEnd || !amountDue) {
    resultEl.innerHTML = `<div class="result paid">Please fill in plate, owner name, dates, and amount.</div>`;
    return;
  }
  try {
    const res = await fetch('/api/subscribers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleNumber, ownerName, phone, vehicleType, subscriptionStart, subscriptionEnd, amountDue, paymentMethod: selectedNewMethod }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    resultEl.innerHTML = `<div class="result sub">Subscriber added. Amount: ₹${data.amountDue} (Paid via ${selectedNewMethod}).</div>`;
    ['newPlate','newOwner','newPhone','newStart','newEnd','newAmount'].forEach(id => document.getElementById(id).value = '');
    loadSubscribers();
    loadRenewalReminders();
  } catch (err) {
    resultEl.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}

function downloadReport() {
  const start = document.getElementById('exportStart').value;
  const end = document.getElementById('exportEnd').value;
  const resultEl = document.getElementById('exportResult');

  if (!start || !end) {
    resultEl.innerHTML = `<div class="result paid">Please pick both a start and end date.</div>`;
    return;
  }
  const diffDays = Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1;
  if (diffDays > 31 || diffDays < 1) {
    resultEl.innerHTML = `<div class="result paid">Please choose a range of 31 days or less.</div>`;
    return;
  }
  resultEl.innerHTML = '';
  window.location.href = `/api/export?startDate=${start}&endDate=${end}`;
}

// ---- Display settings (button size + minimal mode on the gate app) ----
async function loadDisplaySettings() {
  const res = await fetch('/api/settings');
  const data = await res.json();
  document.getElementById('settingButtonSize').value = data.settings.button_size || 'normal';
  document.getElementById('settingMinimal').checked = data.settings.minimal_mode === 'true';
  document.getElementById('settingLotCapacity').value = data.settings.lot_capacity || '';
}

async function saveDisplaySettings() {
  const button_size = document.getElementById('settingButtonSize').value;
  const minimal_mode = document.getElementById('settingMinimal').checked ? 'true' : 'false';
  const lot_capacity = document.getElementById('settingLotCapacity').value || '';
  const resultEl = document.getElementById('settingsResult');
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ button_size, minimal_mode, lot_capacity }),
    });
    const data = await res.json();
    if (!data.success) throw new Error('Failed to save');
    resultEl.innerHTML = `<div class="result sub">Saved.</div>`;
  } catch (err) {
    resultEl.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}
