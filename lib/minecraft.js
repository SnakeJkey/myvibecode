const { DAY, fetchJson, truncate, toIso, byDateDesc, averageGapDays } = require('./util');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_NOTES_URL = 'https://launchercontent.mojang.com/v2/javaPatchNotes.json';
const BEDROCK_NOTES_URL = 'https://launchercontent.mojang.com/v2/bedrockPatchNotes.json';
const CONTENT_HOST = 'https://launchercontent.mojang.com';

const wikiUrl = (id) => `https://ru.minecraft.wiki/w/Java_Edition_${encodeURIComponent(id)}`;
const imageUrl = (entry) => (entry?.image?.url ? `${CONTENT_HOST}${entry.image.url}` : null);

function javaItem(version, notesById, tag) {
  const notes = notesById.get(version.id);
  return {
    title: notes?.title || `Minecraft Java Edition ${version.id}`,
    version: version.id,
    summary: truncate(notes?.shortText, 240),
    date: toIso(version.releaseTime),
    url: wikiUrl(version.id),
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
      url: `https://ru.minecraft.wiki/w/Bedrock_Edition_${encodeURIComponent(latestBedrock.version)}`,
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

module.exports = { load };
