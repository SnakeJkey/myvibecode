const { DAY, fetchJson, stripBBCode, truncate, toIso, byDateDesc } = require('./util');
const { bbcodeToBlocks } = require('./richtext');

const APP_ID = 394360;
const NEWS_URL = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${APP_ID}&count=100&maxlength=0&feeds=steam_community_announcements`;
const CLAN_ACCOUNT_ID = 9948323;
const eventsUrl = (lang) =>
  `https://store.steampowered.com/events/ajaxgetpartnereventspageable/?clan_accountid=${CLAN_ACCOUNT_ID}&appid=${APP_ID}&offset=0&count=100&l=${lang}`;
const STEAM_NEWS_PAGE = `https://store.steampowered.com/news/app/${APP_ID}`;
const STORE_URL = `https://store.steampowered.com/app/${APP_ID}/`;

const PATCH_RE = /patch\s+(\d+(?:\.\d+)+)|hotfix\s+(\d+(?:\.\d+)+)/i;
const BETA_RE = /open beta/i;
const DEV_RE = /dev(?:eloper)? (?:corner|diary)|dev diary/i;
const ANNOUNCE_RE = /pre-?purchase|pre-?order|announc(?:ing|ed)|release date|coming (?:soon|this)|available now|out now/i;
const NOISE_RE = /steam .*sale|\bsale\b|merch/i;

function imageFrom(raw) {
  const m = String(raw).match(/\[img[^\]]*src="([^"]+)"/i) || String(raw).match(/\[img\]\s*(\S+?)\s*\[\/img\]/i);
  if (!m) return null;
  return m[1].replace('{STEAM_CLAN_IMAGE}', 'https://clan.fastly.steamstatic.com/images');
}

const newsUrl = (entry) => `${STEAM_NEWS_PAGE}/view/${entry.gid}?l=russian`;

const CYRILLIC_RE = /[А-Яа-яЁё]/g;

function cyrillicShare(text) {
  const plain = String(text || '').replace(/\[[^\]]*\]/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  const letters = plain.match(/[A-Za-zА-Яа-яЁё]/g) || [];
  if (!letters.length) return 0;
  return (plain.match(CYRILLIC_RE) || []).length / letters.length;
}

function russianVersion(event) {
  const body = event?.announcement_body;
  if (!body?.body) return null;
  const title = String(body.headline || event.event_name || '').trim();
  if (cyrillicShare(body.body) < 0.05 && cyrillicShare(title) < 0.3) return null;
  return { title, contents: body.body };
}

function eventToEntry(event, russian) {
  const body = event.announcement_body || {};
  return {
    gid: String(event.gid),
    title: String(body.headline || event.event_name || '').trim(),
    contents: body.body || '',
    date: body.posttime || event.rtime32_start_time,
    ru: russian ? russianVersion(russian) : null,
  };
}

function eventsToEntries(englishEvents, russianEvents = []) {
  const ruByGid = new Map(russianEvents.map((e) => [String(e.gid), e]));
  return englishEvents
    .filter((e) => e?.announcement_body?.body && !e.hidden && !e.announcement_body.hidden)
    .map((e) => eventToEntry(e, ruByGid.get(String(e.gid))));
}

const localTitle = (entry) => (entry.ru ? entry.ru.title.replace(/\s+Ho?I\s?(?:IV|4)(?=\s*[|\-–—:]|\s*$)/i, '').replace(/\s+/g, ' ').trim() : null);
const localContents = (entry) => entry.ru?.contents || entry.contents;

function summaryFrom(raw) {
  const body = String(raw).split(/\[h\d\]|\[\*\]|\[list\]/i)[0];
  return truncate(stripBBCode(body).replace(/^(?:Generals|Генералы|Генерал)[!,]\s*/i, ''), 240);
}

function classify(title) {
  if (PATCH_RE.test(title)) return 'patch';
  if (BETA_RE.test(title)) return 'beta';
  if (DEV_RE.test(title)) return 'devdiary';
  if (ANNOUNCE_RE.test(title)) return 'dlc';
  return 'news';
}

const feed = { entries: new Map(), at: 0 };

function toItem(entry) {
  const date = toIso(entry.date * 1000);
  const version = (entry.title.match(PATCH_RE) || []).slice(1).find(Boolean) || null;
  const title =
    localTitle(entry) ||
    entry.title.replace(/^(?:.+?\s*\|\s*)?(?=Patch\s|Hotfix\s)/i, '').replace(/^(?:HOI IV|Hearts of Iron IV)\s*(?:[|\-–:]\s*)?/i, '').trim();
  return {
    title,
    version,
    summary: summaryFrom(localContents(entry)),
    date,
    url: newsUrl(entry),
    ref: String(entry.gid),
    image: imageFrom(localContents(entry)),
    tag: classify(entry.title),
    state: 'past',
  };
}

function expansionName(entries) {
  for (const e of entries) {
    const m = e.title.match(/^(.+?)\s*\|\s*Patch/i);
    if (m && !/^(hoi iv|hearts of iron iv)$/i.test(m[1].trim())) return m[1].trim();
  }
  return null;
}

function buildSections(entries, now = Date.now()) {
  const sorted = [...entries].sort((a, b) => b.date - a.date);
  const patches = sorted.filter((e) => PATCH_RE.test(e.title) && !BETA_RE.test(e.title));
  const latestPatch = patches[0];
  if (!latestPatch) throw new Error('В новостях HOI4 не найдено патчей');

  const patchTime = latestPatch.date * 1000;
  const version = latestPatch.title.match(PATCH_RE).slice(1).find(Boolean);
  const expansion = expansionName(patches) || expansionName(sorted);

  const candidates = sorted.filter((e) => !NOISE_RE.test(e.title));
  const recentPatches = patches.slice(0, 6).map(toItem);
  const recentNews = candidates
    .filter((e) => !patches.includes(e) && !DEV_RE.test(e.title) && !BETA_RE.test(e.title) && now - e.date * 1000 < 60 * DAY)
    .slice(0, 6)
    .map(toItem);

  const devDiaries = candidates.filter((e) => DEV_RE.test(e.title) && e.date * 1000 > patchTime - 21 * DAY).map(toItem);
  const betas = candidates.filter((e) => BETA_RE.test(e.title)).slice(0, 4).map(toItem);
  const announcements = candidates
    .filter((e) => ANNOUNCE_RE.test(e.title) && e.date * 1000 > patchTime - 30 * DAY && !PATCH_RE.test(e.title))
    .map((e) => ({ ...toItem(e), state: 'upcoming' }));

  const diaryTopics = devDiaries
    .slice(0, 3)
    .map((d) => d.title.replace(/^(HOI IV\s*)?(Dev(?:eloper)? (?:Corner|Diary)|Уголок разработчиков|Дневник разработчиков)\s*[|\-–—:]?\s*/i, '').trim());
  const latestBeta = betas[0];

  const newest = [devDiaries[0], latestBeta].filter(Boolean).sort(byDateDesc)[0];
  const headlineSource = announcements[0] || newest;
  const headlineKicker = announcements[0] ? 'Анонс' : headlineSource?.tag === 'beta' ? 'Открытое бета-тестирование' : 'Дневник разработчиков';
  const currentHeadline = {
    kicker: 'Hearts of Iron IV',
    title: `Патч ${version}`,
    subtitle: expansion ? `Текущее дополнение: ⟦${expansion}⟧` : latestPatch.title,
    summary: summaryFrom(localContents(latestPatch)),
    date: toIso(patchTime),
    url: newsUrl(latestPatch),
    ref: String(latestPatch.gid),
    image: imageFrom(localContents(latestPatch)),
    chips: [
      { label: 'Версия', value: version },
      expansion && { label: 'Дополнение', value: `⟦${expansion}⟧` },
      { label: 'Дней с патча', value: String(Math.max(0, Math.floor((now - patchTime) / DAY))) },
    ].filter(Boolean),
  };

  const upcomingHeadline = headlineSource
    ? {
        kicker: headlineKicker,
        title: headlineSource.title,
        subtitle: diaryTopics.length ? `Недавние темы «Уголка разработчиков»: ⟦${diaryTopics.join(' · ')}⟧` : null,
        summary: headlineSource.summary,
        date: headlineSource.date,
        url: headlineSource.url,
        ref: headlineSource.ref,
        image: headlineSource.image,
        chips: [
          { label: 'Дневников с патча', value: String(devDiaries.length) },
          latestBeta && { label: 'Последняя бета', value: latestBeta.title.replace(/^Open Beta\s*/i, '') || 'Open Beta' },
        ].filter(Boolean),
      }
    : null;

  return {
    sources: [
      { name: 'Steam — новости HOI4 (на русском)', url: `${STEAM_NEWS_PAGE}?l=russian` },
      { name: 'Страница игры в Steam', url: `${STORE_URL}?l=russian` },
    ],
    current: {
      headline: currentHeadline,
      blocks: [
        { title: 'Последние патчи', items: recentPatches, emptyText: 'Патчей не найдено.' },
        { title: 'Новости', items: recentNews, emptyText: 'Свежих новостей нет.' },
      ],
    },
    upcoming: {
      headline: upcomingHeadline,
      blocks: [
        ...(announcements.length ? [{ title: 'Анонсы', items: announcements }] : []),
        { title: 'Уголок разработчиков: что готовится', items: devDiaries.slice(0, 8), emptyText: 'Дневников разработчиков с последнего патча не выходило.' },
        { title: 'Открытые беты: тест будущих изменений', items: betas, emptyText: 'Открытых бета-тестов не было.' },
      ],
    },
  };
}

async function fetchEntries() {
  try {
    const [english, russian] = await Promise.all([
      fetchJson(eventsUrl('english')),
      fetchJson(eventsUrl('russian')).catch((err) => {
        console.warn(`[hoi4] русская лента Steam недоступна: ${err.message}`);
        return { events: [] };
      }),
    ]);
    const entries = eventsToEntries(english?.events || [], russian?.events || []);
    if (entries.length) return entries;
  } catch (err) {
    console.warn(`[hoi4] лента событий Steam недоступна, используется запасной источник: ${err.message}`);
  }
  const res = await fetchJson(NEWS_URL);
  return res?.appnews?.newsitems || [];
}

function rememberFeed(entries) {
  feed.entries = new Map(entries.map((e) => [String(e.gid), e]));
  feed.at = Date.now();
}

async function load() {
  const entries = await fetchEntries();
  if (!entries.length) throw new Error('Steam вернул пустой список новостей HOI4');
  rememberFeed(entries);
  return buildSections(entries);
}

async function loadArticle(ref) {
  const gid = String(ref);
  if (!/^\d{5,25}$/.test(gid)) throw new Error('Некорректная ссылка на новость');
  let entry = feed.entries.get(gid);
  if (!entry) {
    rememberFeed(await fetchEntries());
    entry = feed.entries.get(gid);
  }
  if (!entry) throw new Error('Новость больше не доступна в ленте Steam');
  return { blocks: bbcodeToBlocks(localContents(entry)), url: newsUrl(entry) };
}

module.exports = { load, loadArticle, buildSections, eventsToEntries, cyrillicShare, classify, expansionName };
