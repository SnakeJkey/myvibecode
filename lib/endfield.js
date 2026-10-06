const { DAY, fetchJson, stripHtml, truncate, byDateDesc, byDateAsc, averageGapDays } = require('./util');

const API = 'https://web-news.gryphline.com/api/bulletin';
const APP_CODE = 'arknights_endfield_official';
const STEAM_APP_ID = 4732690;
const STEAM_URL = `https://store.steampowered.com/app/${STEAM_APP_ID}/`;
const PAGES = 6;
const PAGE_SIZE = 20;

// Время событий в бюллетенях указано по серверу; для Америки/Европы это UTC-5.
const SERVER_UTC_OFFSET_HOURS = -5;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DATE_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+at\s+(\d{1,2}):(\d{2}))?/gi;

const listUrl = (page, lang = 'en-us') => `${API}?lang=${lang}&code=${APP_CODE}&page=${page}&pageSize=${PAGE_SIZE}`;
const detailUrl = (cid, lang = 'en-us') => `${API}/${cid}?lang=${lang}&code=${APP_CODE}`;
const articleUrl = (cid, lang = 'en-us') => `https://endfield.gryphline.com/${lang}/news/${cid}`;

const bracketName = (title) => (title.match(/[\[「«]([^\]」»]+)[\]」»]/) || [])[1] || null;
const isVersionNotes = (title) => /version update notes/i.test(title);

function classify(entry) {
  const t = entry.title;
  if (/version update notes|version pre-download/i.test(t)) return 'update';
  if (/dev comm|development insights/i.test(t)) return 'devcomm';
  if (/headhunting/i.test(t)) return 'headhunting';
  if (/LTO details/i.test(t)) return 'weapon';
  if (/steam|playtest/i.test(t)) return 'steam';
  if (entry.tab === 'events' || /event|🎁/i.test(t)) return 'event';
  return 'news';
}

function parseServerDate(match) {
  const [, mon, day, year, hour, minute] = match;
  const month = MONTHS[mon.toLowerCase().slice(0, 3)];
  const h = hour === undefined ? 0 : Number(hour);
  const m = minute === undefined ? 0 : Number(minute);
  return new Date(Date.UTC(Number(year), month, Number(day), h - SERVER_UTC_OFFSET_HOURS, m)).toISOString();
}

function extractDates(text) {
  return [...String(text).matchAll(DATE_RE)].map(parseServerDate);
}

function extractPeriod(text) {
  const label = /(Event Time|Event Period|Availability Period|Availability|Event Duration|Playtest Start Time)\s*:?\s*([^▼■※]{0,170})/i.exec(text);
  if (!label) return { start: null, end: null, untilNextVersion: false };
  const fragment = label[2];
  const [start = null, end = null] = extractDates(fragment);
  const untilNextVersion = /before (the )?(next )?version update|until (the )?(next )?version update|ends after/i.test(fragment);
  return { start, end: untilNextVersion ? null : end, untilNextVersion };
}

function periodState(period, now) {
  const start = period.start ? Date.parse(period.start) : null;
  const end = period.end ? Date.parse(period.end) : null;
  if (start && start > now) return 'upcoming';
  if (end && end < now) return 'past';
  return 'live';
}

function cleanSummary(text) {
  return String(text || '')
    .replace(/Dear Endministrators?[,:!]?\s*/gi, '')
    .replace(/Уважаемы[ейх]+ Эндминистратор[а-я]*[!,:]?\s*/gi, '')
    .replace(/[▼■※]\s*(\/\/)?\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toItem(entry, details, now, localized) {
  const text = details ? stripHtml(details) : '';
  const period = text ? extractPeriod(text) : { start: null, end: null, untilNextVersion: false };
  const posted = new Date(entry.displayTime * 1000).toISOString();
  const summary = localized?.brief || entry.brief || (text ? text.replace(/^Dear Endministrators?[,:]?\s*/i, '') : '');
  return {
    cid: entry.cid,
    title: (localized?.title || entry.title).replace(/^🎁\s*/, ''),
    summary: truncate(cleanSummary(summary), 240),
    date: period.start || posted,
    endDate: period.end,
    untilNextVersion: period.untilNextVersion,
    posted,
    url: articleUrl(entry.cid, localized ? 'ru-ru' : 'en-us'),
    image: entry.cover || null,
    tag: classify(entry),
    state: text ? periodState(period, now) : 'past',
  };
}

const LIVE_TAGS = ['headhunting', 'weapon', 'event'];

function settleState(item) {
  return item.state === 'live' && !LIVE_TAGS.includes(item.tag) ? { ...item, state: 'past' } : item;
}

async function loadList(lang = 'en-us') {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchJson(listUrl(i + 1, lang)).catch((err) => (i === 0 ? Promise.reject(err) : null)))
  );
  const seen = new Map();
  for (const page of pages) {
    for (const entry of page?.data?.list || []) seen.set(entry.cid, entry);
  }
  return [...seen.values()].sort((a, b) => b.displayTime - a.displayTime);
}

async function loadDetails(cid, lang = 'en-us') {
  try {
    const res = await fetchJson(detailUrl(cid, lang));
    return typeof res?.data?.data === 'string' ? res.data.data : null;
  } catch {
    return null;
  }
}

async function loadSteamStatus() {
  try {
    const res = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${STEAM_APP_ID}&cc=us&l=russian`);
    const data = res[String(STEAM_APP_ID)]?.data;
    if (!data) return null;
    return { comingSoon: Boolean(data.release_date?.coming_soon), date: data.release_date?.date, image: data.header_image, summary: data.short_description };
  } catch {
    return null;
  }
}

function introText(html, fallback) {
  const text = html ? stripHtml(html) : '';
  const intro = text
    .split('▼')[0]
    .replace(/Dear Endministrators?[,:]?\s*/gi, '')
    .replace(/Уважаемы[ейх]+ Эндминистратор[а-я]*[!,:]?\s*/gi, '')
    .trim();
  return truncate(intro || fallback, 320);
}

function buildSections(entries, detailsById, steam, now, ru = {}) {
  const ruTitles = ru.titles || new Map();
  const ruIntro = ru.intro || new Map();
  const loc = (e) => ruTitles.get(e.cid);
  const displayName = (e) => bracketName(loc(e)?.title || '') || bracketName(e.title);
  const versions = entries.filter((e) => isVersionNotes(e.title));
  const latest = versions[0];
  if (!latest) throw new Error('В бюллетене Endfield не найдено обновлений версии');

  const latestTime = latest.displayTime * 1000;
  const currentName = bracketName(latest.title);
  const currentDisplayName = displayName(latest);
  const cycleStart = latestTime - 2 * DAY;

  const items = entries
    .filter((e) => e.cid !== latest.cid)
    .map((e) => settleState(toItem(e, detailsById.get(e.cid), now, loc(e))));
  const cycle = items.filter((i) => Date.parse(i.posted) >= cycleStart);

  const live = cycle.filter((i) => i.state === 'live' && LIVE_TAGS.includes(i.tag));
  const newsAndOther = cycle.filter((i) => !live.includes(i) && i.state !== 'upcoming');
  const scheduled = items.filter((i) => i.state === 'upcoming').sort(byDateAsc);

  const gapDays = averageGapDays(versions.slice(0, 5).map((v) => v.displayTime * 1000));
  const estimate = gapDays ? new Date(latestTime + gapDays * DAY) : null;

  const nextAnnounced = entries.find(
    (e) =>
      e.displayTime * 1000 > latestTime &&
      /version (pre-download|dev comm|preview)|maintenance preview/i.test(e.title) &&
      bracketName(e.title) &&
      bracketName(e.title) !== currentName
  );

  const daysSince = Math.max(0, Math.floor((now - latestTime) / DAY));
  const latestItem = toItem(latest, detailsById.get(latest.cid), now, loc(latest));

  const currentHeadline = {
    kicker: 'Arknights: Endfield',
    title: currentDisplayName ? `Версия «${currentDisplayName}»` : latestItem.title,
    subtitle: 'Текущее обновление игры',
    summary: introText(ruIntro.get(latest.cid) || detailsById.get(latest.cid), loc(latest)?.brief || latest.brief),
    date: latestItem.posted,
    url: articleUrl(latest.cid, loc(latest) ? 'ru-ru' : 'en-us'),
    image: latest.cover || null,
    chips: [
      { label: 'Вышла', value: new Date(latestTime).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) },
      { label: 'Идёт уже', value: `${daysSince} дн.` },
      { label: 'Активных событий', value: String(live.length) },
    ],
  };

  let upcomingHeadline;
  if (nextAnnounced) {
    const name = displayName(nextAnnounced);
    const nextItem = toItem(nextAnnounced, detailsById.get(nextAnnounced.cid), now, loc(nextAnnounced));
    upcomingHeadline = {
      kicker: 'Следующая версия',
      title: `Версия «${name}»`,
      subtitle: 'Анонсирована официально',
      summary: nextItem.summary,
      date: estimate ? estimate.toISOString() : null,
      estimate: true,
      countdown: Boolean(estimate && estimate.getTime() > now),
      url: nextItem.url,
      image: nextItem.image,
      chips: gapDays ? [{ label: 'Средний цикл', value: `${gapDays} дн.`, estimate: true }] : [],
    };
  } else {
    upcomingHeadline = {
      kicker: 'Следующая версия',
      title: 'Версия ещё не анонсирована',
      subtitle: 'Дата рассчитана по среднему циклу обновлений',
      summary: 'Название и точная дата появятся в официальных анонсах: превью версии, DEV Comm и уведомление о предзагрузке.',
      date: estimate ? estimate.toISOString() : null,
      estimate: true,
      countdown: Boolean(estimate && estimate.getTime() > now),
      url: 'https://endfield.gryphline.com/ru-ru/news',
      image: null,
      chips: gapDays ? [{ label: 'Средний цикл', value: `${gapDays} дн.`, estimate: true }] : [],
    };
  }

  const upcomingItems = [...scheduled];
  if (steam?.comingSoon) {
    upcomingItems.push({
      title: 'Релиз Arknights: Endfield в Steam',
      summary: truncate(`${steam.summary || ''} Страница игры уже в Steam, дата выхода: ${steam.date || 'скоро'}.`, 240),
      date: null,
      url: STEAM_URL,
      image: steam.image || null,
      tag: 'steam',
      state: 'upcoming',
      dateLabel: steam.date || 'Скоро',
    });
  }

  return {
    sources: [
      { name: 'Endfield — официальные новости', url: 'https://endfield.gryphline.com/ru-ru/news' },
      { name: 'Steam', url: STEAM_URL },
    ],
    current: {
      headline: currentHeadline,
      blocks: [
        { title: 'Идут сейчас', items: live.sort(byDateDesc), emptyText: 'Активных баннеров и событий не найдено.' },
        { title: 'Новости и объявления версии', items: newsAndOther.slice(0, 8), emptyText: 'С момента обновления новостей не было.' },
      ],
    },
    upcoming: {
      headline: upcomingHeadline,
      blocks: [
        {
          title: 'Запланировано',
          items: upcomingItems,
          emptyText: 'Заранее объявленных событий пока нет. Они появятся в официальных анонсах.',
        },
      ],
    },
  };
}

async function load() {
  const now = Date.now();
  const [entries, ruEntries, steam] = await Promise.all([
    loadList(),
    loadList('ru-ru').catch(() => []),
    loadSteamStatus(),
  ]);
  const titles = new Map(ruEntries.map((e) => [e.cid, { title: e.title, brief: e.brief }]));
  const latest = entries.find((e) => isVersionNotes(e.title));
  const latestTime = latest ? latest.displayTime * 1000 : 0;

  const wantDetails = entries
    .filter((e) => e.displayTime * 1000 >= latestTime - DAY && ['notices', 'events'].includes(e.tab))
    .slice(0, 16);
  const detailsById = new Map();
  await Promise.all(
    wantDetails.map(async (e) => {
      const html = await loadDetails(e.cid);
      if (html) detailsById.set(e.cid, html);
    })
  );

  const intro = new Map();
  if (latest && titles.has(latest.cid)) {
    const html = await loadDetails(latest.cid, 'ru-ru');
    if (html) intro.set(latest.cid, html);
  }

  return buildSections(entries, detailsById, steam, now, { titles, intro });
}

module.exports = { load, buildSections, extractPeriod, extractDates, classify, bracketName };
