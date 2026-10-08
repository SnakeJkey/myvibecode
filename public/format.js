(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  const TAGS = {
    update: ['Обновление', 215],
    patch: ['Патч', 215],
    event: ['Событие', 150],
    special: ['Акция', 28],
    battlepass: ['Боевой пропуск', 285],
    competitive: ['Киберспорт', 350],
    stream: ['Трансляция', 330],
    test: ['Тест', 45],
    merch: ['Мерч', 190],
    news: ['Новость', 235],
    bedrock: ['Bedrock', 120],
    release: ['Релиз', 140],
    snapshot: ['Снапшот', 40],
    headhunting: ['Хедхантинг', 330],
    weapon: ['Оружейный баннер', 20],
    devcomm: ['DEV Comm', 260],
    steam: ['Steam', 205],
    beta: ['Открытая бета', 45],
    devdiary: ['Дневник', 100],
    dlc: ['Анонс', 340],
  };

  function tagInfo(tag) {
    const [label, hue] = TAGS[tag] || ['Новость', 235];
    return { label, hue };
  }

  function plural(n, one, few, many) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }

  function splitDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return {
      days: Math.floor(total / 86400),
      hours: Math.floor((total % 86400) / 3600),
      minutes: Math.floor((total % 3600) / 60),
      seconds: total % 60,
    };
  }

  function humanDuration(ms) {
    const abs = Math.abs(ms);
    if (abs >= DAY) {
      const d = Math.round(abs / DAY);
      return `${d} ${plural(d, 'день', 'дня', 'дней')}`;
    }
    if (abs >= HOUR) {
      const h = Math.round(abs / HOUR);
      return `${h} ${plural(h, 'час', 'часа', 'часов')}`;
    }
    const m = Math.max(1, Math.round(abs / MINUTE));
    return `${m} ${plural(m, 'минуту', 'минуты', 'минут')}`;
  }

  function fmtDate(value, { withYear = false, withTime = false } = {}) {
    const date = new Date(value);
    const opts = { day: 'numeric', month: 'short' };
    if (withYear) opts.year = 'numeric';
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    return new Intl.DateTimeFormat('ru-RU', opts).format(date).replace(/\s?г\.$/, '');
  }

  function isSameDay(a, b) {
    return new Date(a).toDateString() === new Date(b).toDateString();
  }

  function dateRange(item, now = Date.now()) {
    if (item.dateLabel) return item.dateLabel;
    if (!item.date) return 'Дата уточняется';
    const sameYear = new Date(item.date).getFullYear() === new Date(now).getFullYear();
    const withYear = !sameYear;
    const withTime = !item.allDay;
    const start = fmtDate(item.date, { withYear, withTime });
    if (item.untilNextVersion) return `с ${start} до следующей версии`;
    if (item.endDate && !isSameDay(item.date, item.endDate)) {
      return `${fmtDate(item.date, { withYear, withTime })} – ${fmtDate(item.endDate, { withYear, withTime })}`;
    }
    return start;
  }

  function relative(item, now = Date.now()) {
    if (item.state === 'live' && item.endDate) {
      const left = Date.parse(item.endDate) - now;
      return left > 0 ? `осталось ${humanDuration(left)}` : '';
    }
    if (item.state === 'upcoming' && item.date) {
      const left = Date.parse(item.date) - now;
      return left > 0 ? `через ${humanDuration(left)}` : '';
    }
    if (item.state === 'live' && item.untilNextVersion) return 'до новой версии';
    return '';
  }

  const FRESH_WINDOW = 3 * DAY;
  const FRESH_TAGS = new Set(['update', 'patch', 'release', 'snapshot', 'bedrock', 'event', 'headhunting', 'weapon', 'battlepass', 'beta']);

  const itemKey = (item) => `${item.tag || ''}|${item.title || ''}|${item.date || ''}`;

  // Новое: обновление или событие, которое началось не более 3 суток назад.
  function freshItems(data, now = Date.now()) {
    if (!data) return [];
    const seen = new Set();
    const out = [];
    const consider = (item, isHeadline) => {
      if (!item || !item.date || (!isHeadline && !FRESH_TAGS.has(item.tag))) return;
      const age = now - Date.parse(item.date);
      if (!(age >= -HOUR && age <= FRESH_WINDOW)) return;
      const key = itemKey(item);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, title: item.title, tag: item.tag || 'update', date: item.date });
    };
    for (const section of [data.current, data.upcoming]) {
      if (!section) continue;
      if (section === data.current) consider(section.headline, true);
      for (const block of section.blocks || []) for (const item of block.items || []) consider(item, false);
    }
    return out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }

  return { tagInfo, plural, splitDuration, humanDuration, dateRange, relative, fmtDate, freshItems, itemKey };
});
