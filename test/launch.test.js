const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createLauncher, parseRegKeys, parseRegValues } = require('../lib/launch');

const WIN_ENV = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\n\\AppData\\Local' };

function fakeSpawn(log, failFirst) {
  let calls = 0;
  return (file, args, options) => {
    calls += 1;
    log.push({ file, args, cwd: options.cwd });
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => {
      if (failFirst && calls === 1) child.emit('error', Object.assign(new Error('spawn UNKNOWN'), { code: 'UNKNOWN' }));
      else child.emit('spawn');
    });
    return child;
  };
}

function setup({ platform = 'win32', files = [], registry = {}, settings = {}, failFirst = false, pathEnv = '' } = {}) {
  const spawned = [];
  const opened = [];
  const saved = { ...settings };
  const present = new Set(files);
  const launcher = createLauncher({
    platform,
    env: WIN_ENV,
    pathEnv,
    home: '/home/n',
    exists: (p) => present.has(p) || p === 'C:\\' || (platform === 'win32' && /^[D]:\\$/.test(p) && files.some((f) => f.startsWith('D:'))),
    reg: async (args) => {
      const key = args.join(' ');
      for (const [pattern, output] of Object.entries(registry)) if (key.includes(pattern)) return output;
      return '';
    },
    spawnProcess: fakeSpawn(spawned, failFirst),
    shell: {
      openExternal: async (url) => opened.push(['url', url]),
      openPath: async (file) => {
        opened.push(['path', file]);
        return '';
      },
    },
    settings: { get: (id) => saved[id] || null, set: (id, value) => (saved[id] = value) },
  });
  return { launcher, spawned, opened, saved };
}

test('разбор вывода reg query', () => {
  const out = '\r\nHKEY_CURRENT_USER\\Software\\X\\Uninstall\\123\r\n    DisplayName    REG_SZ    World of Tanks EU\r\n    InstallLocation    REG_SZ    C:\\Games\\World_of_Tanks_EU\r\n\r\nEnd of search: 1 match(es) found.\r\n';
  assert.deepEqual(parseRegKeys(out), ['HKEY_CURRENT_USER\\Software\\X\\Uninstall\\123']);
  assert.equal(parseRegValues(out).InstallLocation, 'C:\\Games\\World_of_Tanks_EU');
});

test('Hearts of Iron IV запускается через Steam, без Steam даёт понятную ошибку', async () => {
  const ok = setup({ registry: { 'Valve\\Steam': '    SteamExe    REG_SZ    c:/steam/steam.exe' } });
  assert.deepEqual(await ok.launcher.launch('hoi4'), { ok: true });
  assert.deepEqual(ok.opened, [['url', 'steam://rungameid/394360']]);

  const none = setup();
  const result = await none.launcher.launch('hoi4');
  assert.equal(result.ok, false);
  assert.match(result.error, /Steam не найден/);
});

test('World of Tanks: запускается 64-битный exe напрямую, путь берётся из реестра', async () => {
  const exe = 'D:\\Games\\World_of_Tanks_EU\\win64\\WorldOfTanks.exe';
  const { launcher, spawned } = setup({
    files: [exe, 'D:\\Games\\World_of_Tanks_EU\\WorldOfTanks.exe'],
    registry: {
      'World of Tanks EU': 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\2314027414\r\n',
      '2314027414': '    InstallLocation    REG_SZ    D:\\Games\\World_of_Tanks_EU\r\n',
    },
  });
  assert.deepEqual(await launcher.launch('wot'), { ok: true });
  assert.equal(spawned[0].file, exe);
  assert.equal(spawned[0].cwd, 'D:\\Games\\World_of_Tanks_EU\\win64');
});

test('World of Tanks: без реестра ищется в типичных папках на дисках', async () => {
  const exe = 'D:\\Games\\World_of_Tanks_EU\\win64\\WorldOfTanks.exe';
  const { launcher, spawned } = setup({ files: [exe] });
  assert.equal((await launcher.launch('wot')).ok, true);
  assert.equal(spawned[0].file, exe);
});

test('Endfield: находит Launcher.exe в GRYPHLINK', async () => {
  const exe = 'C:\\Program Files\\GRYPHLINK\\Launcher.exe';
  const { launcher, spawned } = setup({ files: [exe] });
  assert.equal((await launcher.launch('endfield')).ok, true);
  assert.equal(spawned[0].file, exe);
});

test('Minecraft: три варианта, включая Microsoft Store и Modrinth/CurseForge', async () => {
  const modrinth = 'C:\\Users\\n\\AppData\\Local\\Modrinth App\\Modrinth App.exe';
  const curse = 'C:\\Users\\n\\AppData\\Local\\Programs\\CurseForge Windows\\CurseForge.exe';
  const { launcher, spawned } = setup({
    files: [modrinth, curse],
    registry: { 'AppModel\\Repository\\Packages': 'HKEY_CURRENT_USER\\...\\Packages\\Microsoft.4297127D64EC6_1.0.0_x64__8wekyb3d8bbwe\r\n' },
  });
  assert.equal((await launcher.launch('minecraft-modrinth')).ok, true);
  assert.equal((await launcher.launch('minecraft-curseforge')).ok, true);
  assert.equal((await launcher.launch('minecraft-official')).ok, true);
  assert.equal(spawned[0].file, modrinth);
  assert.equal(spawned[1].file, curse);
  assert.equal(spawned[2].file, 'explorer.exe');
  assert.deepEqual(spawned[2].args, ['shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft']);
});

test('если программа не найдена, возвращается not-found, а выбранный вручную путь запоминается', async () => {
  const { launcher, spawned, saved } = setup({ files: ['E:\\Custom\\Launcher.exe'] });
  const missing = await launcher.launch('endfield');
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'not-found');

  assert.equal((await launcher.launchFile('endfield', 'E:\\Nope.exe')).ok, false);
  assert.equal((await launcher.launchFile('endfield', 'E:\\Custom\\Launcher.exe')).ok, true);
  assert.equal(saved.endfield, 'E:\\Custom\\Launcher.exe');
  assert.equal(spawned[0].file, 'E:\\Custom\\Launcher.exe');

  assert.equal((await launcher.launch('endfield')).ok, true);
  assert.equal(spawned[1].file, 'E:\\Custom\\Launcher.exe');
  assert.equal((await launcher.launch('nonsense')).ok, false);
  assert.equal((await launcher.launchFile('hoi4', 'E:\\Custom\\Launcher.exe')).ok, false);
});

test('если прямой запуск не удался (нужны права администратора), используется ShellExecute', async () => {
  const exe = 'C:\\Program Files\\GRYPHLINK\\Launcher.exe';
  const { launcher, opened } = setup({ files: [exe], failFirst: true });
  assert.equal((await launcher.launch('endfield')).ok, true);
  assert.deepEqual(opened, [['path', exe]]);
});

test('Linux: Minecraft Launcher ищется в PATH, WoT и Endfield недоступны', async () => {
  const { launcher, spawned } = setup({ platform: 'linux', files: ['/usr/bin/minecraft-launcher'], pathEnv: '/usr/local/bin:/usr/bin' });
  assert.equal((await launcher.launch('minecraft-official')).ok, true);
  assert.equal(spawned[0].file, '/usr/bin/minecraft-launcher');
  const wot = await launcher.launch('wot');
  assert.equal(wot.ok, false);
  assert.equal(wot.code, 'not-found');
});
