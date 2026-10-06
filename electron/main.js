const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { GAMES, LAUNCH_TARGETS, publicMeta } = require('../lib/games');
const { createLauncher } = require('../lib/launch');
const { createStore } = require('../lib/store');
const { createTranslator } = require('../lib/translate');

let store;
let launcher;
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
    title: 'Game Radar',
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
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveWindowState(win));

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
  return win;
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
  if (result.ok || result.code !== 'not-found') return result;

  const win = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Game Radar',
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
  return launcher.launchFile(target, picked.filePaths[0]);
});

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    const translator = createTranslator({ cacheFile: path.join(app.getPath('userData'), 'translations.json') });
    store = createStore(GAMES, { localize: translator.localize, translateBlocks: translator.translateBlocks });
    launcher = createLauncher({ shell, settings: launcherSettings });
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
