// Параметры записи «Запускать вместе с Windows». В собранном приложении достаточно самого exe,
// при запуске из исходников Electron нужно передать путь к приложению, иначе откроется пустое окно.
function loginItemOptions({ enabled, packaged, execPath, appPath }) {
  const args = [];
  if (!packaged && appPath && !String(appPath).startsWith('-')) args.push(appPath);
  if (enabled) args.push('--minimized');
  return { openAtLogin: Boolean(enabled), path: execPath, args };
}

function shouldStartHidden({ argv = [], wasOpenedAtLogin = false, autoStart = false } = {}) {
  return argv.includes('--minimized') || (wasOpenedAtLogin === true && autoStart === true);
}

module.exports = { loginItemOptions, shouldStartHidden };
