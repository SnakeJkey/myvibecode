const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDates, extractPeriod, classify, bracketName, buildSections } = require('../lib/endfield');

const ts = (iso) => Math.floor(Date.parse(iso) / 1000);

test('extractDates переводит серверное время (UTC-5) в UTC', () => {
  assert.deepEqual(extractDates('Sept. 24, 2026 at 12:00 (server time)'), ['2026-09-24T17:00:00.000Z']);
  assert.deepEqual(extractDates('Oct. 1, 2026'), ['2026-10-01T05:00:00.000Z']);
});

test('extractPeriod понимает «до обновления версии» и диапазоны', () => {
  const open = extractPeriod('▼// Event Time Oct. 1, 2026 at 12:00 (server time) – Before version update and maintenance ▼// Rewards');
  assert.equal(open.start, '2026-10-01T17:00:00.000Z');
  assert.equal(open.end, null);
  assert.equal(open.untilNextVersion, true);

  const range = extractPeriod('Event Time: Oct. 10, 2026 at 04:00 – Oct. 20, 2026 at 03:59 ▼// Rewards');
  assert.equal(range.start, '2026-10-10T09:00:00.000Z');
  assert.equal(range.end, '2026-10-20T08:59:00.000Z');

  assert.deepEqual(extractPeriod('Ничего о датах'), { start: null, end: null, untilNextVersion: false });
});

test('classify и bracketName определяют тип записи и название версии', () => {
  assert.equal(classify({ title: '[Winter Hunt] Chartered Headhunting', tab: 'notices' }), 'headhunting');
  assert.equal(classify({ title: '[Deep Cold Issue] LTO Details', tab: 'notices' }), 'weapon');
  assert.equal(classify({ title: 'Wishlist Milestone Event', tab: 'events' }), 'event');
  assert.equal(bracketName('[Homecoming] Version Update Notes'), 'Homecoming');
});

function fixture() {
  const entry = (cid, title, iso, tab = 'notices') => ({ cid, title, tab, displayTime: ts(iso), brief: `brief ${cid}`, cover: null });
  return [
    entry('4', '[New Banner] Chartered Headhunting', '2026-09-20T05:00:00Z'),
    entry('3', '[Beta] Version Update Notes', '2026-09-01T01:00:00Z'),
    entry('2', '[Alpha] Version Update Notes', '2026-07-15T01:00:00Z'),
    entry('1', '[Zero] Version Update Notes', '2026-06-01T01:00:00Z'),
  ];
}

test('buildSections: текущая версия и расчёт следующей по среднему циклу', () => {
  const now = Date.parse('2026-09-25T00:00:00Z');
  const details = new Map([['4', '<p>Availability Sept. 20, 2026 at 12:00 – Before version update and maintenance</p>']]);
  const result = buildSections(fixture(), details, { comingSoon: true, date: 'Coming soon', summary: 'x' }, now);

  assert.match(result.current.headline.title, /Beta/);
  const live = result.current.blocks[0].items;
  assert.equal(live.length, 1);
  assert.equal(live[0].state, 'live');

  const estimate = new Date(result.upcoming.headline.date);
  const expectedGap = Math.round((Date.parse('2026-09-01T01:00:00Z') - Date.parse('2026-06-01T01:00:00Z')) / 2 / 86400000);
  assert.equal(Math.round((estimate - Date.parse('2026-09-01T01:00:00Z')) / 86400000), expectedGap);
  assert.equal(result.upcoming.headline.estimate, true);
  assert.equal(result.upcoming.blocks[0].items[0].tag, 'steam');
});

test('buildSections: анонс следующей версии определяется по названию', () => {
  const entries = [
    { cid: '9', title: '[Gamma] Version Pre-Download & Update Notice', tab: 'notices', displayTime: ts('2026-09-24T00:00:00Z'), brief: 'pre' },
    ...fixture(),
  ];
  const result = buildSections(entries, new Map(), null, Date.parse('2026-09-25T00:00:00Z'));
  assert.match(result.upcoming.headline.title, /Gamma/);
});

test('buildSections: без записей о версии выбрасывает понятную ошибку', () => {
  assert.throws(() => buildSections([], new Map(), null, Date.now()), /не найдено/);
});
