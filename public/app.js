const els = {
  whoopBtn: document.getElementById('whoopBtn'),
  whoopBtnLabel: document.getElementById('whoopBtnLabel'),

  consumedValue: document.getElementById('consumedValue'),
  netValue: document.getElementById('netValue'),
  netLabel: document.getElementById('netLabel'),
  burnedValue: document.getElementById('burnedValue'),
  gaugeFill: document.getElementById('gaugeFill'),
  gaugeBurnMarker: document.getElementById('gaugeBurnMarker'),
  gaugeCaption: document.getElementById('gaugeCaption'),

  captureStage: document.getElementById('captureStage'),
  stageEmpty: document.getElementById('stageEmpty'),
  video: document.getElementById('video'),
  canvas: document.getElementById('canvas'),
  preview: document.getElementById('preview'),

  startCameraBtn: document.getElementById('startCameraBtn'),
  fileInput: document.getElementById('fileInput'),
  shootBtn: document.getElementById('shootBtn'),
  retakeBtn: document.getElementById('retakeBtn'),
  analyzeBtn: document.getElementById('analyzeBtn'),

  analysisStatus: document.getElementById('analysisStatus'),
  analysisResult: document.getElementById('analysisResult'),
  resultConfidence: document.getElementById('resultConfidence'),
  resultItems: document.getElementById('resultItems'),
  resultNote: document.getElementById('resultNote'),
  totalInput: document.getElementById('totalInput'),
  discardBtn: document.getElementById('discardBtn'),
  addToLogBtn: document.getElementById('addToLogBtn'),

  logList: document.getElementById('logList'),
  logEmpty: document.getElementById('logEmpty'),
  logTotal: document.getElementById('logTotal'),
};

let mediaStream = null;
let capturedBlob = null;
let lastAnalysis = null;
let state = { consumed: 0, burned: null };

// ---------------- Whoop ----------------

async function refreshWhoopStatus() {
  const res = await fetch('/api/whoop/status');
  const { connected } = await res.json();
  els.whoopBtn.dataset.connected = String(connected);
  els.whoopBtnLabel.textContent = connected ? 'Whoop connected' : 'Connect Whoop';

  if (connected) {
    await refreshWhoopToday();
  } else {
    state.burned = null;
    els.gaugeCaption.textContent = 'Connect Whoop to see today\u2019s burn.';
    render();
  }
}

async function refreshWhoopToday() {
  try {
    const res = await fetch('/api/whoop/today');
    if (res.status === 401) {
      state.burned = null;
      els.gaugeCaption.textContent = 'Whoop session expired \u2014 reconnect to see today\u2019s burn.';
      render();
      return;
    }
    const data = await res.json();
    if (data.calories_burned == null) {
      state.burned = null;
      els.gaugeCaption.textContent = data.note || 'Whoop hasn\u2019t scored today\u2019s cycle yet.';
    } else {
      state.burned = data.calories_burned;
      els.gaugeCaption.textContent = `From today\u2019s Whoop cycle (strain ${data.strain?.toFixed(1) ?? '\u2014'})`;
    }
    render();
  } catch (e) {
    console.error(e);
  }
}

els.whoopBtn.addEventListener('click', () => {
  if (els.whoopBtn.dataset.connected === 'true') {
    if (confirm('Disconnect Whoop?')) {
      fetch('/api/whoop/disconnect', { method: 'POST' }).then(refreshWhoopStatus);
    }
  } else {
    window.location.href = '/auth/whoop';
  }
});

// ---------------- Gauge rendering ----------------

function render() {
  els.consumedValue.textContent = state.consumed;

  if (state.burned == null) {
    els.burnedValue.textContent = '\u2014';
    els.netValue.textContent = '\u2014';
    els.netLabel.textContent = 'net';
    els.netValue.style.color = 'var(--text)';
    els.gaugeBurnMarker.classList.remove('visible');

    const scaleMax = Math.max(state.consumed * 1.3, 500);
    const pct = Math.min((state.consumed / scaleMax) * 100, 100);
    els.gaugeFill.style.width = pct + '%';
    els.gaugeFill.classList.remove('over');
    return;
  }

  const net = state.burned - state.consumed;
  els.burnedValue.textContent = state.burned;
  els.netValue.textContent = (net >= 0 ? '' : '\u2212') + Math.abs(net);
  els.netLabel.textContent = net >= 0 ? 'remaining' : 'over';
  els.netValue.style.color = net >= 0 ? 'var(--green)' : 'var(--rust)';

  const scaleMax = Math.max(state.burned, state.consumed) * 1.15 || 500;
  const burnPct = (state.burned / scaleMax) * 100;
  const consumedPct = Math.min((state.consumed / scaleMax) * 100, 100);

  els.gaugeBurnMarker.classList.add('visible');
  els.gaugeBurnMarker.style.left = burnPct + '%';
  els.gaugeFill.style.width = consumedPct + '%';
  els.gaugeFill.classList.toggle('over', state.consumed > state.burned);
}

// ---------------- Camera / capture ----------------

function showStage(mode) {
  // mode: 'empty' | 'video' | 'preview'
  els.stageEmpty.hidden = mode !== 'empty';
  els.video.hidden = mode !== 'video';
  els.preview.hidden = mode !== 'preview';
  els.shootBtn.hidden = mode !== 'video';
  els.retakeBtn.hidden = mode !== 'preview';
  els.analyzeBtn.hidden = mode !== 'preview';
  els.startCameraBtn.hidden = mode !== 'empty';
  els.fileInput.closest('label').hidden = mode !== 'empty';
}

els.startCameraBtn.addEventListener('click', async () => {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    els.video.srcObject = mediaStream;
    showStage('video');
  } catch (e) {
    els.analysisStatus.hidden = false;
    els.analysisStatus.textContent = 'Could not access camera. Try uploading a photo instead.';
  }
});

els.shootBtn.addEventListener('click', () => {
  const w = els.video.videoWidth, h = els.video.videoHeight;
  els.canvas.width = w;
  els.canvas.height = h;
  els.canvas.getContext('2d').drawImage(els.video, 0, 0, w, h);
  els.canvas.toBlob(blob => {
    capturedBlob = blob;
    els.preview.src = URL.createObjectURL(blob);
    stopCamera();
    showStage('preview');
  }, 'image/jpeg', 0.9);
});

els.retakeBtn.addEventListener('click', () => {
  capturedBlob = null;
  hideAnalysis();
  showStage('empty');
});

els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files[0];
  if (!file) return;
  capturedBlob = file;
  els.preview.src = URL.createObjectURL(file);
  showStage('preview');
  els.fileInput.value = '';
});

function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
}

// ---------------- Analysis ----------------

els.analyzeBtn.addEventListener('click', async () => {
  if (!capturedBlob) return;
  hideAnalysis();
  els.analysisStatus.hidden = false;
  els.analysisStatus.textContent = 'Looking at your photo\u2026';
  els.analyzeBtn.disabled = true;

  try {
    const form = new FormData();
    form.append('photo', capturedBlob, 'meal.jpg');
    const res = await fetch('/api/analyze-food', { method: 'POST', body: form });
    if (!res.ok) throw new Error('analysis_failed');
    const data = await res.json();
    lastAnalysis = data;
    renderAnalysis(data);
  } catch (e) {
    els.analysisStatus.textContent = 'Couldn\u2019t analyze that photo. Try again, or enter calories manually below.';
    lastAnalysis = { items: [], total_calories: 0, confidence: 'low', note: '' };
    renderAnalysis(lastAnalysis);
  } finally {
    els.analyzeBtn.disabled = false;
  }
});

function renderAnalysis(data) {
  els.analysisStatus.hidden = true;
  els.resultConfidence.textContent = `Confidence: ${data.confidence || 'unknown'}`;
  els.resultItems.innerHTML = '';
  (data.items || []).forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="item-name">${escapeHtml(item.name)}${item.portion ? ` <span class="item-portion">\u00b7 ${escapeHtml(item.portion)}</span>` : ''}</span>
      <span class="item-cal">${item.calories} kcal</span>
    `;
    els.resultItems.appendChild(li);
  });
  els.resultNote.textContent = data.note || '';
  els.totalInput.value = data.total_calories || 0;
  els.analysisResult.hidden = false;
}

function hideAnalysis() {
  els.analysisResult.hidden = true;
  els.analysisStatus.hidden = true;
  lastAnalysis = null;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

els.discardBtn.addEventListener('click', () => {
  capturedBlob = null;
  hideAnalysis();
  showStage('empty');
});

els.addToLogBtn.addEventListener('click', async () => {
  const calories = parseInt(els.totalInput.value, 10);
  if (!Number.isFinite(calories) || calories < 0) return;

  const name = (lastAnalysis?.items || []).map(i => i.name).join(', ') || 'Logged meal';

  els.addToLogBtn.disabled = true;
  try {
    await fetch('/api/food-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        calories,
        confidence: lastAnalysis?.confidence,
        note: lastAnalysis?.note
      })
    });
    capturedBlob = null;
    hideAnalysis();
    showStage('empty');
    await refreshLog();
  } finally {
    els.addToLogBtn.disabled = false;
  }
});

// ---------------- Today's log ----------------

async function refreshLog() {
  const res = await fetch('/api/food-log/today');
  const data = await res.json();
  state.consumed = data.total_calories;
  els.logTotal.textContent = `${data.total_calories} kcal`;

  els.logList.innerHTML = '';
  if (data.entries.length === 0) {
    els.logList.appendChild(els.logEmpty);
  } else {
    data.entries.forEach(entry => {
      const li = document.createElement('li');
      const time = new Date(entry.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      li.innerHTML = `
        <div class="log-entry-main">
          <span class="log-entry-name">${escapeHtml(entry.name)}</span>
          <span class="log-entry-time">${time}</span>
        </div>
        <div class="log-entry-right">
          <span class="log-entry-cal mono">${entry.calories}</span>
          <button class="log-entry-delete" aria-label="Delete entry" data-id="${entry.id}">\u2715</button>
        </div>
      `;
      els.logList.appendChild(li);
    });
  }
  render();
}

els.logList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.log-entry-delete');
  if (!btn) return;
  await fetch(`/api/food-log/${btn.dataset.id}`, { method: 'DELETE' });
  await refreshLog();
});

// --------------- View Toggle ----------------

const viewBtns = document.querySelectorAll('.view-btn');
const logViews = document.querySelectorAll('.log-view');

viewBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;

    viewBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    logViews.forEach(v => v.classList.add('hidden'));
    document.getElementById(`${view}View`).classList.remove('hidden');
  });
});

// --------------- Quick Add Drinks ----------------

const drinkMenu = {
  'water': { name: 'Water', calories: 0 },
  'coffee': { name: 'Coffee', calories: 5 },
  'tea': { name: 'Tea', calories: 2 },
  'orange-juice': { name: 'Orange juice', calories: 110 },
  'cola': { name: 'Cola', calories: 140 },
  'beer': { name: 'Beer', calories: 150 },
  'wine': { name: 'Wine', calories: 125 },
  'milk': { name: 'Milk', calories: 150 },
  'smoothie': { name: 'Smoothie', calories: 200 },
  'coffee-latte': { name: 'Coffee Latte', calories: 190 }
};

const drinkSelect = document.getElementById('drinkSelect');
const drinkQty = document.getElementById('drinkQty');
const addDrinkBtn = document.getElementById('addDrinkBtn');

addDrinkBtn.addEventListener('click', async () => {
  if (!drinkSelect.value) {
    alert('Please select a drink');
    return;
  }

  const drink = drinkMenu[drinkSelect.value];
  const qty = parseInt(drinkQty.value) || 1;
  const totalCals = drink.calories * qty;
  const name = qty > 1 ? `${drink.name} x${qty}` : drink.name;

  try {
    const res = await fetch('/api/food-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        calories: totalCals,
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
      })
    });

    if (res.ok) {
      drinkSelect.value = '';
      drinkQty.value = '1';
      await refreshLog();
    }
  } catch (e) {
    console.error('Error adding drink:', e);
  }
});

// --------------- Edit Log Entry ----------------

function makeEntryEditable(li, entry) {
  const nameEl = li.querySelector('.log-entry-name');
  const calEl = li.querySelector('.log-entry-cal');
  const deleteBtn = li.querySelector('.log-entry-delete');

  const originalName = nameEl.textContent;
  const originalCal = parseInt(calEl.textContent);

  // Create input elements instead of using contentEditable to prevent XSS
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = originalName;
  nameInput.className = 'entry-edit-input';
  nameInput.style.maxWidth = '200px';

  const calInput = document.createElement('input');
  calInput.type = 'number';
  calInput.value = originalCal;
  calInput.className = 'entry-edit-input';
  calInput.min = '0';
  calInput.max = '100000';
  calInput.style.maxWidth = '80px';

  nameEl.replaceWith(nameInput);
  calEl.replaceWith(calInput);
  nameInput.focus();

  const saveEdit = async () => {
    const newName = nameInput.value.trim() || originalName;
    const newCal = parseInt(nameInput.value);

    // Validate input
    if (newName.length === 0 || newName.length > 500) {
      alert('Name must be between 1 and 500 characters');
      return;
    }

    const calValue = parseInt(calInput.value);
    if (isNaN(calValue) || calValue < 0 || calValue > 100000) {
      alert('Calories must be between 0 and 100000');
      return;
    }

    try {
      const res = await fetch(`/api/food-log/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          calories: calValue
        })
      });

      if (!res.ok) {
        throw new Error(`Update failed: ${res.status}`);
      }

      await refreshLog();
    } catch (e) {
      console.error('Error updating entry:', e);
      alert('Could not save changes');
      // Restore original elements
      nameInput.replaceWith(nameEl);
      calInput.replaceWith(calEl);
    }
  };

  nameInput.addEventListener('blur', saveEdit);
  calInput.addEventListener('blur', saveEdit);

  const handleKeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      nameInput.replaceWith(nameEl);
      calInput.replaceWith(calEl);
    }
  };

  nameInput.addEventListener('keydown', handleKeydown);
  calInput.addEventListener('keydown', handleKeydown);
}

// Make entries editable on click
document.addEventListener('click', (e) => {
  const entry = e.target.closest('.log-list li:not(.log-empty)');
  if (!entry || e.target.closest('.log-entry-delete')) return;

  const entryId = entry.querySelector('.log-entry-delete').dataset.id;
  const logItems = JSON.parse(localStorage.getItem('logItems') || '[]');
  const entryData = logItems.find(item => item.id == entryId);

  if (entryData) {
    makeEntryEditable(entry, entryData);
  }
});

// Store log items in localStorage
function getAllLogs() {
  const logs = JSON.parse(localStorage.getItem('logItems') || '[]');
  return logs.reduce((acc, log) => {
    const date = log.day || todayStr();
    if (!acc[date]) acc[date] = [];
    acc[date].push(log);
    return acc;
  }, {});
}

if (!localStorage.getItem('logItems')) {
  localStorage.setItem('logItems', JSON.stringify([]));
}

// --------------- Calendar View ----------------

let calendarCurrentMonth = new Date();

function getDaysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function getFirstDayOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const monthTitle = document.getElementById('calendarMonth');
  const month = calendarCurrentMonth.getMonth();
  const year = calendarCurrentMonth.getFullYear();

  monthTitle.textContent = calendarCurrentMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });

  grid.innerHTML = '';

  // Day headers
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dayNames.forEach(day => {
    const header = document.createElement('div');
    header.className = 'calendar-day-header';
    header.textContent = day;
    grid.appendChild(header);
  });

  // Empty cells for previous month
  const firstDay = getFirstDayOfMonth(calendarCurrentMonth);
  for (let i = 0; i < firstDay; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day other-month';
    cell.textContent = '';
    grid.appendChild(cell);
  }

  // Days of month
  const daysInMonth = getDaysInMonth(calendarCurrentMonth);
  const allLogs = getAllLogs();
  const today = new Date();

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'calendar-day';

    const logs = allLogs[dateStr] || [];
    let circle = null;

    if (logs.length > 0) {
      const total = logs.reduce((sum, log) => sum + (log.calories || 0), 0);
      const burned = state.burned || 2000; // default estimate
      const percentage = (total / burned) * 100;

      circle = document.createElement('div');
      circle.className = 'calendar-circle';

      // Color based on percentage
      if (percentage < 34) {
        circle.classList.add('circle-deficit');
      } else if (percentage >= 34 && percentage <= 66) {
        circle.classList.add('circle-balanced');
      } else {
        circle.classList.add('circle-surplus');
      }

      circle.textContent = day;
      cell.appendChild(circle);
    } else {
      cell.textContent = day;
    }

    // Highlight today
    if (dateStr === todayStr()) {
      if (circle) {
        circle.classList.add('today');
      } else {
        cell.classList.add('today');
      }
    }

    cell.addEventListener('click', () => showSelectedDate(dateStr, logs));
    grid.appendChild(cell);
  }
}

function showSelectedDate(dateStr, logs) {
  const info = document.getElementById('selectedDateInfo');
  const title = document.getElementById('selectedDateTitle');
  const balance = document.getElementById('selectedDateBalance');
  const logsList = document.getElementById('selectedDateLogs');

  const date = new Date(dateStr + 'T00:00:00');
  title.textContent = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  const total = logs.reduce((sum, log) => sum + (log.calories || 0), 0);
  const burned = state.burned || 2000;
  const net = burned - total;

  balance.textContent = `In: ${total} kcal | Out: ~${burned} kcal | Net: ${net >= 0 ? '+' : ''}${net}`;
  balance.style.color = net >= 0 ? 'var(--green)' : 'var(--rust)';

  logsList.innerHTML = '';
  if (logs.length === 0) {
    logsList.innerHTML = '<li class="log-empty">No logs for this day</li>';
  } else {
    logs.forEach(log => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="log-entry-main">
          <div class="log-entry-name">${escapeHtml(log.name || 'Unnamed')}</div>
          <div class="log-entry-time">${log.time || ''}</div>
        </div>
        <div class="log-entry-right">
          <span class="log-entry-cal mono">${log.calories || 0}</span>
        </div>
      `;
      logsList.appendChild(li);
    });
  }

  info.hidden = false;
}

document.getElementById('prevMonth').addEventListener('click', () => {
  calendarCurrentMonth.setMonth(calendarCurrentMonth.getMonth() - 1);
  renderCalendar();
});

document.getElementById('nextMonth').addEventListener('click', () => {
  calendarCurrentMonth.setMonth(calendarCurrentMonth.getMonth() + 1);
  renderCalendar();
});

// --------------- Theme Toggle ----------------

const themeToggle = document.getElementById('themeToggle');
const htmlElement = document.documentElement;

// Get saved theme preference or use system preference
function initTheme() {
  const saved = localStorage.getItem('theme');

  if (saved) {
    // Use saved preference
    htmlElement.setAttribute('data-theme', saved);
  } else {
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      htmlElement.setAttribute('data-theme', 'dark');
    } else {
      htmlElement.setAttribute('data-theme', 'light');
    }
  }
  updateThemeIcon();
}

function updateThemeIcon() {
  const currentTheme = htmlElement.getAttribute('data-theme');
  if (currentTheme === 'dark') {
    themeToggle.title = 'Switch to light mode';
  } else {
    themeToggle.title = 'Switch to dark mode';
  }
}

themeToggle.addEventListener('click', () => {
  const current = htmlElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';

  htmlElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon();
});

// Listen for system theme changes
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // Only apply if user hasn't saved a preference
    if (!localStorage.getItem('theme')) {
      const theme = e.matches ? 'dark' : 'light';
      htmlElement.setAttribute('data-theme', theme);
      updateThemeIcon();
    }
  });
}

// --------------- Init ----------------

(async function init() {
  initTheme();

  const params = new URLSearchParams(window.location.search);
  if (params.get('whoop_connected')) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  await refreshLog();
  await refreshWhoopStatus();
})();
