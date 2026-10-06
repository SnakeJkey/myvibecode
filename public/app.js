(function () {
  const F = window.GameFormat;
  const SECTIONS = ['current', 'upcoming'];

  const state = {
    games: [],
    cache: new Map(),
    gameId: null,
    section: 'current',
    timer: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const els = {
    games: $('#games'),
    sections: $('#sections'),
    content: $('#content'),
    footer: $('#footer'),
    updated: $('#updated'),
    refresh: $('#refresh'),
    theme: $('#theme'),
  };

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style') el.style.cssText = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  const safeUrl = (url) => (typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null);

  function setTheme(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);
    els.theme.setAttribute('aria-pressed', String(theme === 'dark'));
    if (persist) {
      try {
        localStorage.setItem('theme', theme);
      } catch (e) {
        /* хранилище может быть недоступно */
      }
    }
    applyAccent();
    if (state.games.length) renderGameTabs();
  }

  function currentGame() {
    return state.games.find((g) => g.id === state.gameId);
  }

  function applyAccent() {
    const game = currentGame();
    if (!game) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.style.setProperty('--accent', dark ? game.accentDark : game.accent);
  }

  function renderGameTabs() {
    els.games.replaceChildren(
      ...state.games.map((game) =>
        h(
          'button',
          {
            class: 'game-tab',
            type: 'button',
            role: 'tab',
            id: `tab-${game.id}`,
            'aria-selected': String(game.id === state.gameId),
            style: `--tab-accent:${document.documentElement.getAttribute('data-theme') === 'dark' ? game.accentDark : game.accent}`,
            onclick: () => navigate(game.id, state.section),
          },
          h('span', { class: 'game-tab__badge', 'aria-hidden': 'true' }, game.name.trim()[0]),
          h('span', {}, h('span', { class: 'game-tab__name' }, game.name), h('span', { class: 'game-tab__tagline' }, game.tagline))
        )
      )
    );
  }

  function renderSectionTabs() {
    els.sections.dataset.active = state.section;
    els.sections.querySelectorAll('button').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.section === state.section));
      btn.onclick = () => navigate(state.gameId, btn.dataset.section);
    });
  }

  function parseHash() {
    const [gameId, section] = location.hash.replace(/^#\/?/, '').split('/');
    return {
      gameId: state.games.some((g) => g.id === gameId) ? gameId : state.games[0].id,
      section: SECTIONS.includes(section) ? section : 'current',
    };
  }

  function navigate(gameId, section) {
    const hash = `#/${gameId}/${section}`;
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  const desktop = window.gameApi;

  async function listGames() {
    if (desktop) return desktop.list();
    const res = await fetch('api/games');
    return (await res.json()).games;
  }

  async function fetchGame(id, { force = false } = {}) {
    let payload;
    if (desktop) {
      payload = await desktop.get(id, force);
    } else {
      const res = await fetch(`api/games/${id}${force ? '?refresh=1' : ''}`);
      if (!res.ok) throw new Error(`Сервер вернул ${res.status}`);
      payload = await res.json();
    }
    if (!payload) throw new Error('Игра не найдена');
    state.cache.set(id, payload);
    return payload;
  }

  function badge(text, cls) {
    return h('span', { class: `badge ${cls}` }, text);
  }

  function card(item, index) {
    const tag = F.tagInfo(item.tag);
    const url = safeUrl(item.url);
    const image = safeUrl(item.image);
    const rel = F.relative(item);

    const media = h(
      'div',
      { class: `card__media${image ? '' : ' card__media--empty'}` },
      image
        ? h('img', {
            src: image,
            alt: '',
            loading: 'lazy',
            referrerpolicy: 'no-referrer',
            onerror: (e) => {
              const box = e.target.parentElement;
              e.target.remove();
              box.classList.add('card__media--empty');
              box.prepend(document.createTextNode(tag.label.slice(0, 1)));
            },
          })
        : tag.label.slice(0, 1),
      h(
        'div',
        { class: 'card__badges' },
        badge(tag.label, 'badge--tag'),
        item.state === 'live' && badge('Идёт сейчас', 'badge--live'),
        item.state === 'upcoming' && badge('Скоро', 'badge--upcoming')
      )
    );

    const body = h(
      'div',
      { class: 'card__body' },
      h('h3', { class: 'card__title' }, item.title),
      item.summary && h('p', { class: 'card__summary' }, item.summary),
      h(
        'div',
        { class: 'card__meta' },
        h('span', { class: 'card__when' }, F.dateRange(item)),
        rel && h('span', { class: 'card__rel' }, rel)
      )
    );

    const props = {
      class: 'card',
      style: `--tag-h:${tag.hue};animation-delay:${Math.min(index, 8) * 40}ms`,
    };
    if (url) Object.assign(props, { href: url, target: '_blank', rel: 'noopener noreferrer' });
    return h(url ? 'a' : 'div', props, media, body);
  }

  function block(b) {
    const items = b.items || [];
    return h(
      'section',
      { class: 'block' },
      h('div', { class: 'block__head' }, h('h2', { class: 'block__title' }, b.title), items.length > 0 && h('span', { class: 'block__count' }, items.length)),
      items.length ? h('div', { class: 'cards' }, items.map(card)) : h('div', { class: 'empty' }, b.emptyText || 'Пока ничего нет.')
    );
  }

  function countdown(headline) {
    const target = Date.parse(headline.date);
    if (!headline.countdown || !Number.isFinite(target) || target <= Date.now()) return null;
    const cells = [
      ['days', 'дн'],
      ['hours', 'час'],
      ['minutes', 'мин'],
      ['seconds', 'сек'],
    ].map(([key, unit]) =>
      h('div', { class: 'countdown__cell' }, h('span', { class: 'countdown__num', 'data-unit': key }, '0'), h('span', { class: 'countdown__unit' }, unit))
    );
    const wrap = h(
      'div',
      {},
      h('div', { class: 'countdown', 'data-target': target, role: 'timer', 'aria-label': 'Время до события' }, cells),
      headline.estimate && h('p', { class: 'countdown-note' }, 'Ориентировочная дата, точная ещё не объявлена')
    );
    return wrap;
  }

  function tickCountdowns() {
    document.querySelectorAll('.countdown[data-target]').forEach((box) => {
      const parts = F.splitDuration(Number(box.dataset.target) - Date.now());
      for (const [key, value] of Object.entries(parts)) {
        const el = box.querySelector(`[data-unit="${key}"]`);
        if (el) el.textContent = key === 'days' ? String(value) : String(value).padStart(2, '0');
      }
    });
  }

  function hero(headline, game) {
    const image = safeUrl(headline.image);
    const url = safeUrl(headline.url);
    const when = headline.date && !headline.countdown ? F.fmtDate(headline.date, { withYear: true }) : null;
    return h(
      'article',
      { class: 'hero' },
      h(
        'div',
        { class: 'hero__body' },
        h('span', { class: 'hero__kicker' }, headline.kicker || game.name),
        h('h2', { class: 'hero__title' }, headline.title),
        headline.subtitle && h('p', { class: 'hero__subtitle' }, headline.subtitle),
        headline.summary && h('p', { class: 'hero__summary' }, headline.summary),
        countdown(headline),
        headline.chips?.length > 0 &&
          h(
            'div',
            { class: 'chips' },
            headline.chips.map((c) =>
              h('div', { class: `chip${c.estimate ? ' chip--estimate' : ''}` }, h('span', { class: 'chip__label' }, c.label), h('span', { class: 'chip__value' }, c.value))
            )
          ),
        (url || when) &&
          h(
            'div',
            { class: 'hero__actions' },
            url && h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Подробнее ', h('span', { 'aria-hidden': 'true' }, '→')),
            when && h('span', { class: 'hero__date' }, `Опубликовано ${when}`)
          )
      ),
      image
        ? h(
            'div',
            { class: 'hero__media' },
            h('img', {
              src: image,
              alt: '',
              referrerpolicy: 'no-referrer',
              onerror: (e) => {
                const media = e.target.parentElement;
                media.classList.add('hero__media--empty');
                e.target.replaceWith(h('span', { class: 'hero__glyph', 'aria-hidden': 'true' }, game.name.trim()[0]));
              },
            })
          )
        : h('div', { class: 'hero__media hero__media--empty' }, h('span', { class: 'hero__glyph', 'aria-hidden': 'true' }, game.name.trim()[0]))
    );
  }

  function skeleton() {
    return h('div', {}, h('div', { class: 'skeleton skeleton--hero' }), h('div', { class: 'cards' }, [1, 2, 3].map(() => h('div', { class: 'skeleton skeleton--card' }))));
  }

  function errorView(game, message) {
    return h(
      'div',
      { class: 'alert alert--error', role: 'alert' },
      h('div', {}, h('strong', {}, `Не удалось загрузить данные: ${game.name}. `), message),
      h('button', { type: 'button', onclick: () => reload(true) }, 'Повторить')
    );
  }

  function renderPayload(payload, game) {
    const section = payload.data[state.section];
    const nodes = [];
    if (payload.stale || (payload.error && payload.data)) {
      nodes.push(
        h(
          'div',
          { class: 'alert', role: 'status' },
          h('div', {}, h('strong', {}, 'Показаны сохранённые данные. '), `Источник сейчас недоступен: ${payload.error}`),
          h('button', { type: 'button', onclick: () => reload(true) }, 'Обновить')
        )
      );
    }
    if (section.headline) nodes.push(hero(section.headline, game));
    section.blocks.forEach((b) => nodes.push(block(b)));
    els.content.replaceChildren(...nodes);
    tickCountdowns();
  }

  function renderFooter(payload) {
    if (!payload?.data) {
      els.footer.replaceChildren();
      els.updated.textContent = '';
      return;
    }
    const sources = payload.data.sources || [];
    els.footer.replaceChildren(
      h('span', {}, 'Источники:'),
      ...sources.filter((s) => safeUrl(s.url)).map((s) => h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.name))
    );
    els.updated.textContent = payload.updatedAt ? `Обновлено в ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(payload.updatedAt))}` : '';
  }

  async function render() {
    const parsed = parseHash();
    state.gameId = parsed.gameId;
    state.section = parsed.section;
    const game = currentGame();
    applyAccent();
    renderGameTabs();
    renderSectionTabs();
    document.title = `${game.name}: ${state.section === 'current' ? 'текущая версия' : 'предстоящее'} · Game Radar`;

    const cached = state.cache.get(game.id);
    if (cached?.data) {
      renderPayload(cached, game);
      renderFooter(cached);
      return;
    }
    els.content.replaceChildren(skeleton());
    renderFooter(null);
    const token = `${game.id}/${state.section}`;
    try {
      const payload = await fetchGame(game.id);
      if (token !== `${state.gameId}/${state.section}`) return;
      draw(payload, game);
    } catch (err) {
      if (token !== `${state.gameId}/${state.section}`) return;
      els.content.replaceChildren(errorView(game, err.message));
    }
  }

  function draw(payload, game) {
    if (!payload.data) {
      els.content.replaceChildren(errorView(game, payload.error || 'Источник не отвечает'));
      renderFooter(null);
      return;
    }
    renderPayload(payload, game);
    renderFooter(payload);
  }

  async function reload(force) {
    const game = currentGame();
    els.refresh.classList.add('is-spinning');
    els.refresh.disabled = true;
    try {
      const payload = await fetchGame(game.id, { force });
      if (game.id === state.gameId) draw(payload, game);
    } catch (err) {
      if (game.id === state.gameId) els.content.replaceChildren(errorView(game, err.message));
    } finally {
      els.refresh.classList.remove('is-spinning');
      els.refresh.disabled = false;
    }
  }

  function prefetchOthers() {
    state.games
      .filter((g) => g.id !== state.gameId)
      .forEach((g, i) => setTimeout(() => fetchGame(g.id).catch(() => {}), 600 + i * 500));
  }

  async function init() {
    setTheme(document.documentElement.getAttribute('data-theme'), false);
    els.theme.onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
    els.refresh.onclick = () => reload(true);

    try {
      state.games = await listGames();
    } catch (err) {
      els.content.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, 'Не удалось получить список игр. Перезапустите приложение.'));
      return;
    }

    window.addEventListener('hashchange', render);
    await render();
    prefetchOthers();
    state.timer = setInterval(tickCountdowns, 1000);
    setInterval(() => {
      const game = currentGame();
      if (game && !document.hidden) fetchGame(game.id).then((p) => p.data && draw(p, game)).catch(() => {});
    }, 10 * 60 * 1000);
  }

  init();
})();
