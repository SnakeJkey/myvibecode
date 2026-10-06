const fs = require('node:fs');
const path = require('node:path');
const { USER_AGENT } = require('./util');

const REQUEST_TIMEOUT = 8000;
const COOLDOWN_MS = 3 * 60 * 1000;
const MAX_CACHE_ENTRIES = 6000;
const TRANSLATABLE_KEYS = new Set(['title', 'subtitle', 'summary', 'value']);
const MARK_RE = /⟦([\s\S]*?)⟧/g;

const GLOSSARY = [
  [/Майнкрафт/g, 'Minecraft'],
  [/Хартс оф Айрон|Сердца железа/g, 'Hearts of Iron'],
  [/Уголок(?:ка)? разработчик(?:а|ов)/gi, 'Dev Corner'],
  [/Мир танков/g, 'World of Tanks'],
  [/Мир кораблей/g, 'World of Warships'],
];

const applyGlossary = (text) => GLOSSARY.reduce((acc, [re, repl]) => acc.replace(re, repl), text);

const hasCyrillic = (s) => /[А-Яа-яЁё]/.test(s);
const needsTranslation = (s) => typeof s === 'string' && /[A-Za-z]{3,}/.test(s) && !hasCyrillic(s);

function chunkText(text, max) {
  if (text.length <= max) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';
  const push = () => {
    if (current) chunks.push(current);
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > max) {
      push();
      for (let i = 0; i < sentence.length; i += max) chunks.push(sentence.slice(i, i + max));
      continue;
    }
    if (current && current.length + sentence.length + 1 > max) push();
    current = current ? `${current} ${sentence}` : sentence;
  }
  push();
  return chunks;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const googleProvider = {
  name: 'google',
  maxChunk: 700,
  async translate(text) {
    const url = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=ru&dt=t&q=${encodeURIComponent(text)}`;
    const json = await getJson(url);
    const out = (json?.[0] || []).map((part) => part?.[0] || '').join('');
    if (!out) throw new Error('пустой ответ');
    return out;
  },
};

const myMemoryProvider = {
  name: 'mymemory',
  maxChunk: 450,
  async translate(text) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ru`;
    const json = await getJson(url);
    const out = json?.responseData?.translatedText;
    if (Number(json?.responseStatus) !== 200 || !out || /MYMEMORY WARNING|INVALID/i.test(out)) throw new Error('лимит или ошибка сервиса');
    return out;
  },
};

function loadCache(file) {
  if (!file) return new Map();
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
  } catch {
    return new Map();
  }
}

function createTranslator({ cacheFile = null, providers = [googleProvider, myMemoryProvider], concurrency = 6, now = Date.now } = {}) {
  const cache = loadCache(cacheFile);
  const cooldownUntil = new Map();
  let saveTimer = null;

  function scheduleSave() {
    if (!cacheFile || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        const entries = [...cache.entries()].slice(-MAX_CACHE_ENTRIES);
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(entries)));
      } catch {
        /* кэш перевода не критичен */
      }
    }, 500);
    saveTimer.unref?.();
  }

  async function translate(text) {
    if (cache.has(text)) return applyGlossary(cache.get(text));
    for (const provider of providers) {
      if ((cooldownUntil.get(provider.name) || 0) > now()) continue;
      try {
        const parts = [];
        for (const chunk of chunkText(text, provider.maxChunk || 450)) parts.push(await provider.translate(chunk));
        const result = applyGlossary(parts.join(' ').replace(/\s+/g, ' ').trim());
        if (!result) throw new Error('пустой перевод');
        cache.set(text, result);
        scheduleSave();
        return result;
      } catch (err) {
        cooldownUntil.set(provider.name, now() + COOLDOWN_MS);
        console.warn(`[translate] ${provider.name}: ${err.message}`);
      }
    }
    return null;
  }

  async function translateMany(texts) {
    const unique = [...new Set(texts)];
    const results = new Map();
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const text = unique[next++];
        results.set(text, await translate(text));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
    return results;
  }

  function collect(node, targets) {
    if (Array.isArray(node)) {
      node.forEach((child) => collect(child, targets));
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && TRANSLATABLE_KEYS.has(key)) targets.push({ node, key, text: value });
      else if (value && typeof value === 'object') collect(value, targets);
    }
  }

  async function localize(data) {
    const targets = [];
    collect(data, targets);

    const pending = [];
    for (const target of targets) {
      if (target.text.includes('⟦')) {
        for (const m of target.text.matchAll(MARK_RE)) if (needsTranslation(m[1])) pending.push(m[1]);
      } else if (needsTranslation(target.text)) {
        pending.push(target.text);
      }
    }

    const results = await translateMany(pending);
    const stats = { translated: 0, failed: 0 };
    for (const [, value] of results) value === null ? stats.failed++ : stats.translated++;

    for (const target of targets) {
      const { node, key, text } = target;
      if (text.includes('⟦')) {
        node[key] = text.replace(MARK_RE, (_, inner) => results.get(inner) || inner);
      } else if (results.has(text)) {
        const translated = results.get(text);
        if (translated) {
          node[key] = translated;
          node[`${key}Original`] = text;
        }
      }
    }
    return { data, stats };
  }

  return { translate, translateMany, localize, needsTranslation };
}

module.exports = { createTranslator, needsTranslation, chunkText, googleProvider, myMemoryProvider };
