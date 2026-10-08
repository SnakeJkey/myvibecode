const { execFile } = require('node:child_process');

const JAVA_NAMES = new Set(['java', 'javaw']);
const JAVA_CLIENT = /^minecraft|--accessToken|--gameDir|net\.minecraft\.client|KnotClient|launchwrapper|bootstraplauncher/i;

// Что считать «игра запущена». Лаунчеры (GRYPHLINK, Wargaming Game Center, Minecraft Launcher, Steam)
// сюда не входят: нужен именно процесс самой игры, иначе окно GameHub не вернулось бы после выхода.
const GAME_PROCESSES = {
  endfield: { names: [/^endfield/, /^arknightsendfield/] },
  wot: { names: [/^worldoftanks$/] },
  hoi4: { names: [/^hoi4$/] },
  minecraft: { names: [/^minecraft\.windows$/], java: JAVA_CLIENT },
};

const gameForTarget = (target) => (String(target).startsWith('minecraft-') ? 'minecraft' : String(target));

const normalizeName = (name) => String(name || '').trim().toLowerCase().replace(/\.exe$/, '');

function matchesGame(processes, gameId) {
  const spec = GAME_PROCESSES[gameId];
  if (!spec) return false;
  return processes.some((proc) => {
    const name = normalizeName(proc.name);
    if (spec.names.some((re) => re.test(name))) return true;
    return Boolean(spec.java) && JAVA_NAMES.has(name) && spec.java.test(String(proc.detail || ''));
  });
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      fields.push(current);
      current = '';
    } else current += ch;
  }
  fields.push(current);
  return fields;
}

// Вывод `tasklist /v /fo csv /nh`: имя образа первым полем, заголовок окна последним.
function parseTasklist(output) {
  return String(output)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => parseCsvLine(line))
    .filter((fields) => fields.length >= 2)
    .map((fields) => ({ name: fields[0], detail: fields[fields.length - 1] }));
}

// Вывод `ps -A -o args=`: имя берётся из пути до первых аргументов.
function parsePs(output) {
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((args) => {
      const head = args.split(/\s-/)[0];
      return { name: head.split(/[\\/]/).pop(), detail: args };
    });
}

function run(file, args, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

async function listProcesses({ platform = process.platform, exec = run } = {}) {
  if (platform !== 'win32') return parsePs(await exec('ps', ['-A', '-o', 'args=']));

  const processes = parseTasklist(await exec('tasklist', ['/v', '/fo', 'csv', '/nh']));
  const needsCommandLine = processes.some((p) => JAVA_NAMES.has(normalizeName(p.name)) && !JAVA_CLIENT.test(p.detail));
  if (needsCommandLine) {
    try {
      const out = await exec('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='javaw.exe' OR Name='java.exe'\" | ForEach-Object { $_.CommandLine }",
      ]);
      for (const line of out.split(/\r?\n/).filter((l) => l.trim())) processes.push({ name: 'javaw.exe', detail: line });
    } catch {
      /* без командной строки Java опознаётся только по заголовку окна */
    }
  }
  return processes;
}

// Следит за одной игрой: ждёт появления её процесса, затем его исчезновения.
// Без запуска игры за startTimeoutMs, а также после серии сбоев опроса сеанс завершается сам,
// чтобы окно GameHub не осталось скрытым навсегда.
function createGameWatcher({
  list = listProcesses,
  intervalMs = 3000,
  startTimeoutMs = 10 * 60 * 1000,
  missesToExit = 2,
  maxFailures = 5,
  now = Date.now,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  onRunning = () => {},
  onEnd = () => {},
} = {}) {
  let session = null;

  function finish(current, reason) {
    if (session !== current) return;
    session = null;
    cancel(current.timer);
    onEnd({ gameId: current.gameId, reason, durationMs: current.startedAt !== null ? now() - current.startedAt : 0 });
  }

  async function poll(current = session) {
    if (!current || session !== current) return;
    let processes = null;
    try {
      processes = await list();
    } catch {
      processes = null;
    }
    if (session !== current) return;

    if (processes === null) {
      current.failures += 1;
      if (current.failures >= maxFailures) return finish(current, 'error');
    } else {
      current.failures = 0;
      if (matchesGame(processes, current.gameId)) {
        current.misses = 0;
        if (current.startedAt === null) {
          current.startedAt = now();
          onRunning({ gameId: current.gameId });
        }
      } else if (current.startedAt !== null) {
        current.misses += 1;
        if (current.misses >= missesToExit) return finish(current, 'exited');
      } else if (now() - current.launchedAt >= startTimeoutMs) {
        return finish(current, 'timeout');
      }
    }
    current.timer = schedule(() => poll(current), intervalMs);
  }

  function watch(gameId) {
    if (!GAME_PROCESSES[gameId]) return false;
    stop();
    const current = { gameId, launchedAt: now(), startedAt: null, misses: 0, failures: 0, timer: null };
    session = current;
    current.timer = schedule(() => poll(current), intervalMs);
    return true;
  }

  function stop() {
    if (!session) return;
    cancel(session.timer);
    session = null;
  }

  return { watch, stop, poll, isWatching: () => session?.gameId || null };
}

module.exports = { createGameWatcher, matchesGame, parseTasklist, parsePs, listProcesses, gameForTarget, GAME_PROCESSES };
