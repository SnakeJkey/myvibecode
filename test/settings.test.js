const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSettings, sanitize } = require('../lib/settings');

test('настройки по умолчанию и сохранение на диск', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamehub-'));
  const file = path.join(dir, 'settings.json');
  const settings = createSettings({ file });
  assert.deepEqual(settings.get(), { autoHide: true, displayMode: 'windowed' });
  settings.set({ displayMode: 'fullscreen', autoHide: false });
  assert.deepEqual(createSettings({ file }).get(), { autoHide: false, displayMode: 'fullscreen' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('некорректные значения отбрасываются', () => {
  assert.deepEqual(sanitize({ autoHide: 'yes', displayMode: 'huge', extra: 1 }), {});
  assert.deepEqual(sanitize(null), {});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamehub-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ сломанный json');
  assert.equal(createSettings({ file }).get().autoHide, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
