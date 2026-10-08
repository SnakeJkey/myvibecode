const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRss, parseUpdatesPage, eventToItem, buildSections, updateVersion, updateSubtitle, pairRussianEvents } = require('../lib/wot');

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Update 2.4.1: Map Reworks]]></title><link>https://worldoftanks.eu/en/news/general-news/2-4-1/</link><pubDate>Mon, 05 Oct 2026 09:00:00 +0000</pubDate><description><![CDATA[<p>Maps &amp; more</p>]]></description></item>
<item><title>Micropatch Release</title><link>https://worldoftanks.eu/en/news/updates/micro/</link><pubDate>Thu, 01 Oct 2026 09:00:00 +0000</pubDate><description>x</description></item>
</channel></rss>`;

const UPDATES = `{
    "preview_thumb": "//eu-wotp.wgcdn.co/a.jpg",
    "publication_start": 1788267600.0,
    "title": "Update 2.4:\\u00a0Overdrive",
    "url": "/en/news/updates/wot-2-4/"
  }`;

test('parseRss извлекает записи', () => {
  const items = parseRss(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Update 2.4.1: Map Reworks');
  assert.equal(items[0].summary, 'Maps & more');
  assert.equal(items[0].section, 'general-news');
});

test('parseUpdatesPage читает встроенный JSON со страницы обновлений', () => {
  const [item] = parseUpdatesPage(UPDATES);
  assert.equal(item.title, 'Update 2.4: Overdrive');
  assert.equal(item.url, 'https://worldoftanks.eu/en/news/updates/wot-2-4/');
  assert.equal(item.image, 'https://eu-wotp.wgcdn.co/a.jpg');
  assert.equal(item.date, new Date(1788267600 * 1000).toISOString());
});

test('eventToItem определяет статус события по датам', () => {
  const ev = { title: 'X', category: 'Event', start: '2026-10-10', end: '2026-10-12', summary: '', image: null, url: null };
  assert.equal(eventToItem(ev, Date.parse('2026-10-05T00:00:00Z')).state, 'upcoming');
  assert.equal(eventToItem(ev, Date.parse('2026-10-11T00:00:00Z')).state, 'live');
  assert.equal(eventToItem(ev, Date.parse('2026-10-20T00:00:00Z')).state, 'past');
});

test('buildSections: анонсированное обновление из календаря не считается текущим', () => {
  const now = Date.parse('2026-10-06T00:00:00Z');
  const calendarItems = [
    eventToItem({ title: 'Update 2.4.1', category: 'Update', start: '2026-10-13', end: '2026-10-14', summary: '', image: null, url: 'u' }, now),
  ];
  const r = buildSections({ rss: parseRss(RSS), updates: parseUpdatesPage(UPDATES), calendarItems, now });
  assert.equal(r.current.headline.title, 'Обновление 2.4');
  assert.equal(r.upcoming.headline.title, 'Обновление 2.4.1');
  assert.equal(r.upcoming.headline.subtitle, 'Map Reworks');
  assert.equal(r.upcoming.headline.countdown, true);
});

test('updateVersion', () => {
  assert.equal(updateVersion('Update 2.4.1: Test'), '2.4.1');
  assert.equal(updateVersion('Micropatch'), null);
});

const RU_RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Обновление 2.4.1: переработка карт</title><link>https://worldoftanks.eu/ru/news/general-news/2-4-1/</link><pubDate>Mon, 05 Oct 2026 09:00:00 +0000</pubDate><description><![CDATA[<div>Карты и многое другое</div>]]></description></item>
</channel></rss>`;

const RU_UPDATES = `{
    "preview_thumb": "//eu-wotp.wgcdn.co/a.jpg",
    "publication_start": 1788267600.0,
    "title": "Обновление 2.4:\u00a0На максимуме",
    "url": "/ru/news/updates/wot-2-4/"
  }`;

test('buildSections: русские заголовки, ссылки и описания берутся из русской ленты', () => {
  const now = Date.parse('2026-10-06T00:00:00Z');
  const ruEvent = { title: 'Обновление 2.4.1', summary: '', image: null, url: null };
  const calendarItems = [
    eventToItem({ title: 'Update 2.4.1', category: 'Update', start: '2026-10-13', end: '2026-10-14', summary: '', image: null, url: 'u', ru: ruEvent }, now),
  ];
  const r = buildSections({
    rss: parseRss(RSS),
    updates: parseUpdatesPage(UPDATES),
    ruNews: [...parseRss(RU_RSS), ...parseUpdatesPage(RU_UPDATES)],
    calendarItems,
    now,
  });
  assert.equal(r.current.headline.subtitle, 'На максимуме');
  assert.equal(r.current.headline.url, 'https://worldoftanks.eu/ru/news/updates/wot-2-4/');
  assert.equal(r.upcoming.headline.title, 'Обновление 2.4.1');
  assert.equal(r.upcoming.headline.subtitle, 'переработка карт');
  assert.equal(r.upcoming.headline.ref, 'https://worldoftanks.eu/ru/news/general-news/2-4-1/');
  const news = r.current.blocks[1].items.find((i) => i.ref === 'https://worldoftanks.eu/ru/news/general-news/2-4-1/');
  assert.equal(news?.title, 'Обновление 2.4.1: переработка карт');
  assert.equal(news?.summary, 'Карты и многое другое');
});

test('buildSections: без русской ленты ссылки всё равно ведут на русскую версию сайта', () => {
  const r = buildSections({ rss: parseRss(RSS), updates: parseUpdatesPage(UPDATES), now: Date.parse('2026-10-06T00:00:00Z') });
  assert.match(r.current.headline.url, /\/ru\/news\//);
  assert.equal(r.current.headline.subtitle, 'Map Reworks');
});

test('pairRussianEvents сопоставляет события календаря по датам', () => {
  const en = [
    { title: 'Neon Dash', start: '2026-10-02', end: '2026-10-11' },
    { title: 'Crucible', start: '2026-09-30', end: '2026-11-04' },
  ];
  const ru = [
    { title: 'Вызов', start: '2026-09-30', end: '2026-11-04', summary: 's', image: null, url: null },
    { title: 'Сияние неона', start: '2026-10-02', end: '2026-10-11', summary: 'n', image: null, url: null },
  ];
  const paired = pairRussianEvents(en, ru);
  assert.equal(paired[0].ru.title, 'Сияние неона');
  assert.equal(paired[1].ru.title, 'Вызов');
  assert.equal(pairRussianEvents(en, [])[0].ru, undefined);
});

test('updateVersion и updateSubtitle понимают русские заголовки', () => {
  assert.equal(updateVersion('Обновление 2.4.1: переработка карт'), '2.4.1');
  assert.equal(updateSubtitle('Обновление 2.4: На максимуме'), 'На максимуме');
  assert.equal(updateSubtitle('Update 2.4'), null);
});
