import * as store from './store.js';
import { CurlCounter } from './reps.js';
import { CameraSource, SimSource, drawSilhouette } from './pose.js';

const REST_MS = 8000; // no rep for this long → set ends on its own
const IDLE_MS = 3 * 60000; // no reps or touches → auto check-out (protects privacy at a shared station)
const DONE_MS = 30000; // summary screen returns to idle

const app = document.getElementById('app');
const $ = (sel, root = app) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const S = {
  user: null,
  session: null,
  counter: null,
  source: null,
  currentSet: null, // { reps, start, lastRepAt }
  restStart: null,
  lastActivity: Date.now(),
  tick: null,
  doneTimer: null,
  forceSim: false,
};

try {
  S.forceSim = localStorage.getItem('setflow.sim') === '1';
} catch {}

// ---------- formatting ----------
const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const totalReps = (sess) => sess.sets.reduce((a, s) => a + s.reps, 0);
const volume = (sess) => sess.sets.reduce((a, s) => a + s.reps * s.weight, 0);

// ---------- routing ----------
function route() {
  stopAll();
  const m = location.hash.match(/^#\/history\/(.+)$/);
  document.body.classList.toggle('phone', !!m);
  if (m) return renderHistory(decodeURIComponent(m[1]));
  renderIdle();
}
window.addEventListener('hashchange', route);

function stopAll() {
  S.source?.stop();
  S.source = null;
  clearInterval(S.tick);
  clearTimeout(S.doneTimer);
}

// ---------- 1. Idle / check-in ----------
function renderIdle() {
  stopAll();
  S.user = S.session = S.currentSet = null;
  const users = store.listUsers();
  const hasWebNFC = 'NDEFReader' in window;
  app.className = 'screen idle';
  app.innerHTML = `
    <header class="station-head">
      <div class="brand">SetFlow</div>
      <div class="station-id">Station 1 · Single-arm bicep curl</div>
    </header>
    <section class="idle-main">
      <button class="tap-zone" id="tap-zone" type="button" aria-label="Tap phone to check in">
        <span class="ring"></span><span class="ring r2"></span>
        <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="14" y="5" width="20" height="38" rx="4" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M36 17c3 3 3 11 0 14M40 13c5 5 5 17 0 22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      </button>
      <div class="idle-copy">
        <h1>Tap your phone to start</h1>
        <p>SetFlow counts your reps and sets so you don't have to log them. The camera turns on only after you say yes.</p>
        <div class="sim-block">
          <div class="sim-label"><span class="tag sim">SIMULATED NFC</span> Choose who's tapping in</div>
          <div class="member-row">
            ${users.map((u) => `<button class="chip" data-user="${esc(u.id)}" type="button">${esc(u.name)}</button>`).join('')}
            <button class="chip ghost" id="new-member" type="button">+ New member</button>
          </div>
          <form id="new-form" class="new-form" hidden>
            <input id="new-name" maxlength="24" placeholder="First name" autocomplete="off" aria-label="First name" />
            <button class="btn small" type="submit">Check in</button>
          </form>
          ${hasWebNFC ? `<button class="btn ghost small" id="webnfc" type="button"><span class="tag real">REAL</span> Scan an NFC tag</button>` : ''}
        </div>
      </div>
    </section>`;

  app.querySelectorAll('[data-user]').forEach((b) => (b.onclick = () => checkIn(b.dataset.user)));
  $('#tap-zone').onclick = () => app.querySelector('[data-user]')?.focus();
  $('#new-member').onclick = () => {
    $('#new-form').hidden = false;
    $('#new-name').focus();
  };
  $('#new-form').onsubmit = (e) => {
    e.preventDefault();
    const name = $('#new-name').value.trim();
    if (!name) return;
    const u = store.upsertUser({ id: 'tag-' + store.uid(), name });
    checkIn(u.id);
  };
  $('#webnfc')?.addEventListener('click', async () => {
    try {
      const reader = new window.NDEFReader();
      await reader.scan();
      reader.onreading = ({ serialNumber }) => {
        const id = 'nfc-' + serialNumber;
        if (!store.getUser(id)) store.upsertUser({ id, name: 'Member ' + serialNumber.slice(-4) });
        checkIn(id);
      };
    } catch (err) {
      alert('NFC scan failed: ' + err.message);
    }
  });
}

function checkIn(userId) {
  S.user = store.getUser(userId);
  S.lastActivity = Date.now();
  if (!S.user.consent) renderConsent();
  else renderSetup();
}

// ---------- 2. Camera consent ----------
function renderConsent() {
  app.className = 'screen consent';
  app.innerHTML = `
    <header class="station-head">
      <div class="brand">SetFlow</div>
      <div class="who">Hi, ${esc(S.user.name)}</div>
    </header>
    <section class="consent-main">
      <h1>Before the camera turns on</h1>
      <ul class="facts">
        <li><b>The camera stays on this iPad.</b> Your pose is worked out here, and no video is saved or sent anywhere.</li>
        <li><b>You'll only see a simple figure</b>, never camera footage. Only one person is tracked at a time.</li>
        <li><b>The camera turns off when you check out</b> or step away for 3 minutes.</li>
        <li><b>Only your sets, reps and weight are kept</b>, and you can edit or delete them from your phone.</li>
      </ul>
      <div class="choice-grid">
        <button class="choice primary" data-mode="silhouette" type="button"><b>Use camera</b><span>Show my figure while I lift</span></button>
        <button class="choice" data-mode="countonly" type="button"><b>Camera, count only</b><span>Show just the rep count, no figure</span></button>
        <button class="choice" data-mode="manual" type="button"><b>No camera</b><span>I'll tap +1 myself</span></button>
      </div>
      <button class="link" id="cancel" type="button">Not me, cancel</button>
    </section>`;
  app.querySelectorAll('[data-mode]').forEach(
    (b) =>
      (b.onclick = () => {
        store.setConsent(S.user.id, b.dataset.mode);
        S.user = store.getUser(S.user.id);
        renderSetup();
      }),
  );
  $('#cancel').onclick = renderIdle;
}

// ---------- 3. Weight + arm (entered once) ----------
function renderSetup(midSession = false) {
  const last = store.lastSession(S.user.id);
  const prev = S.session || last;
  let weight = prev?.sets?.at(-1)?.weight ?? prev?.weight ?? 20;
  let unit = prev?.unit ?? 'lb';
  let arm = prev?.arm ?? 'right';
  const step = () => (unit === 'lb' ? 2.5 : 1);

  app.className = 'screen setup';
  app.innerHTML = `
    <header class="station-head">
      <div class="brand">SetFlow</div>
      <div class="who">${esc(S.user.name)}</div>
    </header>
    <section class="setup-main">
      <div class="setup-col">
        <h1>${midSession ? 'Change weight' : 'What are you lifting?'}</h1>
        ${last && !midSession ? `<p class="muted">Last time (${fmtDate(last.start)}): ${last.sets.map((s) => s.reps).join(' · ')} reps at ${last.sets.at(-1)?.weight ?? last.weight} ${last.unit}</p>` : '<p class="muted">You only enter this once. Every set after uses it.</p>'}
        <div class="weight">
          <button class="step" data-d="-2" type="button" aria-label="Decrease a lot">−−</button>
          <button class="step" data-d="-1" type="button" aria-label="Decrease">−</button>
          <div class="weight-val"><span id="w">${weight}</span><button id="unit" class="unit" type="button" aria-label="Toggle unit">${unit}</button></div>
          <button class="step" data-d="1" type="button" aria-label="Increase">+</button>
          <button class="step" data-d="2" type="button" aria-label="Increase a lot">++</button>
        </div>
        <div class="presets">${[10, 15, 20, 25, 30, 35, 40].map((p) => `<button class="chip" data-p="${p}" type="button">${p}</button>`).join('')}</div>
      </div>
      <div class="setup-col">
        <h2>Which arm?</h2>
        <div class="seg" role="radiogroup" aria-label="Arm">
          <button data-arm="left" role="radio" type="button">Left</button>
          <button data-arm="right" role="radio" type="button">Right</button>
        </div>
        <p class="muted small">Stand about 2 m away, with the arm you're curling toward the screen. It works best if your shoulder, elbow and wrist are all in view.</p>
        <button class="btn big" id="go" type="button">${midSession ? 'Save' : 'Start'}</button>
        ${midSession ? '' : '<button class="link" id="cancel" type="button">Cancel</button>'}
      </div>
    </section>`;

  const paint = () => {
    $('#w').textContent = weight;
    $('#unit').textContent = unit;
    app.querySelectorAll('[data-arm]').forEach((b) => b.setAttribute('aria-checked', b.dataset.arm === arm));
  };
  app.querySelectorAll('.step').forEach(
    (b) =>
      (b.onclick = () => {
        const d = Number(b.dataset.d);
        weight = Math.max(0, Math.round((weight + d * step()) * 10) / 10); // ±1 step or ±2 steps
        paint();
      }),
  );
  app.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => ((weight = Number(b.dataset.p)), paint())));
  app.querySelectorAll('[data-arm]').forEach((b) => (b.onclick = () => ((arm = b.dataset.arm), paint())));
  $('#unit').onclick = () => {
    unit = unit === 'lb' ? 'kg' : 'lb';
    weight = unit === 'kg' ? Math.round(weight / 2.2046) : Math.round((weight * 2.2046) / 2.5) * 2.5;
    paint();
  };
  $('#cancel')?.addEventListener('click', renderIdle);
  $('#go').onclick = () => {
    if (midSession) {
      closeSet();
      Object.assign(S.session, { weight, unit });
      if (arm !== S.session.arm) {
        S.session.arm = arm;
        S.counter = new CurlCounter(arm);
        if (S.source?.kind === 'sim') S.source.arm = arm;
      }
      store.saveSession(S.user.id, S.session);
      renderTrack(true);
    } else {
      S.session = {
        id: store.uid(),
        exercise: 'Single-arm bicep curl',
        station: 'Station 1',
        arm, unit, weight,
        start: Date.now(),
        end: null,
        sets: [],
      };
      renderTrack();
    }
  };
  paint();
}

// ---------- 4. Tracking ----------
function renderTrack(resume = false) {
  const mode = S.user.consent.mode; // silhouette | countonly | manual
  const usesCamera = mode !== 'manual';
  app.className = `screen track mode-${mode}`;
  app.innerHTML = `
    <section class="viz">
      <canvas id="sil" aria-hidden="true"></canvas>
      <div class="count-only" aria-hidden="true"><div class="big-ring"><span id="ring-reps">0</span></div></div>
      <div class="manual-only"><button class="mega-plus" id="mega-plus" type="button">+1 rep</button></div>
      <div class="cam-status" id="cam-status"></div>
      <div class="rom" aria-hidden="true"><div class="rom-fill" id="rom"></div><span>range</span></div>
      <div class="hint" id="hint"></div>
      <div class="sim-controls" id="sim-controls" hidden>
        <span class="tag sim">SIMULATED CAMERA</span>
        <button class="btn small" id="sim-one" type="button">Do 1 curl</button>
        <button class="btn small ghost" id="sim-auto" type="button" aria-pressed="false">Auto-curl: off</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-top">
        <div class="who">${esc(S.user.name)}</div>
        <button class="link" id="change" type="button"><span id="wt">${S.session.weight} ${S.session.unit}</span> · ${S.session.arm} arm ✎</button>
      </div>
      <div class="set-label" id="set-label">Set 1</div>
      <div class="reps-wrap">
        <button class="adj" id="minus" type="button" aria-label="Remove one rep">−</button>
        <div class="reps" id="reps" aria-live="polite">0</div>
        <button class="adj" id="plus" type="button" aria-label="Add one rep">+</button>
      </div>
      <div class="state" id="state">Ready when you are</div>
      <div class="timer-row"><span id="timer-label">Set</span><span id="timer">0:00</span></div>
      <button class="btn ghost" id="end-set" type="button">End set</button>
      <ol class="sets" id="sets"></ol>
      <div class="panel-foot">
        <button class="btn checkout" id="checkout" type="button">Tap phone to check out <span class="tag sim">SIM</span></button>
      </div>
    </section>`;

  S.counter = new CurlCounter(S.session.arm);
  if (!resume) {
    S.currentSet = null;
    S.restStart = null;
  }
  paintSets();
  paintCurrent();

  $('#plus').onclick = () => adjust(1);
  $('#minus').onclick = () => adjust(-1);
  $('#mega-plus').onclick = () => addRep();
  $('#end-set').onclick = () => closeSet();
  $('#checkout').onclick = () => checkOut();
  $('#change').onclick = () => {
    S.source?.stop();
    S.source = null;
    clearInterval(S.tick);
    renderSetup(true);
  };
  app.addEventListener('pointerdown', () => (S.lastActivity = Date.now()));

  if (usesCamera) startSource(mode);
  else setCamStatus('off', 'Camera off · counting by tap');

  clearInterval(S.tick);
  S.tick = setInterval(onTick, 250);
}

async function startSource(mode) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const body = getComputedStyle(document.documentElement).getPropertyValue('--figure').trim();
  const canvas = $('#sil');
  const onFrame = (lm) => {
    if (!S.counter) return;
    const r = S.counter.update(lm);
    if (mode === 'silhouette') drawSilhouette(canvas, lm, { arm: S.session.arm, accent, body });
    const rom = $('#rom');
    if (rom) rom.style.height = `${Math.round((r.progress ?? 0) * 100)}%`;
    const hint = $('#hint');
    if (hint) hint.textContent = !lm ? 'Step into view' : !r.visible ? `Turn so your ${S.session.arm} arm faces the screen` : '';
    if (r.rep) addRep();
  };

  const useSim = () => {
    S.source = new SimSource(onFrame, S.session.arm);
    S.source.start();
    setCamStatus('sim', 'Simulated camera · no real camera in use');
    const sc = $('#sim-controls');
    sc.hidden = false;
    $('#sim-one').onclick = () => S.source.oneRep();
    $('#sim-auto').onclick = (e) => {
      S.source.auto = !S.source.auto;
      e.currentTarget.setAttribute('aria-pressed', S.source.auto);
      e.currentTarget.textContent = `Auto-curl: ${S.source.auto ? 'on' : 'off'}`;
    };
  };

  if (S.forceSim || !navigator.mediaDevices?.getUserMedia) return useSim();

  setCamStatus('loading', 'Starting the tracker…');
  try {
    const src = new CameraSource(onFrame);
    S.source = src;
    await src.start();
    if (S.source !== src) return src.stop(); // left the screen while loading
    setCamStatus('on', 'Camera on · stays on this iPad · not recorded');
  } catch (err) {
    console.warn('camera failed', err);
    S.source = null;
    setCamStatus('off', `Camera unavailable (${err.name || 'error'})`);
    const hint = $('#hint');
    if (hint) {
      hint.innerHTML = `Couldn't start the camera. <button class="btn small" id="fallback-sim" type="button">Use simulated camera</button>`;
      $('#fallback-sim').onclick = () => ((hint.textContent = ''), useSim());
    }
  }
}

function setCamStatus(kind, text) {
  const el = $('#cam-status');
  if (el) el.innerHTML = `<span class="dot ${kind}"></span>${esc(text)}`;
}

function addRep() {
  const now = Date.now();
  S.lastActivity = now;
  if (!S.currentSet) {
    S.currentSet = { reps: 0, start: now, lastRepAt: now };
    S.restStart = null;
  }
  S.currentSet.reps++;
  S.currentSet.lastRepAt = now;
  paintCurrent(true);
}

function adjust(d) {
  S.lastActivity = Date.now();
  if (S.currentSet) {
    S.currentSet.reps = Math.max(0, S.currentSet.reps + d);
    S.currentSet.edited = true;
    S.currentSet.lastRepAt = Date.now(); // a correction shouldn't end the set early
    paintCurrent();
  } else if (d > 0) {
    addRep();
    S.currentSet.edited = true;
  } else if (S.session.sets.length) {
    editSaved(S.session.sets.length - 1, -1);
  }
}

function editSaved(i, d) {
  const s = S.session.sets[i];
  s.reps = Math.max(0, s.reps + d);
  s.edited = true;
  if (s.reps === 0) S.session.sets.splice(i, 1);
  store.saveSession(S.user.id, S.session);
  paintSets();
  paintCurrent();
}

function closeSet() {
  const c = S.currentSet;
  if (!c) return;
  if (c.reps > 0) {
    S.session.sets.push({
      reps: c.reps,
      weight: S.session.weight,
      start: c.start,
      durationMs: c.lastRepAt - c.start,
      edited: !!c.edited,
    });
    store.saveSession(S.user.id, S.session); // save every set so nothing is lost if the station restarts
  }
  S.currentSet = null;
  S.restStart = Date.now();
  paintSets();
  paintCurrent();
}

function onTick() {
  const now = Date.now();
  if (S.currentSet && now - S.currentSet.lastRepAt > REST_MS) closeSet();
  if (now - S.lastActivity > IDLE_MS) return checkOut(true);

  const label = $('#timer-label');
  const timer = $('#timer');
  if (!timer) return;
  if (S.currentSet) {
    label.textContent = 'Set time';
    timer.textContent = fmtTime(now - S.currentSet.start);
    const left = REST_MS - (now - S.currentSet.lastRepAt);
    $('#state').textContent = left < 5000 ? `Set ends in ${Math.ceil(left / 1000)}s if you stop` : 'Counting…';
  } else if (S.restStart) {
    label.textContent = 'Rest';
    timer.textContent = fmtTime(now - S.restStart);
  } else {
    label.textContent = 'Session';
    timer.textContent = fmtTime(now - S.session.start);
  }
}

function paintCurrent(pulse = false) {
  const reps = S.currentSet?.reps ?? 0;
  const n = S.session.sets.length + (S.currentSet ? 1 : 0) || 1;
  const repsEl = $('#reps');
  if (!repsEl) return;
  repsEl.textContent = reps;
  $('#ring-reps').textContent = reps;
  $('#set-label').textContent = S.currentSet ? `Set ${n}` : S.session.sets.length ? `Set ${n + 1} · resting` : 'Set 1';
  $('#state').textContent = S.currentSet ? 'Counting…' : S.session.sets.length ? 'Start curling to begin the next set' : 'Ready when you are';
  $('#end-set').disabled = !S.currentSet;
  if (pulse) {
    for (const el of [repsEl, $('#ring-reps')]) {
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
    }
  }
}

function paintSets() {
  const ol = $('#sets');
  if (!ol) return;
  ol.innerHTML = S.session.sets
    .map(
      (s, i) => `<li>
        <span class="n">${i + 1}</span>
        <span class="r">${s.reps} reps</span>
        <span class="w">${s.weight} ${S.session.unit}${s.edited ? ' · edited' : ''}</span>
        <span class="ed"><button data-i="${i}" data-d="-1" type="button" aria-label="Remove a rep from set ${i + 1}">−</button><button data-i="${i}" data-d="1" type="button" aria-label="Add a rep to set ${i + 1}">+</button></span>
      </li>`,
    )
    .reverse()
    .join('');
  ol.querySelectorAll('button').forEach((b) => (b.onclick = () => editSaved(Number(b.dataset.i), Number(b.dataset.d))));
}

// ---------- 5. Check-out summary ----------
function checkOut(auto = false) {
  closeSet();
  stopAll();
  S.counter = null;
  const sess = S.session;
  sess.end = Date.now();
  const prev = store.getUser(S.user.id).sessions.filter((s) => s.id !== sess.id).at(-1);
  if (sess.sets.length) store.saveSession(S.user.id, sess);

  const historyUrl = `${location.origin}${location.pathname}#/history/${encodeURIComponent(S.user.id)}`;
  const tr = totalReps(sess);
  const delta = prev ? tr - totalReps(prev) : null;

  app.className = 'screen summary';
  app.innerHTML = `
    <header class="station-head">
      <div class="brand">SetFlow</div>
      <div class="who">${auto ? 'Checked out automatically after 3 min idle' : 'Checked out'}</div>
    </header>
    <section class="summary-main">
      <div class="sum-col">
        <h1>Nice work, ${esc(S.user.name)}.</h1>
        ${
          sess.sets.length
            ? `<div class="stats">
                <div><b>${sess.sets.length}</b><span>sets</span></div>
                <div><b>${tr}</b><span>reps</span></div>
                <div><b>${Math.round(volume(sess))}</b><span>${sess.unit} total</span></div>
                <div><b>${fmtTime(sess.end - sess.start)}</b><span>time</span></div>
              </div>
              <p class="sum-line">${sess.sets.map((s) => `${s.reps}×${s.weight}`).join('  ·  ')} ${sess.unit}</p>
              ${delta != null ? `<p class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta} reps compared with last time</p>` : ''}`
            : '<p class="muted">No sets were recorded, so nothing was saved.</p>'
        }
        <p class="privacy">● The camera is off, and this session has been cleared from the station.</p>
        <button class="btn big" id="done" type="button">Done <span id="cd"></span></button>
      </div>
      <div class="sum-col qr-col">
        <div id="qr" class="qr"></div>
        <p>Scan to see your history on your phone</p>
        <a class="link" href="#/history/${encodeURIComponent(S.user.id)}" target="_blank" rel="noopener">Open phone view</a>
        <p class="small muted"><span class="tag sim">SIMULATED SYNC</span> History is stored on this device for now.</p>
      </div>
    </section>`;

  if (window.QRCode) new window.QRCode($('#qr'), { text: historyUrl, width: 180, height: 180, colorDark: '#0f100d', colorLight: '#ffffff' });
  const end = Date.now() + DONE_MS;
  const cd = () => {
    const left = Math.ceil((end - Date.now()) / 1000);
    const el = $('#cd');
    if (!el) return;
    if (left <= 0) return renderIdle();
    el.textContent = `(${left})`;
    S.doneTimer = setTimeout(cd, 500);
  };
  cd();
  $('#done').onclick = renderIdle;
}

// ---------- 6. Phone history ----------
function renderHistory(userId) {
  const u = store.getUser(userId);
  app.className = 'screen history';
  if (!u) {
    app.innerHTML = `<section class="h-wrap"><h1>No history found</h1><p class="muted">This phone view reads this device's storage (simulated sync). Open it on the same device as the station.</p><a class="link" href="#">Back to station</a></section>`;
    return;
  }
  const sessions = [...u.sessions].sort((a, b) => b.start - a.start);
  const chron = [...sessions].reverse().slice(-8);
  const best = Math.max(0, ...u.sessions.flatMap((s) => s.sets.map((x) => x.weight)));

  app.innerHTML = `
    <section class="h-wrap">
      <header class="h-head">
        <div>
          <div class="brand small">SetFlow</div>
          <h1>${esc(u.name)}'s curls</h1>
        </div>
        <a class="link" href="#">Station</a>
      </header>
      <p class="small muted"><span class="tag sim">SIMULATED SYNC</span> In the beta this will come from the cloud; for now it's read from this device.</p>
      ${
        sessions.length
          ? `<div class="h-stats">
              <div><b>${u.sessions.length}</b><span>sessions</span></div>
              <div><b>${u.sessions.reduce((a, s) => a + totalReps(s), 0)}</b><span>total reps</span></div>
              <div><b>${best}</b><span>top weight</span></div>
            </div>
            <h2>Total weight lifted per session</h2>
            ${chart(chron)}
            <h2>Sessions</h2>
            <ul class="h-list">${sessions
              .map(
                (s) => `<li>
                <div class="h-row"><b>${fmtDate(s.start)}</b><span class="muted small">${s.arm} arm · ${fmtTime((s.end || s.start) - s.start)}${s.demo ? ' · demo data' : ''}</span></div>
                <div class="h-sets">${s.sets.map((x) => `<span>${x.reps}<small>×${x.weight}${s.unit}${x.edited ? '*' : ''}</small></span>`).join('')}</div>
                <button class="link danger" data-del="${esc(s.id)}" type="button">Delete</button>
              </li>`,
              )
              .join('')}</ul>
            <p class="small muted">* edited by hand</p>
            <button class="btn ghost" id="csv" type="button">Export CSV</button>`
          : '<p class="muted">No sessions yet. Check in at the station to record your first one.</p>'
      }
    </section>`;

  app.querySelectorAll('[data-del]').forEach(
    (b) =>
      (b.onclick = () => {
        if (!confirm('Delete this session? This cannot be undone.')) return;
        store.deleteSession(userId, b.dataset.del);
        renderHistory(userId);
      }),
  );
  $('#csv')?.addEventListener('click', () => {
    const rows = [['date', 'exercise', 'arm', 'set', 'reps', 'weight', 'unit', 'edited']];
    for (const s of [...u.sessions].sort((a, b) => a.start - b.start))
      s.sets.forEach((x, i) => rows.push([new Date(s.start).toISOString(), s.exercise, s.arm, i + 1, x.reps, x.weight, s.unit, x.edited]));
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `setflow-${u.name.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function chart(sessions) {
  if (sessions.length < 2) return '<p class="muted small">The trend shows up after two sessions.</p>';
  const vals = sessions.map(volume);
  const W = 320, H = 120, pad = 24;
  const max = Math.max(...vals) * 1.1;
  const x = (i) => pad + (i * (W - pad * 2)) / (vals.length - 1);
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Total weight lifted per session, from ${Math.round(vals[0])} to ${Math.round(vals.at(-1))}">
    <line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" class="axis"/>
    <polyline points="${pts}" class="line"/>
    ${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" class="pt"><title>${fmtDate(sessions[i].start)}: ${Math.round(v)}</title></circle>`).join('')}
    <text x="${x(vals.length - 1)}" y="${y(vals.at(-1)) - 9}" text-anchor="end" class="lbl">${Math.round(vals.at(-1))}</text>
    <text x="${pad}" y="${H - 6}" class="lbl muted">${fmtDate(sessions[0].start)}</text>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" class="lbl muted">${fmtDate(sessions.at(-1).start)}</text>
  </svg>`;
}

// ---------- prototype panel ----------
const protoBtn = document.getElementById('proto-btn');
const protoPanel = document.getElementById('proto-panel');
protoBtn.onclick = () => {
  protoPanel.hidden = !protoPanel.hidden;
  protoBtn.setAttribute('aria-expanded', !protoPanel.hidden);
};
const simToggle = document.getElementById('sim-toggle');
simToggle.checked = S.forceSim;
simToggle.onchange = () => {
  S.forceSim = simToggle.checked;
  try {
    localStorage.setItem('setflow.sim', S.forceSim ? '1' : '0');
  } catch {}
};
document.getElementById('reset-data').onclick = () => {
  if (!confirm('Reset all members and sessions to the demo data?')) return;
  store.resetAll();
  location.hash = '';
  route();
};
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && S.source?.kind === 'sim' && e.target === document.body) {
    e.preventDefault();
    S.source.oneRep();
  }
});

route();
