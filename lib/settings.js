const fs = require('node:fs');

const DEFAULTS = Object.freeze({ autoHide: true, displayMode: 'windowed' });

const VALIDATORS = {
  autoHide: (v) => typeof v === 'boolean',
  displayMode: (v) => v === 'windowed' || v === 'fullscreen',
};

function sanitize(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, valid] of Object.entries(VALIDATORS)) {
    if (valid(input[key])) out[key] = input[key];
  }
  return out;
}

function createSettings({ file, fsImpl = fs } = {}) {
  let values = { ...DEFAULTS };
  try {
    values = { ...DEFAULTS, ...sanitize(JSON.parse(fsImpl.readFileSync(file, 'utf8'))) };
  } catch {
    /* файла ещё нет или он повреждён: используются значения по умолчанию */
  }

  return {
    get: () => ({ ...values }),
    set(patch) {
      values = { ...values, ...sanitize(patch) };
      try {
        fsImpl.writeFileSync(file, JSON.stringify(values, null, 2));
      } catch {
        /* настройка действует до выхода из приложения */
      }
      return { ...values };
    },
  };
}

module.exports = { createSettings, sanitize, DEFAULTS };
