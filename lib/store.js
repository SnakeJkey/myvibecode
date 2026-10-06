const { normalize } = require('./games');

const DEFAULT_TTL = 15 * 60 * 1000;
const LOAD_TIMEOUT = 60 * 1000;
const TRANSLATE_TIMEOUT = 45 * 1000;
const ARTICLE_TTL = 30 * 60 * 1000;
const ARTICLE_TIMEOUT = 40 * 1000;
const TEXT_BLOCKS = new Set(['h', 'p', 'li', 'quote']);

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Превышено время ожидания источника')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createStore(games, { ttl = DEFAULT_TTL, loadTimeout = LOAD_TIMEOUT, now = Date.now, localize = null, translateBlocks = null } = {}) {
  const byId = new Map(games.map((g) => [g.id, g]));
  const entries = new Map();
  const inflight = new Map();
  const articles = new Map();
  const articleInflight = new Map();

  function refresh(id) {
    if (inflight.has(id)) return inflight.get(id);
    const game = byId.get(id);
    const task = withTimeout(Promise.resolve().then(() => game.load()), loadTimeout)
      .then(async (raw) => {
        let data = normalize(raw);
        let translation = null;
        if (localize) {
          try {
            ({ data, stats: translation } = await withTimeout(localize(data), TRANSLATE_TIMEOUT));
          } catch (err) {
            console.warn(`[${id}] перевод пропущен: ${err.message}`);
            translation = { translated: 0, failed: -1 };
          }
        }
        const entry = { data, translation, updatedAt: now(), error: null };
        entries.set(id, entry);
        return entry;
      })
      .catch((err) => {
        console.warn(`[${id}] ошибка обновления: ${err.message}`);
        const previous = entries.get(id);
        const entry = { data: previous?.data || null, translation: previous?.translation || null, updatedAt: previous?.updatedAt || null, error: err.message };
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
      translation: entry.translation || null,
      ...extra,
    };
  }

  async function buildArticle(game, ref) {
    const raw = await withTimeout(Promise.resolve().then(() => game.article(ref)), ARTICLE_TIMEOUT);
    const blocks = (raw.blocks || []).map((b) => ({ ...b }));
    let translated = 0;
    let failed = 0;
    if (translateBlocks) {
      const indexes = blocks.map((b, i) => (TEXT_BLOCKS.has(b.type) ? i : -1)).filter((i) => i >= 0);
      try {
        const results = await withTimeout(translateBlocks(indexes.map((i) => blocks[i].text)), TRANSLATE_TIMEOUT);
        indexes.forEach((i, k) => {
          const result = results[k];
          if (result === null || result === undefined) failed += 1;
          else if (result !== blocks[i].text) {
            blocks[i].original = blocks[i].text;
            blocks[i].text = result;
            translated += 1;
          }
        });
      } catch (err) {
        console.warn(`[${game.id}] перевод статьи пропущен: ${err.message}`);
        failed = -1;
      }
    }
    return { ref, url: raw.url || null, blocks, translation: { translated, failed } };
  }

  async function getArticle(id, ref) {
    const game = byId.get(id);
    if (!game) return null;
    if (!game.article || !ref) return { ok: false, error: 'Для этой новости нет полного текста' };
    const key = `${id}|${ref}`;
    const cached = articles.get(key);
    if (cached && now() - cached.at < ARTICLE_TTL) return { ok: true, article: cached.article };
    if (!articleInflight.has(key)) {
      articleInflight.set(
        key,
        buildArticle(game, ref)
          .then((article) => {
            articles.set(key, { at: now(), article });
            return { ok: true, article };
          })
          .catch((err) => {
            console.warn(`[${id}] статья ${ref}: ${err.message}`);
            return { ok: false, error: err.message };
          })
          .finally(() => articleInflight.delete(key))
      );
    }
    return articleInflight.get(key);
  }

  return { get, getArticle, has: (id) => byId.has(id) };
}

module.exports = { createStore, DEFAULT_TTL };
