'use strict';

/* =========================================================
   Tontechnikplan – reine Browser-App, Daten in localStorage
   ========================================================= */

const STORAGE_KEY = 'tontechnikplan:v1';
const VIEW_KEY = 'tontechnikplan:view';
const ME_KEY = 'tontechnikplan:me';
const TOKEN_KEY = 'tontechnikplan:token';
const THEME_KEY = 'tontechnikplan:theme';

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Die Farbwerte stehen in styles.css (--c-…), damit der Dark Mode sie anpassen kann
const COLORS = [
  { key: 'none', label: 'Weiß' },
  { key: 'blau', label: 'Blau (Sonntag)' },
  { key: 'gelb', label: 'Gelb (Russisch)' },
  { key: 'orange', label: 'Orange (Hochzeit)' },
  { key: 'gruen', label: 'Grün' },
  { key: 'rosa', label: 'Rosa' },
  { key: 'lila', label: 'Lila' },
  { key: 'grau', label: 'Grau' },
].map(c => ({ ...c, bg: `var(--c-${c.key})` }));
const colorBg = key => (COLORS.find(c => c.key === key) || COLORS[0]).bg;

const QUICK_EVENTS = [
  { title: 'Hochzeit', slots: 2, color: 'orange' },
  { title: 'Erntedank', slots: 2, color: 'blau' },
  { title: 'Taufe', slots: 2, color: 'blau' },
  { title: 'Beerdigung', slots: 2, color: 'grau' },
  { title: 'Jugendstunde', slots: 1, color: 'none' },
  { title: 'Konzert', slots: 2, color: 'gruen' },
  { title: 'Weihnachten', slots: 2, color: 'blau' },
  { title: 'Gemeindestunde', slots: 1, color: 'blau' },
];

const DEFAULT_SETTINGS = {
  title: 'Technikerdienst',
  col1: 'Studio',
  col2: 'Mischpult',
  note: 'Bitte die Anlage um XX:35 Uhr schon hochfahren um zu testen.',
  weekSplit: 'afterSunday',
  singleMode: 'merged',
  showYear: false,
};

/* ---------- Hilfsfunktionen ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad = n => String(n).padStart(2, '0');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isoDate = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`; // m: 0-basiert
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const weekdayOf = s => parseDate(s).getDay();
const fmtShort = s => { const d = parseDate(s); return `${d.getDate()}.${d.getMonth() + 1}.`; };
const monthPrefix = (y, m) => `${y}-${pad(m + 1)}-`;
const isRussisch = e => /russisch/i.test(e.title || '');
const roleOf = (e, i) => (e.slots === 1 ? 'single' : i === 0 ? 'studio' : 'mischpult');
const canRole = (p, role) => (role === 'studio' ? p.studio : p.mischpult);
const isAbsent = (p, date) => (p.absences || []).some(a => a.from && date >= a.from && date <= (a.to || a.from));
const ruleApplies = (r, e) => Number(r.weekday) === weekdayOf(e.date) && (!r.time || r.time === e.time) && (!r.month || e.date.startsWith(r.month + '-'));
const blockingRule = (p, e) => (p.rules || []).find(r => ruleApplies(r, e));

// Grund, warum eine Person für einen Termin nicht verfügbar ist ('' = verfügbar)
function unavailableReason(p, e) {
  if (!e || !e.date) return '';
  if (e.declined && e.declined.includes(p.id)) return 'hat abgesagt';
  if (isAbsent(p, e.date)) return 'abwesend';
  const r = blockingRule(p, e);
  if (r) return `kann nicht ${r.time ? WD[r.weekday] + ' ' + r.time : WD_LONG[r.weekday].toLowerCase() + 's'}`;
  return '';
}

function describeRule(r) {
  const when = `${WD_LONG[r.weekday].toLowerCase()}s${r.time ? ' um ' + r.time : ''}`;
  return `kann nicht ${when}`;
}
function describeRuleScope(r) {
  if (!r.month) return 'jeden Monat';
  const [y, m] = r.month.split('-').map(Number);
  return `nur ${MONTHS[m - 1]} ${y}`;
}

// Wochen-Schlüssel für die Leerzeilen. 1.1.1970 war ein Donnerstag.
function weekKey(date, mode) {
  const n = dayNum(date);
  return mode === 'beforeSunday' ? Math.floor((n + 4) / 7) : Math.floor((n + 3) / 7);
}

/* ---------- Ausgangsdaten: Personen und Regeltermine (ohne Termine) ---------- */
function defaultTemplates() {
  return [
    { id: uid(), weekday: 3, time: '19:00', title: 'Bibelstunde', slots: 1, color: 'none', weeks: [] },
    { id: uid(), weekday: 6, time: '19:00', title: 'Gebetsstunde', slots: 2, color: 'none', weeks: [] },
    { id: uid(), weekday: 0, time: '10:00', title: 'Gottesdienst', slots: 2, color: 'blau', weeks: [] },
    { id: uid(), weekday: 0, time: '17:00', title: 'Abendmahl', slots: 1, color: 'blau', weeks: ['1'] },
    { id: uid(), weekday: 0, time: '17:00', title: 'Russisch', slots: 1, color: 'gelb', weeks: ['3'] },
    { id: uid(), weekday: 0, time: '17:00', title: 'Gemeindestunde', slots: 1, color: 'blau', weeks: ['last'] },
  ];
}

function seedState() {
  const people = [
    ['jk', 'J.Koop'], ['mw', 'M.Weber'], ['sk', 'S.Klassen'], ['dn', 'D.Neumann'],
    ['mk', 'M.Koop'], ['vg', 'V.Gorin', true], ['pk', 'P.Koop'], ['dk', 'D.Kazancev', true],
  ].map(([id, name, ru]) => ({ id, name, active: true, studio: true, mischpult: true, russisch: !!ru, absences: [], rules: [] }));

  return { version: 2, settings: { ...DEFAULT_SETTINGS }, people, templates: defaultTemplates(), events: [], log: [] };
}

/* ---------- Zustand & Speicherung ---------- */
function normalize(s) {
  if (!s || !Array.isArray(s.people) || !Array.isArray(s.events)) throw new Error('Ungültige Daten');
  s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  s.people = s.people.map(p => {
    const q = { active: true, studio: true, mischpult: true, russisch: false, ...p, id: p.id || uid() };
    q.absences = (p.absences || []).map(a => ({ ...a, id: a.id || uid() }));
    q.rules = (p.rules || []).map(r => ({ time: '', month: '', ...r, weekday: Number(r.weekday), id: r.id || uid() }));
    return q;
  });
  s.templates = Array.isArray(s.templates) ? s.templates.map(t => ({ slots: 2, color: 'none', weeks: [], ...t, id: t.id || uid() })) : defaultTemplates();
  // Version 1 enthielt nur Beispielpläne (Aug.–Nov. 2026): diese einmalig entfernen
  if (!(s.version >= 2)) { s.events = []; s.log = []; s.version = 2; }
  delete s.notices;
  s.log = Array.isArray(s.log) ? s.log.filter(l => l && l.text) : [];
  s.events = s.events.map(e => {
    const slots = e.slots === 1 ? 1 : 2;
    const people = Array.from({ length: slots }, (_, i) => (e.people && e.people[i]) || null);
    return { color: 'none', title: '', time: '19:00', ...e, id: e.id || uid(), slots, people };
  });
  return s;
}

function emptyState() {
  return { version: 2, settings: { ...DEFAULT_SETTINGS }, people: [], templates: defaultTemplates(), events: [], log: [] };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (err) {
    console.warn('Gespeicherte Daten konnten nicht gelesen werden:', err);
  }
  // Auf einem Webserver erst den Plan vom Server abwarten statt kurz die Beispieldaten zu zeigen
  if (location.protocol !== 'file:') return emptyState();
  return seedState();
}

function cacheLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    if (!server.enabled) toast('Speichern im Browser fehlgeschlagen – bitte eine Sicherung exportieren.');
  }
}

function save() {
  cacheLocal();
  if (!server.enabled) return;
  server.dirty = true;
  setSync('saving');
  clearTimeout(server.timer);
  server.timer = setTimeout(pushNow, 400);
}

const hadCache = (() => { try { return !!localStorage.getItem(STORAGE_KEY); } catch (err) { return false; } })();
let state = loadState();
const view = loadView();
const undoStack = [];
const ui = { mode: 'view', page: 'plan', me: loadMe(), pendingAction: null, editSnapshot: null, statsRange: '3m', statsFuture: false };

function loadMe() {
  try { return localStorage.getItem(ME_KEY) || ''; } catch (err) { return ''; }
}

/* ---------- Darstellung (Light / Dark Mode, pro Gerät) ---------- */
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const theme = loadTheme();

function loadTheme() {
  let t = {};
  try { t = JSON.parse(localStorage.getItem(THEME_KEY) || '{}') || {}; } catch (err) { /* ignorieren */ }
  return { mode: ['light', 'dark'].includes(t.mode) ? t.mode : 'auto', sheet: t.sheet === 'dark' ? 'dark' : 'light' };
}

function applyTheme() {
  const dark = theme.mode === 'dark' || (theme.mode === 'auto' && !!darkQuery?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.sheet = theme.sheet;
  setRadio('themeMode', theme.mode);
  $('#themeSheetLight').checked = theme.sheet === 'light';
  $('#themeSheetLight').disabled = !dark;
}

function setTheme(patch) {
  Object.assign(theme, patch);
  try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch (err) { /* ignorieren */ }
  applyTheme();
}

/* ---------- Server-Speicherung (api.php) ----------
   Ohne Server (Datei direkt geöffnet) bleibt alles im Browser gespeichert. */
const server = {
  enabled: false,
  checked: false,
  missing: false,
  token: (() => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (err) { return ''; } })(),
  rev: 0,
  updatedAt: null,
  dirty: false,
  timer: null,
  saving: null,
  status: 'local',
};

function storeToken(token) {
  server.token = token;
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignorieren */ }
}

async function api(action, { method = 'GET', body = null, params = '' } = {}) {
  const headers = {};
  if (server.token) headers['X-Auth-Token'] = server.token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`api.php?action=${action}${params}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let data = null;
  try { data = await res.json(); } catch (err) { /* keine JSON-Antwort */ }
  if (res.status === 401 && action !== 'login' && server.token) {
    storeToken('');
    if (ui.mode === 'edit') setMode('view');
  }
  return { status: res.status, ok: res.ok, data };
}

async function initServer() {
  try {
    if (location.protocol === 'file:') throw new Error('lokal geöffnet');
    const info = await api('info');
    if (!info.ok || !info.data || !info.data.ok) throw new Error('kein Server');
    server.enabled = true;
  } catch (err) {
    if (!state.people.length) state = seedState();
    server.checked = true;
    setSync('local');
    render();
    return;
  }
  await loadFromServer();
  setInterval(checkForUpdates, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdates(); });
  window.addEventListener('online', () => { if (server.dirty) pushNow(); else checkForUpdates(); });
}

async function loadFromServer() {
  try {
    const r = await api('load');
    if (!r.ok || !r.data) throw new Error('Laden fehlgeschlagen');
    if (!r.data.data) {
      // Noch kein Plan auf dem Server: mit den Ausgangsdaten starten, die erste Anmeldung lädt sie hoch
      server.missing = true;
      if (!state.people.length) { state = seedState(); cacheLocal(); }
      if (server.token) pushNow();
    } else if (!server.dirty) {
      adoptRemote(r.data);
    }
    setSync('online');
  } catch (err) {
    console.error(err);
    if (!state.people.length) state = seedState();
    setSync('error');
  }
  server.checked = true;
  render();
}

function adoptRemote(file) {
  server.rev = file.rev || 0;
  server.updatedAt = file.updatedAt ? new Date(file.updatedAt) : null;
  server.missing = false;
  if (JSON.stringify(file.data) === JSON.stringify(state)) return;
  try {
    state = normalize(file.data);
    undoStack.length = 0;
    cacheLocal();
    fillSettings();
  } catch (err) {
    console.error('Plan vom Server konnte nicht gelesen werden:', err);
  }
}

async function checkForUpdates() {
  if (!server.enabled || server.dirty || document.hidden) return;
  try {
    const r = await api('rev');
    if (r.ok && r.data && r.data.rev !== server.rev) {
      const l = await api('load');
      if (l.ok && l.data && l.data.data && !server.dirty) { adoptRemote(l.data); render(); }
    }
    setSync('online');
  } catch (err) {
    setSync('error');
  }
}

// Speichern nacheinander ausführen; liefert true, wenn der aktuelle Stand gespeichert ist
function pushNow() {
  clearTimeout(server.timer);
  if (!server.enabled || !server.token) return Promise.resolve(false);
  server.saving = (server.saving || Promise.resolve()).then(doPush, doPush);
  return server.saving;
}

async function doPush() {
  if (!server.dirty && !server.missing) return true;
  const json = JSON.stringify(state);
  setSync('saving');
  try {
    const r = await api('save', { method: 'POST', body: { baseRev: server.rev, data: json } });
    if (r.status === 409 && r.data) {
      server.dirty = false;
      adoptRemote(r.data);
      render();
      setSync('online');
      toast('Jemand anderes hat den Plan gerade geändert. Der neueste Stand wurde geladen – bitte deine letzte Änderung wiederholen.');
      return false;
    }
    if (r.status === 401) {
      setSync('error');
      toast('Die Anmeldung ist abgelaufen – bitte über „Bearbeiten“ neu anmelden.');
      return false;
    }
    if (!r.ok || !r.data) throw new Error((r.data && r.data.error) || `Fehler ${r.status}`);
    server.rev = r.data.rev;
    server.updatedAt = new Date(r.data.updatedAt);
    server.missing = false;
    if (JSON.stringify(state) === json) server.dirty = false;
    setSync(server.dirty ? 'saving' : 'online');
    return !server.dirty;
  } catch (err) {
    console.error(err);
    setSync('error');
    toast('Speichern auf dem Server fehlgeschlagen. Bitte Internetverbindung prüfen.');
    return false;
  }
}

async function login(password) {
  const r = await api('login', { method: 'POST', body: { password } });
  if (!r.ok || !r.data || !r.data.token) throw new Error((r.data && r.data.error) || 'Anmeldung fehlgeschlagen');
  storeToken(r.data.token);
  if (server.missing) pushNow();
}

function logout() {
  storeToken('');
  setMode('view');
  toast('Auf diesem Gerät abgemeldet');
}

const fmtDateTime = d => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;

function setSync(status) {
  server.status = status;
  const el = $('#syncInfo');
  if (!el) return;
  const labels = {
    local: ['Nur auf diesem Gerät', 'Kein Server gefunden (api.php) – der Plan bleibt in diesem Browser'],
    connecting: ['Lädt …', ''],
    online: ['Aktuell', 'Alle sehen denselben Plan'],
    saving: ['Speichert …', ''],
    error: ['Keine Verbindung', 'Der Plan konnte nicht vom Server geladen oder gespeichert werden'],
  };
  const [text, title] = labels[status] || labels.local;
  el.textContent = text;
  el.title = title;
  el.className = 'sync ' + status;
  renderLastUpdate();
}

function renderLastUpdate() {
  const el = $('#lastUpdate');
  if (!el) return;
  el.textContent = server.enabled
    ? (server.updatedAt ? `Stand: ${fmtDateTime(server.updatedAt)}` : '')
    : (server.checked ? 'Hinweis: Der Plan ist nur auf diesem Gerät gespeichert.' : '');
}

function renderServerInfo() {
  const el = $('#cloudInfo');
  if (!el) return;
  el.textContent = server.enabled
    ? 'Der Plan wird auf eurem Server gespeichert – alle sehen sofort denselben Stand.'
    : 'Kein Server gefunden – der Plan wird nur in diesem Browser gespeichert. Für den gemeinsamen Plan die Seite mit api.php auf einen Webserver mit PHP legen (siehe README).';
  $('#logoutRow').hidden = !(server.enabled && server.token);
}

/* ---------- Modus ---------- */
function setMode(mode) {
  ui.mode = mode === 'edit' ? 'edit' : 'view';
  document.body.classList.toggle('mode-edit', ui.mode === 'edit');
  document.body.classList.toggle('mode-view', ui.mode === 'view');
  if (ui.mode === 'edit') fillSettings();
  render();
}

// Führt eine Aktion aus, für die Schreibrechte nötig sind (ggf. nach Passwort-Abfrage)
function requireEdit(action) {
  if (!server.enabled || server.token) { action(); return; }
  ui.pendingAction = action;
  $('#loginPw').value = '';
  $('#loginErr').textContent = '';
  $('#loginDialog').showModal();
  $('#loginPw').focus();
}

async function submitLogin(ev) {
  ev.preventDefault();
  const pw = $('#loginPw').value;
  if (!pw) { $('#loginPw').focus(); return; }
  $('#loginSubmit').disabled = true;
  $('#loginErr').textContent = '';
  try {
    await login(pw);
    const action = ui.pendingAction;
    $('#loginDialog').close();
    if (action) action();
  } catch (err) {
    $('#loginErr').textContent = err.message || 'Anmeldung fehlgeschlagen.';
    $('#loginPw').select();
  } finally {
    $('#loginSubmit').disabled = false;
  }
}

function loadView() {
  const now = new Date();
  if (state.events.some(e => e.date.startsWith(monthPrefix(now.getFullYear(), now.getMonth())))) {
    return { y: now.getFullYear(), m: now.getMonth(), highlight: null };
  }
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if (v && Number.isInteger(v.y) && Number.isInteger(v.m)) return { y: v.y, m: v.m, highlight: null };
  } catch (err) { /* ignorieren */ }
  // Standard: der neueste Monat mit Terminen, sonst der aktuelle Monat
  const latest = state.events.map(e => e.date).sort().pop();
  const d = latest ? parseDate(latest) : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { y: d.getFullYear(), m: d.getMonth(), highlight: null };
}

function saveView() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ y: view.y, m: view.m })); } catch (err) { /* ignorieren */ }
}

function mutate(fn, msg) {
  if (server.enabled && !server.token) { toast('Zum Ändern bitte zuerst über „Bearbeiten“ anmelden.'); return; }
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 50) undoStack.shift();
  fn();
  save();
  render();
  if (msg) toast(msg);
}

function undo() {
  if (!undoStack.length) { toast('Nichts zum Rückgängigmachen'); return; }
  state = normalize(JSON.parse(undoStack.pop()));
  save();
  render();
  fillSettings();
  toast('Rückgängig gemacht');
}

/* ---------- Abfragen ---------- */
const personById = id => state.people.find(p => p.id === id);
const personName = id => (id ? (personById(id)?.name ?? '??') : '??');
const sortedPeople = () => [...state.people].sort((a, b) => a.name.localeCompare(b.name, 'de'));
const sortEvents = list => list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

function monthEvents(y = view.y, m = view.m) {
  const prefix = monthPrefix(y, m);
  return sortEvents(state.events.filter(e => e.date.startsWith(prefix)));
}

function eventIssues(e) {
  const issues = [];
  e.people.forEach((pid, i) => {
    const role = roleOf(e, i);
    const label = role === 'studio' ? state.settings.col1 : role === 'mischpult' ? state.settings.col2 : 'Person';
    if (!pid) { issues.push({ slot: i, level: 'error', msg: `${label} ist noch nicht besetzt` }); return; }
    const p = personById(pid);
    if (!p) { issues.push({ slot: i, level: 'error', msg: `${label}: Person existiert nicht mehr` }); return; }
    if (e.declined && e.declined.includes(pid)) issues.push({ slot: i, level: 'error', msg: `${p.name} hat für diesen Termin abgesagt` });
    else if (isAbsent(p, e.date)) issues.push({ slot: i, level: 'error', msg: `${p.name} ist an diesem Tag abwesend` });
    else if (blockingRule(p, e)) issues.push({ slot: i, level: 'error', msg: `${p.name} ${describeRule(blockingRule(p, e))} (${describeRuleScope(blockingRule(p, e))})` });
    if (!p.active) issues.push({ slot: i, level: 'warn', msg: `${p.name} ist als inaktiv markiert` });
    if (isRussisch(e) && !p.russisch) issues.push({ slot: i, level: 'warn', msg: `${p.name} ist nicht für Russisch-Dienste eingetragen` });
    if (!canRole(p, role)) issues.push({ slot: i, level: 'warn', msg: `${p.name} ist nicht für „${label}“ eingetragen` });
    if (e.people.indexOf(pid) !== i) issues.push({ slot: i, level: 'error', msg: `${p.name} ist doppelt in diesem Termin eingeteilt` });
  });
  return issues;
}

function personWarnSuffix(p, e, role) {
  if (!e) return '';
  const reason = unavailableReason(p, e);
  if (reason) return ` – ${reason}`;
  if (isRussisch(e) && !p.russisch) return ' ⚠';
  if (!canRole(p, role)) return ' ⚠';
  return '';
}

function personOptions(selected, e, role, { inSheet = false } = {}) {
  let html = `<option value=""${selected ? '' : ' selected'}>${inSheet ? '??' : '– offen –'}</option>`;
  for (const p of sortedPeople()) {
    if (!p.active && p.id !== selected) continue;
    const suffix = inSheet ? '' : personWarnSuffix(p, e, role);
    html += `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.name)}${suffix}</option>`;
  }
  return html;
}

/* ---------- Rendering: Plan ---------- */
function render() {
  document.body.classList.toggle('page-stats', ui.page === 'stats');
  $('#statsBtn').textContent = ui.page === 'stats' ? '← Zum Plan' : '📊 Statistik';
  renderMine();
  renderChangeLog();
  renderStats();
  renderLastUpdate();
  renderServerInfo();
  renderMonthNav();
  renderSheet();
  renderWarnings();
  renderPeople();
  renderRules();
  renderTemplates();
}

function renderMonthNav() {
  const monthSel = $('#monthSel');
  if (!monthSel.options.length) monthSel.innerHTML = MONTHS.map((n, i) => `<option value="${i}">${n}</option>`).join('');
  monthSel.value = String(view.m);

  const nowY = new Date().getFullYear();
  const years = new Set([nowY - 1, nowY, nowY + 1, nowY + 2, view.y]);
  state.events.forEach(e => years.add(Number(e.date.slice(0, 4))));
  $('#yearSel').innerHTML = [...years].sort().map(y => `<option value="${y}"${y === view.y ? ' selected' : ''}>${y}</option>`).join('');
}

const CHANGE_MARK_MS = 14 * 864e5;
const isEditing = () => ui.mode === 'edit';

function personCell(e, i, colspan) {
  const pid = e.people[i];
  const cls = ['person'];
  const hl = isEditing() ? view.highlight : ui.me;
  if (hl && pid === hl) cls.push('hl');
  const changedAt = e.changed && e.changed[i];
  const changed = changedAt && Date.now() - changedAt < CHANGE_MARK_MS;
  const span = colspan ? ` colspan="${colspan}"` : '';

  if (!isEditing()) {
    cls.push('ro');
    if (changed) cls.push('changed');
    const title = changed ? ` title="Geändert am ${fmtDateTime(new Date(changedAt))}"` : '';
    return `<td class="${cls.join(' ')}"${span}${title}>${pid ? esc(personName(pid)) : '<span class="unset-text">??</span>'}</td>`;
  }

  const issues = eventIssues(e).filter(x => x.slot === i);
  if (issues.length) cls.push('issue');
  const title = issues.map(x => x.msg).join('\n');
  return `<td class="${cls.join(' ')}"${span}${title ? ` title="${esc(title)}"` : ''}>` +
    `<select class="pick${pid ? '' : ' unset'}" data-ev="${e.id}" data-slot="${i}" aria-label="${esc(e.title)} ${fmtShort(e.date)} ${e.time}">${personOptions(pid, e, roleOf(e, i), { inSheet: true })}</select>` +
    `<span class="print-only">${esc(personName(pid))}</span></td>`;
}

// Zeilen des Plans inkl. Leerzeilen zwischen den Wochen
function sheetRows(evs) {
  const mode = state.settings.weekSplit;
  const rows = [];
  let prevWeek = null;
  for (const e of evs) {
    if (mode !== 'none') {
      const wk = weekKey(e.date, mode);
      if (prevWeek !== null && wk !== prevWeek) rows.push({ type: 'spacer' });
      prevWeek = wk;
    }
    rows.push({ type: 'ev', e });
  }
  return rows;
}

function renderSheet() {
  const s = state.settings;
  const evs = monthEvents();
  const editing = isEditing();
  let rows = '';

  for (const r of sheetRows(evs)) {
    if (r.type === 'spacer') { rows += '<tr class="spacer"><td></td><td></td><td></td><td></td><td></td><td></td></tr>'; continue; }
    const e = r.e;
    const d = parseDate(e.date);
    let persons;
    if (e.slots === 1) {
      persons = s.singleMode === 'col2' ? '<td></td>' + personCell(e, 0) : personCell(e, 0, 2);
    } else {
      persons = personCell(e, 0) + personCell(e, 1);
    }
    const click = editing ? ` click" data-edit="${e.id}` : '';
    rows += `<tr class="ev" style="background:${colorBg(e.color)}" data-id="${e.id}">` +
      `<td class="day${click}">${d.getDate()}</td>` +
      `<td class="wd${click}">${WD[d.getDay()]}</td>` +
      `<td class="time${click}">${esc(e.time)}</td>` +
      persons +
      `<td class="bem${click}">${esc(e.title)}` +
      (editing
        ? `<span class="row-actions"><button type="button" data-edit="${e.id}" title="Bearbeiten" aria-label="Bearbeiten">✎</button>` +
          `<button type="button" class="del" data-del="${e.id}" title="Löschen" aria-label="Löschen">✕</button></span>`
        : '') +
      `</td></tr>`;
  }

  if (!evs.length) {
    const loading = !server.checked && !state.people.length;
    rows = `<tr class="empty-row no-print"><td colspan="6">` + (loading
      ? 'Plan wird geladen …'
      : editing
        ? `Für ${MONTHS[view.m]} ${view.y} gibt es noch keine Termine.<br>` +
          `<button type="button" class="btn btn-primary" data-action="randomPlan">🎲 Zufallsplan erstellen</button>` +
          `<button type="button" class="btn" data-action="genRegular">Nur Regeltermine einfügen</button>` +
          `<button type="button" class="btn" data-action="addEvent">+ Ereignis</button>`
        : `Für ${MONTHS[view.m]} ${view.y} gibt es noch keinen Plan.`) +
      `</td></tr>`;
  }

  $('#sheet').innerHTML =
    `<h1 class="sheet-title">${esc(s.title)} ${MONTHS[view.m]}${s.showYear ? ' ' + view.y : ''}</h1>` +
    `<table class="plan">` +
    `<colgroup><col style="width:38px"><col style="width:40px"><col style="width:74px"><col style="width:148px"><col style="width:148px"><col style="width:190px"></colgroup>` +
    `<thead><tr><th colspan="2">Datum</th><th>Zeit</th><th>${esc(s.col1)}</th><th>${esc(s.col2)}</th><th>Bemerkung</th></tr>` +
    `<tr class="note"><td colspan="6">${esc(s.note)}</td></tr></thead>` +
    `<tbody>${rows}</tbody></table>`;

  // Statuszeile
  const open = evs.reduce((n, e) => n + e.people.filter(p => !p).length, 0);
  $('#statusInfo').innerHTML = evs.length
    ? `${evs.length} Termine · ${open ? `<span class="open">${open} offen</span>` : '<span class="ok">alle Plätze besetzt</span>'}`
    : '';
  $('#undoBtn').disabled = !undoStack.length;
}

/* ---------- Änderungen für die Gruppe ---------- */
const eventLabel = e => `${WD[weekdayOf(e.date)]} ${fmtShort(e.date)} ${e.time} ${e.title}`;
const roleLabel = (e, i) => (e.slots === 1 ? 'allein' : i === 0 ? state.settings.col1 : state.settings.col2);
const calendarUrl = pid => new URL(`api.php?action=ics&person=${encodeURIComponent(pid)}`, location.href).href;
const whoName = pid => (pid ? personName(pid) : '??');
const peopleText = e => (e.slots === 1 ? whoName(e.people[0]) : `${whoName(e.people[0])} / ${whoName(e.people[1])}`);

function todayIso() {
  const d = new Date();
  return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
}

// Text zum Einfügen in die Gruppe
function changeMessage(lines) {
  return '🔄 Änderung im Technikerdienst\n' + lines.map(l => (lines.length > 1 ? '• ' : '') + l).join('\n');
}

function addLog(text) {
  state.log.unshift({ id: uid(), at: Date.now(), text });
  state.log = state.log.slice(0, 100);
}

function showChangeText(title, intro, text) {
  $('#changeTitle').textContent = title;
  $('#changeIntro').textContent = intro;
  $('#changeText').value = text;
  $('#changeDialog').showModal();
  $('#changeCopy').focus();
}

// Was hat sich seit Beginn der Bearbeitung an bereits geplanten Terminen geändert?
function describeEditChanges(before) {
  const today = todayIso();
  const knownMonths = new Set([...before.values()].map(e => e.date.slice(0, 7)));
  const lines = [];
  const add = (date, time, text) => lines.push({ key: date + time, text });

  for (const [id, old] of before) {
    const e = state.events.find(x => x.id === id);
    if (!e) {
      if (old.date >= today) add(old.date, old.time, `${eventLabel(old)} fällt weg`);
      continue;
    }
    if (e.date < today && old.date < today) continue;
    if (e.date !== old.date || e.time !== old.time) {
      add(e.date, e.time, `${eventLabel(old)} wird verlegt auf ${WD[weekdayOf(e.date)]} ${fmtShort(e.date)} ${e.time}`);
    }
    if (e.slots !== old.slots) {
      if (peopleText(e) !== peopleText(old)) add(e.date, e.time, `${eventLabel(e)}: jetzt ${peopleText(e)} (vorher ${peopleText(old)})`);
      continue;
    }
    e.people.forEach((pid, i) => {
      const was = old.people[i] || null;
      if ((pid || null) === was) return;
      const label = `${eventLabel(e)} (${roleLabel(e, i)})`;
      if (pid && was) add(e.date, e.time, `${label}: ${whoName(pid)} statt ${whoName(was)}`);
      else if (pid) add(e.date, e.time, `${label}: ${whoName(pid)} übernimmt`);
      else add(e.date, e.time, `${label}: ${whoName(was)} fällt aus – Platz noch offen`);
    });
  }
  // Neue Einzeltermine in Monaten, die schon geplant waren (ganz neue Monate zählen nicht als Änderung)
  for (const e of state.events) {
    if (before.has(e.id) || e.date < today || !knownMonths.has(e.date.slice(0, 7))) continue;
    add(e.date, e.time, `Neu: ${eventLabel(e)} – ${peopleText(e)}`);
  }
  return lines.sort((x, y) => x.key.localeCompare(y.key)).map(l => l.text);
}

function startEditing() {
  ui.editSnapshot = new Map(state.events.map(e => [e.id, JSON.parse(JSON.stringify(e))]));
  setMode('edit');
}

function finishEditing() {
  const lines = ui.editSnapshot ? describeEditChanges(ui.editSnapshot) : [];
  ui.editSnapshot = null;
  if (lines.length) {
    const text = changeMessage(lines);
    mutate(() => addLog(text));
    setMode('view');
    showChangeText('Änderungen für die Gruppe',
      `Du hast ${lines.length === 1 ? 'eine Änderung' : lines.length + ' Änderungen'} an bereits geplanten Diensten gemacht. Bitte kurz in die Gruppe schreiben:`, text);
    return;
  }
  if (server.dirty) pushNow();
  setMode('view');
}

/* ---------- Rendering: "Wann bin ich dran?" ---------- */
function renderMine() {
  const sel = $('#meSel');
  const me = ui.me && personById(ui.me) ? ui.me : '';
  sel.innerHTML = `<option value="">– Namen auswählen –</option>` +
    sortedPeople().filter(p => p.active || p.id === me)
      .map(p => `<option value="${esc(p.id)}"${p.id === me ? ' selected' : ''}>${esc(p.name)}</option>`).join('');

  if (!me) {
    $('#myCal').innerHTML = '';
    $('#myDuties').innerHTML = '<p class="hint">Wähle deinen Namen, dann siehst du deine nächsten Dienste und sie werden im Plan blau umrandet.</p>';
    return;
  }

  $('#myCal').innerHTML = server.enabled
    ? `<a class="btn btn-sm" href="${esc(calendarUrl(me).replace(/^https?:/, 'webcal:'))}">📅 Dienste im Handy-Kalender abonnieren</a>` +
      `<button type="button" class="link-btn" data-copycal="${esc(me)}">Kalender-Link kopieren</button>`
    : '';

  const s = state.settings;
  const list = sortEvents(state.events.filter(e => e.date >= todayIso() && e.people.includes(me))).slice(0, 12);
  const inMonth = monthEvents().filter(e => e.people.includes(me)).length;
  const items = list.map(e => {
    const d = parseDate(e.date);
    const i = e.people.indexOf(me);
    const role = e.slots === 1 ? 'allein' : i === 0 ? s.col1 : s.col2;
    const partner = e.slots === 2 && e.people[1 - i] ? ` · mit ${personName(e.people[1 - i])}` : '';
    return `<li class="duty">` +
      `<div class="duty-date" style="--row:${colorBg(e.color)}" data-goto="${e.date}" title="Monat anzeigen"><b>${d.getDate()}</b><span>${WD[d.getDay()]}</span><small>${MONTHS[d.getMonth()].slice(0, 3)}</small></div>` +
      `<div class="duty-main"><strong>${esc(e.time)} · ${esc(e.title)}</strong><span>${esc(role)}${esc(partner)}</span></div>` +
      `<button type="button" class="btn btn-sm btn-ghost" data-cancel="${e.id}" title="Absagen – es wird automatisch ein Ersatz gesucht">Kann nicht</button></li>`;
  });
  $('#myDuties').innerHTML =
    `<p class="duty-sum">Im ${MONTHS[view.m]}: <b>${inMonth}</b> ${inMonth === 1 ? 'Dienst' : 'Dienste'}</p>` +
    (items.length ? `<ul class="duties">${items.join('')}</ul>` : '<p class="hint">Keine anstehenden Dienste eingetragen.</p>');
}

function renderChangeLog() {
  const recent = state.log.filter(l => l.at > Date.now() - 30 * 864e5).slice(0, 6);
  $('#changeLog').innerHTML = recent.length
    ? `<h3>Letzte Änderungen</h3><p class="hint">Zum Weitergeben in die Gruppe einfach kopieren und einfügen.</p><ul>${recent.map(l => {
        const d = new Date(l.at);
        return `<li><div class="log-head"><time>${d.getDate()}.${d.getMonth() + 1}. ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr</time>` +
          `<span class="log-actions"><button type="button" class="btn btn-sm" data-copylog="${esc(l.id)}">📋 Kopieren</button>` +
          `<button type="button" class="icon-btn edit-only" data-dellog="${esc(l.id)}" title="Eintrag entfernen" aria-label="Eintrag entfernen" style="font-size:18px">×</button></span></div>` +
          `<p class="log-text">${esc(l.text)}</p></li>`;
      }).join('')}</ul>`
    : '';
}

/* ---------- Absage mit automatischer Ersatzsuche ---------- */
function cancelDuty(eventId, personId) {
  const e = state.events.find(x => x.id === eventId);
  const p = personById(personId);
  if (!e || !p) return;
  const i = e.people.indexOf(p.id);
  if (i < 0) return;
  if (!confirm(`${p.name} kann am ${eventLabel(e)} nicht?\n\nEs wird automatisch ein Ersatz eingetragen.`)) return;

  const d = parseDate(e.date);
  let result, text, sub;
  mutate(() => {
    e.declined = [...new Set([...(e.declined || []), p.id])];
    e.people[i] = null;
    result = fillSlots(monthEvents(d.getFullYear(), d.getMonth()), { only: new Set([e.id]) });
    e.changed = { ...(e.changed || {}), [i]: Date.now() };
    sub = e.people[i];
    const label = `${eventLabel(e)} (${roleLabel(e, i)})`;
    text = changeMessage([sub
      ? `${label}: ${personName(sub)} übernimmt für ${p.name}`
      : `${label}: ${p.name} kann nicht – wer kann einspringen? 🙏`]);
    addLog(text);
  });
  if (!result) return;

  if (d.getFullYear() !== view.y || d.getMonth() !== view.m) setMonth(d.getFullYear(), d.getMonth());
  showChangeText(sub ? 'Ersatz eingetragen' : 'Kein Ersatz verfügbar',
    sub
      ? `${personName(sub)} wurde automatisch eingetragen. Bitte schreib die Änderung kurz in die Gruppe:`
      : 'Gerade ist niemand verfügbar – der Platz ist im Plan als „??“ markiert. Bitte in der Gruppe nach Ersatz fragen:',
    text);
}

/* ---------- Statistik ---------- */
const STATS_RANGES = [['4w', '4 Wochen'], ['3m', '3 Monate'], ['6m', '6 Monate'], ['12m', '12 Monate'], ['year', 'Dieses Jahr'], ['lastyear', 'Letztes Jahr'], ['all', 'Gesamt']];
const ROLE_COLORS = { studio: '#2a78d6', mischpult: '#eb6834', single: '#1baf7a' };
const HEAT = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
const fmtLong = iso => { const d = parseDate(iso); return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; };

function shiftIso(iso, { days = 0, months = 0 } = {}) {
  const d = parseDate(iso);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() + days);
  return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
}

function statsPeriod(key, future) {
  const today = todayIso();
  const y = Number(today.slice(0, 4));
  let from = '0000-01-01', to = future ? '9999-12-31' : today;
  if (key === '4w') from = shiftIso(today, { days: -27 });
  if (key === '3m') from = shiftIso(today, { months: -3, days: 1 });
  if (key === '6m') from = shiftIso(today, { months: -6, days: 1 });
  if (key === '12m') from = shiftIso(today, { months: -12, days: 1 });
  if (key === 'year') { from = `${y}-01-01`; if (future) to = `${y}-12-31`; }
  if (key === 'lastyear') { from = `${y - 1}-01-01`; to = `${y - 1}-12-31`; }
  // Auf den Bereich begrenzen, in dem es überhaupt Termine gibt
  const dates = state.events.map(e => e.date).sort();
  if (!dates.length) return { from: today, to: today };
  {
    if (from < dates[0]) from = dates[0];
    if (to > dates[dates.length - 1]) to = dates[dates.length - 1];
  }
  if (to > '9000') to = today;
  if (to < from) to = from;
  return { from, to };
}

function computeStats(from, to) {
  const rows = new Map();
  state.people.forEach(p => rows.set(p.id, { p, total: 0, studio: 0, mischpult: 0, single: 0, sunday: 0, weekday: 0, declined: 0, last: '' }));
  let events = 0, declined = 0;
  for (const e of state.events) {
    if (e.date < from || e.date > to) continue;
    events++;
    const sunday = weekdayOf(e.date) === 0;
    e.people.forEach((pid, i) => {
      const r = rows.get(pid);
      if (!r) return;
      r.total++;
      r[roleOf(e, i)]++;
      if (sunday) r.sunday++; else r.weekday++;
      if (e.date > r.last) r.last = e.date;
    });
    (e.declined || []).forEach(pid => { const r = rows.get(pid); if (r) { r.declined++; declined++; } });
  }
  const list = [...rows.values()]
    .filter(r => r.p.active || r.total || r.declined)
    .sort((a, b) => b.total - a.total || a.p.name.localeCompare(b.p.name, 'de'));
  return { list, events, declined, slots: list.reduce((n, r) => n + r.total, 0) };
}

// Spalten für den Verlauf: Wochen bei kurzen Zeiträumen, sonst Monate
function statsBuckets(from, to) {
  const days = dayNum(to) - dayNum(from);
  const buckets = [];
  if (days <= 100) {
    let d = parseDate(from);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Montag
    while (true) {
      const start = isoDate(d.getFullYear(), d.getMonth(), d.getDate());
      if (start > to) break;
      const end = shiftIso(start, { days: 6 });
      buckets.push({ from: start, to: end, label: fmtShort(start), title: `Woche ab ${fmtLong(start)}` });
      d = parseDate(shiftIso(start, { days: 7 }));
    }
    return { unit: 'Woche', buckets };
  }
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)) - 1;
  while (true) {
    const start = isoDate(y, m, 1);
    if (start > to) break;
    buckets.push({ from: start, to: isoDate(y, m, new Date(y, m + 1, 0).getDate()), label: `${MONTHS[m].slice(0, 3)} ${String(y).slice(2)}`, title: `${MONTHS[m]} ${y}` });
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return { unit: 'Monat', buckets: buckets.slice(-24) };
}

function renderStats() {
  const page = $('#statsPage');
  if (ui.page !== 'stats') { page.hidden = true; return; }
  page.hidden = false;
  const s = state.settings;
  const { from, to } = statsPeriod(ui.statsRange, ui.statsFuture);
  const st = computeStats(from, to);
  const max = Math.max(1, ...st.list.map(r => r.total));
  const counted = st.list.filter(r => r.p.active);
  const avg = counted.length ? (st.slots / counted.length).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '0';
  const roles = [['studio', s.col1], ['mischpult', s.col2], ['single', 'Allein']];

  const filters = STATS_RANGES.map(([k, label]) =>
    `<button type="button" class="chip${ui.statsRange === k ? ' on' : ''}" data-range="${k}" aria-pressed="${ui.statsRange === k}">${label}</button>`).join('');

  const bars = st.list.map(r => {
    const segs = roles.filter(([k]) => r[k]).map(([k, label]) =>
      `<span class="seg" style="flex-grow:${r[k]};background:${ROLE_COLORS[k]}" data-tip="${esc(r.p.name)} · ${esc(label)}: ${r[k]}"></span>`).join('');
    return `<div class="bar-row"><span class="bar-name">${esc(r.p.name)}</span>` +
      `<div class="bar-track">${r.total ? `<div class="bar-fill" style="width:${(r.total / max) * 100}%">${segs}</div>` : ''}</div>` +
      `<span class="bar-val">${r.total}</span></div>`;
  }).join('');

  const { unit, buckets } = statsBuckets(from, to);
  const cell = {};
  for (const e of state.events) {
    if (e.date < from || e.date > to) continue;
    const b = buckets.findIndex(x => e.date >= x.from && e.date <= x.to);
    if (b < 0) continue;
    e.people.forEach(pid => { if (pid) cell[pid + '|' + b] = (cell[pid + '|' + b] || 0) + 1; });
  }
  const heatMax = Math.max(1, ...Object.values(cell));
  const heatRows = st.list.map(r => `<tr><th scope="row">${esc(r.p.name)}</th>` + buckets.map((b, bi) => {
    const n = cell[r.p.id + '|' + bi] || 0;
    const step = n ? Math.min(HEAT.length - 1, Math.floor((n / heatMax) * (HEAT.length - 1) + 0.0001)) : -1;
    const bg = step < 0 ? '' : ` style="background:${HEAT[step]};color:${step >= 3 ? '#fff' : '#0b0b0b'}"`;
    return `<td${bg} data-tip="${esc(r.p.name)} · ${esc(b.title)}: ${n} ${n === 1 ? 'Dienst' : 'Dienste'}">${n || ''}</td>`;
  }).join('') + `</tr>`).join('');

  const tableRows = st.list.map(r => `<tr><th scope="row">${esc(r.p.name)}</th><td><b>${r.total}</b></td><td>${r.studio}</td><td>${r.mischpult}</td><td>${r.single}</td>` +
    `<td>${r.sunday}</td><td>${r.weekday}</td><td>${r.declined}</td><td>${r.last ? fmtLong(r.last) : '–'}</td></tr>`).join('');

  page.innerHTML =
    `<div class="stats-head"><div><h1>Statistik</h1><p class="hint">Wer war wie oft dran? Gezählt werden alle eingeteilten Dienste im gewählten Zeitraum.</p></div></div>` +
    `<div class="stats-filters"><div class="chips">${filters}</div>` +
    `<label class="check"><input type="checkbox" id="statsFuture"${ui.statsFuture ? ' checked' : ''}> bereits geplante Dienste mitzählen</label></div>` +
    `<p class="stats-range">Zeitraum: <b>${fmtLong(from)} – ${fmtLong(to)}</b></p>` +
    `<div class="kpis">` +
      `<div class="kpi"><span>Dienste</span><b>${st.slots}</b></div>` +
      `<div class="kpi"><span>Termine</span><b>${st.events}</b></div>` +
      `<div class="kpi"><span>Ø pro Person</span><b>${avg}</b></div>` +
      `<div class="kpi"><span>Absagen</span><b>${st.declined}</b></div>` +
    `</div>` +
    `<section class="viz-card"><h2>Dienste pro Person</h2>` +
      `<div class="legend">${roles.map(([k, label]) => `<span><i style="background:${ROLE_COLORS[k]}"></i>${esc(label)}</span>`).join('')}</div>` +
      `<div class="bars">${bars || '<p class="hint">Keine Dienste im Zeitraum.</p>'}</div></section>` +
    `<section class="viz-card"><h2>Verlauf pro ${unit}</h2>` +
      `<div class="table-scroll"><table class="heat"><thead><tr><th></th>${buckets.map(b => `<th scope="col" title="${esc(b.title)}">${esc(b.label)}</th>`).join('')}</tr></thead><tbody>${heatRows}</tbody></table></div>` +
      `<p class="hint">Zahl = Anzahl Dienste${unit === 'Woche' ? ' in der Woche (ab Montag)' : ' im Monat'}; je dunkler, desto mehr.</p></section>` +
    `<section class="viz-card"><h2>Übersicht</h2><div class="table-scroll"><table class="stats-table">` +
      `<thead><tr><th scope="col">Person</th><th scope="col">Gesamt</th><th scope="col">${esc(s.col1)}</th><th scope="col">${esc(s.col2)}</th><th scope="col">Allein</th>` +
      `<th scope="col">Sonntags</th><th scope="col">Wochentags</th><th scope="col">Absagen</th><th scope="col">Zuletzt</th></tr></thead>` +
      `<tbody>${tableRows}</tbody></table></div></section>`;
}

function renderWarnings() {
  const items = [];
  for (const e of monthEvents()) {
    for (const issue of eventIssues(e)) {
      items.push(`<li class="${issue.level}" data-edit="${e.id}">${WD[weekdayOf(e.date)]} ${fmtShort(e.date)} ${esc(e.time)} · ${esc(e.title)}: ${esc(issue.msg)}</li>`);
    }
  }
  $('#warnings').innerHTML = items.length ? `<h3>Hinweise (${items.length})</h3><ul>${items.join('')}</ul>` : '';
}

/* ---------- Rendering: Seitenleiste ---------- */
function monthCounts(y = view.y, m = view.m) {
  const counts = {};
  state.people.forEach(p => { counts[p.id] = { total: 0, studio: 0, mischpult: 0, single: 0 }; });
  for (const e of monthEvents(y, m)) {
    e.people.forEach((pid, i) => {
      if (pid && counts[pid]) { counts[pid].total++; counts[pid][roleOf(e, i)]++; }
    });
  }
  return counts;
}

function renderPeople() {
  const counts = monthCounts();
  const prefix = monthPrefix(view.y, view.m);
  const monthStart = prefix + '01';
  const monthEnd = prefix + '31';
  const s = state.settings;

  $('#peopleList').innerHTML = state.people.map(p => {
    const c = counts[p.id];
    const badges = [];
    if (p.russisch) badges.push('<span class="badge ru" title="Russisch-Dienste">RU</span>');
    if (!p.studio) badges.push(`<span class="badge" title="Nicht für ${esc(s.col1)}">kein ${esc(s.col1)}</span>`);
    if (!p.mischpult) badges.push(`<span class="badge" title="Nicht für ${esc(s.col2)}">kein ${esc(s.col2)}</span>`);
    if (!p.active) badges.push('<span class="badge off">inaktiv</span>');
    const away = (p.absences || []).filter(a => a.from && a.from <= monthEnd && (a.to || a.from) >= monthStart);
    const monthKey = prefix.slice(0, 7);
    for (const r of (p.rules || []).filter(r => !r.month || r.month === monthKey)) {
      badges.push(`<span class="badge away" title="${esc(describeRule(r) + ' – ' + describeRuleScope(r))}">nicht ${WD[r.weekday]}${r.time ? ' ' + esc(r.time) : ''}</span>`);
    }
    if (away.length) badges.push(`<span class="badge away" title="${esc(away.map(a => fmtShort(a.from) + (a.to && a.to !== a.from ? '–' + fmtShort(a.to) : '')).join(', '))}">abwesend</span>`);
    const meta = c.total
      ? [c.studio && `${c.studio}× ${s.col1}`, c.mischpult && `${c.mischpult}× ${s.col2}`, c.single && `${c.single}× allein`].filter(Boolean).join(' · ')
      : 'keine Dienste in diesem Monat';
    return `<li class="person-item${p.active ? '' : ' inactive'}${view.highlight === p.id ? ' hl' : ''}">` +
      `<div class="person-main"><button type="button" class="person-name" data-hl="${esc(p.id)}" title="Im Plan hervorheben">${esc(p.name)}<span class="badges">${badges.join('')}</span></button>` +
      `<span class="person-meta">${esc(meta)}</span></div>` +
      `<div class="count">${c.total}<small>Dienste</small></div>` +
      `<button type="button" class="icon-btn" data-edit-person="${esc(p.id)}" title="Bearbeiten" aria-label="${esc(p.name)} bearbeiten" style="font-size:16px">✎</button></li>`;
  }).join('') || '<li class="hint">Noch keine Personen angelegt.</li>';
}

function describeWeeks(t) {
  if (!t.weeks || !t.weeks.length) return `jeden ${WD_LONG[t.weekday]}`;
  const parts = t.weeks.map(w => (w === 'last' ? 'letzter' : `${w}.`));
  return `${parts.join(' & ')} ${WD_LONG[t.weekday]} im Monat`;
}

function renderTemplates() {
  const order = t => ((t.weekday + 6) % 7) * 10000 + Number(t.time.replace(':', ''));
  const list = [...state.templates].sort((a, b) => order(a) - order(b));
  $('#templateList').innerHTML = list.map(t =>
    `<li class="tpl-item"><span class="sw" style="background:${colorBg(t.color)}"></span>` +
    `<div><strong>${WD[t.weekday]} ${esc(t.time)} · ${esc(t.title)}</strong>` +
    `<span class="meta">${t.slots === 1 ? '1 Person' : '2 Personen'} · ${esc(describeWeeks(t))}</span></div>` +
    `<button type="button" class="icon-btn" data-edit-tpl="${esc(t.id)}" title="Bearbeiten" aria-label="Bearbeiten" style="font-size:16px">✎</button></li>`
  ).join('') || '<li class="hint">Keine Regeltermine.</li>';
}

/* ---------- Rendering: Verfügbarkeit ---------- */
function knownTimes() {
  const times = new Set([...state.templates.map(t => t.time), ...state.events.map(e => e.time)]);
  return [...times].filter(Boolean).sort();
}

function timeOptions(selected = '') {
  const times = knownTimes();
  if (selected && !times.includes(selected)) times.push(selected);
  return `<option value="">ganzer Tag</option>` +
    times.sort().map(t => `<option value="${esc(t)}"${t === selected ? ' selected' : ''}>nur ${esc(t)} Uhr</option>`).join('');
}

function monthOptions(selected = '') {
  const keys = [];
  for (let i = -1; i <= 12; i++) {
    const d = new Date(view.y, view.m + i, 1);
    keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  if (selected && !keys.includes(selected)) keys.push(selected);
  return `<option value=""${selected ? '' : ' selected'}>jeden Monat (dauerhaft)</option>` +
    keys.sort().map(k => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(describeRuleScope({ month: k }))}</option>`).join('');
}

function weekdayOptions(selected = 0) {
  return [1, 2, 3, 4, 5, 6, 0].map(i => `<option value="${i}"${i === Number(selected) ? ' selected' : ''}>${WD_LONG[i]}</option>`).join('');
}

function ruleRow(r = { weekday: 3, time: '', month: '' }) {
  return `<div class="rule-row" data-id="${esc(r.id || '')}">` +
    `<select class="ru-wd" aria-label="Wochentag">${weekdayOptions(r.weekday)}</select>` +
    `<select class="ru-time" aria-label="Uhrzeit">${timeOptions(r.time)}</select>` +
    `<select class="ru-month" aria-label="Gültig">${monthOptions(r.month)}</select>` +
    `<button type="button" class="icon-btn ru-del" aria-label="Regel entfernen" style="font-size:18px">×</button></div>`;
}

function renderRules() {
  const monthKey = monthPrefix(view.y, view.m).slice(0, 7);
  const monthStart = monthKey + '-01', monthEnd = monthKey + '-31';
  $('#rfMonthName').textContent = `${MONTHS[view.m]} ${view.y}`;

  // Formular: Auswahl erhalten
  const rfPerson = $('#rfPerson');
  const keepPerson = rfPerson.value;
  rfPerson.innerHTML = sortedPeople().filter(p => p.active).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (keepPerson && personById(keepPerson)) rfPerson.value = keepPerson;
  const rfTime = $('#rfTime'), keepTime = rfTime.value;
  rfTime.innerHTML = timeOptions(keepTime);
  const rfMonth = $('#rfMonth');
  const keepAlways = rfMonth.options.length && rfMonth.value === '';
  rfMonth.innerHTML = monthOptions(keepAlways ? '' : monthKey);

  const current = [], other = [];
  for (const p of sortedPeople()) {
    for (const r of p.rules || []) {
      const item = `<li class="rule-item"><div><strong>${esc(p.name)}</strong> ${esc(describeRule(r))}` +
        `<span class="meta">${esc(describeRuleScope(r))}</span></div>` +
        `<button type="button" class="icon-btn" data-del-rule="${esc(p.id)}|rule|${esc(r.id)}" aria-label="Regel löschen" style="font-size:18px">×</button></li>`;
      (!r.month || r.month === monthKey ? current : other).push(item);
    }
    for (const a of p.absences || []) {
      const to = a.to || a.from;
      const range = fmtShort(a.from) + (to !== a.from ? ' – ' + fmtShort(to) + to.slice(0, 4) : a.from.slice(0, 4));
      const item = `<li class="rule-item absence-item"><div><strong>${esc(p.name)}</strong> abwesend` +
        `<span class="meta">${esc(range)}</span></div>` +
        `<button type="button" class="icon-btn" data-del-rule="${esc(p.id)}|absence|${esc(a.id)}" aria-label="Abwesenheit löschen" style="font-size:18px">×</button></li>`;
      (a.from <= monthEnd && to >= monthStart ? current : other).push(item);
    }
  }
  $('#ruleList').innerHTML = current.join('');
  $('#ruleOtherList').innerHTML = other.join('');
  $('#ruleOtherWrap').hidden = !other.length;
}

function addRuleFromForm() {
  const p = personById($('#rfPerson').value);
  if (!p) { toast('Bitte zuerst eine Person anlegen.'); return; }
  const type = $('input[name=rfType]:checked').value;
  if (type === 'weekday') {
    const rule = { id: uid(), weekday: Number($('#rfWeekday').value), time: $('#rfTime').value, month: $('#rfMonth').value };
    if (p.rules.some(r => r.weekday === rule.weekday && r.time === rule.time && r.month === rule.month)) { toast('Diese Regel gibt es schon.'); return; }
    mutate(() => { p.rules.push(rule); }, `${p.name} ${describeRule(rule)} (${describeRuleScope(rule)})`);
  } else {
    let from = $('#rfFrom').value, to = $('#rfTo').value || from;
    if (!from) { toast('Bitte ein Datum angeben.'); $('#rfFrom').focus(); return; }
    if (to < from) [from, to] = [to, from];
    mutate(() => { p.absences.push({ id: uid(), from, to }); }, `${p.name} abwesend ${fmtShort(from)}${to !== from ? '–' + fmtShort(to) : ''}`);
    $('#rfFrom').value = '';
    $('#rfTo').value = '';
  }
}

function fillSettings() {
  for (const el of $$('[data-setting]')) {
    if (el === document.activeElement) continue;
    const v = state.settings[el.dataset.setting];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  }
}

/* ---------- Aktionen ---------- */
function buildRegularEvents(y, m) {
  const dim = new Date(y, m + 1, 0).getDate();
  const added = [];
  for (let d = 1; d <= dim; d++) {
    const wd = new Date(y, m, d).getDay();
    const nth = String(Math.ceil(d / 7));
    const isLast = d + 7 > dim;
    for (const t of state.templates) {
      if (Number(t.weekday) !== wd) continue;
      if (t.weeks.length && !(t.weeks.includes(nth) || (isLast && t.weeks.includes('last')))) continue;
      const date = isoDate(y, m, d);
      const exists = state.events.some(e => e.date === date && e.time === t.time) || added.some(e => e.date === date && e.time === t.time);
      if (exists) continue;
      added.push({ id: uid(), date, time: t.time, title: t.title, color: t.color, slots: t.slots, people: Array(t.slots).fill(null) });
    }
  }
  return added;
}

function generateRegular() {
  const added = buildRegularEvents(view.y, view.m);
  if (!added.length) { toast('Alle Regeltermine sind bereits vorhanden.'); return; }
  mutate(() => { state.events.push(...added); }, `${added.length} Regeltermine eingefügt`);
}

// Besetzt alle leeren Plätze der übergebenen Termine. Bevorzugt wird, wer im Monat
// (und leicht gewichtet in den 3 Vormonaten) am wenigsten Dienste hat; "randomness"
// bestimmt, wie stark der Zufall bei ähnlich belasteten Personen mitspielt.
function fillSlots(evs, { randomness = 2, only = null } = {}) {
  const counts = {}, roles = {}, hist = {};
  state.people.forEach(p => { counts[p.id] = 0; hist[p.id] = 0; roles[p.id] = { studio: 0, mischpult: 0, single: 0 }; });
  evs.forEach(e => e.people.forEach((pid, i) => {
    if (pid && pid in counts) { counts[pid]++; roles[pid][roleOf(e, i)]++; }
  }));

  const first = evs.length ? parseDate(evs[0].date) : new Date(view.y, view.m, 1);
  const start = monthPrefix(first.getFullYear(), first.getMonth()) + '01';
  const h = new Date(first.getFullYear(), first.getMonth() - 3, 1);
  const histStart = isoDate(h.getFullYear(), h.getMonth(), 1);
  state.events.filter(e => e.date >= histStart && e.date < start)
    .forEach(e => e.people.forEach(pid => { if (pid && pid in hist) hist[pid]++; }));

  let filled = 0;
  const unfilled = [];
  for (const e of evs) {
    for (let i = 0; i < e.slots; i++) {
      if (e.people[i] || (only && !only.has(e.id))) continue;
      const role = roleOf(e, i);
      const candidates = state.people.filter(p =>
        p.active && canRole(p, role) && (!isRussisch(e) || p.russisch) && !unavailableReason(p, e) && !e.people.includes(p.id));
      if (!candidates.length) { unfilled.push(e); continue; }

      const n = dayNum(e.date);
      let best = null, bestScore = Infinity;
      for (const p of candidates) {
        let score = counts[p.id] * 10 + hist[p.id] * 1.5 + roles[p.id][role] * 3 + Math.random() * randomness;
        for (const o of evs) {
          if (o === e || !o.people.includes(p.id)) continue;
          const diff = Math.abs(dayNum(o.date) - n);
          if (diff === 0) score += 8;
          else if (diff <= 2) score += 4;
          else if (diff <= 4) score += 1;
        }
        if (score < bestScore) { bestScore = score; best = p; }
      }
      e.people[i] = best.id;
      counts[best.id]++;
      roles[best.id][role]++;
      filled++;
    }
  }
  return { filled, unfilled };
}

function fillResultMessage({ filled, unfilled }, prefix = '') {
  if (unfilled.length) {
    const where = [...new Set(unfilled.map(e => fmtShort(e.date) + ' ' + e.title))].slice(0, 3).join(', ');
    return `${prefix}${filled} Plätze besetzt – ${unfilled.length} blieben offen, weil niemand verfügbar ist (${where}).`;
  }
  return filled ? `${prefix}${filled} Plätze besetzt` : 'Es gab keine offenen Plätze.';
}

function autoAssign({ all = false } = {}) {
  const evs = monthEvents();
  if (!evs.length) { toast('Keine Termine in diesem Monat.'); return; }
  let result;
  mutate(() => {
    if (all) evs.forEach(e => { e.people = e.people.map(() => null); });
    result = fillSlots(evs);
  });
  toast(fillResultMessage(result));
}

// Zufallsgenerator: legt bei leerem Monat die Regeltermine an und verteilt
// alle Plätze zufällig, fair und unter Beachtung aller Regeln neu.
function randomPlan() {
  const existing = monthEvents();
  const hasPeople = existing.some(e => e.people.some(Boolean));
  if (hasPeople && !confirm(`Zufallsplan für ${MONTHS[view.m]} ${view.y} erstellen?\nAlle eingetragenen Personen werden neu ausgelost (mit „Rückgängig“ wiederherstellbar).`)) return;
  let result, added = 0;
  mutate(() => {
    if (!existing.length) {
      const regular = buildRegularEvents(view.y, view.m);
      state.events.push(...regular);
      added = regular.length;
    }
    const evs = monthEvents();
    evs.forEach(e => { e.people = e.people.map(() => null); });
    result = fillSlots(evs, { randomness: 7 });
  });
  if (!added && !existing.length) { toast('Keine Regeltermine vorhanden – bitte zuerst Termine anlegen.'); return; }
  toast(fillResultMessage(result, added ? `${added} Termine angelegt, ` : '🎲 Neu ausgelost: '));
}

function planAsText() {
  const s = state.settings;
  const lines = [`${s.title} ${MONTHS[view.m]} ${view.y}`];
  if (s.note) lines.push(s.note);
  let prevWeek = null;
  for (const e of monthEvents()) {
    const wk = weekKey(e.date, s.weekSplit === 'none' ? 'afterSunday' : s.weekSplit);
    if (wk !== prevWeek) lines.push('');
    prevWeek = wk;
    const d = parseDate(e.date);
    const who = e.slots === 1
      ? personName(e.people[0])
      : `${s.col1}: ${personName(e.people[0])} · ${s.col2}: ${personName(e.people[1])}`;
    lines.push(`${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${e.time} – ${e.title}: ${who}`);
  }
  return lines.join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const now = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `tontechnikplan-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = normalize(JSON.parse(reader.result)); } catch (err) { toast('Die Datei ist keine gültige Sicherung.'); return; }
    if (!confirm(`Sicherung mit ${data.people.length} Personen und ${data.events.length} Terminen laden? Die aktuellen Daten in diesem Browser werden ersetzt.`)) return;
    mutate(() => { state = data; }, 'Sicherung importiert');
    fillSettings();
  };
  reader.readAsText(file);
}

/* ---------- Dialog: Ereignis ---------- */
let editingEventId = null;
let evTouched = { color: false, slots: false };

function swatchesHtml(name) {
  return COLORS.map(c => `<label title="${esc(c.label)}"><input type="radio" name="${name}" value="${c.key}"><span style="background:${c.bg}"></span></label>`).join('');
}

function typeDefaults(title) {
  const t = title.trim().toLowerCase();
  if (!t) return null;
  const tpl = state.templates.find(x => x.title.toLowerCase() === t);
  if (tpl) return { slots: tpl.slots, color: tpl.color };
  const quick = QUICK_EVENTS.find(x => t.startsWith(x.title.toLowerCase()));
  if (quick) return { slots: quick.slots, color: quick.color };
  if (t.includes('russisch')) return { slots: 1, color: 'gelb' };
  const last = sortEvents(state.events.filter(e => e.title.toLowerCase() === t)).pop();
  if (last) return { slots: last.slots, color: last.color };
  return null;
}

function dialogEventDraft() {
  return {
    date: $('#evDate').value,
    title: $('#evTitle').value,
    slots: Number($('input[name=evSlots]:checked')?.value || 2),
  };
}

function refreshEventDialogPeople() {
  const draft = dialogEventDraft();
  const s = state.settings;
  const p0 = $('#evP0').value, p1 = $('#evP1').value;
  const single = draft.slots === 1;
  $('#evP1Wrap').hidden = single;
  $('#evP0Label').textContent = single ? 'Person' : s.col1;
  $('#evP1Label').textContent = s.col2;
  $('#evP0').innerHTML = personOptions(p0 || null, draft, single ? 'single' : 'studio');
  $('#evP1').innerHTML = personOptions(p1 || null, draft, 'mischpult');

  const fake = { ...draft, people: single ? [p0 || null] : [p0 || null, p1 || null] };
  const warn = eventIssues(fake).filter(i => i.msg && !/nicht besetzt/.test(i.msg)).map(i => i.msg);
  $('#evWarn').textContent = warn.length ? '⚠ ' + warn.join(' · ') : '';
}

function setEvSlots(n) {
  const r = $(`input[name=evSlots][value="${n}"]`);
  if (r) r.checked = true;
}
function setRadio(name, value) {
  const r = $(`input[name=${name}][value="${value}"]`);
  if (r) r.checked = true;
}

function openEventDialog(id = null, preset = {}) {
  const e = id ? state.events.find(x => x.id === id) : null;
  editingEventId = e ? e.id : null;
  evTouched = { color: !!e, slots: !!e };

  let date = preset.date;
  if (!date) {
    const today = new Date();
    date = today.getFullYear() === view.y && today.getMonth() === view.m
      ? isoDate(view.y, view.m, today.getDate())
      : isoDate(view.y, view.m, 1);
  }
  const data = e || { date, time: '19:00', title: '', slots: 2, color: weekdayOf(date) === 0 ? 'blau' : 'none', people: [null, null] };

  $('#eventDialogTitle').textContent = e ? 'Ereignis bearbeiten' : 'Neues Ereignis';
  $('#evDate').value = data.date;
  $('#evTime').value = data.time;
  $('#evTitle').value = data.title;
  setEvSlots(data.slots);
  setRadio('evColor', data.color);
  $('#evDelete').hidden = !e;

  // Personen-Selects vorbelegen (bei 1 Person steht sie in evP0)
  $('#evP0').innerHTML = personOptions(data.people[0] || null, data, data.slots === 1 ? 'single' : 'studio');
  $('#evP1').innerHTML = personOptions(data.people[1] || null, data, 'mischpult');
  refreshEventDialogPeople();

  // Vorschläge für die Bemerkung
  const titles = new Set([...state.templates.map(t => t.title), ...QUICK_EVENTS.map(q => q.title), ...state.events.map(x => x.title)]);
  $('#titleList').innerHTML = [...titles].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de')).map(t => `<option value="${esc(t)}">`).join('');

  $('#eventDialog').showModal();
  $('#evTitle').focus();
}

function applyTitleDefaults() {
  const d = typeDefaults($('#evTitle').value);
  if (!d) return;
  if (!evTouched.slots) {
    const cur = Number($('input[name=evSlots]:checked')?.value || 2);
    if (cur !== d.slots) { if (d.slots === 1 && !$('#evP0').value) $('#evP0').value = $('#evP1').value; setEvSlots(d.slots); }
  }
  if (!evTouched.color) setRadio('evColor', d.color);
  refreshEventDialogPeople();
}

function saveEventDialog(ev) {
  ev.preventDefault();
  const date = $('#evDate').value;
  const time = $('#evTime').value;
  const title = $('#evTitle').value.trim();
  if (!date || !time || !title) {
    toast('Bitte Datum, Uhrzeit und Bemerkung ausfüllen.');
    (!date ? $('#evDate') : !time ? $('#evTime') : $('#evTitle')).focus();
    return;
  }
  const slots = Number($('input[name=evSlots]:checked')?.value || 2);
  const color = $('input[name=evColor]:checked')?.value || 'none';
  const p0 = $('#evP0').value || null, p1 = $('#evP1').value || null;
  const people = slots === 1 ? [p0] : [p0, p1];

  const clash = state.events.find(x => x.id !== editingEventId && x.date === date && x.time === time);
  if (clash && !confirm(`Am ${fmtShort(date)} um ${time} gibt es bereits „${clash.title}“. Trotzdem speichern?`)) return;

  const id = editingEventId;
  mutate(() => {
    if (id) {
      Object.assign(state.events.find(x => x.id === id), { date, time, title, slots, color, people });
    } else {
      state.events.push({ id: uid(), date, time, title, slots, color, people });
    }
  }, id ? 'Ereignis gespeichert' : 'Ereignis hinzugefügt');

  // Zum Monat des Ereignisses springen, falls anderer Monat
  const d = parseDate(date);
  if (d.getFullYear() !== view.y || d.getMonth() !== view.m) setMonth(d.getFullYear(), d.getMonth());
  $('#eventDialog').close();
}

function deleteEvent(id) {
  const e = state.events.find(x => x.id === id);
  if (!e) return;
  mutate(() => { state.events = state.events.filter(x => x.id !== id); }, `„${e.title}“ am ${fmtShort(e.date)} gelöscht – Rückgängig mit Strg+Z`);
}

/* ---------- Dialog: Person ---------- */
let editingPersonId = null;

function absenceRow(a = { from: '', to: '' }) {
  return `<div class="absence"><input type="date" class="ab-from" value="${esc(a.from)}" aria-label="Von"><span>bis</span>` +
    `<input type="date" class="ab-to" value="${esc(a.to || '')}" aria-label="Bis"><button type="button" class="icon-btn ab-del" aria-label="Entfernen" style="font-size:18px">×</button></div>`;
}

function openPersonDialog(id = null) {
  const p = id ? personById(id) : null;
  editingPersonId = p ? p.id : null;
  const d = p || { name: '', active: true, studio: true, mischpult: true, russisch: false, absences: [], rules: [] };
  $('#personDialogTitle').textContent = p ? 'Person bearbeiten' : 'Neue Person';
  $('#psName').value = d.name;
  $('#psActive').checked = d.active;
  $('#psStudio').checked = d.studio;
  $('#psMischpult').checked = d.mischpult;
  $('#psRussisch').checked = d.russisch;
  $('#psStudioLabel').textContent = state.settings.col1;
  $('#psMischpultLabel').textContent = state.settings.col2;
  $('#psAbsences').innerHTML = (d.absences || []).map(absenceRow).join('');
  $('#psRules').innerHTML = (d.rules || []).map(ruleRow).join('');
  $('#psDelete').hidden = !p;
  $('#personDialog').showModal();
  $('#psName').focus();
}

function savePersonDialog(ev) {
  ev.preventDefault();
  const name = $('#psName').value.trim();
  if (!name) { toast('Bitte einen Namen eingeben.'); $('#psName').focus(); return; }
  if (state.people.some(p => p.id !== editingPersonId && p.name.toLowerCase() === name.toLowerCase())) {
    toast('Diesen Namen gibt es bereits.'); $('#psName').focus(); return;
  }
  const absences = $$('#psAbsences .absence').map(r => {
    let from = $('.ab-from', r).value, to = $('.ab-to', r).value || from;
    if (from && to < from) [from, to] = [to, from];
    return { from, to };
  }).filter(a => a.from).map(a => ({ id: uid(), ...a }));
  const rules = $$('#psRules .rule-row').map(r => ({
    id: r.dataset.id || uid(),
    weekday: Number($('.ru-wd', r).value),
    time: $('.ru-time', r).value,
    month: $('.ru-month', r).value,
  }));
  const data = {
    name,
    active: $('#psActive').checked,
    studio: $('#psStudio').checked,
    mischpult: $('#psMischpult').checked,
    russisch: $('#psRussisch').checked,
    absences,
    rules,
  };
  const id = editingPersonId || uid();
  const isNew = !editingPersonId;
  mutate(() => {
    if (isNew) state.people.push({ id, ...data });
    else Object.assign(personById(id), data);
  }, isNew ? `${name} hinzugefügt` : 'Person gespeichert');

  $('#personDialog').close();
}

function deletePerson() {
  const p = personById(editingPersonId);
  if (!p) return;
  const used = state.events.filter(e => e.people.includes(p.id)).length;
  if (used) {
    if (!confirm(`${p.name} ist in ${used} Terminen eingetragen. Die Person wird deshalb nur deaktiviert (bisherige Pläne bleiben erhalten) und erscheint nicht mehr in der Auswahl. Fortfahren?`)) return;
    mutate(() => { p.active = false; }, `${p.name} deaktiviert`);
  } else {
    if (!confirm(`${p.name} wirklich entfernen?`)) return;
    mutate(() => { state.people = state.people.filter(x => x.id !== p.id); }, `${p.name} entfernt`);
  }
  if (view.highlight === p.id) view.highlight = null;
  $('#personDialog').close();
}

/* ---------- Dialog: Regeltermin ---------- */
let editingTemplateId = null;

function openTemplateDialog(id = null) {
  const t = id ? state.templates.find(x => x.id === id) : null;
  editingTemplateId = t ? t.id : null;
  const d = t || { weekday: 0, time: '10:00', title: '', slots: 2, color: 'none', weeks: [] };
  $('#templateDialogTitle').textContent = t ? 'Regeltermin bearbeiten' : 'Neuer Regeltermin';
  $('#tpWeekday').value = String(d.weekday);
  $('#tpTime').value = d.time;
  $('#tpTitle').value = d.title;
  setRadio('tpSlots', d.slots);
  setRadio('tpColor', d.color);
  $$('#tpWeeks input').forEach(i => { i.checked = d.weeks.includes(i.value); });
  $('#tpDelete').hidden = !t;
  $('#templateDialog').showModal();
  $('#tpTitle').focus();
}

function saveTemplateDialog(ev) {
  ev.preventDefault();
  const title = $('#tpTitle').value.trim();
  const time = $('#tpTime').value;
  if (!title || !time) { toast('Bitte Uhrzeit und Bemerkung ausfüllen.'); return; }
  const data = {
    weekday: Number($('#tpWeekday').value),
    time,
    title,
    slots: Number($('input[name=tpSlots]:checked')?.value || 2),
    color: $('input[name=tpColor]:checked')?.value || 'none',
    weeks: $$('#tpWeeks input:checked').map(i => i.value),
  };
  const id = editingTemplateId;
  mutate(() => {
    if (id) Object.assign(state.templates.find(x => x.id === id), data);
    else state.templates.push({ id: uid(), ...data });
  }, 'Regeltermin gespeichert');
  $('#templateDialog').close();
}

/* ---------- Navigation ---------- */
function setMonth(y, m) {
  const d = new Date(y, m, 1);
  view.y = d.getFullYear();
  view.m = d.getMonth();
  saveView();
  render();
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ---------- Ereignis-Bindungen ---------- */
function init() {
  // statische Teile der Dialoge
  $('#evColors').innerHTML = swatchesHtml('evColor');
  $('#tpColors').innerHTML = swatchesHtml('tpColor');
  $('#tpWeekday').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(i => `<option value="${i}">${WD_LONG[i]}</option>`).join('');
  $('#tpWeeks').innerHTML = ['1', '2', '3', '4', '5', 'last'].map(w =>
    `<label><input type="checkbox" value="${w}"><span>${w === 'last' ? 'Letzte' : w + '.'}</span></label>`).join('');
  $('#quickChips').innerHTML = QUICK_EVENTS.map((q, i) =>
    `<button type="button" class="chip" data-quick="${i}"><i style="background:${colorBg(q.color)}"></i>${esc(q.title)}</button>`).join('');

  // Darstellung
  applyTheme();
  $$('input[name=themeMode]').forEach(i => i.addEventListener('change', () => setTheme({ mode: i.value })));
  $('#themeSheetLight').addEventListener('change', e => setTheme({ sheet: e.target.checked ? 'light' : 'dark' }));
  darkQuery?.addEventListener?.('change', applyTheme);

  // Monatsnavigation
  $('#prevMonth').addEventListener('click', () => setMonth(view.y, view.m - 1));
  $('#nextMonth').addEventListener('click', () => setMonth(view.y, view.m + 1));
  $('#monthSel').addEventListener('change', e => setMonth(view.y, Number(e.target.value)));
  $('#yearSel').addEventListener('change', e => setMonth(Number(e.target.value), view.m));

  // Werkzeugleiste
  $('#addEvent').addEventListener('click', () => openEventDialog());
  $('#randomPlan').addEventListener('click', randomPlan);
  $('#genRegular').addEventListener('click', generateRegular);
  $('#autoAssign').addEventListener('click', () => autoAssign());
  $('#undoBtn').addEventListener('click', undo);
  $('#printBtn').addEventListener('click', () => window.print());
  $('#statsBtn').addEventListener('click', () => {
    ui.page = ui.page === 'stats' ? 'plan' : 'stats';
    render();
    window.scrollTo(0, 0);
  });
  $('#enterEdit').addEventListener('click', () => requireEdit(startEditing));
  $('#leaveEdit').addEventListener('click', finishEditing);
  $('#logoutBtn').addEventListener('click', logout);
  $('#loginForm').addEventListener('submit', submitLogin);
  $('#loginDialog').addEventListener('close', () => { ui.pendingAction = null; });

  // Statistik
  const statsPage = $('#statsPage');
  statsPage.addEventListener('click', e => {
    const chip = e.target.closest('[data-range]');
    if (chip) { ui.statsRange = chip.dataset.range; renderStats(); }
  });
  statsPage.addEventListener('change', e => {
    if (e.target.id === 'statsFuture') { ui.statsFuture = e.target.checked; renderStats(); }
  });
  const tip = $('#vizTip');
  const showTip = e => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + 'px';
    tip.style.top = (e.clientY + 16) + 'px';
  };
  statsPage.addEventListener('pointermove', showTip);
  statsPage.addEventListener('pointerdown', showTip);
  statsPage.addEventListener('pointerleave', () => { tip.hidden = true; });

  // "Wann bin ich dran?"
  $('#meSel').addEventListener('change', e => {
    ui.me = e.target.value;
    try { localStorage.setItem(ME_KEY, ui.me); } catch (err) { /* ignorieren */ }
    render();
  });
  $('#myDuties').addEventListener('click', e => {
    const go = e.target.closest('[data-goto]');
    if (go) { const d = parseDate(go.dataset.goto); setMonth(d.getFullYear(), d.getMonth()); return; }
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) {
      const id = cancel.dataset.cancel, me = ui.me;
      requireEdit(() => cancelDuty(id, me));
    }
  });
  $('.mine').addEventListener('click', async e => {
    const cal = e.target.closest('[data-copycal]');
    if (cal) { await copyText(calendarUrl(cal.dataset.copycal)); toast('Kalender-Link kopiert – z. B. in Google Kalender oder Outlook unter „Kalender abonnieren“ einfügen.'); }
  });
  // Letzte Änderungen: kopieren / (im Bearbeitungsmodus) entfernen
  $('#changeLog').addEventListener('click', async e => {
    const cp = e.target.closest('[data-copylog]');
    if (cp) {
      const entry = state.log.find(l => l.id === cp.dataset.copylog);
      if (entry) { await copyText(entry.text); toast('Kopiert – jetzt in die Gruppe einfügen.'); }
      return;
    }
    const del = e.target.closest('[data-dellog]');
    if (del) mutate(() => { state.log = state.log.filter(l => l.id !== del.dataset.dellog); }, 'Eintrag entfernt');
  });
  $('#changeCopy').addEventListener('click', async () => {
    await copyText($('#changeText').value);
    toast('Kopiert – jetzt in die Gruppe einfügen.');
  });
  $('#copyText').addEventListener('click', async () => { await copyText(planAsText()); toast('Plan als Text kopiert'); });

  // Offene Menüs schließen (außer dem, in das gerade geklickt wurde)
  const closeMenu = (keep = null) => $$('.menu[open]').forEach(m => { if (m !== keep) m.removeAttribute('open'); });
  document.addEventListener('click', e => closeMenu(e.target.closest('.menu')));
  $('#clearPeople').addEventListener('click', () => {
    closeMenu();
    if (!confirm(`Alle Personen aus den Terminen im ${MONTHS[view.m]} entfernen? Die Termine bleiben bestehen.`)) return;
    mutate(() => monthEvents().forEach(e => { e.people = e.people.map(() => null); }), 'Besetzung geleert');
  });
  $('#reshuffle').addEventListener('click', () => {
    closeMenu();
    if (!confirm(`Alle Plätze im ${MONTHS[view.m]} neu verteilen? Auch bereits eingetragene Personen werden ersetzt.`)) return;
    autoAssign({ all: true });
  });
  $('#clearMonth').addEventListener('click', () => {
    closeMenu();
    const evs = monthEvents();
    if (!evs.length) { toast('Keine Termine in diesem Monat.'); return; }
    if (!confirm(`Alle ${evs.length} Termine im ${MONTHS[view.m]} ${view.y} löschen?`)) return;
    const prefix = monthPrefix(view.y, view.m);
    mutate(() => { state.events = state.events.filter(e => !e.date.startsWith(prefix)); }, 'Monat geleert – Rückgängig mit Strg+Z');
  });

  // Plan-Tabelle
  const sheet = $('#sheet');
  sheet.addEventListener('change', e => {
    const sel = e.target.closest('select.pick');
    if (!sel) return;
    const ev = state.events.find(x => x.id === sel.dataset.ev);
    if (!ev) return;
    const slot = Number(sel.dataset.slot);
    const value = sel.value || null;
    const old = ev.people[slot];
    mutate(() => {
      if (old && value) ev.changed = { ...(ev.changed || {}), [slot]: Date.now() };
      ev.people[slot] = value;
    });
  });
  sheet.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { deleteEvent(del.dataset.del); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { openEventDialog(edit.dataset.edit); return; }
    const action = e.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'genRegular') generateRegular();
      if (action.dataset.action === 'randomPlan') randomPlan();
      if (action.dataset.action === 'addEvent') openEventDialog();
    }
  });
  $('#warnings').addEventListener('click', e => {
    const li = e.target.closest('[data-edit]');
    if (li) openEventDialog(li.dataset.edit);
  });

  // Seitenleiste
  $$('.tab').forEach(tab => tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
    $$('.tab-panel').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
  }));
  $('#addPerson').addEventListener('click', () => openPersonDialog());
  $('#peopleList').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit-person]');
    if (ed) { openPersonDialog(ed.dataset.editPerson); return; }
    const hl = e.target.closest('[data-hl]');
    if (hl) {
      view.highlight = view.highlight === hl.dataset.hl ? null : hl.dataset.hl;
      renderSheet();
      renderPeople();
    }
  });
  // Verfügbarkeit
  $('#rfWeekday').innerHTML = weekdayOptions(3);
  $$('input[name=rfType]').forEach(r => r.addEventListener('change', () => {
    const dates = $('input[name=rfType]:checked').value === 'dates';
    $('#rfWeekdayFields').hidden = dates;
    $('#rfDateFields').hidden = !dates;
  }));
  $('#rfFrom').addEventListener('change', () => {
    if (!$('#rfTo').value || $('#rfTo').value < $('#rfFrom').value) $('#rfTo').value = $('#rfFrom').value;
  });
  $('#rfAdd').addEventListener('click', addRuleFromForm);
  $('.tab-panel[data-panel=rules]').addEventListener('click', e => {
    const del = e.target.closest('[data-del-rule]');
    if (!del) return;
    const [pid, kind, id] = del.dataset.delRule.split('|');
    const p = personById(pid);
    if (!p) return;
    mutate(() => {
      if (kind === 'rule') p.rules = p.rules.filter(r => r.id !== id);
      else p.absences = p.absences.filter(a => a.id !== id);
    }, 'Regel gelöscht');
  });
  $('#psAddRule').addEventListener('click', () => {
    $('#psRules').insertAdjacentHTML('beforeend', ruleRow({ weekday: 3, time: '', month: '' }));
    $('#psRules .rule-row:last-child .ru-wd').focus();
  });
  $('#psRules').addEventListener('click', e => {
    const del = e.target.closest('.ru-del');
    if (del) del.closest('.rule-row').remove();
  });

  $('#addTemplate').addEventListener('click', () => openTemplateDialog());
  $('#templateList').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit-tpl]');
    if (ed) openTemplateDialog(ed.dataset.editTpl);
  });

  // Einstellungen
  $$('[data-setting]').forEach(el => {
    const evName = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evName, () => {
      state.settings[el.dataset.setting] = el.type === 'checkbox' ? el.checked : el.value;
      save();
      renderSheet();
      renderWarnings();
      renderPeople();
    });
  });
  $('#exportJson').addEventListener('click', exportJson);
  $('#importJson').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) importJson(f);
    e.target.value = '';
  });
  $('#resetAll').addEventListener('click', () => {
    if (!confirm('Wirklich alle Daten durch die Ausgangsdaten ersetzen? Danach gibt es nur noch die Personen und Regeltermine, alle Pläne sind gelöscht.')) return;
    mutate(() => { state = seedState(); }, 'Auf Ausgangsdaten zurückgesetzt');
    fillSettings();
  });

  // Dialoge allgemein
  $$('dialog').forEach(dlg => {
    dlg.addEventListener('click', e => {
      if (e.target.closest('[data-close]') || e.target === dlg) dlg.close();
    });
  });

  // Ereignis-Dialog
  $('#eventForm').addEventListener('submit', saveEventDialog);
  $('#evDelete').addEventListener('click', () => {
    const id = editingEventId;
    $('#eventDialog').close();
    deleteEvent(id);
  });
  $('#quickChips').addEventListener('click', e => {
    const chip = e.target.closest('[data-quick]');
    if (!chip) return;
    const q = QUICK_EVENTS[Number(chip.dataset.quick)];
    $('#evTitle').value = q.title;
    if (q.slots === 1 && !$('#evP0').value) $('#evP0').value = $('#evP1').value;
    setEvSlots(q.slots);
    setRadio('evColor', q.color);
    evTouched = { color: false, slots: false };
    refreshEventDialogPeople();
    $('#evTitle').focus();
  });
  $('#evTitle').addEventListener('change', applyTitleDefaults);
  $('#evTitle').addEventListener('input', () => {
    // Bei Auswahl aus der Vorschlagsliste sofort übernehmen
    if (typeDefaults($('#evTitle').value)) applyTitleDefaults(); else refreshEventDialogPeople();
  });
  $('#evDate').addEventListener('change', () => {
    const v = $('#evDate').value;
    if (v && !evTouched.color && !typeDefaults($('#evTitle').value)) setRadio('evColor', weekdayOf(v) === 0 ? 'blau' : 'none');
    refreshEventDialogPeople();
  });
  $$('input[name=evSlots]').forEach(r => r.addEventListener('change', () => {
    evTouched.slots = true;
    if (r.value === '1' && !$('#evP0').value) $('#evP0').value = $('#evP1').value;
    refreshEventDialogPeople();
  }));
  $('#evColors').addEventListener('change', () => { evTouched.color = true; });
  $('#evP0').addEventListener('change', refreshEventDialogPeople);
  $('#evP1').addEventListener('change', refreshEventDialogPeople);

  // Personen-Dialog
  $('#personForm').addEventListener('submit', savePersonDialog);
  $('#psDelete').addEventListener('click', deletePerson);
  $('#psAddAbsence').addEventListener('click', () => {
    $('#psAbsences').insertAdjacentHTML('beforeend', absenceRow());
    $('#psAbsences .absence:last-child .ab-from').focus();
  });
  $('#psAbsences').addEventListener('click', e => {
    const del = e.target.closest('.ab-del');
    if (del) del.closest('.absence').remove();
  });
  $('#psAbsences').addEventListener('change', e => {
    // "bis" automatisch auf "von" setzen, wenn leer
    if (e.target.classList.contains('ab-from')) {
      const to = $('.ab-to', e.target.closest('.absence'));
      if (!to.value || to.value < e.target.value) to.value = e.target.value;
    }
  });

  // Regeltermin-Dialog
  $('#templateForm').addEventListener('submit', saveTemplateDialog);
  $('#tpDelete').addEventListener('click', () => {
    const id = editingTemplateId;
    mutate(() => { state.templates = state.templates.filter(t => t.id !== id); }, 'Regeltermin gelöscht');
    $('#templateDialog').close();
  });

  // Tastatur
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing && isEditing()) { e.preventDefault(); undo(); }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowLeft' && tag !== 'select') setMonth(view.y, view.m - 1);
    if (e.key === 'ArrowRight' && tag !== 'select') setMonth(view.y, view.m + 1);
  });

  // Online-Speicherung: nach Verbindungsabbruch erneut speichern, beim Schließen warnen
  window.addEventListener('beforeunload', e => {
    if (server.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // Änderungen aus einem anderen Tab übernehmen
  window.addEventListener('storage', e => {
    if (server.enabled || e.key !== STORAGE_KEY || !e.newValue) return;
    try { state = normalize(JSON.parse(e.newValue)); render(); fillSettings(); } catch (err) { /* ignorieren */ }
  });

  fillSettings();
  setSync('connecting');
  setMode('view');
  initServer();
}

init();
