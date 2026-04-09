const APP_VERSION = '1.1.0';

const KEY_SCHEDULE   = 'ms_schedule';
const KEY_LOG        = 'ms_log';
const KEY_SENSOR     = 'ms_sensor';
const KEY_TEMP_UNIT  = 'ms_tempUnit';
const KEY_URL_LOGS   = 'ms_urlLogs';
const KEY_URL_CTRLS  = 'ms_urlCtrls';
const KEY_NOTIF_DOSE = 'ms_notifDose';
const KEY_NOTIF_MISS = 'ms_notifMiss';
const KEY_SYNC_QUEUE = 'ms_syncQueue';

const SENSOR_POLL_MS = 30000;
const QUEUE_FLUSH_MS = 20000;

let schedule    = JSON.parse(localStorage.getItem(KEY_SCHEDULE) || '[]');
let log         = JSON.parse(localStorage.getItem(KEY_LOG) || '[]');
let sensor      = JSON.parse(localStorage.getItem(KEY_SENSOR) || 'null');
let tempUnit    = localStorage.getItem(KEY_TEMP_UNIT) || 'C';
let editingId   = null;
let deleteTarget = null;
let searchQuery = '';

const $ = id => document.getElementById(id);

function haptic(pattern = [48, 32]) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function toast(msg, duration = 2400) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveScheduleLS() {
  localStorage.setItem(KEY_SCHEDULE, JSON.stringify(schedule));
}

function saveLogLS() {
  localStorage.setItem(KEY_LOG, JSON.stringify(log));
}

function saveSensorLS(data) {
  localStorage.setItem(KEY_SENSOR, JSON.stringify(data));
}

function getLogsUrl()  { return localStorage.getItem(KEY_URL_LOGS)  || ''; }
function getCtrlsUrl() { return localStorage.getItem(KEY_URL_CTRLS) || ''; }

function enqueueLog(entry) {
  const q = JSON.parse(localStorage.getItem(KEY_SYNC_QUEUE) || '[]');
  q.push(entry);
  localStorage.setItem(KEY_SYNC_QUEUE, JSON.stringify(q));
}

async function flushQueue() {
  const url = getLogsUrl();
  if (!url || !navigator.onLine) return;
  const q = JSON.parse(localStorage.getItem(KEY_SYNC_QUEUE) || '[]');
  if (q.length === 0) return;

  const failed = [];
  for (const entry of q) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'appendLog', entry })
      });
    } catch {
      failed.push(entry);
    }
  }
  localStorage.setItem(KEY_SYNC_QUEUE, JSON.stringify(failed));
  if (failed.length === 0 && q.length > 0) {
    updateSyncBadge(true);
  }
}

async function pushSensorToSheet(data) {
  const url = getLogsUrl();
  if (!url || !navigator.onLine) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logSensor', data })
    });
  } catch {}
}

async function fetchSensorFromSheet() {
  const url = getCtrlsUrl();
  if (!url) return null;
  try {
    const res = await fetch(`${url}?action=getSensor&t=${Date.now()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function sendCtrl(payload) {
  const url = getCtrlsUrl();
  if (!url) { toast('Ctrls URL not configured.'); return false; }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch { return false; }
}

function updateSyncBadge(synced) {
  const badge = $('syncStatusBadge');
  if (!badge) return;
  badge.textContent = synced ? 'Synced' : 'Offline';
  badge.className   = 'sync-badge ' + (synced ? 'ok' : 'off');
}

const drum = (() => {
  const ITEM_H  = 44;
  const PADDING = 2;

  function buildCol(el, items, loop = true) {
    const list = document.createElement('div');
    list.className = 'drum-list';

    const render = (data) => {
      list.innerHTML = '';
      if (loop) data.slice(-PADDING).forEach(v => appendItem(list, v));
      data.forEach(v => appendItem(list, v));
      if (loop) data.slice(0, PADDING).forEach(v => appendItem(list, v));
    };

    render(items);
    el.appendChild(list);

    let idx = 0;
    let offset = loop ? PADDING : 0;
    let startY, startTY, isDragging = false;

    function getTranslateY() {
      const m = new WebKitCSSMatrix(list.style.transform || getComputedStyle(list).transform);
      return m.m42;
    }

    function snapTo(i, animated = true) {
      idx = loop ? ((i % items.length) + items.length) % items.length : Math.max(0, Math.min(i, items.length - 1));
      const raw = loop ? i : idx;
      const y   = -(raw + offset) * ITEM_H + (el.clientHeight / 2) - ITEM_H / 2;
      list.style.transition = animated ? 'transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none';
      list.style.transform  = `translateY(${y}px)`;
      updateOpacity();
      if (animated) haptic([8]);
    }

    function updateOpacity() {
      list.querySelectorAll('.drum-item').forEach((item, i) => {
        const dist = Math.abs(i - (idx + offset));
        item.classList.remove('selected', 'near', 'far');
        if (dist === 0)      item.classList.add('selected');
        else if (dist === 1) item.classList.add('near');
        else                 item.classList.add('far');
      });
    }

    function onStart(e) {
      isDragging = true;
      startY  = e.touches ? e.touches[0].clientY : e.clientY;
      startTY = getTranslateY();
      list.style.transition = 'none';
    }

    function onMove(e) {
      if (!isDragging) return;
      e.preventDefault();
      const y  = e.touches ? e.touches[0].clientY : e.clientY;
      list.style.transform = `translateY(${startTY + (y - startY)}px)`;
    }

    function onEnd(e) {
      if (!isDragging) return;
      isDragging = false;
      const y    = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
      snapTo(idx + Math.round(-(y - startY) / ITEM_H));
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove',  onMove,  { passive: false });
    el.addEventListener('touchend',   onEnd);
    el.addEventListener('mousedown',  onStart);
    window.addEventListener('mousemove', e => { if (isDragging) onMove(e); });
    window.addEventListener('mouseup',   e => { if (isDragging) onEnd(e); });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      snapTo(idx + Math.sign(e.deltaY));
    }, { passive: false });

    snapTo(0, false);
    return {
      setIndex(i, animated = false) { snapTo(i, animated); },
      getIndex() { return idx; },
      getValue() { return items[idx]; }
    };
  }

  function appendItem(list, v) {
    const div = document.createElement('div');
    div.className = 'drum-item';
    div.textContent = v;
    list.appendChild(div);
  }

  let hourDrum, minDrum, ampmDrum;

  function init() {
    const hours = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const mins  = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

    $('drumHour').innerHTML = '';
    $('drumMin').innerHTML  = '';
    $('drumAmpm').innerHTML = '';

    hourDrum  = buildCol($('drumHour'), hours, true);
    minDrum   = buildCol($('drumMin'),  mins,  true);
    ampmDrum  = buildCol($('drumAmpm'), ['AM', 'PM'], false);
  }

  function setValue(time24) {
    if (!hourDrum) init();
    const [h, m] = time24.split(':').map(Number);
    hourDrum.setIndex((h % 12 || 12) - 1, false);
    minDrum.setIndex(m, false);
    ampmDrum.setIndex(h >= 12 ? 1 : 0, false);
  }

  function getValue() {
    if (!hourDrum) return '08:00';
    let h  = parseInt(hourDrum.getValue(), 10);
    const m  = parseInt(minDrum.getValue(), 10);
    const pm = ampmDrum.getValue() === 'PM';
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return { init, setValue, getValue };
})();

function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function formatTemp(celsius) {
  if (tempUnit === 'F') return (celsius * 9 / 5 + 32).toFixed(1) + '°F';
  return celsius.toFixed(1) + '°C';
}

function formatTs(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function nav(id) {
  const next = $(id);
  if (!next || next.classList.contains('active')) return;
  haptic([32, 20]);
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  next.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-target="${id}"]`)?.classList.add('active');
  if (id === 'stats') renderStats();
}

function applySensorUI(data) {
  if (!data) return;
  $('sensorTemp').textContent = formatTemp(data.temp);

  const hum = Math.min(100, Math.max(0, Math.round(data.hum)));
  $('sensorHumidLabel').textContent = hum + '%';
  const offset = (251.3 - (251.3 * hum / 100)).toFixed(2);
  $('humidArc').setAttribute('stroke-dashoffset', offset);

  const tag     = $('sensorStatusTag');
  const inRange = data.temp >= 15 && data.temp <= 30;
  tag.innerHTML  = `<span class="material-symbols-rounded">${inRange ? 'check_circle' : 'warning'}</span>
                    <span>${inRange ? 'Within Range' : 'Check Storage'}</span>`;
  tag.className  = `status-pill ${inRange ? 'ok' : 'warn'}`;

  if (data.battery != null) {
    const pct = Math.min(100, Math.max(0, Math.round(data.battery)));
    $('batteryVal').innerHTML = `${pct}<span class="mini-unit">%</span>`;
    $('batteryFill').style.width = pct + '%';
    $('batteryCard').className = 'mini-card ' + (pct <= 20 ? 'battery-low' : pct <= 50 ? 'battery-mid' : 'battery-full');
  }
}

async function refreshSensor() {
  if (sensor) applySensorUI(sensor);

  const data = await fetchSensorFromSheet();
  if (data?.temp != null) {
    sensor = data;
    saveSensorLS(data);
    applySensorUI(data);
    updateSyncBadge(true);
    pushSensorToSheet(data);
  } else {
    updateSyncBadge(false);
  }
}

function openScheduleModal(id) {
  editingId = id || null;
  const s = id ? schedule.find(x => x.id === id) : null;
  $('inputName').value     = s?.name  || '';
  $('inputDose').value     = s?.dose  || '';
  $('inputActive').checked = s?.active ?? true;
  $('modalTitle').textContent = id ? 'Edit Medication' : 'Add Medication';
  drum.init();
  drum.setValue(s?.time || '08:00');
  openSheet('scheduleModal');
}

function closeScheduleModal() {
  closeSheet('scheduleModal');
  editingId = null;
}

function saveSchedule() {
  const name   = $('inputName').value.trim();
  const dose   = $('inputDose').value.trim();
  const time   = drum.getValue();
  const active = $('inputActive').checked;

  if (!name) { haptic([80, 40, 80]); toast('Medication name is required.'); return; }

  if (editingId) {
    const idx = schedule.findIndex(x => x.id === editingId);
    if (idx !== -1) schedule[idx] = { ...schedule[idx], name, dose, time, active };
  } else {
    schedule.push({ id: uid(), name, dose, time, active });
  }

  saveScheduleLS();
  renderHomeSchedule();
  renderScheduleSettings();
  updateNextDoseCard();
  closeScheduleModal();
  toast(editingId ? 'Medication updated.' : 'Medication added.');
  haptic([48, 32]);
}

function openConfirmDelete(id, name) {
  deleteTarget = id;
  $('confirmText').textContent = `Remove "${name}" from your schedule? This cannot be undone.`;
  openSheet('confirmModal');
}

function executeDelete() {
  if (!deleteTarget) return;
  haptic([80, 40]);
  schedule = schedule.filter(x => x.id !== deleteTarget);
  saveScheduleLS();
  closeSheet('confirmModal');
  deleteTarget = null;
  renderHomeSchedule();
  renderScheduleSettings();
  updateNextDoseCard();
  toast('Medication removed.');
}

function markDose(medId, status) {
  const med = schedule.find(s => s.id === medId);
  if (!med) return;

  const existing = log.find(e => e.medId === medId && new Date(e.timestamp).toDateString() === new Date().toDateString());
  if (existing) {
    existing.status    = status;
    existing.timestamp = Date.now();
  } else {
    const entry = { id: uid(), medId, name: med.name, dose: med.dose, status, timestamp: Date.now() };
    log.push(entry);
    enqueueLog(entry);
  }

  saveLogLS();
  renderHomeSchedule();
  if ($('stats').classList.contains('active')) renderStats();
  updateNextDoseCard();
  haptic([48, 32]);
  toast(status === 'taken' ? `${med.name} marked taken` : `${med.name} marked missed.`);
  flushQueue();
}

async function requestNotifPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  await Notification.requestPermission();
}

function sendNotification(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/icon.png' });
  }
  haptic([80, 40, 80]);
}

function checkLocalNotifs() {
  const doseOn  = localStorage.getItem(KEY_NOTIF_DOSE) !== 'false';
  const missOn  = localStorage.getItem(KEY_NOTIF_MISS) !== 'false';
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const todayLog = getTodayLog();

  schedule.filter(s => s.active).forEach(s => {
    const [h, m] = s.time.split(':').map(Number);
    const scheduledMins = h * 60 + m;

    if (doseOn && nowMins === scheduledMins && !todayLog[s.id]) {
      sendNotification('Time for your medicine!', `${s.name} · ${s.dose}`);
    }
    if (missOn && nowMins === scheduledMins + 10 && !todayLog[s.id]) {
      sendNotification('Missed dose!', `${s.name} was due 10 min ago.`);
    }
  });
}

async function refreshAll() {
  const btn = $('refreshBtn');
  btn?.classList.add('spinning');
  haptic([32]);
  await refreshSensor();
  await flushQueue();
  renderHomeSchedule();
  if ($('stats').classList.contains('active')) renderStats();
  btn?.classList.remove('spinning');
  toast('Synced!');
}

function getTodayLog() {
  const ds  = new Date().toDateString();
  const map = {};
  log.forEach(e => { if (new Date(e.timestamp).toDateString() === ds) map[e.medId] = e.status; });
  return map;
}

function getItemStatus(s, todayLog) {
  if (todayLog[s.id]) return todayLog[s.id];
  const [h, m] = s.time.split(':').map(Number);
  const now    = new Date().getHours() * 60 + new Date().getMinutes();
  return h * 60 + m < now ? 'pending' : 'upcoming';
}

function updateNextDoseCard() {
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const upcoming = schedule
    .filter(s => s.active)
    .map(s => { const [h, m] = s.time.split(':').map(Number); return { ...s, mins: h * 60 + m }; })
    .filter(s => s.mins > nowMins)
    .sort((a, b) => a.mins - b.mins);

  $('nextDoseTime').textContent = upcoming.length ? formatTime(upcoming[0].time) : '--:--';
  $('nextDoseSub').textContent  = upcoming.length ? `${upcoming[0].name} · ${upcoming[0].dose}` : 'No more doses today';
}

function renderHomeSchedule() {
  const list     = $('pillList');
  const todayLog = getTodayLog();

  let items = schedule
    .filter(s => s.active)
    .map(s => {
      const [h, m] = s.time.split(':').map(Number);
      return { ...s, mins: h * 60 + m, status: getItemStatus(s, todayLog) };
    })
    .sort((a, b) => a.mins - b.mins);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter(s => s.name.toLowerCase().includes(q) || s.dose.toLowerCase().includes(q));
  }

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <span class="material-symbols-rounded">medication</span>
      <p>${searchQuery ? 'No matches found.' : 'No schedule yet. Add a medication.'}</p>
    </div>`;
    return;
  }

  const iconMap  = { taken: 'check_circle', missed: 'cancel', pending: 'hourglass_top', upcoming: 'schedule' };
  const labelMap = { taken: 'Taken', missed: 'Missed', pending: 'Pending', upcoming: 'Upcoming' };

  list.innerHTML = items.map(s => `
    <div class="pill-item ${s.status}" data-id="${s.id}">
      <div class="pill-icon-wrap">
        <span class="material-symbols-rounded">${iconMap[s.status] || 'schedule'}</span>
      </div>
      <div class="pill-content">
        <div class="pill-name">${s.name}</div>
        <div class="pill-meta">${formatTime(s.time)} · ${s.dose}</div>
      </div>
      <div class="pill-actions">
        ${s.status !== 'taken'  ? `<button class="pill-action-btn take"  data-id="${s.id}" title="Mark taken"><span class="material-symbols-rounded">check</span></button>` : ''}
        ${s.status !== 'missed' ? `<button class="pill-action-btn miss"  data-id="${s.id}" title="Mark missed"><span class="material-symbols-rounded">close</span></button>` : ''}
        <span class="pill-badge">${labelMap[s.status] || 'Upcoming'}</span>
      </div>
    </div>`).join('');

  list.querySelectorAll('.pill-action-btn.take').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); markDose(btn.dataset.id, 'taken'); })
  );
  list.querySelectorAll('.pill-action-btn.miss').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); markDose(btn.dataset.id, 'missed'); })
  );
}

function renderScheduleSettings() {
  const list = $('scheduleList');
  if (schedule.length === 0) {
    list.innerHTML = `<div class="empty-state compact">
      <span class="material-symbols-rounded">medication</span><p>No medications added yet.</p></div>`;
    return;
  }
  list.innerHTML = schedule.map(s => `
    <div class="pref-row" style="cursor:default;">
      <div class="pref-info">
        <h4>${s.name} · ${s.dose}</h4>
        <p>${formatTime(s.time)} · ${s.active ? 'Active' : 'Paused'}</p>
      </div>
      <div class="sched-row-actions">
        <button class="action-icon edit" data-edit="${s.id}"><span class="material-symbols-rounded">edit</span></button>
        <button class="action-icon del"  data-del="${s.id}" data-name="${s.name}"><span class="material-symbols-rounded">delete</span></button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.action-icon.edit').forEach(btn =>
    btn.addEventListener('click', () => { haptic([32]); openScheduleModal(btn.dataset.edit); })
  );
  list.querySelectorAll('.action-icon.del').forEach(btn =>
    btn.addEventListener('click', () => { haptic([32]); openConfirmDelete(btn.dataset.del, btn.dataset.name); })
  );
}

function renderStats() {
  renderBarChart();
  renderAdherence();
  renderStreakChips();
  renderLogList();
}

function renderBarChart() {
  const chart = $('barChart');
  if (!chart) return;
  const days   = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const today  = new Date();
  const counts = [];
  const isTod  = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    counts.push(log.filter(e => new Date(e.timestamp).toDateString() === d.toDateString() && e.status === 'taken').length);
    isTod.push(i === 6);
  }

  const max = Math.max(...counts, 1);
  chart.innerHTML = '';

  days.forEach((d, i) => {
    const col   = document.createElement('div'); col.className = 'bar-col';
    const bar   = document.createElement('div'); bar.className = 'bar' + (isTod[i] ? ' today' : ''); bar.style.height = '4px';
    const label = document.createElement('div'); label.className = 'bar-day'; label.textContent = d;
    col.append(bar, label);
    chart.appendChild(col);
    const target = Math.round((counts[i] / max) * 80) || 4;
    requestAnimationFrame(() => setTimeout(() => { bar.style.height = target + 'px'; }, 60 + i * 55));
  });
}

function renderAdherence() {
  const total = log.length;
  const taken = log.filter(e => e.status === 'taken').length;
  const rate  = total > 0 ? Math.round((taken / total) * 100) : 0;
  $('adherenceRate').innerHTML = `${rate}<em>%</em>`;
  setTimeout(() => { $('adherenceFill').style.width = rate + '%'; }, 120);
}

function renderStreakChips() {
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (log.some(e => new Date(e.timestamp).toDateString() === d.toDateString() && e.status === 'taken')) streak++;
    else break;
  }
  $('chipStreak').textContent = streak;
  $('chipTaken').textContent  = log.filter(e => e.status === 'taken').length;
  $('chipMissed').textContent = log.filter(e => e.status === 'missed').length;
}

function renderLogList() {
  const container = $('logList');
  const recent    = [...log].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  if (recent.length === 0) {
    container.innerHTML = `<div class="empty-state compact"><span class="material-symbols-rounded">history</span><p>No log entries yet.</p></div>`;
    return;
  }
  container.innerHTML = recent.map(e => `
    <div class="log-item">
      <div class="log-dot ${e.status}"></div>
      <span class="log-name">${e.name || e.medId}</span>
      <span class="log-ts">${formatTs(e.timestamp)}</span>
    </div>`).join('');
}

async function dispenseNow(medId) {
  const med = schedule.find(s => s.id === medId);
  if (!med) return;
  haptic([48, 32]);
  const ok = await sendCtrl({ action: 'dispense', medId, name: med.name, dose: med.dose });
  toast(ok ? `Dispense requested: ${med.name}` : 'Ctrls URL not set or offline.');
}

function openSheet(id)  { $(id).classList.add('open'); haptic([32]); }
function closeSheet(id) { $(id).classList.remove('open'); }

function openTempUnitModal() {
  document.querySelectorAll('.choice-item').forEach(item =>
    item.classList.toggle('selected', item.dataset.unit === tempUnit)
  );
  openSheet('tempUnitModal');
}

function setTempUnit(unit) {
  tempUnit = unit;
  localStorage.setItem(KEY_TEMP_UNIT, unit);
  $('tempUnitLabel').textContent = unit === 'C' ? 'Celsius (°C)' : 'Fahrenheit (°F)';
  document.querySelectorAll('.choice-item').forEach(item =>
    item.classList.toggle('selected', item.dataset.unit === unit)
  );
  closeSheet('tempUnitModal');
  haptic([32]);
  if (sensor) applySensorUI(sensor);
}

function updateUrlPreviews() {
  const logsUrl  = getLogsUrl();
  const ctrlsUrl = getCtrlsUrl();

  const logsEl  = $('logsUrlPreview');
  const ctrlsEl = $('ctrlsUrlPreview');

  function preview(el, url) {
    if (!el) return;
    if (!url) { el.textContent = 'Not configured'; el.style.color = 'var(--danger)'; return; }
    try { el.textContent = new URL(url).hostname + '/…'; el.style.color = ''; }
    catch { el.textContent = 'Invalid URL'; el.style.color = 'var(--danger)'; }
  }

  preview(logsEl, logsUrl);
  preview(ctrlsEl, ctrlsUrl);
}

function openApiConfigModal() {
  $('inputLogsUrl').value  = getLogsUrl();
  $('inputCtrlsUrl').value = getCtrlsUrl();
  openSheet('apiConfigModal');
}

function saveApiConfig() {
  const logsRaw  = $('inputLogsUrl').value.trim();
  const ctrlsRaw = $('inputCtrlsUrl').value.trim();

  if (!logsRaw && !ctrlsRaw) { toast('At least one URL is required.'); haptic([80,40,80]); return; }
  if (logsRaw)  try { new URL(logsRaw);  } catch { toast('Logs URL invalid.'); haptic([80,40,80]); return; }
  if (ctrlsRaw) try { new URL(ctrlsRaw); } catch { toast('Ctrls URL invalid.'); haptic([80,40,80]); return; }

  if (logsRaw)  localStorage.setItem(KEY_URL_LOGS,  logsRaw);
  if (ctrlsRaw) localStorage.setItem(KEY_URL_CTRLS, ctrlsRaw);

  updateUrlPreviews();
  closeSheet('apiConfigModal');
  toast('URLs saved.');
  haptic([48, 32]);
  refreshSensor();
}

function clearLog() {
  haptic([80, 40, 80]);
  log = [];
  saveLogLS();
  localStorage.removeItem(KEY_SYNC_QUEUE);
  renderHomeSchedule();
  if ($('stats').classList.contains('active')) renderStats();
  toast('Log cleared.');
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.nav-item').forEach(item =>
    item.addEventListener('click', () => nav(item.dataset.target))
  );

  $('refreshBtn')?.addEventListener('click', refreshAll);
  $('devBtn')?.addEventListener('click', () => { haptic([32]); window.open('https://github.com/zenlixir', '_blank'); });
  $('addMedBtn')?.addEventListener('click', () => { haptic([32]); openScheduleModal(null); });
  $('addMedBtnSettings')?.addEventListener('click', () => { haptic([32]); openScheduleModal(null); });
  $('modalSaveBtn')?.addEventListener('click', saveSchedule);
  $('modalCancelBtn')?.addEventListener('click', closeScheduleModal);
  $('modalCloseBtn')?.addEventListener('click', closeScheduleModal);
  $('confirmDeleteBtn')?.addEventListener('click', () => { closeSheet('confirmModal'); executeDelete(); });
  $('confirmCancelBtn')?.addEventListener('click', () => closeSheet('confirmModal'));
  $('tempUnitRow')?.addEventListener('click', openTempUnitModal);
  $('apiConfigRow')?.addEventListener('click', openApiConfigModal);
  $('apiConfigSaveBtn')?.addEventListener('click', saveApiConfig);
  $('apiConfigCancelBtn')?.addEventListener('click', () => closeSheet('apiConfigModal'));
  $('apiConfigCloseBtn')?.addEventListener('click', () => closeSheet('apiConfigModal'));

  $('clearLogRow')?.addEventListener('click', () => {
    haptic([48, 32]);
    $('confirmText').textContent = 'Remove all dose log history? This cannot be undone.';
    $('confirmDeleteBtn').onclick = () => { closeSheet('confirmModal'); clearLog(); };
    openSheet('confirmModal');
  });

  document.querySelectorAll('[data-toggle]').forEach(row =>
    row.addEventListener('click', () => {
      haptic([32]);
      const tog = row.querySelector('.toggle');
      tog?.classList.toggle('on');
      const key = tog?.id === 'toggleDoseReminder' ? KEY_NOTIF_DOSE : KEY_NOTIF_MISS;
      localStorage.setItem(key, tog?.classList.contains('on') ? 'true' : 'false');
    })
  );

  document.querySelectorAll('.choice-item').forEach(item =>
    item.addEventListener('click', () => setTempUnit(item.dataset.unit))
  );

  document.querySelectorAll('.backdrop').forEach(b =>
    b.addEventListener('click', e => {
      if (e.target === b) {
        haptic([20]);
        b.classList.remove('open');
        if (b.id === 'scheduleModal') editingId = null;
        if (b.id === 'confirmModal')  deleteTarget = null;
      }
    })
  );

  const searchInput = $('searchInput');
  const searchClear = $('searchClear');
  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    searchClear.classList.toggle('visible', searchQuery.length > 0);
    renderHomeSchedule();
  });
  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.classList.remove('visible');
    renderHomeSchedule();
    searchInput.blur();
    haptic([20]);
  });

  const doseOn = localStorage.getItem(KEY_NOTIF_DOSE) !== 'false';
  const missOn = localStorage.getItem(KEY_NOTIF_MISS) !== 'false';
  $('toggleDoseReminder')?.classList.toggle('on', doseOn);
  $('toggleMissedAlert')?.classList.toggle('on', missOn);
  $('tempUnitLabel').textContent = tempUnit === 'C' ? 'Celsius (°C)' : 'Fahrenheit (°F)';
  updateUrlPreviews();
  updateSyncBadge(navigator.onLine);

  await requestNotifPermission();

  renderHomeSchedule();
  renderScheduleSettings();
  updateNextDoseCard();
  if (sensor) applySensorUI(sensor);

  await refreshSensor();
  await flushQueue();

  setInterval(refreshSensor,    SENSOR_POLL_MS);
  setInterval(flushQueue,       QUEUE_FLUSH_MS);
  setInterval(checkLocalNotifs, 60000);

  window.addEventListener('online',  () => { updateSyncBadge(false); flushQueue(); });
  window.addEventListener('offline', () => updateSyncBadge(false));
});