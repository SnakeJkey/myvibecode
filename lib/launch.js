const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const UNINSTALL_ROOTS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];
const APPX_REPOSITORY = 'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages';
const MINECRAFT_APPX = { package: 'Microsoft.4297127D64EC6', aumid: 'Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft' };

// Описание того, что и где искать. На Windows порядок поиска такой: путь, указанный пользователем,
// затем реестр (запись об установке), затем типичные папки на всех дисках.
const TARGETS = {
  endfield: {
    name: 'лаунчер Arknights: Endfield (GRYPHLINK)',
    win: {
      registry: ['GRYPHLINK', 'Arknights: Endfield'],
      files: ['Launcher.exe'],
      dirs: ({ programFiles, drives }) => [
        ...programFiles.map((p) => path.win32.join(p, 'GRYPHLINK')),
        ...drives.flatMap((d) => [`${d}\\GRYPHLINK`, `${d}\\Games\\GRYPHLINK`, `${d}\\Program Files\\GRYPHLINK`]),
      ],
    },
  },
  wot: {
    name: 'World of Tanks',
    win: {
      registry: ['World of Tanks EU', 'World of Tanks'],
      // 64-битный клиент запускает игру сразу, минуя Wargaming Game Center
      files: ['win64\\WorldOfTanks.exe', 'WorldOfTanks.exe'],
      dirs: ({ programFiles, drives }) => [
        ...['World_of_Tanks_EU', 'World_of_Tanks'].flatMap((name) => [
          ...programFiles.map((p) => path.win32.join(p, name)),
          ...drives.flatMap((d) => [`${d}\\Games\\${name}`, `${d}\\${name}`]),
        ]),
      ],
    },
  },
  hoi4: { name: 'Hearts of Iron IV (Steam)', steamId: 394360 },
  'minecraft-official': {
    name: 'Minecraft Launcher',
    win: {
      files: ['MinecraftLauncher.exe', 'Content\\Minecraft.exe'],
      dirs: ({ programFiles, drives }) => [
        ...programFiles.map((p) => path.win32.join(p, 'Minecraft Launcher')),
        ...drives.map((d) => `${d}\\XboxGames\\Minecraft Launcher`),
      ],
      appx: MINECRAFT_APPX,
    },
    mac: { apps: ['/Applications/Minecraft.app'] },
    linux: { bins: ['minecraft-launcher'], files: ['/opt/minecraft-launcher/minecraft-launcher'], flatpak: 'com.mojang.Minecraft' },
  },
  'minecraft-modrinth': {
    name: 'Modrinth App',
    win: {
      registry: ['Modrinth App'],
      files: ['Modrinth App.exe'],
      dirs: ({ localAppData, programFiles }) => [
        path.win32.join(localAppData, 'Modrinth App'),
        path.win32.join(localAppData, 'Programs', 'Modrinth App'),
        ...programFiles.map((p) => path.win32.join(p, 'Modrinth App')),
      ],
    },
    mac: { apps: ['/Applications/Modrinth App.app'] },
    linux: { bins: ['ModrinthApp', 'modrinth-app'], flatpak: 'com.modrinth.ModrinthApp' },
  },
  'minecraft-curseforge': {
    name: 'CurseForge',
    win: {
      registry: ['CurseForge'],
      files: ['CurseForge.exe'],
      dirs: ({ localAppData, programFiles }) => [
        path.win32.join(localAppData, 'Programs', 'CurseForge Windows'),
        path.win32.join(localAppData, 'Programs', 'CurseForge'),
        path.win32.join(localAppData, 'CurseForge'),
        ...programFiles.flatMap((p) => [path.win32.join(p, 'CurseForge Windows'), path.win32.join(p, 'CurseForge')]),
      ],
    },
    mac: { apps: ['/Applications/CurseForge.app'] },
    linux: { bins: ['curseforge'] },
  },
};

const unquote = (s) => String(s).trim().replace(/^"(.*)"$/, '$1');

function defaultReg(args) {
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

function parseRegValues(output) {
  const values = {};
  for (const line of String(output).split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+REG_\w+\s+(.*)$/.exec(line);
    if (m) values[m[1]] = m[2].trim();
  }
  return values;
}

function parseRegKeys(output) {
  return String(output)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^HKEY_/i.test(l));
}

function createLauncher({
  platform = process.platform,
  env = process.env,
  exists = fs.existsSync,
  reg = defaultReg,
  spawnProcess = spawn,
  shell,
  settings = { get: () => null, set: () => {} },
  pathEnv = process.env.PATH || '',
  home = require('node:os').homedir(),
} = {}) {
  const isWin = platform === 'win32';

  function windowsContext() {
    const programFiles = [...new Set([env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(Boolean))];
    const drives = [];
    for (let code = 67; code <= 90; code += 1) {
      const letter = String.fromCharCode(code);
      if (exists(`${letter}:\\`)) drives.push(`${letter}:`);
    }
    return { programFiles, drives, localAppData: env.LOCALAPPDATA || path.win32.join(env.USERPROFILE || home, 'AppData', 'Local') };
  }

  async function registryDirs(names) {
    const dirs = [];
    for (const name of names) {
      for (const root of UNINSTALL_ROOTS) {
        const found = await reg(['query', root, '/s', '/f', name, '/d']);
        for (const key of parseRegKeys(found)) {
          const values = parseRegValues(await reg(['query', key]));
          if (values.InstallLocation) dirs.push(unquote(values.InstallLocation));
          for (const field of ['DisplayIcon', 'UninstallString']) {
            const raw = values[field];
            if (!raw) continue;
            const file = /^"([^"]+)"/.exec(raw)?.[1] || /^(\S.*?\.exe)/i.exec(raw)?.[1];
            if (file) dirs.push(path.win32.dirname(file));
          }
        }
      }
    }
    return dirs;
  }

  async function resolveWindows(spec) {
    const ctx = windowsContext();
    const dirs = [];
    if (spec.registry) dirs.push(...(await registryDirs(spec.registry)));
    if (spec.dirs) dirs.push(...spec.dirs(ctx));
    for (const dir of [...new Set(dirs)]) {
      for (const file of spec.files || []) {
        const full = path.win32.join(dir, file);
        if (exists(full)) return { kind: 'exec', file: full, cwd: path.win32.dirname(full) };
      }
    }
    if (spec.appx) {
      const packages = await reg(['query', APPX_REPOSITORY, '/f', spec.appx.package, '/k']);
      if (parseRegKeys(packages).some((key) => key.includes(spec.appx.package))) return { kind: 'appx', aumid: spec.appx.aumid };
    }
    return null;
  }

  function findOnPath(name) {
    for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
      const full = path.join(dir, name);
      if (exists(full)) return full;
    }
    return null;
  }

  function resolveUnix(spec) {
    if (platform === 'darwin') {
      for (const app of spec.apps || []) {
        for (const candidate of [app, path.join(home, app)]) if (exists(candidate)) return { kind: 'mac-app', file: candidate };
      }
      return null;
    }
    for (const file of spec.files || []) if (exists(file)) return { kind: 'exec', file };
    for (const bin of spec.bins || []) {
      const found = findOnPath(bin);
      if (found) return { kind: 'exec', file: found };
    }
    if (spec.flatpak) {
      const dirs = ['/var/lib/flatpak/app', path.join(home, '.local/share/flatpak/app')];
      if (dirs.some((d) => exists(path.join(d, spec.flatpak)))) return { kind: 'exec', file: 'flatpak', args: ['run', spec.flatpak] };
    }
    return null;
  }

  function planFromFile(file) {
    if (/\.app\/?$/i.test(file) && platform === 'darwin') return { kind: 'mac-app', file };
    return { kind: 'exec', file, cwd: isWin ? path.win32.dirname(file) : path.dirname(file) };
  }

  async function steamPlan(steamId) {
    if (isWin) {
      const steam = await reg(['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamExe']);
      if (!/SteamExe/i.test(steam)) return { error: 'Steam не найден на этом компьютере. Установите Steam и войдите в аккаунт.' };
    }
    return { plan: { kind: 'url', url: `steam://rungameid/${steamId}` } };
  }

  async function resolve(target) {
    const spec = TARGETS[target];
    if (!spec) return { error: 'Неизвестная игра или лаунчер' };
    if (spec.steamId) return steamPlan(spec.steamId);

    const saved = settings.get(target);
    if (saved && exists(saved)) return { plan: planFromFile(saved) };

    const platformSpec = isWin ? spec.win : platform === 'darwin' ? spec.mac : spec.linux;
    if (!platformSpec) {
      return { error: `${spec.name}: запуск из GameHub поддерживается только в Windows. Можно указать файл запуска вручную.`, code: 'not-found', name: spec.name };
    }
    const plan = isWin ? await resolveWindows(platformSpec) : resolveUnix(platformSpec);
    if (plan) return { plan };
    return { error: `Не удалось найти: ${spec.name}. Проверьте, что он установлен.`, code: 'not-found', name: spec.name };
  }

  function spawnDetached(file, args, cwd) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnProcess(file, args || [], { cwd, detached: true, stdio: 'ignore' });
      } catch (err) {
        reject(err);
        return;
      }
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  async function execute(plan) {
    if (plan.kind === 'url') {
      await shell.openExternal(plan.url);
      return;
    }
    if (plan.kind === 'appx') {
      await spawnDetached('explorer.exe', [`shell:AppsFolder\\${plan.aumid}`]);
      return;
    }
    if (plan.kind === 'mac-app') {
      await spawnDetached('open', ['-a', plan.file]);
      return;
    }
    try {
      await spawnDetached(plan.file, plan.args, plan.cwd);
    } catch (err) {
      if (!isWin || !shell.openPath) throw err;
      // программы с требованием прав администратора нельзя запустить напрямую: ShellExecute покажет запрос UAC
      const failure = await shell.openPath(plan.file);
      if (failure) throw new Error(failure);
    }
  }

  async function run(plan, target, remember) {
    try {
      await execute(plan);
      if (remember) settings.set(target, remember);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Не удалось запустить: ${err.message}` };
    }
  }

  async function launch(target) {
    const { plan, error, code, name } = await resolve(target);
    if (!plan) return { ok: false, error, code, name };
    return run(plan, target, null);
  }

  async function launchFile(target, file) {
    if (!TARGETS[target] || TARGETS[target].steamId) return { ok: false, error: 'Неизвестная игра или лаунчер' };
    if (typeof file !== 'string' || !exists(file)) return { ok: false, error: 'Выбранный файл не найден' };
    return run(planFromFile(file), target, file);
  }

  return { launch, launchFile, resolve, names: Object.fromEntries(Object.entries(TARGETS).map(([id, t]) => [id, t.name])) };
}

module.exports = { createLauncher, TARGETS, parseRegValues, parseRegKeys };
