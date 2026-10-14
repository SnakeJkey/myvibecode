const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameWatcher, matchesGame, parseTasklist, parsePs, listProcesses, gameForTarget } = require('../lib/gamewatch');

test('gameForTarget связывает пункты запуска с играми', () => {
  assert.equal(gameForTarget('minecraft-modrinth'), 'minecraft');
  assert.equal(gameForTarget('wot'), 'wot');
});

test('parseTasklist читает имя образа и заголовок окна', () => {
  const out = [
    '"WorldOfTanks.exe","1234","Console","1","1 500 000 K","Running","PC\\user","0:10:00","World of Tanks"',
    '"javaw.exe","77","Console","1","900 K","Running","PC\\user","0:01:00","Minecraft* 1.21.1 - Singleplayer, \\"test\\""',
  ].join('\r\n');
  const procs = parseTasklist(out);
  assert.equal(procs.length, 2);
  assert.equal(procs[0].name, 'WorldOfTanks.exe');
  assert.match(procs[1].detail, /^Minecraft\*/);
});

test('parsePs берёт имя из пути запуска', () => {
  const procs = parsePs('/usr/bin/bash -l\n/Applications/Hearts of Iron IV.app/Contents/MacOS/hoi4 -x\nZ:\\Games\\WorldOfTanks.exe\n');
  assert.deepEqual(
    procs.map((p) => p.name),
    ['bash', 'hoi4', 'WorldOfTanks.exe']
  );
});

test('matchesGame отличает игру от лаунчера', () => {
  assert.equal(matchesGame([{ name: 'hoi4.exe' }], 'hoi4'), true);
  assert.equal(matchesGame([{ name: 'WorldOfTanks.exe' }], 'wot'), true);
  assert.equal(matchesGame([{ name: 'wgc.exe' }, { name: 'WorldOfTanks_Launcher.exe' }], 'wot'), false);
  assert.equal(matchesGame([{ name: 'Endfield.exe' }], 'endfield'), true);
  assert.equal(matchesGame([{ name: 'Launcher.exe' }, { name: 'GRYPHLINK.exe' }], 'endfield'), false);
  assert.equal(matchesGame([{ name: 'MinecraftLauncher.exe', detail: 'Minecraft Launcher' }], 'minecraft'), false);
  assert.equal(matchesGame([{ name: 'javaw.exe', detail: 'Minecraft* 1.21.1' }], 'minecraft'), true);
  assert.equal(matchesGame([{ name: 'java', detail: 'java -Xmx2G net.minecraft.client.main.Main --accessToken x' }], 'minecraft'), true);
  assert.equal(matchesGame([{ name: 'java', detail: 'java -jar minecraft_server.jar nogui' }], 'minecraft'), false);
  assert.equal(matchesGame([{ name: 'Minecraft.Windows.exe' }], 'minecraft'), true);
  assert.equal(matchesGame([{ name: 'hoi4.exe' }], 'unknown'), false);
  assert.equal(matchesGame(parsePs('/tmp/hoi4 600\n/usr/bin/sleep 5\n'), 'hoi4'), true);
  assert.equal(matchesGame(parsePs('/usr/bin/sleep 5\n'), 'hoi4'), false);
});

test('listProcesses на Windows добирает командную строку Java', async () => {
  const calls = [];
  const exec = async (file) => {
    calls.push(file);
    if (file === 'tasklist') return '"javaw.exe","5","Console","1","1 K","Running","u","0:00:01","N/A"\r\n';
    return 'javaw -Xmx2G net.minecraft.client.main.Main --accessToken abc\r\n';
  };
  const procs = await listProcesses({ platform: 'win32', exec });
  assert.deepEqual(calls, ['tasklist', 'powershell']);
  assert.equal(matchesGame(procs, 'minecraft'), true);
});

function makeWatcher(script, options = {}) {
  let time = 0;
  const events = [];
  let step = 0;
  const watcher = createGameWatcher({
    list: async () => {
      const value = script[Math.min(step, script.length - 1)];
      step += 1;
      if (value instanceof Error) throw value;
      return value;
    },
    now: () => time,
    schedule: () => 1,
    cancel: () => {},
    onRunning: (info) => events.push(['running', info.gameId]),
    onEnd: (info) => events.push(['end', info.reason, info.durationMs]),
    ...options,
  });
  return { watcher, events, advance: (ms) => (time += ms) };
}

const GAME = [{ name: 'hoi4.exe' }];
const NONE = [{ name: 'explorer.exe' }];

test('наблюдатель ждёт игру, а после её закрытия завершает сеанс', async () => {
  const { watcher, events, advance } = makeWatcher([NONE, GAME, GAME, NONE, NONE]);
  assert.equal(watcher.watch('hoi4'), true);
  await watcher.poll();
  assert.deepEqual(events, []);
  await watcher.poll();
  assert.deepEqual(events, [['running', 'hoi4']]);
  advance(60000);
  await watcher.poll();
  await watcher.poll();
  assert.deepEqual(events.length, 1, 'одиночный пропуск не считается выходом');
  advance(1000);
  await watcher.poll();
  assert.deepEqual(events[1], ['end', 'exited', 61000]);
  assert.equal(watcher.isWatching(), null);
});

test('игра, мелькнувшая между опросами, не завершает сеанс', async () => {
  const { watcher, events } = makeWatcher([GAME, NONE, GAME, NONE, GAME]);
  watcher.watch('hoi4');
  for (let i = 0; i < 5; i += 1) await watcher.poll();
  assert.deepEqual(events, [['running', 'hoi4']]);
});

test('если игра не запустилась, сеанс завершается по таймауту', async () => {
  const { watcher, events, advance } = makeWatcher([NONE], { startTimeoutMs: 1000 });
  watcher.watch('hoi4');
  await watcher.poll();
  assert.deepEqual(events, []);
  advance(1500);
  await watcher.poll();
  assert.deepEqual(events, [['end', 'timeout', 0]]);
});

test('серия сбоев опроса завершает сеанс, чтобы окно не осталось скрытым', async () => {
  const { watcher, events } = makeWatcher([new Error('ps failed')], { maxFailures: 3 });
  watcher.watch('hoi4');
  for (let i = 0; i < 3; i += 1) await watcher.poll();
  assert.deepEqual(events, [['end', 'error', 0]]);
});

test('stop отменяет наблюдение без событий, неизвестная игра не отслеживается', async () => {
  const { watcher, events } = makeWatcher([GAME]);
  assert.equal(watcher.watch('nothing'), false);
  watcher.watch('hoi4');
  watcher.stop();
  await watcher.poll();
  assert.deepEqual(events, []);
  assert.equal(watcher.isWatching(), null);
});
