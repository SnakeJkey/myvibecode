const endfield = require('./endfield');
const wot = require('./wot');
const minecraft = require('./minecraft');
const hoi4 = require('./hoi4');

function toBlocks(section) {
  if (section.blocks) return section;
  const { items = [], itemsTitle, emptyText, ...rest } = section;
  return { ...rest, blocks: [{ title: itemsTitle, items, emptyText }] };
}

function normalize(data) {
  return {
    sources: data.sources || [],
    current: toBlocks(data.current),
    upcoming: toBlocks(data.upcoming),
  };
}

const GAMES = [
  {
    id: 'endfield',
    name: 'Arknights: Endfield',
    short: 'Endfield',
    tagline: 'Версии, баннеры и события',
    accent: '#e8b100',
    accentDark: '#ffd23f',
    icon: 'icons/endfield.png',
    russianSource: true,
    load: endfield.load,
    article: endfield.loadArticle,
    launch: [{ target: 'endfield', label: 'Играть', hint: 'Запустит лаунчер GRYPHLINK' }],
  },
  {
    id: 'wot',
    name: 'World of Tanks',
    short: 'WoT',
    tagline: 'Европейский сервер',
    accent: '#d9602b',
    accentDark: '#ff8a4c',
    icon: 'icons/wot.png',
    russianSource: true,
    load: wot.load,
    article: wot.loadArticle,
    launch: [{ target: 'wot', label: 'Играть', hint: 'Запустит игру сразу, без лаунчера' }],
  },
  {
    id: 'minecraft',
    name: 'Minecraft',
    short: 'Minecraft',
    tagline: 'Java и Bedrock',
    accent: '#3f9b3a',
    accentDark: '#6fd267',
    icon: 'icons/minecraft.png',
    load: minecraft.load,
    article: minecraft.loadArticle,
    launch: [
      { target: 'minecraft-official', label: 'Minecraft Launcher', hint: 'Официальный лаунчер Mojang' },
      { target: 'minecraft-modrinth', label: 'Modrinth App', hint: 'Лаунчер с модами и сборками' },
      { target: 'minecraft-curseforge', label: 'CurseForge', hint: 'Лаунчер со сборками CurseForge' },
    ],
  },
  {
    id: 'hoi4',
    name: 'Hearts of Iron IV',
    short: 'HOI4',
    tagline: 'Патчи, беты и дневники',
    accent: '#5a7d3c',
    accentDark: '#9bc46d',
    icon: 'icons/hoi4.png',
    russianSource: true,
    load: hoi4.load,
    article: hoi4.loadArticle,
    launch: [{ target: 'hoi4', label: 'Играть', hint: 'Запустит игру через Steam' }],
  },
];

const publicMeta = ({ id, name, short, tagline, accent, accentDark, icon, launch = [] }) => ({ id, name, short, tagline, accent, accentDark, icon, launch });

const LAUNCH_TARGETS = new Set(GAMES.flatMap((game) => (game.launch || []).map((item) => item.target)));

module.exports = { GAMES, LAUNCH_TARGETS, normalize, publicMeta };
