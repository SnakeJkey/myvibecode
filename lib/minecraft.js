const { DAY, USER_AGENT, fetchJson, truncate, toIso, byDateDesc, averageGapDays } = require('./util');
const { htmlToBlocks } = require('./richtext');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_NOTES_URL = 'https://launchercontent.mojang.com/v2/javaPatchNotes.json';
const BEDROCK_NOTES_URL = 'https://launchercontent.mojang.com/v2/bedrockPatchNotes.json';
const CONTENT_HOST = 'https://launchercontent.mojang.com';

const SITE = 'https://www.minecraft.net';
const UPDATES_URL = `${SITE}/ru-ru/updates`;
const BEDROCK_CHANGELOGS = 'https://feedback.minecraft.net/hc/en-us/sections/360001186971-Release-Changelogs';
const REF_RE = /^(java|bedrock)PatchNotes\/[A-Za-z0-9._-]+\.json$/;
const slug = (v) => String(v).toLowerCase().replace(/\./g, '-');

function articleSlugs({ version, type, id, edition }) {
  if (edition === 'bedrock') return [];
  if (type === 'release') return [`minecraft-java-edition-${slug(version)}`];
  if (/^\d{2}w\d{2}[a-z]$/.test(version)) return [`minecraft-snapshot-${version}`];
  const spelled = slug(version).replace(/-rc-/, '-release-candidate-').replace(/-pre-/, '-pre-release-');
  return [...new Set([/^\d/.test(id || '') ? `minecraft-${id}` : null, `minecraft-${spelled}`, `minecraft-${slug(version)}`].filter(Boolean))];
}

const articleUrl = (entry, edition = 'java', lang = 'ru-ru') => {
  const [first] = articleSlugs({ version: entry.version, type: entry.type, id: entry.id, edition });
  if (edition === 'bedrock') return BEDROCK_CHANGELOGS;
  return first ? `${SITE}/${lang}/article/${first}` : UPDATES_URL;
};

const wikiUrl = (id) => `${SITE}/ru-ru/article/${articleSlugs({ version: id, type: /^\d+\.\d+(\.\d+)?$/.test(id) ? 'release' : 'snapshot', id: slug(id) })[0] || 'minecraft-java-edition-' + slug(id)}`;
const imageUrl = (entry) => (entry?.image?.url ? `${CONTENT_HOST}${entry.image.url}` : null);

function javaItem(version, notesById, tag) {
  const notes = notesById.get(version.id);
  return {
    title: notes?.title || `Minecraft Java Edition ${version.id}`,
    version: version.id,
    summary: truncate(notes?.shortText, 240),
    date: toIso(version.releaseTime),
    url: notes ? articleUrl({ version: version.id, type: version.type, id: notes.id }) : wikiUrl(version.id),
    ref: notes?.contentPath || null,
    image: imageUrl(notes),
    tag,
    state: 'past',
  };
}

function baseVersion(id) {
  return id.split('-')[0];
}

async function load() {
  const [manifest, javaNotes, bedrockNotes] = await Promise.all([
    fetchJson(MANIFEST_URL),
    fetchJson(JAVA_NOTES_URL),
    fetchJson(BEDROCK_NOTES_URL).catch(() => ({ entries: [] })),
  ]);

  const notesById = new Map(javaNotes.entries.map((e) => [e.version, e]));
  const versions = manifest.versions;
  const releases = versions.filter((v) => v.type === 'release');
  const latestRelease = versions.find((v) => v.id === manifest.latest.release) || releases[0];
  const releaseTime = new Date(latestRelease.releaseTime).getTime();

  const bedrockRetail = bedrockNotes.entries.filter((e) => e.patchNoteType === 'retail').sort(byDateDesc);
  const latestBedrock = bedrockRetail[0];

  const releaseNotes = notesById.get(latestRelease.id);
  const currentHeadline = {
    kicker: 'Minecraft: Java Edition',
    title: `Версия ${latestRelease.id}`,
    subtitle: releaseNotes?.title && releaseNotes.title !== `Minecraft: Java Edition ${latestRelease.id}` ? releaseNotes.title : null,
    summary: truncate(releaseNotes?.shortText, 320),
    date: toIso(latestRelease.releaseTime),
    url: wikiUrl(latestRelease.id),
    ref: releaseNotes?.contentPath || null,
    image: imageUrl(releaseNotes),
    chips: [
      { label: 'Java Edition', value: latestRelease.id },
      latestBedrock && { label: 'Bedrock Edition', value: latestBedrock.version },
    ].filter(Boolean),
  };

  const currentItems = [];
  if (latestBedrock) {
    currentItems.push({
      title: latestBedrock.title,
      version: latestBedrock.version,
      summary: truncate(latestBedrock.shortText, 240),
      date: toIso(latestBedrock.date),
      url: BEDROCK_CHANGELOGS,
      ref: latestBedrock.contentPath || null,
      image: imageUrl(latestBedrock),
      tag: 'bedrock',
      state: 'past',
    });
  }
  releases
    .filter((v) => v.id !== latestRelease.id)
    .slice(0, 5)
    .forEach((v) => currentItems.push(javaItem(v, notesById, 'release')));
  currentItems.sort(byDateDesc);

  const upcomingVersions = versions
    .filter((v) => v.type === 'snapshot' && new Date(v.releaseTime).getTime() > releaseTime)
    .slice(0, 10);

  let upcomingHeadline = null;
  if (upcomingVersions.length) {
    const newest = upcomingVersions[0];
    const notes = notesById.get(newest.id);
    const next = baseVersion(newest.id);
    const avgGap = averageGapDays(releases.slice(0, 5).map((v) => v.releaseTime));
    const estimate = avgGap ? new Date(releaseTime + avgGap * DAY) : null;
    upcomingHeadline = {
      kicker: 'Следующее обновление',
      title: `Minecraft ${next}`,
      subtitle: `Последняя сборка: ${newest.id}`,
      summary: truncate(notes?.shortText, 320),
      date: toIso(newest.releaseTime),
      url: wikiUrl(newest.id),
      ref: notes?.contentPath || null,
      image: imageUrl(notes),
      chips: [
        { label: 'Сборок в цикле', value: String(upcomingVersions.length) },
        estimate && estimate.getTime() > Date.now() && {
          label: 'Ориентировочный релиз',
          value: estimate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
          estimate: true,
        },
      ].filter(Boolean),
    };
  }

  const upcomingItems = upcomingVersions.map((v) => {
    const item = javaItem(v, notesById, 'snapshot');
    item.state = 'upcoming';
    return item;
  });

  return {
    sources: [
      { name: 'Mojang Version Manifest', url: MANIFEST_URL },
      { name: 'Minecraft Patch Notes', url: JAVA_NOTES_URL },
    ],
    current: { headline: currentHeadline, items: currentItems, itemsTitle: 'Недавние релизы' },
    upcoming: {
      headline: upcomingHeadline,
      items: upcomingItems,
      itemsTitle: 'Снапшоты и пре-релизы',
      emptyText: 'Сейчас нет снапшотов следующего обновления. Новый цикл тестирования ещё не начался.',
    },
  };
}

const urlCache = new Map();

async function exists(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(6000), redirect: 'follow' });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveOfficialUrl(entry, edition) {
  if (edition === 'bedrock') return BEDROCK_CHANGELOGS;
  const key = `${edition}:${entry.version}`;
  if (urlCache.has(key)) return urlCache.get(key);
  let found = null;
  for (const s of articleSlugs({ version: entry.version, type: entry.type, id: entry.id, edition })) {
    for (const lang of ['ru-ru', 'en-us']) {
      const url = `${SITE}/${lang}/article/${s}`;
      if (await exists(url)) {
        found = url;
        break;
      }
    }
    if (found) break;
  }
  const result = found || UPDATES_URL;
  urlCache.set(key, result);
  return result;
}

async function loadArticle(ref) {
  if (!REF_RE.test(String(ref))) throw new Error('Некорректная ссылка на патчноут');
  const data = await fetchJson(`${CONTENT_HOST}/v2/${ref}`);
  const edition = ref.startsWith('bedrock') ? 'bedrock' : 'java';
  const url = await resolveOfficialUrl({ version: data.version, type: data.type, id: data.id }, edition);
  return { blocks: htmlToBlocks(data.body), url };
}

module.exports = { load, loadArticle, articleSlugs };
