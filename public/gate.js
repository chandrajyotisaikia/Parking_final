// gate.js — gate check-in screen: manual entry, camera OCR + AI vehicle-type detection,
// name locking, live charge preview, receipts, vehicle exit, expense logging, display settings.

let selectedType = 'CAR';

function selectType(type) {
  selectedType = type;
  document.getElementById('btnCar').classList.toggle('selected', type === 'CAR');
  document.getElementById('btnBike').classList.toggle('selected', type === 'BIKE');
  updateChargePreview();
}

// Upgrade: tells the attendant what to charge before they even tap Check In
function updateChargePreview() {
  const amt = selectedType === 'CAR' ? 80 : 40;
  const el = document.getElementById('chargePreview');
  if (el) el.textContent = `💰 Standard charge: ₹${amt} (free if subscriber) — you'll choose Cash/UPI/Later after tapping Check In`;
}

function showTab(tab) {
  document.getElementById('gateSection').style.display = tab === 'gate' ? 'block' : 'none';
  document.getElementById('expenseSection').style.display = tab === 'expense' ? 'block' : 'none';
  document.getElementById('subSection').style.display = tab === 'sub' ? 'block' : 'none';
  document.getElementById('tabGate').classList.toggle('active', tab === 'gate');
  document.getElementById('tabExpense').classList.toggle('active', tab === 'expense');
  document.getElementById('tabSub').classList.toggle('active', tab === 'sub');
}

// ---- Plate number formatting: only capital letters and digits, format AB01CD2345 ----
const PLATE_REGEX = /^[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}$/;

function sanitizePlateInput(inputEl) {
  const cleaned = inputEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (inputEl.value !== cleaned) inputEl.value = cleaned;
}

// ---- Login ----
function initGateLogin() {
  const savedUser = localStorage.getItem('gateUsername');
  if (savedUser) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    document.getElementById('loggedInUserLabel').textContent = savedUser;
    preloadScanModels();
    refreshParkedCount();
  }
}

async function gateLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('gateLoginBtn');
  if (!username || !password) {
    errEl.textContent = 'Please enter both username and password.';
    return;
  }
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Logging in...';
  errEl.textContent = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!data.success) {
      errEl.textContent = data.error || 'Login failed.';
      return;
    }
    localStorage.setItem('gateUsername', data.username);
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    document.getElementById('loggedInUserLabel').textContent = data.username;
    preloadScanModels();
    refreshParkedCount();
  } catch (err) {
    errEl.textContent = 'Could not reach the server — try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function gateLogout() {
  localStorage.removeItem('gateUsername');
  document.getElementById('loginScreen').style.display = 'block';
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}

function openChangePassword() {
  document.getElementById('changePasswordCard').style.display = 'block';
}
function closeChangePassword() {
  document.getElementById('changePasswordCard').style.display = 'none';
  document.getElementById('oldPassword').value = '';
  document.getElementById('newPasswordField').value = '';
  document.getElementById('changePasswordResult').innerHTML = '';
}

async function submitChangePassword() {
  const username = localStorage.getItem('gateUsername');
  const oldPassword = document.getElementById('oldPassword').value;
  const newPassword = document.getElementById('newPasswordField').value;
  const resultEl = document.getElementById('changePasswordResult');
  if (!oldPassword || !newPassword) {
    resultEl.innerHTML = `<div class="result paid">Please fill in both fields.</div>`;
    return;
  }
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, oldPassword, newPassword }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to update password');
    resultEl.innerHTML = `<div class="result sub">Password updated.</div>`;
    setTimeout(closeChangePassword, 1200);
  } catch (err) {
    resultEl.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}

// ---- Display settings (set from the admin dashboard) ----
async function applyDisplaySettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    const s = data.settings || {};
    const padMap = { normal: '18px 16px', large: '22px 18px', xl: '28px 22px' };
    const fontMap = { normal: '18px', large: '20px', xl: '24px' };
    document.documentElement.style.setProperty('--btn-pad', padMap[s.button_size] || padMap.normal);
    document.documentElement.style.setProperty('--btn-font', fontMap[s.button_size] || fontMap.normal);
    document.body.classList.toggle('minimal', s.minimal_mode === 'true');
  } catch (err) {
    console.warn('[settings] using defaults:', err.message);
  }
}

// ---- Camera: OCR plate reading + free on-device AI vehicle-type detection ----
// coco-ssd is a free, client-side object detection model (no API key, no account) —
// it can recognize "car" vs "motorcycle" in the photo, so the type can be auto-filled.
let cocoModel = null;
async function getCocoModel() {
  if (!cocoModel) cocoModel = await cocoSsd.load();
  return cocoModel;
}

function startScan() {
  document.getElementById('cameraInput').click();
}

document.getElementById('cameraInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('ocrStatus');
  statusEl.textContent = '📷 Photo captured. Analyzing...';

  try {
    const imageBitmap = await createImageBitmap(file);

    // Original color canvas — used for AI vehicle-type detection
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = imageBitmap.width;
    colorCanvas.height = imageBitmap.height;
    colorCanvas.getContext('2d').drawImage(imageBitmap, 0, 0);

    // Best-effort vehicle type detection — never blocks the OCR flow if it fails
    try {
      statusEl.textContent = '🚙 Detecting vehicle type...';
      const model = await getCocoModel();
      const predictions = await model.detect(colorCanvas);
      const vehiclePred = predictions
        .filter(p => ['car', 'motorcycle', 'truck', 'bus'].includes(p.class))
        .sort((a, b) => b.score - a.score)[0];
      if (vehiclePred) {
        const detectedType = vehiclePred.class === 'motorcycle' ? 'BIKE' : 'CAR';
        selectType(detectedType);
        statusEl.textContent = `🚙 Detected: ${detectedType === 'BIKE' ? 'Bike' : 'Car'} (${Math.round(vehiclePred.score * 100)}% confidence). `;
      }
    } catch (visionErr) {
      console.warn('[vehicle detection]', visionErr);
    }

    // Preprocess for OCR: grayscale + auto-brightness threshold
    const ocrCanvas = document.createElement('canvas');
    ocrCanvas.width = imageBitmap.width;
    ocrCanvas.height = imageBitmap.height;
    const ctx = ocrCanvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
    const data = imgData.data;

    let totalLuminance = 0;
    for (let i = 0; i < data.length; i += 4) {
      totalLuminance += 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
    }
    const avgLuminance = totalLuminance / (data.length / 4);
    const threshold = avgLuminance * 0.85;

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      const contrasted = gray > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = contrasted;
    }
    ctx.putImageData(imgData, 0, 0);

    statusEl.textContent += ' 🔍 Reading plate text (first scan can take ~30s to load)...';

    const result = await Tesseract.recognize(ocrCanvas, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          statusEl.textContent = `🔍 Reading plate... ${Math.round(m.progress * 100)}%`;
        }
      },
    });

    const rawText = result.data.text || '';
    const cleaned = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (!cleaned) {
      statusEl.textContent = "⚠️ Couldn't read the plate — try again or type it manually below.";
      return;
    }

    document.getElementById('plateInput').value = cleaned;
    statusEl.textContent = `✅ Recognized: "${cleaned}" — please check it's correct before confirming.`;
  } catch (err) {
    console.error('[scan error]', err);
    statusEl.textContent = "⚠️ Scan failed — try again or type the plate manually below.";
  } finally {
    e.target.value = '';
  }
});

// ---- Check-in submit (two-step: compute charge → collect payment choice → save) ----
let lastReceiptText = '';
let lastReceiptData = null;
let pendingCheckIn = null; // holds plate/type while waiting for a payment choice

async function checkIn(skipDuplicateCheck) {
  const plate = document.getElementById('plateInput').value.trim().toUpperCase();
  const attendantName = localStorage.getItem('gateUsername') || 'unknown';
  const resultBox = document.getElementById('resultBox');
  if (!plate) {
    resultBox.innerHTML = `<div class="result paid">Please enter or scan a plate number first.</div>`;
    return;
  }
  if (!PLATE_REGEX.test(plate)) {
    resultBox.innerHTML = `<div class="result paid">Plate must be in format AB01CD2345 (2 letters, 2 digits, 2 letters, 4 digits).</div>`;
    return;
  }
  try {
    const res = await fetch('/api/verify-and-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleNumber: plate, vehicleType: selectedType, attendantName, duplicateConfirmed: !!skipDuplicateCheck }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');

    // Same plate is already checked in and not yet exited — rush-hour mistake guard
    if (data.duplicate) {
      const since = new Date(data.activeEntry.entry_time).toLocaleTimeString('en-IN');
      if (confirm(`${plate} is already checked in (since ${since}) and hasn't exited yet. Check it in again anyway?`)) {
        return checkIn(true);
      }
      return;
    }

    // Non-subscriber vehicle — show the payment popup before saving anything
    if (data.needsPayment) {
      pendingCheckIn = { plate, vehicleType: selectedType, attendantName, amount: data.amount };
      document.getElementById('paymentModalAmount').textContent = `${plate} — Amount: ₹${data.amount}`;
      document.getElementById('paymentModal').style.display = 'block';
      return;
    }

    finishCheckIn(data);
  } catch (err) {
    resultBox.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}

// Called by the Cash / UPI / Collect Later buttons in the payment popup
async function choosePaymentAndCheckIn(choice) {
  if (!pendingCheckIn) return;
  document.getElementById('paymentModal').style.display = 'none';
  const resultBox = document.getElementById('resultBox');
  try {
    const res = await fetch('/api/verify-and-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicleNumber: pendingCheckIn.plate, vehicleType: pendingCheckIn.vehicleType,
        attendantName: pendingCheckIn.attendantName, paymentChoice: choice, duplicateConfirmed: true,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    finishCheckIn(data);
  } catch (err) {
    resultBox.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
  pendingCheckIn = null;
}

function finishCheckIn(data) {
  const resultBox = document.getElementById('resultBox');
  const cls = data.isSubscriber ? 'sub' : 'paid';
  const payLabel = data.isSubscriber ? 'Subscriber — free' : (data.paymentStatus === 'UNPAID' ? 'Payment: Collect Later' : `Payment: ${data.paymentStatus}`);
  lastReceiptText = `LIGANG ALOY PARKING\nVehicle: ${data.vehicleNumber} (${data.vehicleType})\n${data.isSubscriber ? `Subscriber: ${data.subscriberName} - Free entry` : `Charge: Rs ${data.amount} (${data.paymentStatus})`}\nAttendant: ${data.attendantName || 'N/A'}\nTime: ${new Date(data.entryTime).toLocaleString('en-IN')}`;
  lastReceiptData = data;

  resultBox.innerHTML = `<div class="result ${cls}">
    ${data.vehicleNumber} — ${data.isSubscriber ? `Subscriber (${data.subscriberName}) — Free entry` : `Charge: ₹${data.amount}`}
    <div style="font-size:13px; font-weight:600; margin-top:4px;">${payLabel}</div>
    <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
      <button class="secondary" onclick="generateReceiptPDF()">📄 Generate Receipt (PDF)</button>
      <button class="secondary" onclick="shareReceipt()">📤 Share Text</button>
      ${data.entryId ? `<button class="secondary" id="undoBtn-${data.entryId}" onclick="undoEntry(${data.entryId})">↩ Undo</button>` : ''}
    </div>
  </div>`;

  if (data.previousDues > 0) {
    alert(`⚠️ This vehicle has ₹${data.previousDues} in unpaid dues from ${data.previousDuesCount} previous visit(s). Please try to collect if possible.`);
    resultBox.innerHTML = `<div class="result paid" style="border-color:#ef4444; margin-bottom:12px;">⚠️ ₹${data.previousDues} unpaid from ${data.previousDuesCount} earlier visit(s)</div>` + resultBox.innerHTML;
  }

  document.getElementById('plateInput').value = '';
  document.getElementById('ocrStatus').textContent = '';
  document.getElementById('plateInput').focus(); // rush-hour: ready for the next plate immediately
  refreshParkedCount();
}

// Undo a mis-tapped check-in — only works within 2 minutes and before the vehicle exits (enforced server-side)
async function undoEntry(entryId) {
  if (!confirm('Undo this check-in?')) return;
  try {
    const res = await fetch(`/api/entries/${entryId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Could not undo');
    document.getElementById('resultBox').innerHTML = `<div class="result sub">Entry undone.</div>`;
    refreshParkedCount();
  } catch (err) {
    alert(err.message);
  }
}

// ---- Live "currently parked" counter ----
async function refreshParkedCount() {
  try {
    const res = await fetch('/api/summary');
    const data = await res.json();
    const el = document.getElementById('parkedCounter');
    if (!el) return;
    const cap = data.lotCapacity ? ` / ${data.lotCapacity}` : '';
    el.textContent = `🅿️ Currently Parked: ${data.currentlyParked}${cap}`;
    el.style.color = (data.lotCapacity && data.currentlyParked >= data.lotCapacity) ? '#DC2626' : '';
  } catch (err) { /* non-critical */ }
}

// ---- Preload the OCR + AI models right after login, so the ~30s first-load delay
// happens before the rush starts instead of during it ----
function preloadScanModels() {
  getCocoModel().catch(() => {});
  if (window.Tesseract && Tesseract.createWorker) {
    Tesseract.recognize(document.createElement('canvas'), 'eng').catch(() => {});
  }
}

// Fix: previously this built the share text inline inside the onclick HTML attribute,
// and the apostrophe in "TULON'S" broke the attribute so the button silently did nothing.
// Now the text is stored in a variable and the button just calls this with no arguments.
async function shareReceipt() {
  if (!lastReceiptText) return;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Ligang Aloy Parking Receipt", text: lastReceiptText });
      return;
    } catch (err) {
      return; // user cancelled the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(lastReceiptText);
    alert('Receipt copied — you can paste it into a message.');
  } catch (err) {
    alert(lastReceiptText);
  }
}

// Generates a formatted PDF receipt matching the client's paper receipt design, using jsPDF (free, client-side)
async function generateReceiptPDF() {
  if (!lastReceiptData) return;
  const d = lastReceiptData;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: [320, 480] });

  const pageW = 320;
  const receiptNo = String(d.entryId || 0).padStart(6, '0');
  const dateTime = new Date(d.entryTime).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const feeText = d.isSubscriber ? 'FREE (Subscriber)' : `Rs ${d.amount}`;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 31, 61);
  doc.text('LIGANG ALOY PARKING', pageW / 2, 34, { align: 'center' });
  doc.setDrawColor(15, 31, 61);
  doc.setLineWidth(1);
  doc.line(30, 44, pageW - 30, 44);

  doc.setFontSize(9);
  doc.setTextColor(180, 30, 30);
  doc.text(`Receipt No.`, pageW - 32, 20, { align: 'right' });
  doc.setFontSize(11);
  doc.text(receiptNo, pageW - 32, 32, { align: 'right' });

  // Owner (if known — subscriber vehicles have this on file)
  let y = 62;
  doc.setTextColor(15, 31, 61);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Vehicle Owner: ${d.subscriberName || 'Walk-in Customer'}`, 30, y);
  if (d.subscriberPhone) {
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.text(`Phone: ${d.subscriberPhone}`, 30, y);
  }

  y += 20;
  doc.setFillColor(15, 31, 61);
  doc.rect(20, y, pageW - 40, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('PARKING RECEIPT', pageW / 2, y + 16, { align: 'center' });

  y += 44;
  const rows = [
    ['Vehicle No.', d.vehicleNumber],
    ['Vehicle Type', d.vehicleType === 'BIKE' ? 'Bike' : 'Car'],
    ['Date & Time', dateTime],
    ['Parking Fee', feeText],
    ['Attendant', d.attendantName || '-'],
  ];
  doc.setTextColor(15, 31, 61);
  rows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(label, 30, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(value), pageW - 30, y, { align: 'right' });
    doc.setDrawColor(210, 210, 210);
    doc.line(30, y + 6, pageW - 30, y + 6);
    y += 26;
  });

  y += 16;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(11);
  doc.text('Thank You! — Visit Again', pageW / 2, y, { align: 'center' });
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('Drive Safe', pageW / 2, y, { align: 'center' });

  const filename = `Receipt-${receiptNo}-${d.vehicleNumber}.pdf`;

  // Try sharing the actual PDF file (Android Chrome supports this); fall back to a plain download
  try {
    const blob = doc.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (err) { /* fall through to download */ }

  doc.save(filename);
}

// ---- Mark vehicle exit ----
let exitPanelOpen = false;
let pendingExitEntry = null;

async function toggleExitPanel() {
  exitPanelOpen = !exitPanelOpen;
  const panel = document.getElementById('exitPanel');
  panel.style.display = exitPanelOpen ? 'block' : 'none';
  if (exitPanelOpen) await loadActiveVehicles();
}

async function loadActiveVehicles() {
  const statusEl = document.getElementById('exitStatus');
  const listEl = document.getElementById('exitList');
  statusEl.textContent = 'Loading parked vehicles...';
  listEl.innerHTML = '';
  try {
    const res = await fetch('/api/entries/active');
    const data = await res.json();
    if (!data.entries || data.entries.length === 0) {
      statusEl.textContent = 'No vehicles currently parked.';
      return;
    }
    statusEl.textContent = `${data.entries.length} vehicle(s) currently parked. Tap one to check out:`;
    listEl.innerHTML = data.entries.map(e => {
      const paid = e.payment_status && e.payment_status !== 'UNPAID';
      const payBadge = paid ? `<span style="color:#16A34A;">✓ ${e.payment_status}</span>` : `<span style="color:#DC2626;">⚠ Unpaid</span>`;
      const collectBtns = paid ? '' : `
        <div style="margin-top:8px; display:flex; gap:8px;">
          <button class="secondary" onclick='event.stopPropagation(); collectPayment(${e.id}, "CASH")'>💵 Collect Cash</button>
          <button class="secondary" onclick='event.stopPropagation(); collectPayment(${e.id}, "UPI")'>📱 Collect UPI</button>
        </div>`;
      return `<div class="type-btn" style="text-align:left; margin-bottom:8px; cursor:pointer;" onclick='confirmExit(${e.id}, "${e.vehicle_number}", ${paid})'>
        ${e.vehicle_number} — ${e.vehicle_type} — entered ${new Date(e.entry_time).toLocaleTimeString('en-IN')}<br>
        <span style="font-size:13px;">${payBadge}</span>
        ${collectBtns}
      </div>`;
    }).join('');
  } catch (err) {
    statusEl.textContent = 'Could not load parked vehicles — try again.';
  }
}

// Collect payment from a vehicle that's still parked (deferred at entry) — doesn't exit it
async function collectPayment(entryId, method) {
  const statusEl = document.getElementById('exitStatus');
  try {
    const res = await fetch(`/api/entries/${entryId}/collect-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    statusEl.textContent = `✅ Payment collected (${method}).`;
    await loadActiveVehicles();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
}

async function confirmExit(entryId, plate, alreadyPaid) {
  pendingExitEntry = { entryId, plate };
  if (alreadyPaid) {
    // Already paid — no need to ask again, one-tap exit
    if (confirm(`${plate} is already paid. Exit now?`)) {
      await finalizeExit('KEEP');
    }
    return;
  }
  document.getElementById('exitModalPlate').textContent = `Confirm exit for ${plate}:`;
  document.getElementById('exitPaymentModal').style.display = 'block';
}

function cancelExitModal() {
  pendingExitEntry = null;
  document.getElementById('exitPaymentModal').style.display = 'none';
}

async function finalizeExit(method) {
  if (!pendingExitEntry) return;
  const { entryId, plate } = pendingExitEntry;
  // 'KEEP' means don't touch payment status — vehicle was already paid, just exit it (backend leaves it untouched if omitted)
  const paymentStatus = method === 'KEEP' ? null : (method === 'UNPAID' ? 'UNPAID' : `PAID/${method}`);
  const statusEl = document.getElementById('exitStatus');
  try {
    const res = await fetch(`/api/entries/${entryId}/exit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatus }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    statusEl.textContent = method === 'KEEP' ? `✅ ${plate} checked out.` : `✅ ${plate} checked out (${method === 'UNPAID' ? 'payment due' : 'paid via ' + method}).`;
    cancelExitModal();
    await loadActiveVehicles();
    refreshParkedCount();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
}

// ---- Expense logging ----
async function submitExpense() {
  const amount = document.getElementById('expAmount').value;
  const description = document.getElementById('expDesc').value.trim();
  const expenseDate = document.getElementById('expDate').value;
  const attendantName = localStorage.getItem('gateUsername') || 'unknown';
  const resultEl = document.getElementById('expenseResult');

  if (!amount || !description || !expenseDate) {
    resultEl.innerHTML = `<div class="result paid">Please fill in amount, description, and date.</div>`;
    return;
  }
  try {
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: parseFloat(amount), description, expenseDate, attendantName }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    resultEl.innerHTML = `<div class="result sub">Expense logged: ₹${amount} — ${description}</div>`;
    document.getElementById('expAmount').value = '';
    document.getElementById('expDesc').value = '';
  } catch (err) {
    resultEl.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}

// ---- Add Subscriber (from the gate app) ----
let selectedSubType = 'CAR';

function selectSubType(type) {
  selectedSubType = type;
  document.getElementById('subBtnCar').classList.toggle('selected', type === 'CAR');
  document.getElementById('subBtnBike').classList.toggle('selected', type === 'BIKE');
}

let selectedSubMethod = 'CASH';
function selectSubMethod(method) {
  selectedSubMethod = method;
  document.getElementById('subMethodCash').classList.toggle('selected', method === 'CASH');
  document.getElementById('subMethodUpi').classList.toggle('selected', method === 'UPI');
}

async function addSubscriberFromGate() {
  const plateInput = document.getElementById('subPlate');
  sanitizePlateInput(plateInput);
  const vehicleNumber = plateInput.value.trim();
  const ownerName = document.getElementById('subOwner').value.trim();
  const phone = document.getElementById('subPhone').value.trim();
  const subscriptionStart = document.getElementById('subStart').value;
  const subscriptionEnd = document.getElementById('subEnd').value;
  const amountDue = document.getElementById('subAmount').value;
  const errEl = document.getElementById('subPlateError');
  const resultEl = document.getElementById('subResult');
  errEl.textContent = '';

  if (!vehicleNumber || !ownerName || !subscriptionStart || !subscriptionEnd || !amountDue) {
    resultEl.innerHTML = `<div class="result paid">Please fill in plate, owner name, dates, and amount.</div>`;
    return;
  }
  if (!PLATE_REGEX.test(vehicleNumber)) {
    errEl.textContent = 'Format must be AB01CD2345 (2 letters, 2 digits, 2 letters, 4 digits).';
    return;
  }
  try {
    const res = await fetch('/api/subscribers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicleNumber, ownerName, phone, vehicleType: selectedSubType,
        subscriptionStart, subscriptionEnd, amountDue,
        paymentMethod: selectedSubMethod,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    resultEl.innerHTML = `<div class="result sub">Subscriber added. Amount: ₹${data.amountDue} (Paid via ${selectedSubMethod}).</div>`;
    ['subPlate','subOwner','subPhone','subStart','subEnd','subAmount'].forEach(id => document.getElementById(id).value = '');
  } catch (err) {
    resultEl.innerHTML = `<div class="result paid">Error: ${err.message}</div>`;
  }
}
