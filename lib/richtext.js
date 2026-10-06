const { decodeEntities } = require('./util');

const MAX_BLOCKS = 700;
const MAX_TEXT = 4000;
const STEAM_IMAGE_HOST = 'https://clan.fastly.steamstatic.com/images';

const cleanText = (s) =>
  decodeEntities(String(s))
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function safeImageUrl(raw, baseUrl) {
  if (!raw) return null;
  try {
    const url = new URL(decodeEntities(raw).trim(), baseUrl || undefined);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function createBuilder() {
  const blocks = [];
  let buf = '';
  let heading = null;
  let inQuote = 0;
  let li = null;
  const lists = [];

  const push = (block) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === block.type && last.text === block.text && last.src === block.src) return;
    if (blocks.length < MAX_BLOCKS) blocks.push(block);
  };

  const flush = () => {
    let text = cleanText(buf).slice(0, MAX_TEXT);
    buf = '';
    if (!text || /^[^\p{L}\p{N}]+$/u.test(text)) return;
    if (!heading && !li && !inQuote) {
      const marker = /^([·•・■▼▶◆●])\s*(?:\/\/\s*)?(.+)$/.exec(text);
      if (marker && marker[2].length > 1) {
        text = marker[2];
        if (marker[1] === '■' || marker[1] === '◆') return push({ type: 'h', level: 3, text });
        if (marker[1] === '▼' || marker[1] === '▶') return push({ type: 'h', level: 2, text });
        return push({ type: 'li', text, depth: 0, ordered: false });
      }
    }
    if (heading) push({ type: 'h', level: Math.min(Math.max(heading, 2), 4), text });
    else if (li) push({ type: 'li', text, depth: Math.max(0, li.depth), ordered: li.ordered });
    else if (inQuote) push({ type: 'quote', text });
    else push({ type: 'p', text });
  };

  return {
    blocks,
    text: (t) => {
      buf += t;
    },
    flush,
    takeText: () => {
      const t = cleanText(buf);
      buf = '';
      return t;
    },
    startHeading: (level) => {
      flush();
      heading = level;
    },
    endHeading: () => {
      flush();
      heading = null;
    },
    startList: (ordered) => {
      flush();
      lists.push({ ordered });
    },
    endList: () => {
      flush();
      lists.pop();
      li = null;
    },
    startItem: () => {
      flush();
      const list = lists[lists.length - 1] || { ordered: false };
      li = { depth: Math.max(0, lists.length - 1), ordered: list.ordered };
    },
    endItem: () => {
      flush();
      li = null;
    },
    startQuote: () => {
      flush();
      inQuote += 1;
    },
    endQuote: () => {
      flush();
      inQuote = Math.max(0, inQuote - 1);
    },
    isHeading: () => heading !== null,
    image: (src) => {
      flush();
      if (src) push({ type: 'img', src });
    },
    rule: () => {
      flush();
      push({ type: 'hr' });
    },
    paragraph: (text) => {
      flush();
      const t = cleanText(text);
      if (t) push({ type: 'p', text: t });
    },
    done: () => {
      flush();
      return blocks;
    },
  };
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? m[1] ?? m[2] ?? m[3] : null;
}

function htmlToBlocks(html, { baseUrl } = {}) {
  const src = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|video|iframe|template|form|button)\b[\s\S]*?<\/\1>/gi, ' ');
  const b = createBuilder();
  let row = null;

  for (const m of src.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)|</gi)) {
    if (m[4] !== undefined) {
      b.text(m[4]);
      continue;
    }
    if (!m[2]) continue;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';

    if (/^h[1-6]$/.test(tag)) {
      closing ? b.endHeading() : b.startHeading(Number(tag[1]));
    } else if (tag === 'ul' || tag === 'ol') {
      closing ? b.endList() : b.startList(tag === 'ol');
    } else if (tag === 'li') {
      closing ? b.endItem() : b.startItem();
    } else if (tag === 'blockquote') {
      closing ? b.endQuote() : b.startQuote();
    } else if (tag === 'img' && !closing) {
      const url = safeImageUrl(attr(attrs, 'src') || attr(attrs, 'data-src'), baseUrl);
      const width = Number(attr(attrs, 'width') || attr(attrs, 'data-width') || 0);
      if (url && !(width > 0 && width < 40)) b.image(url);
    } else if (tag === 'hr') {
      b.rule();
    } else if (tag === 'br') {
      b.isHeading() ? b.text(' ') : b.flush();
    } else if (tag === 'tr') {
      b.flush();
      if (!closing) row = [];
      else {
        if (row && row.length) b.paragraph(row.join(' | '));
        row = null;
      }
    } else if (tag === 'td' || tag === 'th') {
      if (!closing) b.flush();
      else if (row) {
        const cell = b.takeText();
        if (cell) row.push(cell);
      }
    } else if (['p', 'div', 'section', 'article', 'header', 'footer', 'table', 'figure', 'figcaption', 'pre', 'dl', 'dt', 'dd'].includes(tag)) {
      b.flush();
    }
  }
  return b.done();
}

const BB_TOKEN = /\[(\/?)([a-z0-9*]+)(?:=([^\]]*)|\s+([^\]]*))?\]|([^[]+)|\[/gi;

function bbcodeToBlocks(text) {
  const b = createBuilder();
  const skip = { tag: null, depth: 0 };
  let imgCapture = null;
  let row = null;

  const body = String(text || '').replace(/\r/g, '');
  for (const m of body.matchAll(BB_TOKEN)) {
    if (m[5] !== undefined) {
      if (skip.tag) continue;
      if (imgCapture !== null) {
        imgCapture += m[5];
        continue;
      }
      const parts = m[5].split('\n');
      parts.forEach((part, i) => {
        if (i > 0) b.flush();
        if (part) b.text(part);
      });
      continue;
    }
    if (!m[2]) {
      if (!skip.tag) b.text('[');
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const arg = (m[3] || m[4] || '').trim();

    if (skip.tag) {
      if (tag === skip.tag) skip.depth += closing ? -1 : 1;
      if (skip.depth <= 0) skip.tag = null;
      continue;
    }

    if (tag === 'previewyoutube' || tag === 'dynamiclink' || tag === 'spoiler_hidden') {
      if (!closing) {
        skip.tag = tag;
        skip.depth = 1;
      }
    } else if (tag === 'img') {
      if (!closing) {
        imgCapture = '';
        const direct = arg.match(/src="([^"]+)"/i);
        if (direct) imgCapture = direct[1];
      } else {
        const url = safeImageUrl((imgCapture || '').trim().replace('{STEAM_CLAN_IMAGE}', STEAM_IMAGE_HOST));
        b.image(url);
        imgCapture = null;
      }
    } else if (/^h[1-6]$/.test(tag)) {
      closing ? b.endHeading() : b.startHeading(Number(tag[1]));
    } else if (tag === 'list' || tag === 'olist') {
      closing ? b.endList() : b.startList(tag === 'olist' || /order/i.test(arg));
    } else if (tag === '*') {
      b.startItem();
    } else if (tag === 'quote') {
      closing ? b.endQuote() : b.startQuote();
    } else if (tag === 'hr') {
      b.rule();
    } else if (tag === 'tr') {
      b.flush();
      if (!closing) row = [];
      else {
        if (row && row.length) b.paragraph(row.join(' | '));
        row = null;
      }
    } else if (tag === 'td' || tag === 'th') {
      if (!closing) {
        b.flush();
      } else if (row) {
        const cellText = b.takeText();
        if (cellText) row.push(cellText);
      }
    } else if (tag === 'p' || tag === 'table') {
      b.flush();
    }
  }
  return b.done();
}

module.exports = { htmlToBlocks, bbcodeToBlocks, cleanText, safeImageUrl };
