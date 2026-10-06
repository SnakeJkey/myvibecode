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
    load: endfield.load,
    article: endfield.loadArticle,
  },
  {
    id: 'wot',
    name: 'World of Tanks',
    short: 'WoT',
    tagline: 'Европейский сервер',
    accent: '#d9602b',
    accentDark: '#ff8a4c',
    icon: 'icons/wot.png',
    load: wot.load,
    article: wot.loadArticle,
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
  },
  {
    id: 'hoi4',
    name: 'Hearts of Iron IV',
    short: 'HOI4',
    tagline: 'Патчи, беты и дневники',
    accent: '#5a7d3c',
    accentDark: '#9bc46d',
    icon: 'icons/hoi4.png',
    load: hoi4.load,
    article: hoi4.loadArticle,
  },
];

const publicMeta = ({ id, name, short, tagline, accent, accentDark, icon }) => ({ id, name, short, tagline, accent, accentDark, icon });

module.exports = { GAMES, normalize, publicMeta };
