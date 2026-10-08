const { htmlToBlocks } = require('./richtext');
const { DAY, fetchText, stripHtml, decodeEntities, truncate, toIso, byDateDesc, byDateAsc } = require('./util');

const SITE = 'https://worldoftanks.eu';
const RSS_URL = `${SITE}/en/rss/news/`;
const UPDATES_URL = `${SITE}/en/news/updates/`;
const RU_RSS_URL = `${SITE}/ru/rss/news/`;
const RU_UPDATES_URL = `${SITE}/ru/news/updates/`;

const newsPath = (url) => String(url || '').replace(/^https:\/\/worldoftanks\.eu\/(?:en|ru)\/news\//, '').replace(/\/$/, '');
const toRussianUrl = (url) => String(url || '').replace('/en/news/', '/ru/news/');
const toEnglishUrl = (url) => String(url || '').replace('/ru/news/', '/en/news/');

const CATEGORY_TAGS = {
  event: 'event',
  special: 'special',
  'battle pass': 'battlepass',
  'competitive gaming': 'competitive',
  livestream: 'stream',
  update: 'update',
};

function unwrapCdata(text) {
  return String(text).replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
}

function tagValue(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? unwrapCdata(m[1]).trim() : null;
}

function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const link = tagValue(block, 'link');
    const title = tagValue(block, 'title');
    if (!link || !title) continue;
    const pubDate = tagValue(block, 'pubDate');
    const description = tagValue(block, 'description') || '';
    const description2 = stripHtml(description.replace(/<a[^>]*>\s*(Read more|Discuss)\s*<\/a>/gi, ''));
    items.push({
      title: decodeEntities(title),
      url: link,
      date: pubDate ? toIso(pubDate) : null,
      summary: truncate(description2, 240),
      image: (block.match(/<enclosure[^>]*url="([^"]+)"/i) || [])[1] || null,
      section: (link.match(/\/en\/news\/([^/]+)\//) || [])[1] || 'news',
    });
  }
  return items;
}

function parseUpdatesPage(html) {
  const items = [];
  const re = /"preview_thumb":\s*"([^"]*)",\s*"publication_start":\s*([\d.]+),\s*"title":\s*"((?:[^"\\]|\\.)*)",\s*"url":\s*"([^"]+)"/g;
  for (const m of html.matchAll(re)) {
    let title;
    try {
      title = JSON.parse(`"${m[3]}"`).replace(/\u00a0/g, ' ');
    } catch {
      continue;
    }
    items.push({
      title,
      url: `${SITE}${m[4]}`,
      date: toIso(Number(m[2]) * 1000),
      image: m[1] ? `https:${m[1]}`.replace(/^https:https:/, 'https:') : null,
      summary: '',
      section: 'updates',
    });
  }
  return items;
}

function parseMonthlyCalendar(html) {
  const events = [];
  const re = /<div class="pcg-events_item"([^>]*)>([\s\S]*?)(?=<div class="pcg-events_item"|<!-- \/Events -->|$)/g;
  for (const m of html.matchAll(re)) {
    const attrs = m[1];
    const body = m[2];
    const start = (attrs.match(/data-start-date="([^"]+)"/) || [])[1];
    const end = (attrs.match(/data-end-date="([^"]+)"/) || [])[1];
    const title = (body.match(/pcg-events_item-title">([\s\S]*?)<\/div>/) || [])[1];
    if (!start || !end || !title) continue;
    const category = stripHtml((body.match(/pcg-events_item-category">([\s\S]*?)<\/div>/) || [])[1] || '');
    const popup = (body.match(/pcg-events_item-popup"([^>]*)>([\s\S]*)/) || []);
    const image = (popup[1] || '').match(/data-preview-image="([^"]+)"/)?.[1] || null;
    const paragraph = (popup[2] || '').match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const link = (popup[2] || '').match(/<a[^>]*href="(https?:[^"]+)"/)?.[1] || null;
    events.push({
      title: stripHtml(title),
      category,
      start,
      end,
      summary: truncate(stripHtml(paragraph ? paragraph[1] : ''), 260),
      image,
      url: link,
    });
  }
  return events;
}

const isArticleUrl = (url) => typeof url === 'string' && /^https:\/\/worldoftanks\.eu\/(?:en|ru)\/news\/[\w\-/]+\/?$/.test(url);

function eventToItem(ev, now) {
  const ru = ev.ru || {};
  const startMs = Date.parse(`${ev.start}T00:00:00Z`);
  const endMs = Date.parse(`${ev.end}T23:59:59Z`);
  const state = now < startMs ? 'upcoming' : now <= endMs ? 'live' : 'past';
  const own = ru.ownUrl || ev.ownUrl;
  return {
    title: ru.title || ev.title,
    summary: ru.summary || ev.summary,
    date: new Date(startMs).toISOString(),
    endDate: new Date(endMs).toISOString(),
    allDay: true,
    url: toRussianUrl(ru.url || ev.url || `${SITE}/ru/news/`),
    ref: isArticleUrl(own) ? toRussianUrl(own) : null,
    image: ru.image || ev.image,
    tag: CATEGORY_TAGS[ev.category.toLowerCase()] || 'event',
    state,
  };
}

function localized(entry) {
  const ru = entry.ru || {};
  return {
    title: ru.title || entry.title,
    summary: ru.summary || entry.summary,
    url: ru.url || toRussianUrl(entry.url),
    image: ru.image || entry.image,
  };
}

function newsToItem(entry) {
  const tagBySection = { updates: 'update', specials: 'special', merchandise: 'merch' };
  const view = localized(entry);
  return {
    title: view.title,
    summary: view.summary,
    date: entry.date,
    url: view.url,
    ref: isArticleUrl(view.url) ? view.url : null,
    image: view.image,
    tag: tagBySection[entry.section] || 'news',
    state: 'past',
  };
}

const isCommonTest = (title) => /common test|supertest|sandbox|join the common test/i.test(title);
const isMainUpdate = (title) => /^update\s+\d+\.\d+/i.test(title) && !isCommonTest(title);
const updateVersion = (title) => (title.match(/^(?:update|обновление)\s+(\d+\.\d+(?:\.\d+)?)/i) || [])[1] || null;
const updateSubtitle = (title) => title.replace(/^(?:update|обновление)\s+\d+(\.\d+)*:?\s*/i, '') || null;

function pairRussianEvents(events, russianEvents) {
  const byKey = new Map();
  for (const ev of russianEvents) {
    const key = `${ev.start}|${ev.end}`;
    byKey.set(key, [...(byKey.get(key) || []), ev]);
  }
  return events.map((ev) => {
    const candidates = byKey.get(`${ev.start}|${ev.end}`) || [];
    const ru = candidates.shift();
    return ru ? { ...ev, ru: { title: ru.title, summary: ru.summary, image: ru.image, url: ru.url, ownUrl: ru.url } } : ev;
  });
}

async function loadCalendar(monthlies, now) {
  const items = [];
  const seen = new Set();
  for (const monthly of monthlies) {
    try {
      const [html, ruHtml] = await Promise.all([fetchText(monthly.url), fetchText(toRussianUrl(monthly.url)).catch(() => '')]);
      const events = pairRussianEvents(parseMonthlyCalendar(html), ruHtml ? parseMonthlyCalendar(ruHtml) : []);
      for (const ev of events) {
        const key = `${ev.title}|${ev.start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(eventToItem({ ...ev, ownUrl: ev.url, url: ev.url || monthly.url }, now));
      }
    } catch (err) {
      console.warn(`[wot] не удалось загрузить календарь ${monthly.url}: ${err.message}`);
    }
  }
  return items;
}

function mergeNews(rss, updates, russian = []) {
  const byTitle = new Map(rss.map((n) => [n.title.toLowerCase(), n]));
  for (const u of updates) {
    const key = u.title.toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, u);
  }
  const ruByPath = new Map();
  for (const r of russian) {
    const key = newsPath(r.url);
    const known = ruByPath.get(key);
    if (!known || (!known.summary && r.summary)) ruByPath.set(key, r);
  }
  return [...byTitle.values()].map((n) => {
    const ru = ruByPath.get(newsPath(n.url));
    return ru ? { ...n, ru: { title: ru.title, summary: ru.summary || null, url: ru.url, image: ru.image } } : n;
  });
}

function buildSections({ rss, updates = [], ruNews = [], calendarItems = [], monthlies = [], now = Date.now() }) {
  const news = mergeNews(rss, updates, ruNews);
  const live = calendarItems.filter((i) => i.state === 'live').sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
  const planned = calendarItems.filter((i) => i.state === 'upcoming').sort(byDateAsc);

  const scheduledVersions = new Set(planned.map((i) => updateVersion(i.title)).filter(Boolean));
  const mainUpdates = news.filter((n) => isMainUpdate(n.title)).sort(byDateDesc);
  const released = mainUpdates.find((n) => !scheduledVersions.has(updateVersion(n.title)));
  const announcedNext = mainUpdates.find((n) => scheduledVersions.has(updateVersion(n.title)));
  const calendarNext = planned.find((i) => updateVersion(i.title));
  const version = released ? updateVersion(released.title) : null;

  const recentNews = news
    .filter((n) => n.section !== 'updates' || !isMainUpdate(n.title))
    .filter((n) => !/wot monthly/i.test(n.title) && n.date && now - new Date(n.date).getTime() < 21 * DAY)
    .sort(byDateDesc)
    .slice(0, 8)
    .map(newsToItem);

  const tests = news
    .filter((n) => isCommonTest(n.title) && (!released || new Date(n.date) > new Date(released.date)))
    .sort(byDateDesc)
    .map((n) => ({ ...newsToItem(n), tag: 'test', state: 'upcoming' }));

  const releasedView = released ? localized(released) : null;
  const currentHeadline = released
    ? {
        kicker: 'World of Tanks · EU',
        title: version ? `Обновление ${version}` : releasedView.title,
        subtitle: updateSubtitle(releasedView.title),
        summary: releasedView.summary,
        date: released.date,
        url: releasedView.url,
        ref: isArticleUrl(releasedView.url) ? releasedView.url : null,
        image: releasedView.image,
        chips: [version && { label: 'Версия', value: version }, { label: 'Событий сейчас', value: String(live.length) }].filter(Boolean),
      }
    : null;

  let upcomingHeadline = null;
  if (calendarNext) {
    const nextVersion = updateVersion(calendarNext.title);
    const announcedView = announcedNext ? localized(announcedNext) : null;
    const source = announcedView || calendarNext;
    upcomingHeadline = {
      kicker: 'Следующее обновление',
      title: `Обновление ${nextVersion}`,
      subtitle: announcedView ? updateSubtitle(announcedView.title) : null,
      summary: source.summary || calendarNext.summary,
      date: calendarNext.date,
      endDate: calendarNext.endDate,
      allDay: true,
      url: source.url || calendarNext.url,
      ref: isArticleUrl(source.url) ? source.url : calendarNext.ref || null,
      image: source.image || calendarNext.image,
      countdown: true,
      chips: [
        tests[0] && { label: 'Общий тест', value: `с ${new Date(tests[0].date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` },
        { label: 'В расписании', value: String(planned.length + tests.length) },
      ].filter(Boolean),
    };
  } else {
    const fallback = tests[0] || planned[0];
    if (fallback) {
      upcomingHeadline = {
        kicker: tests[0] ? 'Тестирование' : 'Ближайшее событие',
        title: fallback.title,
        summary: fallback.summary,
        date: fallback.date,
        endDate: fallback.endDate,
        allDay: fallback.allDay,
        url: fallback.url,
        ref: fallback.ref || null,
        image: fallback.image,
        countdown: true,
        chips: [{ label: 'В расписании', value: String(planned.length + tests.length) }],
      };
    }
  }

  return {
    sources: [
      { name: 'World of Tanks EU: новости (на русском)', url: RU_RSS_URL },
      { name: 'World of Tanks EU: обновления (на русском)', url: RU_UPDATES_URL },
      ...monthlies.map((m) => ({ name: m.ru?.title || m.title, url: toRussianUrl(m.url) })),
    ],
    current: {
      headline: currentHeadline,
      blocks: [
        { title: 'Идут сейчас', items: live, emptyText: 'В календаре нет активных событий.' },
        { title: 'Последние новости и обновления', items: recentNews, emptyText: 'Свежих новостей нет.' },
      ],
    },
    upcoming: {
      headline: upcomingHeadline,
      blocks: [
        ...(tests.length ? [{ title: 'Тестирование', items: tests }] : []),
        {
          title: 'В расписании',
          items: planned,
          emptyText: 'В опубликованном календаре нет будущих событий. Новый WoT Monthly обычно выходит в конце месяца.',
        },
      ],
    },
  };
}

async function load() {
  const now = Date.now();
  const optional = (url) => fetchText(url).catch((err) => {
    console.warn(`[wot] русская версия недоступна (${url}): ${err.message}`);
    return '';
  });
  const [rssXml, updatesHtml, ruRssXml, ruUpdatesHtml] = await Promise.all([
    fetchText(RSS_URL),
    optional(UPDATES_URL),
    optional(RU_RSS_URL),
    optional(RU_UPDATES_URL),
  ]);
  const rss = parseRss(rssXml);
  if (!rss.length) throw new Error('RSS World of Tanks пуст');
  const updates = updatesHtml ? parseUpdatesPage(updatesHtml) : [];
  const ruNews = [...(ruRssXml ? parseRss(ruRssXml) : []), ...(ruUpdatesHtml ? parseUpdatesPage(ruUpdatesHtml) : [])];

  const monthlies = rss.filter((n) => /wot monthly/i.test(n.title)).sort(byDateDesc).slice(0, 2);
  const calendarItems = await loadCalendar(monthlies, now);
  return buildSections({ rss, updates, ruNews, calendarItems, monthlies, now });
}

function matchingEnd(html, from) {
  const re = /<(\/?)div\b[^>]*>/gi;
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return re.lastIndex;
  }
  return html.length;
}

function extractArticleHtml(html) {
  const pieces = [];
  const re = /<(h[1-3])\b[^>]*class="[^"]*(?:rich-heading|spoiler_title)[^"]*"[^>]*>[\s\S]*?<\/\1>|<div\b[^>]*class="([^"]*user-generated[^"]*)"[^>]*>|<div\b[^>]*class="text-block_(title|description)"[^>]*>[\s\S]*?<\/div>/gi;
  let lastEnd = 0;
  for (const m of html.matchAll(re)) {
    if (m.index < lastEnd) continue;
    if (m[3]) {
      const inner = m[0].replace(/^<div[^>]*>/i, '').replace(/<\/div>$/i, '');
      pieces.push(m[3] === 'title' ? `<h3>${inner}</h3>` : `<p>${inner}</p>`);
      lastEnd = m.index + m[0].length;
    } else if (m[2]) {
      if (/ugc-widget/.test(m[2])) {
        lastEnd = matchingEnd(html, m.index + m[0].length);
        continue;
      }
      const end = matchingEnd(html, m.index + m[0].length);
      pieces.push(html.slice(m.index, end));
      lastEnd = end;
    } else {
      pieces.push(m[0]);
      lastEnd = m.index + m[0].length;
    }
  }
  return pieces.join('\n');
}

async function loadArticle(ref) {
  if (!isArticleUrl(ref)) throw new Error('Некорректная ссылка на новость');
  const candidates = ref.includes('/ru/news/') ? [ref, toEnglishUrl(ref)] : [ref];
  let lastError = null;
  for (const url of candidates) {
    try {
      const html = await fetchText(url, { headers: { 'Accept-Language': url.includes('/ru/') ? 'ru-RU,ru;q=0.9' : 'en-US,en;q=0.9' } });
      const blocks = htmlToBlocks(extractArticleHtml(html), { baseUrl: url });
      if (blocks[0]?.type === 'h' && blocks.length > 1) blocks.shift();
      if (blocks.length) return { blocks, url };
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return { blocks: [], url: ref };
}

module.exports = { load, loadArticle, mergeNews, pairRussianEvents, updateSubtitle, extractArticleHtml, buildSections, parseRss, parseUpdatesPage, parseMonthlyCalendar, eventToItem, updateVersion };
