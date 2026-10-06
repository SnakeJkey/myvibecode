const { normalize } = require('./games');

const DEFAULT_TTL = 15 * 60 * 1000;
const LOAD_TIMEOUT = 60 * 1000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Превышено время ожидания источника')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createStore(games, { ttl = DEFAULT_TTL, loadTimeout = LOAD_TIMEOUT, now = Date.now } = {}) {
  const byId = new Map(games.map((g) => [g.id, g]));
  const entries = new Map();
  const inflight = new Map();

  function refresh(id) {
    if (inflight.has(id)) return inflight.get(id);
    const game = byId.get(id);
    const task = withTimeout(Promise.resolve().then(() => game.load()), loadTimeout)
      .then((raw) => {
        const entry = { data: normalize(raw), updatedAt: now(), error: null };
        entries.set(id, entry);
        return entry;
      })
      .catch((err) => {
        console.warn(`[${id}] ошибка обновления: ${err.message}`);
        const previous = entries.get(id);
        const entry = { data: previous?.data || null, updatedAt: previous?.updatedAt || null, error: err.message };
        entries.set(id, entry);
        return entry;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, task);
    return task;
  }

  async function get(id, { force = false } = {}) {
    if (!byId.has(id)) return null;
    const cached = entries.get(id);
    const fresh = cached && !cached.error && now() - cached.updatedAt < ttl;
    if (fresh && !force) return present(id, cached);
    if (cached?.data && !force) {
      refresh(id);
      return present(id, cached, { revalidating: true });
    }
    return present(id, await refresh(id));
  }

  function present(id, entry, extra = {}) {
    return {
      id,
      ok: Boolean(entry.data) && !entry.error,
      stale: Boolean(entry.data && entry.error),
      error: entry.error,
      updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : null,
      data: entry.data,
      ...extra,
    };
  }

  return { get, has: (id) => byId.has(id) };
}

module.exports = { createStore, DEFAULT_TTL };
