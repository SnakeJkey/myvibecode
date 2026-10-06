const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 GameTracker/1.0';

const DAY = 24 * 60 * 60 * 1000;

async function fetchRaw(url, { timeout = 15000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
  return res;
}

async function fetchJson(url, options) {
  return (await fetchRaw(url, options)).json();
}

async function fetchText(url, options) {
  return (await fetchRaw(url, options)).text();
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function stripHtml(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function stripBBCode(text) {
  return String(text)
    .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, ' ')
    .replace(/\[previewyoutube[^\]]*\][\s\S]*?\[\/previewyoutube\]/gi, ' ')
    .replace(/\[previewyoutube=[^\]]*\]/gi, ' ')
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[\/?[a-z0-9]+(?:=[^\]]*)?\]/gi, ' ')
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, max = 220) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).replace(/[\s,.;:–—-]+$/, '')}…`;
}

function toIso(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function byDateDesc(a, b) {
  return new Date(b.date || 0) - new Date(a.date || 0);
}

function byDateAsc(a, b) {
  return new Date(a.date || 0) - new Date(b.date || 0);
}

function averageGapDays(dates) {
  const times = dates.map((d) => new Date(d).getTime()).filter(Number.isFinite).sort((a, b) => b - a);
  if (times.length < 2) return null;
  let total = 0;
  for (let i = 0; i < times.length - 1; i++) total += times[i] - times[i + 1];
  return Math.round(total / (times.length - 1) / DAY);
}

module.exports = {
  DAY,
  USER_AGENT,
  fetchJson,
  fetchText,
  decodeEntities,
  stripHtml,
  stripBBCode,
  truncate,
  toIso,
  byDateDesc,
  byDateAsc,
  averageGapDays,
};
