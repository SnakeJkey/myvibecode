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
    load: endfield.load,
  },
  {
    id: 'wot',
    name: 'World of Tanks',
    short: 'WoT',
    tagline: 'Европейский сервер',
    accent: '#d9602b',
    accentDark: '#ff8a4c',
    load: wot.load,
  },
  {
    id: 'minecraft',
    name: 'Minecraft',
    short: 'Minecraft',
    tagline: 'Java и Bedrock',
    accent: '#3f9b3a',
    accentDark: '#6fd267',
    load: minecraft.load,
  },
  {
    id: 'hoi4',
    name: 'Hearts of Iron IV',
    short: 'HOI4',
    tagline: 'Патчи, беты и дневники',
    accent: '#5a7d3c',
    accentDark: '#9bc46d',
    load: hoi4.load,
  },
];

const publicMeta = ({ id, name, short, tagline, accent, accentDark }) => ({ id, name, short, tagline, accent, accentDark });

module.exports = { GAMES, normalize, publicMeta };
