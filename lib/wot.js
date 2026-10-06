const { DAY, fetchText, stripHtml, decodeEntities, truncate, toIso, byDateDesc, byDateAsc } = require('./util');

const RSS_URL = 'https://worldoftanks.eu/en/rss/news/';
const UPDATES_URL = 'https://worldoftanks.eu/en/news/updates/';
const SITE = 'https://worldoftanks.eu';

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

function eventToItem(ev, now) {
  const startMs = Date.parse(`${ev.start}T00:00:00Z`);
  const endMs = Date.parse(`${ev.end}T23:59:59Z`);
  const state = now < startMs ? 'upcoming' : now <= endMs ? 'live' : 'past';
  return {
    title: ev.title,
    summary: ev.summary,
    date: new Date(startMs).toISOString(),
    endDate: new Date(endMs).toISOString(),
    allDay: true,
    url: ev.url || 'https://worldoftanks.eu/en/news/',
    image: ev.image,
    tag: CATEGORY_TAGS[ev.category.toLowerCase()] || 'event',
    state,
  };
}

function newsToItem(entry) {
  const tagBySection = { updates: 'update', specials: 'special', merchandise: 'merch' };
  return {
    title: entry.title,
    summary: entry.summary,
    date: entry.date,
    url: entry.url,
    image: entry.image,
    tag: tagBySection[entry.section] || 'news',
    state: 'past',
  };
}

const isCommonTest = (title) => /common test|supertest|sandbox|join the common test/i.test(title);
const isMainUpdate = (title) => /^update\s+\d+\.\d+/i.test(title) && !isCommonTest(title);
const updateVersion = (title) => (title.match(/^update\s+(\d+\.\d+(?:\.\d+)?)/i) || [])[1] || null;

async function loadCalendar(monthlies, now) {
  const items = [];
  const seen = new Set();
  for (const monthly of monthlies) {
    try {
      const html = await fetchText(monthly.url);
      for (const ev of parseMonthlyCalendar(html)) {
        const key = `${ev.title}|${ev.start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(eventToItem({ ...ev, url: ev.url || monthly.url }, now));
      }
    } catch (err) {
      console.warn(`[wot] не удалось загрузить календарь ${monthly.url}: ${err.message}`);
    }
  }
  return items;
}

function mergeNews(rss, updates) {
  const byTitle = new Map(rss.map((n) => [n.title.toLowerCase(), n]));
  for (const u of updates) {
    const key = u.title.toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, u);
  }
  return [...byTitle.values()];
}

function buildSections({ rss, updates = [], calendarItems = [], monthlies = [], now = Date.now() }) {
  const news = mergeNews(rss, updates);
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

  const currentHeadline = released
    ? {
        kicker: 'World of Tanks · EU',
        title: version ? `Обновление ${version}` : released.title,
        subtitle: released.title.replace(/^update\s+\d+(\.\d+)*:?\s*/i, '') || null,
        summary: released.summary,
        date: released.date,
        url: released.url,
        image: released.image,
        chips: [version && { label: 'Версия', value: version }, { label: 'Событий сейчас', value: String(live.length) }].filter(Boolean),
      }
    : null;

  let upcomingHeadline = null;
  if (calendarNext) {
    const nextVersion = updateVersion(calendarNext.title);
    const source = announcedNext || calendarNext;
    upcomingHeadline = {
      kicker: 'Следующее обновление',
      title: `Обновление ${nextVersion}`,
      subtitle: announcedNext ? announcedNext.title.replace(/^update\s+\d+(\.\d+)*:?\s*/i, '') || null : null,
      summary: source.summary || calendarNext.summary,
      date: calendarNext.date,
      endDate: calendarNext.endDate,
      allDay: true,
      url: source.url || calendarNext.url,
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
        image: fallback.image,
        countdown: true,
        chips: [{ label: 'В расписании', value: String(planned.length + tests.length) }],
      };
    }
  }

  return {
    sources: [
      { name: 'WoT EU: новости (RSS)', url: RSS_URL },
      { name: 'WoT EU: обновления', url: UPDATES_URL },
      ...monthlies.map((m) => ({ name: m.title, url: m.url })),
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
  const [rssXml, updatesHtml] = await Promise.all([fetchText(RSS_URL), fetchText(UPDATES_URL).catch(() => '')]);
  const rss = parseRss(rssXml);
  if (!rss.length) throw new Error('RSS World of Tanks пуст');
  const updates = updatesHtml ? parseUpdatesPage(updatesHtml) : [];

  const monthlies = rss.filter((n) => /wot monthly/i.test(n.title)).sort(byDateDesc).slice(0, 2);
  const calendarItems = await loadCalendar(monthlies, now);
  return buildSections({ rss, updates, calendarItems, monthlies, now });
}

module.exports = { load, buildSections, parseRss, parseUpdatesPage, parseMonthlyCalendar, eventToItem, updateVersion };
