const { app, BrowserWindow, ipcMain, shell, Menu, dialog, Tray, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { GAMES, LAUNCH_TARGETS, publicMeta } = require('../lib/games');
const { createLauncher } = require('../lib/launch');
const { createStore } = require('../lib/store');
const { createTranslator } = require('../lib/translate');
const { createSettings } = require('../lib/settings');
const { createGameWatcher, gameForTarget } = require('../lib/gamewatch');

let store;
let launcher;
let settings;
let watcher;
let tray = null;
let mainWindow = null;
let quitting = false;
const closing = new WeakSet();
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
const launchersFile = () => path.join(app.getPath('userData'), 'launchers.json');

const launcherSettings = {
  read() {
    try {
      return JSON.parse(fs.readFileSync(launchersFile(), 'utf8'));
    } catch {
      return {};
    }
  },
  get(target) {
    const value = this.read()[target];
    return typeof value === 'string' ? value : null;
  },
  set(target, file) {
    try {
      fs.writeFileSync(launchersFile(), JSON.stringify({ ...this.read(), [target]: file }, null, 2));
    } catch {
      /* путь просто не запомнится */
    }
  },
};

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveWindowState(win) {
  if (win.isMinimized() || win.isFullScreen()) return;
  const { x, y, width, height } = win.getBounds();
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ x, y, width, height, maximized: win.isMaximized() }));
  } catch {
    /* состояние окна не критично */
  }
}

function isExternal(url) {
  return /^https?:\/\//i.test(url);
}

function createWindow() {
  const saved = loadWindowState();
  const win = new BrowserWindow({
    width: saved.width || 1240,
    height: saved.height || 860,
    x: saved.x,
    y: saved.y,
    minWidth: 420,
    minHeight: 560,
    title: 'GameHub',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#f4f5fb',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (saved.maximized) win.maximize();
  win.once('ready-to-show', () => {
    if (settings.get().displayMode === 'fullscreen') win.setFullScreen(true);
    win.show();
  });
  win.on('close', () => {
    closing.add(win);
    saveWindowState(win);
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.on('enter-full-screen', () => syncDisplayMode(win));
  win.on('leave-full-screen', () => syncDisplayMode(win));
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      if (isExternal(url)) shell.openExternal(url);
    }
  });

  win.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
  mainWindow = win;
  return win;
}

function currentSettings(win) {
  return { ...settings.get(), fullscreen: Boolean(win && !win.isDestroyed() && win.isFullScreen()) };
}

function syncDisplayMode(win) {
  if (quitting || closing.has(win) || win.isDestroyed()) return;
  settings.set({ displayMode: win.isFullScreen() ? 'fullscreen' : 'windowed' });
  win.webContents.send('settings:changed', currentSettings(win));
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function showMainWindow() {
  destroyTray();
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function hideForGame(gameName) {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  try {
    destroyTray();
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 20, height: 20 });
    tray = new Tray(icon);
    tray.setToolTip(`GameHub вернётся после выхода из игры: ${gameName}`);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Показать GameHub',
          click: () => {
            watcher.stop();
            showMainWindow();
          },
        },
        { label: 'Выйти', click: () => app.quit() },
      ])
    );
    tray.on('click', () => {
      watcher.stop();
      showMainWindow();
    });
    win.hide();
  } catch {
    destroyTray();
    win.minimize();
  }
}

function beginPlaySession(target) {
  if (!settings.get().autoHide) return;
  const gameId = gameForTarget(target);
  const meta = GAMES.find((g) => g.id === gameId);
  if (!meta || !watcher.watch(gameId)) return;
  setTimeout(() => {
    if (watcher.isWatching() === gameId) hideForGame(meta.name);
  }, 1200);
}

function endPlaySession(info) {
  showMainWindow();
  const win = mainWindow;
  if (win && !win.isDestroyed()) win.webContents.send('game:session', info);
}

ipcMain.handle('games:list', () => GAMES.map(publicMeta));
ipcMain.handle('games:get', async (_event, id, force) => {
  if (typeof id !== 'string') return null;
  return store.get(id, { force: force === true });
});

ipcMain.handle('articles:get', async (_event, id, ref) => {
  if (typeof id !== 'string' || typeof ref !== 'string') return { ok: false, error: 'Некорректный запрос' };
  return (await store.getArticle(id, ref)) || { ok: false, error: 'Игра не найдена' };
});

ipcMain.handle('games:launch', async (event, target) => {
  if (typeof target !== 'string' || !LAUNCH_TARGETS.has(target)) return { ok: false, error: 'Неизвестная игра или лаунчер' };
  const result = await launcher.launch(target);
  if (result.ok) beginPlaySession(target);
  if (result.ok || result.code !== 'not-found') return result;

  const win = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'GameHub',
    message: `Не удалось найти: ${result.name}`,
    detail: 'Если программа установлена в необычное место, укажите файл для запуска. Выбор запомнится.',
    buttons: ['Указать файл…', 'Отмена'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return { ok: false, cancelled: true, error: result.error };
  const picked = await dialog.showOpenDialog(win, {
    title: `Укажите файл запуска: ${result.name}`,
    properties: ['openFile'],
    filters: process.platform === 'win32' ? [{ name: 'Программы', extensions: ['exe', 'lnk', 'bat'] }, { name: 'Все файлы', extensions: ['*'] }] : [],
  });
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true, error: result.error };
  const manual = await launcher.launchFile(target, picked.filePaths[0]);
  if (manual.ok) beginPlaySession(target);
  return manual;
});

ipcMain.handle('settings:get', (event) => currentSettings(BrowserWindow.fromWebContents(event.sender)));
ipcMain.handle('settings:set', (event, patch) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const next = settings.set(patch);
  if (win && patch && typeof patch === 'object' && 'displayMode' in patch) win.setFullScreen(next.displayMode === 'fullscreen');
  return currentSettings(win);
});

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    watcher?.stop();
    showMainWindow();
  });

  app.whenReady().then(() => {
    const translator = createTranslator({ cacheFile: path.join(app.getPath('userData'), 'translations.json') });
    store = createStore(GAMES, { localize: translator.localize, translateBlocks: translator.translateBlocks });
    launcher = createLauncher({ shell, settings: launcherSettings });
    settings = createSettings({ file: path.join(app.getPath('userData'), 'settings.json') });
    watcher = createGameWatcher({ onEnd: endPlaySession });
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    watcher?.stop();
    destroyTray();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
