// Local data store.
// SIMULATED: in the prototype everything lives in this browser's localStorage.
// Beta: swap these functions for a hosted DB (e.g. Supabase/Firebase) keyed by the
// member's NFC tag ID so the phone history view reads the same records.

const KEY = 'setflow.v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { users: {} };
  } catch {
    return { users: {} };
  }
}

function save(db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* storage unavailable (private mode): keep working in memory */
  }
}

let db = load();

export const uid = () => Math.random().toString(36).slice(2, 10);

export function getUser(id) {
  return db.users[id] || null;
}

export function listUsers() {
  return Object.values(db.users);
}

export function upsertUser(user) {
  db.users[user.id] = { sessions: [], consent: null, ...db.users[user.id], ...user };
  save(db);
  return db.users[user.id];
}

export function setConsent(userId, mode) {
  db.users[userId].consent = { mode, at: Date.now() };
  save(db);
}

export function saveSession(userId, session) {
  const u = db.users[userId];
  const i = u.sessions.findIndex((s) => s.id === session.id);
  if (i >= 0) u.sessions[i] = session;
  else u.sessions.push(session);
  save(db);
}

export function deleteSession(userId, sessionId) {
  const u = db.users[userId];
  u.sessions = u.sessions.filter((s) => s.id !== sessionId);
  save(db);
}

export function lastSession(userId) {
  const s = db.users[userId]?.sessions || [];
  return s.length ? s[s.length - 1] : null;
}

export function resetAll() {
  db = { users: {} };
  save(db);
  seedDemo();
}

// Demo members with a few past sessions so history and comparisons have something to show.
export function seedDemo() {
  if (Object.keys(db.users).length) return;
  const day = 86400000;
  const mk = (daysAgo, weight, reps) => {
    const start = Date.now() - daysAgo * day;
    return {
      id: uid(),
      exercise: 'Single-arm bicep curl',
      arm: 'right',
      unit: 'lb',
      weight,
      start,
      end: start + 9 * 60000,
      demo: true,
      sets: reps.map((r, i) => ({ reps: r, weight, start: start + i * 150000, durationMs: r * 2100, edited: false })),
    };
  };
  upsertUser({
    id: 'tag-04A1', name: 'Alex', demo: true,
    sessions: [mk(12, 20, [10, 9, 8]), mk(8, 20, [11, 10, 9]), mk(4, 25, [8, 8, 7]), mk(1, 25, [9, 8, 8])],
  });
  upsertUser({
    id: 'tag-07C3', name: 'Jordan', demo: true,
    sessions: [mk(6, 15, [12, 12, 10]), mk(2, 15, [12, 12, 12])],
  });
  upsertUser({ id: 'tag-0B9F', name: 'Sam', demo: true, sessions: [] });
}

seedDemo();
