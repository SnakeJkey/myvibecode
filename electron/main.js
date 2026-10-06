const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { GAMES, publicMeta } = require('../lib/games');
const { createStore } = require('../lib/store');
const { createTranslator } = require('../lib/translate');

let store;
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

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
