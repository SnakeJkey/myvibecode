const fs = require('node:fs');
const { GAME_PROCESSES, matchesGame, listProcesses } = require('./gamewatch');

const KEEP_DAYS = 120;

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Границы последних `days` календарных суток по местному времени (последняя граница: начало завтрашнего дня).
function dayBoundaries(now, days) {
  const first = new Date(startOfDay(now));
  first.setDate(first.getDate() - (days - 1));
  const bounds = [];
  for (let i = 0; i <= days; i += 1) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    bounds.push(d.getTime());
  }
  return bounds;
}

function summarize(sessions, now = Date.now(), days = 7) {
  const bounds = dayBoundaries(now, days);
  const from = bounds[0];
  const to = bounds[days];
  const perDay = bounds.slice(0, days).map((start) => ({ start, total: 0, byGame: {} }));
  const games = {};
  let total = 0;

  for (const s of sessions) {
    if (s.end <= from || s.start >= to) continue;
    const game = (games[s.gameId] ||= { total: 0, sessions: 0, longest: 0, lastPlayed: 0 });
    game.lastPlayed = Math.max(game.lastPlayed, s.end);
    let counted = false;
    for (let i = 0; i < days; i += 1) {
      const overlap = Math.min(s.end, bounds[i + 1]) - Math.max(s.start, bounds[i]);
      if (overlap <= 0) continue;
      counted = true;
      perDay[i].total += overlap;
      perDay[i].byGame[s.gameId] = (perDay[i].byGame[s.gameId] || 0) + overlap;
      game.total += overlap;
      total += overlap;
    }
    if (counted) {
      game.sessions += 1;
      game.longest = Math.max(game.longest, Math.min(s.end, to) - Math.max(s.start, from));
    }
  }
  return { from, days: perDay, games, total };
}

// Учитывает время, пока GameHub открыт: каждые intervalMs смотрит, какие игры запущены,
// и записывает сеансы на диск. Сеанс, который остался открытым после сбоя, закрывается по последней отметке.
function createPlaytime({
  file,
  fsImpl = fs,
  list = listProcesses,
  now = Date.now,
  intervalMs = 15000,
  missesToEnd = 2,
  minSessionMs = 1000,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  onChange = () => {},
} = {}) {
  let sessions = [];
  let open = {};
  const misses = {};
  let timer = null;
  let running = false;

  function load() {
    try {
      const data = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
      const valid = (s) => s && typeof s.gameId === 'string' && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start;
      sessions = Array.isArray(data.sessions) ? data.sessions.filter(valid) : [];
      for (const [gameId, o] of Object.entries(data.open || {})) {
        if (Number.isFinite(o?.start) && Number.isFinite(o?.lastSeen)) close({ gameId, start: o.start, end: o.lastSeen });
      }
    } catch {
      /* файла ещё нет или он повреждён: статистика начинается с нуля */
    }
  }

  function close(session) {
    if (session.end - session.start >= minSessionMs) sessions.push(session);
  }

  function save() {
    const cutoff = now() - KEEP_DAYS * 86400000;
    sessions = sessions.filter((s) => s.end >= cutoff);
    try {
      fsImpl.writeFileSync(file, JSON.stringify({ sessions, open }));
    } catch {
      /* статистика просто не сохранится */
    }
  }

  async function tick() {
    let processes;
    try {
      processes = await list();
    } catch {
      return;
    }
    const time = now();
    let changed = false;
    for (const gameId of Object.keys(GAME_PROCESSES)) {
      if (matchesGame(processes, gameId)) {
        misses[gameId] = 0;
        if (!open[gameId]) {
          open[gameId] = { start: time, lastSeen: time };
          changed = true;
        } else open[gameId].lastSeen = time;
      } else if (open[gameId]) {
        misses[gameId] = (misses[gameId] || 0) + 1;
        if (misses[gameId] >= missesToEnd) {
          close({ gameId, start: open[gameId].start, end: open[gameId].lastSeen });
          delete open[gameId];
          changed = true;
        }
      }
    }
    if (Object.keys(open).length || changed) save();
    if (changed) onChange();
  }

  async function loop() {
    if (!running) return;
    await tick();
    if (running) timer = schedule(loop, intervalMs);
  }

  function start() {
    if (running) return;
    running = true;
    load();
    save();
    timer = schedule(loop, 0);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancel(timer);
    for (const [gameId, o] of Object.entries(open)) close({ gameId, start: o.start, end: Math.max(o.lastSeen, Math.min(now(), o.lastSeen + intervalMs)) });
    open = {};
    save();
  }

  function summary(days = 7) {
    const time = now();
    const live = Object.entries(open).map(([gameId, o]) => ({ gameId, start: o.start, end: Math.max(o.lastSeen, time) }));
    return { ...summarize([...sessions, ...live], time, days), playing: Object.keys(open) };
  }

  function reset() {
    sessions = [];
    for (const o of Object.values(open)) o.start = now();
    save();
    onChange();
  }

  return { start, stop, tick, summary, reset, isRunning: () => running };
}

module.exports = { createPlaytime, summarize, dayBoundaries };
