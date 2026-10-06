const test = require('node:test');
const assert = require('node:assert/strict');
const { truncate, stripBBCode, stripHtml, averageGapDays, DAY } = require('../lib/util');

test('truncate обрезает по границе слова и добавляет многоточие', () => {
  assert.equal(truncate('короткий текст', 50), 'короткий текст');
  const out = truncate('раз два три четыре пять шесть семь восемь', 20);
  assert.ok(out.endsWith('…'));
  assert.ok(out.length <= 21);
});

test('stripBBCode убирает разметку Steam', () => {
  const raw = '[p]Привет [b]мир[/b][/p][img src="{STEAM_CLAN_IMAGE}/1/a.png"][/img][url=https://x.y]ссылка[/url]';
  assert.equal(stripBBCode(raw), 'Привет мир ссылка');
});

test('stripHtml декодирует сущности и убирает теги', () => {
  assert.equal(stripHtml('<p>A &amp; B</p><script>x()</script><p>C&nbsp;D</p>'), 'A & B C D');
});

test('averageGapDays считает средний интервал между датами', () => {
  const base = Date.UTC(2026, 0, 1);
  assert.equal(averageGapDays([base, base + 40 * DAY, base + 90 * DAY]), 45);
  assert.equal(averageGapDays([base]), null);
});
