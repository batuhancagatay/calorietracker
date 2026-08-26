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

// ---------------- Init ----------------

(async function init() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('whoop_connected')) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  await refreshLog();
  await refreshWhoopStatus();
})();
