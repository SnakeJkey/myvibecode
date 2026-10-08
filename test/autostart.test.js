const test = require('node:test');
const assert = require('node:assert/strict');
const { loginItemOptions, shouldStartHidden } = require('../lib/autostart');

test('loginItemOptions добавляет --minimized и путь приложения вне сборки', () => {
  assert.deepEqual(loginItemOptions({ enabled: true, packaged: true, execPath: 'C:\\GameHub.exe' }), {
    openAtLogin: true,
    path: 'C:\\GameHub.exe',
    args: ['--minimized'],
  });
  assert.deepEqual(loginItemOptions({ enabled: true, packaged: false, execPath: 'electron.exe', appPath: 'C:\\src' }), {
    openAtLogin: true,
    path: 'electron.exe',
    args: ['C:\\src', '--minimized'],
  });
  assert.equal(loginItemOptions({ enabled: false, packaged: true, execPath: 'GameHub.exe' }).openAtLogin, false);
  assert.deepEqual(loginItemOptions({ enabled: false, packaged: true, execPath: 'GameHub.exe' }).args, []);
});

test('shouldStartHidden прячет окно при автозапуске', () => {
  assert.equal(shouldStartHidden({ argv: ['GameHub.exe', '--minimized'] }), true);
  assert.equal(shouldStartHidden({ wasOpenedAtLogin: true, autoStart: true }), true);
  assert.equal(shouldStartHidden({ wasOpenedAtLogin: true, autoStart: false }), false);
  assert.equal(shouldStartHidden({ argv: ['GameHub.exe'] }), false);
});
