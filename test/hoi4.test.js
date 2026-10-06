const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSections, classify, expansionName } = require('../lib/hoi4');

const ts = (iso) => Math.floor(Date.parse(iso) / 1000);
const post = (gid, title, iso, contents = 'Generals! Текст [b]поста[/b]') => ({ gid, title, date: ts(iso), contents });

const entries = [
  post('6', 'Steam Autumn Sale 2026', '2026-10-01T10:00:00Z'),
  post('5', 'HOI IV Dev Corner | Energy', '2026-10-01T09:00:00Z', '[img src="{STEAM_CLAN_IMAGE}/1/pic.png"][/img] Energy'),
  post('4', 'HOI IV | Patch 1.19.3', '2026-09-17T11:00:00Z'),
  post('3', 'HOI IV | Open Beta SE Update 3.03', '2026-08-28T11:00:00Z'),
  post('2', 'Thunder at our Gates | Patch 1.19.2', '2026-06-30T11:00:00Z'),
  post('1', 'Thunder at our Gates - Available Now!', '2026-06-11T11:00:00Z'),
];

test('classify определяет тип записи', () => {
  assert.equal(classify('HOI IV | Patch 1.19.3'), 'patch');
  assert.equal(classify('Hotfix 1.19.0.1'), 'patch');
  assert.equal(classify('HOI IV Dev Corner | Energy'), 'devdiary');
  assert.equal(classify('HOI IV | Open Beta SE Update 3.03'), 'beta');
  assert.equal(classify('Something else'), 'news');
});

test('expansionName берёт название дополнения из заголовка патча', () => {
  assert.equal(expansionName(entries.filter((e) => /Patch/.test(e.title))), 'Thunder at our Gates');
});

test('buildSections: версия, Dev Corner и беты', () => {
  const now = Date.parse('2026-10-06T00:00:00Z');
  const r = buildSections(entries, now);
  assert.equal(r.current.headline.title, 'Патч 1.19.3');
  assert.match(r.current.headline.subtitle, /Thunder at our Gates/);
  assert.equal(r.current.blocks[0].items[0].version, '1.19.3');
  assert.equal(r.current.blocks[0].items.length, 2);

  const diaries = r.upcoming.blocks.find((b) => b.title.startsWith('Dev Corner'));
  assert.equal(diaries.items.length, 1);
  assert.match(diaries.items[0].url, /view\/5$/);
  assert.equal(diaries.items[0].image, 'https://clan.fastly.steamstatic.com/images/1/pic.png');
  assert.equal(r.upcoming.headline.kicker, 'Дневник разработчиков');
});

test('buildSections: распродажи не попадают в новости', () => {
  const r = buildSections(entries, Date.parse('2026-10-06T00:00:00Z'));
  const news = r.current.blocks[1].items.map((i) => i.title);
  assert.ok(!news.some((t) => /sale/i.test(t)));
});

test('buildSections: без патчей ошибка', () => {
  assert.throws(() => buildSections([post('1', 'Новость', '2026-01-01T00:00:00Z')]), /патчей/);
});
