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

  function gameIcon(game, cls) {
    return h('img', { class: cls, src: game.icon, alt: '', width: 128, height: 128, draggable: 'false' });
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
          h('span', { class: 'game-tab__badge', 'aria-hidden': 'true' }, gameIcon(game, 'game-tab__icon')),
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


  async function fetchArticle(gameId, ref) {
    let result;
    if (desktop) {
      result = await desktop.article(gameId, ref);
    } else {
      const res = await fetch(`api/games/${gameId}/article?ref=${encodeURIComponent(ref)}`);
      result = await res.json();
    }
    if (!result || !result.ok) throw new Error(result?.error || 'Не удалось загрузить новость');
    return result.article;
  }

  const modalEls = {
    root: $('#modal'),
    dialog: $('#modal .modal__dialog'),
    scroll: $('#modal .modal__scroll'),
    close: $('#modal-close'),
  };
  let modalState = { token: 0, lastFocus: null };

  function renderBlocks(blocks) {
    const out = [];
    let list = null;
    for (const b of blocks) {
      if (b.type === 'li') {
        if (!list || list.dataset.ordered !== String(Boolean(b.ordered))) {
          list = h(b.ordered ? 'ol' : 'ul', { class: 'prose__list', 'data-ordered': String(Boolean(b.ordered)) });
          out.push(list);
        }
        list.append(h('li', { style: b.depth ? `margin-left:${Math.min(b.depth, 4) * 1.3}rem` : null, title: b.original ? `Оригинал: ${b.original}` : null }, b.text));
        continue;
      }
      list = null;
      const title = b.original ? `Оригинал: ${b.original}` : null;
      if (b.type === 'h') out.push(h(`h${Math.min(Math.max(b.level || 3, 2), 4) + 1}`, { class: 'prose__h', title }, b.text));
      else if (b.type === 'p') out.push(h('p', { title }, b.text));
      else if (b.type === 'quote') out.push(h('blockquote', { title }, b.text));
      else if (b.type === 'hr') out.push(h('hr'));
      else if (b.type === 'img') {
        const src = safeUrl(b.src);
        if (!src) continue;
        out.push(
          h(
            'figure',
            { class: 'prose__figure' },
            h('img', {
              src,
              alt: b.alt || '',
              loading: 'lazy',
              referrerpolicy: 'no-referrer',
              onerror: (e) => e.target.closest('figure')?.remove(),
            })
          )
        );
      }
    }
    return out;
  }

  function closeArticle() {
    if (modalEls.root.hidden) return;
    modalState.token += 1;
    modalEls.root.hidden = true;
    document.body.classList.remove('modal-open');
    modalEls.scroll.replaceChildren();
    if (modalState.lastFocus && document.contains(modalState.lastFocus)) modalState.lastFocus.focus();
  }

  function loadingView(item) {
    return h(
      'div',
      { class: 'prose' },
      item.summary && h('p', { class: 'prose__lead' }, item.summary),
      h('div', { class: 'modal__loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Загружаем полный текст…')
    );
  }

  async function openArticle(item, game, tag) {
    const info = tag || F.tagInfo(item.tag);
    const image = safeUrl(item.image);
    const officialFallback = safeUrl(item.url);
    const token = ++modalState.token;
    if (modalEls.root.hidden) modalState.lastFocus = document.activeElement;

    const footer = h('div', { class: 'modal__footer' });
    const body = h('div', { class: 'modal__content' });
    const date = F.dateRange(item);
    const rel = F.relative(item);

    const head = h(
      'header',
      { class: 'modal__head' },
      h('div', { class: 'modal__badges' }, h('span', { class: 'badge badge--tag' }, item.kicker || info.label), item.state === 'live' && badge('Идёт сейчас', 'badge--live'), item.state === 'upcoming' && badge('Скоро', 'badge--upcoming')),
      h('h2', { class: 'modal__title', id: 'modal-title', title: item.titleOriginal ? `Оригинал: ${item.titleOriginal}` : null }, item.title),
      (date || rel) && h('p', { class: 'modal__when' }, date, rel && h('span', {}, ` · ${rel}`))
    );

    const media = image
      ? h('img', {
          class: 'modal__cover',
          src: image,
          alt: '',
          referrerpolicy: 'no-referrer',
          onerror: (e) => e.target.remove(),
        })
      : null;

    modalEls.dialog.style.setProperty('--tag-h', info.hue);
    modalEls.dialog.setAttribute('aria-busy', 'true');
    modalEls.scroll.replaceChildren(h('div', { class: 'modal__inner' }, media, head, body), footer);
    modalEls.scroll.scrollTop = 0;
    body.replaceChildren(loadingView(item));
    footer.replaceChildren(officialButton(officialFallback), h('button', { class: 'btn btn--ghost', type: 'button', onclick: closeArticle }, 'Закрыть'));
    modalEls.root.hidden = false;
    document.body.classList.add('modal-open');
    modalEls.close.focus({ preventScroll: true });

    const showFallback = (note, retry) => {
      body.replaceChildren(
        h(
          'div',
          { class: 'prose' },
          item.summary && h('p', { class: 'prose__lead' }, item.summary),
          h(
            'div',
            { class: 'alert' },
            h('div', {}, note),
            retry && h('button', { type: 'button', onclick: () => openArticle(item, game, tag) }, 'Повторить')
          )
        )
      );
    };

    if (!item.ref) {
      modalEls.dialog.removeAttribute('aria-busy');
      showFallback(officialFallback ? 'Полный текст этой записи доступен на официальном сайте.' : 'Дополнительных подробностей для этой записи нет.', false);
      return;
    }

    try {
      const article = await fetchArticle(game.id, item.ref);
      if (token !== modalState.token) return;
      modalEls.dialog.removeAttribute('aria-busy');
      const url = safeUrl(article.url) || officialFallback;
      footer.replaceChildren(officialButton(url), h('button', { class: 'btn btn--ghost', type: 'button', onclick: closeArticle }, 'Закрыть'));
      const nodes = [];
      const hasText = article.blocks.some((b) => b.type !== 'img');
      if (!hasText) {
        showFallback('Полный текст этой новости опубликован на официальном сайте. Нажмите кнопку ниже, чтобы открыть её там.', false);
        if (article.blocks.length) body.firstChild.append(...renderBlocks(article.blocks));
        return;
      }
      if (article.translation?.translated > 0) nodes.push(h('p', { class: 'modal__note' }, 'Текст переведён автоматически. Оригинал показывается при наведении на абзац.'));
      if (article.translation && article.translation.failed !== 0) nodes.push(h('p', { class: 'modal__note modal__note--warn' }, 'Часть текста не удалось перевести, она показана на языке оригинала.'));
      nodes.push(h('div', { class: 'prose' }, renderBlocks(article.blocks)));
      body.replaceChildren(...nodes);
    } catch (err) {
      if (token !== modalState.token) return;
      modalEls.dialog.removeAttribute('aria-busy');
      showFallback(`Не удалось загрузить полный текст: ${err.message}`, true);
    }
  }

  function officialButton(url) {
    if (!url) return h('span', { class: 'modal__nolink' }, 'Ссылка на официальный сайт недоступна');
    return h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Открыть на официальном сайте ', h('span', { 'aria-hidden': 'true' }, '↗'));
  }

  function trapFocus(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeArticle();
      return;
    }
    if (e.key !== 'Tab' || modalEls.root.hidden) return;
    const focusable = [...modalEls.dialog.querySelectorAll('a[href], button:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function badge(text, cls) {
    return h('span', { class: `badge ${cls}` }, text);
  }

  function card(item, index, game) {
    const tag = F.tagInfo(item.tag);
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
              box.prepend(gameIcon(game, 'card__icon'));
            },
          })
        : gameIcon(game, 'card__icon'),
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
      h('h3', { class: 'card__title', title: item.titleOriginal ? `Оригинал: ${item.titleOriginal}` : null }, item.title),
      item.summary && h('p', { class: 'card__summary' }, item.summary),
      h(
        'div',
        { class: 'card__meta' },
        h('span', { class: 'card__when' }, F.dateRange(item)),
        rel && h('span', { class: 'card__rel' }, rel)
      )
    );

    const open = () => openArticle(item, game, tag);
    return h(
      'article',
      {
        class: 'card',
        role: 'button',
        tabindex: '0',
        'aria-label': `Открыть новость: ${item.title}`,
        style: `--tag-h:${tag.hue};animation-delay:${Math.min(index, 8) * 40}ms`,
        onclick: open,
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        },
      },
      media,
      body
    );
  }

  function block(b, game) {
    const items = b.items || [];
    return h(
      'section',
      { class: 'block' },
      h('div', { class: 'block__head' }, h('h2', { class: 'block__title' }, b.title), items.length > 0 && h('span', { class: 'block__count' }, items.length)),
      items.length ? h('div', { class: 'cards' }, items.map((item, i) => card(item, i, game))) : h('div', { class: 'empty' }, b.emptyText || 'Пока ничего нет.')
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
    const openable = Boolean(headline.ref || headline.url || headline.summary);
    const when = headline.date && !headline.countdown ? F.fmtDate(headline.date, { withYear: true }) : null;
    return h(
      'article',
      { class: 'hero' },
      h(
        'div',
        { class: 'hero__body' },
        h('span', { class: 'hero__kicker' }, headline.kicker || game.name),
        h('h2', { class: 'hero__title', title: headline.titleOriginal ? `Оригинал: ${headline.titleOriginal}` : null }, headline.title),
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
        (openable || when) &&
          h(
            'div',
            { class: 'hero__actions' },
            openable && h('button', { class: 'btn', type: 'button', onclick: () => openArticle(headline, game, null) }, 'Подробнее ', h('span', { 'aria-hidden': 'true' }, '→')),
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
                e.target.replaceWith(gameIcon(game, 'hero__glyph'));
              },
            })
          )
        : h('div', { class: 'hero__media hero__media--empty' }, gameIcon(game, 'hero__glyph'))
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
    if (payload.translation && payload.translation.failed !== 0) {
      nodes.push(
        h(
          'div',
          { class: 'alert', role: 'status' },
          h('div', {}, h('strong', {}, 'Автоперевод сейчас недоступен. '), 'Часть текстов показана на языке оригинала. Попробуйте обновить данные позже.'),
          h('button', { type: 'button', onclick: () => reload(true) }, 'Обновить')
        )
      );
    }
    if (section.headline) nodes.push(hero(section.headline, game));
    section.blocks.forEach((b) => nodes.push(block(b, game)));
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
      payload.translation?.translated > 0 && h('span', {}, 'Тексты на английском переведены автоматически, оригинал виден при наведении на заголовок.'),
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
    modalEls.close.onclick = closeArticle;
    modalEls.root.addEventListener('mousedown', (e) => {
      if (e.target === modalEls.root || e.target.classList.contains('modal__backdrop')) closeArticle();
    });
    document.addEventListener('keydown', (e) => {
      if (!modalEls.root.hidden) trapFocus(e);
    });

    try {
      state.games = await listGames();
    } catch (err) {
      els.content.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, 'Не удалось получить список игр. Перезапустите приложение.'));
      return;
    }

    window.addEventListener('hashchange', () => {
      closeArticle();
      render();
    });
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
