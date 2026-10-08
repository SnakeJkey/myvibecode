const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaytime, summarize, dayBoundaries } = require('../lib/playtime');

const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const HOUR = 3600000;

test('dayBoundaries покрывает последние 7 календарных суток', () => {
  const bounds = dayBoundaries(at(2026, 10, 8, 15), 7);
  assert.equal(bounds.length, 8);
  assert.equal(bounds[0], at(2026, 10, 2));
  assert.equal(bounds[7], at(2026, 10, 9));
});

test('summarize делит сеанс, переходящий через полночь, и отбрасывает старые', () => {
  const now = at(2026, 10, 8, 15);
  const summary = summarize(
    [
      { gameId: 'wot', start: at(2026, 10, 8, 14), end: at(2026, 10, 8, 15) },
      { gameId: 'hoi4', start: at(2026, 10, 7, 23), end: at(2026, 10, 8, 1) },
      { gameId: 'minecraft', start: at(2026, 9, 1, 10), end: at(2026, 9, 1, 12) },
    ],
    now
  );
  assert.equal(summary.games.wot.total, HOUR);
  assert.equal(summary.games.wot.sessions, 1);
  assert.equal(summary.games.hoi4.total, 2 * HOUR);
  assert.equal(summary.games.minecraft, undefined);
  assert.equal(summary.days[6].byGame.wot, HOUR);
  assert.equal(summary.days[6].byGame.hoi4, HOUR);
  assert.equal(summary.days[5].byGame.hoi4, HOUR);
  assert.equal(summary.total, 3 * HOUR);
});

function memoryFs(initial = {}) {
  const files = { ...initial };
  return {
    files,
    readFileSync(file) {
      if (!(file in files)) {
        const err = new Error('missing');
        err.code = 'ENOENT';
        throw err;
      }
      return files[file];
    },
    writeFileSync(file, content) {
      files[file] = content;
    },
  };
}

test('учётчик открывает сеанс, пока процесс есть, и закрывает после двух пропусков', async () => {
  const fsImpl = memoryFs();
  let time = at(2026, 10, 8, 12);
  const script = [
    [{ name: 'hoi4.exe' }],
    [{ name: 'hoi4.exe' }],
    [{ name: 'hoi4.exe' }],
    [{ name: 'explorer.exe' }],
    [{ name: 'explorer.exe' }],
  ];
  let step = 0;
  const changes = [];
  const playtime = createPlaytime({
    file: 'playtime.json',
    fsImpl,
    list: async () => script[Math.min(step++, script.length - 1)],
    now: () => time,
    minSessionMs: 1000,
    onChange: () => changes.push(time),
    schedule: () => 1,
    cancel: () => {},
  });
  playtime.start();
  await playtime.tick();
  time += 30 * 60 * 1000;
  await playtime.tick();
  time += 30 * 60 * 1000;
  await playtime.tick();
  let summary = playtime.summary();
  assert.deepEqual(summary.playing, ['hoi4']);
  assert.equal(summary.games.hoi4.total, 60 * 60 * 1000);
  await playtime.tick();
  assert.deepEqual(playtime.summary().playing, ['hoi4'], 'один пропуск не заканчивает сеанс');
  time += 1000;
  await playtime.tick();
  summary = playtime.summary();
  assert.deepEqual(summary.playing, []);
  assert.equal(summary.games.hoi4.sessions, 1);
  assert.equal(summary.games.hoi4.total, 60 * 60 * 1000);
  assert.equal(changes.length, 2);

  playtime.stop();
  const saved = JSON.parse(fsImpl.files['playtime.json']);
  assert.equal(saved.sessions.length, 1);
  assert.deepEqual(saved.open, {});
});

test('незакрытый сеанс после сбоя восстанавливается по последней отметке', () => {
  const fsImpl = memoryFs({
    'playtime.json': JSON.stringify({
      sessions: [],
      open: { wot: { start: at(2026, 10, 8, 10), lastSeen: at(2026, 10, 8, 11) } },
    }),
  });
  const playtime = createPlaytime({
    file: 'playtime.json',
    fsImpl,
    now: () => at(2026, 10, 8, 12),
    schedule: () => 1,
    cancel: () => {},
  });
  playtime.start();
  const summary = playtime.summary();
  assert.equal(summary.games.wot.total, HOUR);
  assert.deepEqual(summary.playing, []);
  playtime.stop();
});

test('короткое появление процесса не попадает в статистику, сброс очищает сеансы', async () => {
  const fsImpl = memoryFs();
  let time = at(2026, 10, 8, 12);
  const playtime = createPlaytime({
    file: 'playtime.json',
    fsImpl,
    list: async () => [{ name: 'WorldOfTanks.exe' }],
    now: () => time,
    minSessionMs: 60 * 1000,
    schedule: () => 1,
    cancel: () => {},
  });
  playtime.start();
  await playtime.tick();
  time += 1000;
  playtime.stop();
  assert.equal(playtime.summary().total, 0);

  time = at(2026, 10, 8, 18);
  const again = createPlaytime({
    file: 'playtime.json',
    fsImpl,
    list: async () => [{ name: 'WorldOfTanks.exe' }],
    now: () => time,
    schedule: () => 1,
    cancel: () => {},
  });
  again.start();
  await again.tick();
  time += 10 * 60 * 1000;
  await again.tick();
  assert.equal(again.summary().total, 10 * 60 * 1000);
  again.reset();
  assert.equal(again.summary().total, 0);
  assert.deepEqual(again.summary().playing, ['wot']);
  again.stop();
});
