const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../public/format');

test('plural склоняет русские числительные', () => {
  assert.equal(F.plural(1, 'день', 'дня', 'дней'), 'день');
  assert.equal(F.plural(3, 'день', 'дня', 'дней'), 'дня');
  assert.equal(F.plural(11, 'день', 'дня', 'дней'), 'дней');
  assert.equal(F.plural(21, 'день', 'дня', 'дней'), 'день');
});

test('splitDuration разбивает интервал', () => {
  assert.deepEqual(F.splitDuration(((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000), { days: 2, hours: 3, minutes: 4, seconds: 5 });
  assert.equal(F.splitDuration(-5).days, 0);
});

test('relative показывает остаток или время до начала', () => {
  const now = Date.parse('2026-10-06T00:00:00Z');
  assert.equal(F.relative({ state: 'live', endDate: '2026-10-09T00:00:00Z' }, now), 'осталось 3 дня');
  assert.equal(F.relative({ state: 'upcoming', date: '2026-10-06T05:00:00Z' }, now), 'через 5 часов');
  assert.equal(F.relative({ state: 'past', date: '2026-10-01T00:00:00Z' }, now), '');
  assert.equal(F.relative({ state: 'live', untilNextVersion: true }, now), 'до новой версии');
});

test('formatPlaytime складывает часы и минуты', () => {
  assert.equal(F.formatPlaytime(0), '0 мин');
  assert.equal(F.formatPlaytime(30 * 1000), 'меньше минуты');
  assert.equal(F.formatPlaytime(5 * 60 * 1000), '5 мин');
  assert.equal(F.formatPlaytime(2 * 3600 * 1000), '2 часа');
  assert.equal(F.formatPlaytime((3 * 60 + 15) * 60 * 1000), '3 часа 15 мин');
  assert.equal(F.formatPlaytime((1 * 60 + 1) * 60 * 1000), '1 час 1 мин');
  assert.match(F.weekdayShort(new Date(2026, 9, 8).getTime()), /чт/i);
});

test('dateRange форматирует даты', () => {
  const now = Date.parse('2026-10-06T00:00:00Z');
  assert.equal(F.dateRange({ date: null }, now), 'Дата уточняется');
  assert.equal(F.dateRange({ dateLabel: 'Скоро' }, now), 'Скоро');
  assert.match(F.dateRange({ date: '2026-10-02T00:00:00Z', endDate: '2026-10-09T23:59:00Z', allDay: true }, now), /–/);
  assert.match(F.dateRange({ date: '2026-10-02T00:00:00Z', untilNextVersion: true, allDay: true }, now), /до следующей версии/);
});

test('tagInfo возвращает запасной вариант для неизвестного тега', () => {
  assert.equal(F.tagInfo('patch').label, 'Патч');
  assert.equal(F.tagInfo('unknown').label, 'Новость');
});

test('freshItems находит обновления и события, начавшиеся не более 3 суток назад', () => {
  const now = Date.parse('2026-10-08T09:00:00Z');
  const data = {
    current: {
      headline: { title: 'Версия 1.2', date: '2026-10-07T01:00:00Z' },
      blocks: [
        {
          items: [
            { tag: 'event', title: 'Новое событие', date: '2026-10-06T10:00:00Z', state: 'live' },
            { tag: 'event', title: 'Старое событие', date: '2026-10-01T10:00:00Z', state: 'live' },
            { tag: 'merch', title: 'Мерч', date: '2026-10-07T10:00:00Z' },
            { tag: 'update', title: 'Анонс в будущем', date: '2026-10-12T10:00:00Z', state: 'upcoming' },
          ],
        },
      ],
    },
    upcoming: {
      headline: { title: 'Дневник', date: '2026-10-07T10:00:00Z' },
      blocks: [{ items: [{ tag: 'snapshot', title: 'Снапшот 3', date: '2026-10-07T12:00:00Z', state: 'upcoming' }] }],
    },
  };
  const fresh = F.freshItems(data, now);
  assert.deepEqual(
    fresh.map((i) => i.title),
    ['Снапшот 3', 'Версия 1.2', 'Новое событие']
  );
  assert.equal(F.freshItems(null, now).length, 0);
  assert.equal(F.itemKey({ tag: 'event', title: 'A', date: 'D' }), 'event|A|D');
});
