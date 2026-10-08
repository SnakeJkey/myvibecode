(function () {
  const F = window.GameFormat;
  const SECTIONS = ['current', 'upcoming'];

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch (e) {
      return fallback;
    }
  }

  function loadFlag(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value === '1';
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* хранилище может быть недоступно */
    }
  }

  const state = {
    games: [],
    cache: new Map(),
    gameId: null,
    section: 'current',
    view: 'home',
    timer: null,
    fresh: new Map(),
    seen: loadJson('gamehub.seen', {}),
    highlightNew: loadFlag('gamehub.highlightNew', true),
    desktop: null,
    returnHash: '#/',
    signature: '',
    playtime: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const els = {
    games: $('#games'),
    sections: $('#sections'),
    content: $('#content'),
    footer: $('#footer'),
    updated: $('#updated'),
    refresh: $('#refresh'),
    settings: $('#settings'),
    play: $('#play'),
    playtime: $('#playtime-chip'),
    toast: $('#toast'),
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

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function themeMode() {
    let saved = null;
    try {
      saved = localStorage.getItem('theme');
    } catch (e) {
      /* хранилище может быть недоступно */
    }
    return saved === 'light' || saved === 'dark' ? saved : 'auto';
  }

  function applyTheme() {
    const mode = themeMode();
    const theme = mode === 'auto' ? (systemDark.matches ? 'dark' : 'light') : mode;
    document.documentElement.setAttribute('data-theme', theme);
    applyAccent();
    if (!state.games.length) return;
    renderGameTabs();
    if (state.view === 'home') renderHome();
  }

  function setThemeMode(mode) {
    try {
      if (mode === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', mode);
    } catch (e) {
      /* хранилище может быть недоступно */
    }
    applyTheme();
  }

  function currentGame() {
    return state.games.find((g) => g.id === state.gameId);
  }

  function applyAccent() {
    const game = currentGame();
    if (!game) {
      document.documentElement.style.removeProperty('--accent');
      return;
    }
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.style.setProperty('--accent', dark ? game.accentDark : game.accent);
  }

  function unseenFor(id) {
    const seen = new Set(state.seen[id] || []);
    return (state.fresh.get(id) || []).filter((item) => !seen.has(item.key));
  }

  const isNew = (id) => state.highlightNew && unseenFor(id).length > 0;

  function orderedGames() {
    if (!state.highlightNew) return state.games;
    const latest = (game) => Date.parse(unseenFor(game.id)[0]?.date || 0);
    const flagged = state.games.filter((g) => isNew(g.id)).sort((a, b) => latest(b) - latest(a));
    return [...flagged, ...state.games.filter((g) => !flagged.includes(g))];
  }

  function markSeen(id) {
    const fresh = state.fresh.get(id);
    if (!id || !fresh) return;
    const keys = [...new Set([...(state.seen[id] || []), ...fresh.map((i) => i.key)])].slice(-60);
    state.seen[id] = keys;
    save('gamehub.seen', JSON.stringify(state.seen));
  }

  function orderSignature() {
    return orderedGames()
      .map((g) => `${g.id}${isNew(g.id) ? '!' : ''}`)
      .join(',');
  }

  function onFreshChanged() {
    const signature = orderSignature();
    if (signature === state.signature) return;
    state.signature = signature;
    if (!state.games.length) return;
    renderGameTabs();
    if (state.view === 'home') reorderHome();
  }

  function trackFresh(id, payload) {
    state.fresh.set(id, F.freshItems(payload.data));
    onFreshChanged();
  }

  function renderGameTabs() {
    state.signature = orderSignature();
    els.games.replaceChildren(
      ...orderedGames().map((game) =>
        h(
          'button',
          {
            class: `game-tab${isNew(game.id) ? ' game-tab--new' : ''}`,
            type: 'button',
            role: 'tab',
            id: `tab-${game.id}`,
            'aria-selected': String(game.id === state.gameId),
            title: isNew(game.id) ? `Новое: ${unseenFor(game.id).map((i) => i.title).slice(0, 3).join('; ')}` : null,
            style: `--tab-accent:${document.documentElement.getAttribute('data-theme') === 'dark' ? game.accentDark : game.accent}`,
            onclick: () => navigate(game.id, 'current'),
          },
          h('span', { class: 'game-tab__badge', 'aria-hidden': 'true' }, gameIcon(game, 'game-tab__icon')),
          h('span', {}, h('span', { class: 'game-tab__name' }, game.name), h('span', { class: 'game-tab__tagline' }, game.tagline)),
          isNew(game.id) && h('span', { class: 'game-tab__flag' }, 'Новое')
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
    if (gameId === 'settings') return { view: 'settings', gameId: null, section: 'current' };
    return {
      view: state.games.some((g) => g.id === gameId) ? 'game' : 'home',
      gameId: state.games.some((g) => g.id === gameId) ? gameId : null,
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
    if (payload.data) trackFresh(id, payload);
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
    modalEls.dialog.style.setProperty('--accent', document.documentElement.getAttribute('data-theme') === 'dark' ? game.accentDark : game.accent);
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


  let toastTimer = null;
  function showToast(message, kind) {
    els.toast.textContent = message;
    els.toast.className = `toast${kind ? ` toast--${kind}` : ''}`;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, kind === 'error' ? 7000 : 3500);
  }

  function closePlayMenu() {
    const toggle = els.play.querySelector('[aria-expanded="true"]');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    const menu = els.play.querySelector('.play__menu');
    if (menu) menu.hidden = true;
  }

  async function launchTarget(option, button) {
    closePlayMenu();
    button.disabled = true;
    showToast(`Запускаем: ${option.label === 'Играть' ? currentGame().name : option.label}…`);
    try {
      const result = await desktop.launch(option.target);
      if (result.ok) showToast(`Запущено: ${option.label === 'Играть' ? currentGame().name : option.label}`, 'ok');
      else if (result.cancelled) els.toast.hidden = true;
      else showToast(result.error || 'Не удалось запустить', 'error');
    } catch (err) {
      showToast(`Не удалось запустить: ${err.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  const playIcon = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5z');
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  };

  function renderPlay(game) {
    const options = game?.launch || [];
    if (!desktop || !desktop.launch || !options.length) {
      els.play.hidden = true;
      els.play.replaceChildren();
      return;
    }
    els.play.hidden = false;
    if (options.length === 1) {
      const [option] = options;
      const button = h('button', { class: 'play__btn', type: 'button', title: option.hint, onclick: () => launchTarget(option, button) }, playIcon(), option.label);
      els.play.replaceChildren(button);
      return;
    }
    const menu = h(
      'div',
      { class: 'play__menu', role: 'menu', hidden: true },
      options.map((option) => {
        const item = h(
          'button',
          { class: 'play__item', type: 'button', role: 'menuitem', onclick: () => launchTarget(option, item) },
          h('span', { class: 'play__item-label' }, option.label),
          h('span', { class: 'play__item-hint' }, option.hint)
        );
        return item;
      })
    );
    const toggle = h(
      'button',
      {
        class: 'play__btn',
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        title: 'Выберите, чем запустить Minecraft',
        onclick: (e) => {
          e.stopPropagation();
          const open = toggle.getAttribute('aria-expanded') === 'true';
          closePlayMenu();
          if (!open) {
            toggle.setAttribute('aria-expanded', 'true');
            menu.hidden = false;
            menu.querySelector('button')?.focus();
          }
        },
      },
      playIcon(),
      'Играть',
      h('span', { class: 'play__caret', 'aria-hidden': 'true' }, '▾')
    );
    els.play.replaceChildren(toggle, menu);
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
        item.state === 'upcoming' && badge('Скоро', 'badge--upcoming'),
        state.highlightNew && unseenFor(game.id).some((f) => f.key === F.itemKey(item)) && badge('Новое', 'badge--new')
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


  const toolbar = $('.toolbar');
  const CHANGELOG_RE = /обновл|патч|верси|релиз|снапшот|исправлен|баланс|update|patch|release|snapshot/i;
  const NOT_CHANGELOG = new Set(['merch', 'special', 'stream', 'competitive', 'battlepass', 'event', 'headhunting', 'weapon']);

  function recentChanges(payload, limit) {
    const head = payload.data.current.headline;
    const all = payload.data.current.blocks.flatMap((b) => b.items || []).filter((i) => i.date && i.state !== 'live' && i.state !== 'upcoming' && i.title !== head?.title);
    const pool = all.filter((i) => !NOT_CHANGELOG.has(i.tag));
    const preferred = pool.filter((i) => CHANGELOG_RE.test(i.title) || ['update', 'patch', 'release', 'snapshot', 'bedrock'].includes(i.tag));
    const picked = [...preferred, ...pool.filter((i) => !preferred.includes(i))].slice(0, limit);
    return picked.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }

  function homeCardSkeleton(game) {
    return h('div', { class: 'home-card home-card--loading', 'data-game': game.id }, h('div', { class: 'skeleton skeleton--home' }));
  }

  function homeCard(game, payload, error) {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const head = h(
      'header',
      { class: 'home-card__head' },
      gameIcon(game, 'home-card__icon'),
      h('div', { class: 'home-card__titles' }, h('h2', { class: 'home-card__name' }, game.name), h('span', { class: 'home-card__tagline' }, game.tagline)),
      h('button', { class: 'home-card__open', type: 'button', onclick: () => navigate(game.id, 'current') }, 'Открыть ', h('span', { 'aria-hidden': 'true' }, '→'))
    );
    const fresh = isNew(game.id) ? unseenFor(game.id).slice(0, 2) : [];
    const attrs = { class: `home-card${fresh.length ? ' home-card--new' : ''}`, 'data-game': game.id, style: `--accent:${dark ? game.accentDark : game.accent}` };
    const flag = fresh.length
      ? h(
          'div',
          { class: 'home-new', role: 'status' },
          h('span', { class: 'home-new__label' }, 'Новое'),
          h('span', { class: 'home-new__text' }, fresh.map((i) => i.title).join(' · '))
        )
      : null;

    if (!payload?.data) {
      return h(
        'section',
        attrs,
        head,
        h(
          'div',
          { class: 'alert alert--error', role: 'alert' },
          h('div', {}, `Не удалось загрузить данные: ${error || payload?.error || 'источник не отвечает'}`),
          h('button', { type: 'button', onclick: () => renderHome(true) }, 'Повторить')
        )
      );
    }

    const headline = payload.data.current.headline;
    const upcoming = payload.data.upcoming.headline;
    const changes = recentChanges(payload, 4);
    const openable = headline && (headline.ref || headline.url || headline.summary);
    const latest = headline
      ? h(
          'div',
          { class: `home-latest${openable ? ' home-latest--link' : ''}`, role: openable ? 'button' : null, tabindex: openable ? '0' : null, onclick: openable ? () => openArticle(headline, game, null) : null, onkeydown: openable ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openArticle(headline, game, null)) : null },
          h('span', { class: 'home-latest__kicker' }, 'Сейчас'),
          h('h3', { class: 'home-latest__title' }, headline.title),
          headline.subtitle && h('p', { class: 'home-latest__subtitle' }, headline.subtitle),
          headline.summary && h('p', { class: 'home-latest__summary' }, headline.summary),
          h(
            'div',
            { class: 'home-latest__meta' },
            headline.date && !(headline.chips || []).length && h('span', {}, `Вышло ${F.fmtDate(headline.date, { withYear: true })}`),
            (headline.chips || []).slice(0, 3).map((c) => h('span', { class: 'home-chip' }, `${c.label}: ${c.value}`))
          )
        )
      : null;

    const list = changes.length
      ? h(
          'div',
          { class: 'home-changes' },
          h('h4', { class: 'home-changes__title' }, 'Последние изменения'),
          h(
            'ul',
            { class: 'home-changes__list' },
            changes.map((item) => {
              const tag = F.tagInfo(item.tag);
              return h(
                'li',
                {},
                h(
                  'button',
                  { class: 'home-change', type: 'button', onclick: () => openArticle(item, game, tag) },
                  h('time', { class: 'home-change__date', datetime: item.date }, F.fmtDate(item.date)),
                  h('span', { class: 'home-change__title' }, item.title),
                  h('span', { class: 'home-change__tag', style: `--tag-h:${tag.hue}` }, tag.label)
                )
              );
            })
          )
        )
      : null;

    const next = upcoming
      ? h(
          'button',
          { class: 'home-next', type: 'button', onclick: () => navigate(game.id, 'upcoming') },
          h('span', { class: 'home-next__label' }, 'Дальше'),
          h('span', { class: 'home-next__title' }, upcoming.title),
          upcoming.date && h('span', { class: 'home-next__date' }, `${upcoming.estimate ? '≈ ' : ''}${F.fmtDate(upcoming.date)}`),
          h('span', { 'aria-hidden': 'true' }, '→')
        )
      : null;

    return h('section', attrs, head, flag, latest, list, next);
  }

  let homeToken = 0;
  let homeView = null;

  function reorderHome() {
    if (!homeView) return;
    for (const game of orderedGames()) {
      let node = homeView.slots.get(game.id);
      if (!node) continue;
      const cached = state.cache.get(game.id);
      const loaded = !node.classList.contains('home-card--loading');
      if (loaded && cached?.data && node.classList.contains('home-card--new') !== isNew(game.id)) {
        const next = homeCard(game, cached);
        node.replaceWith(next);
        homeView.slots.set(game.id, next);
        node = next;
      }
      homeView.grid.append(node);
    }
  }

  function gameAccent(game) {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark ? game.accentDark : game.accent;
  }

  function playtimePanel(summary) {
    const max = Math.max(1, ...summary.days.map((day) => day.total));
    const chart = h(
      'div',
      { class: 'ptime__chart', role: 'img', 'aria-label': `Время по дням: ${F.formatPlaytime(summary.total)}` },
      summary.days.map((day) => {
        const stack = h('div', { class: 'ptime__stack' });
        state.games.forEach((game) => {
          const ms = day.byGame[game.id] || 0;
          if (!ms) return;
          stack.append(h('div', { class: 'ptime__seg', style: `height:${(ms / max) * 100}%;background:${gameAccent(game)}`, title: `${game.name}: ${F.formatPlaytime(ms)}` }));
        });
        return h('div', { class: 'ptime__col', title: `${F.weekdayShort(day.start)}: ${F.formatPlaytime(day.total)}` }, stack, h('span', { class: 'ptime__dow' }, F.weekdayShort(day.start)));
      })
    );
    const rows = state.games.map((game) => {
      const stat = summary.games[game.id];
      const playing = summary.playing.includes(game.id);
      return h(
        'button',
        { class: 'ptime__game', type: 'button', onclick: () => navigate(game.id, 'current') },
        gameIcon(game, 'ptime__icon'),
        h('span', { class: 'ptime__name' }, game.short),
        h('span', { class: 'ptime__time' }, F.formatPlaytime(stat?.total || 0)),
        playing && h('span', { class: 'ptime__live' }, 'сейчас')
      );
    });
    return h(
      'section',
      { class: 'ptime', 'aria-label': 'Время в играх за неделю' },
      h('div', { class: 'ptime__head' }, h('h2', { class: 'ptime__title' }, 'За последние 7 дней'), h('span', { class: 'ptime__total' }, summary.total ? F.formatPlaytime(summary.total) : 'пока нет сессий')),
      h('p', { class: 'ptime__note' }, 'Считается, пока GameHub открыт или свёрнут в трей, по тем же процессам, что и автоскрытие.'),
      chart,
      h('div', { class: 'ptime__games' }, rows)
    );
  }

  function renderPlaytimeChip(game) {
    if (!desktop?.playtime || !game || !state.playtime) {
      els.playtime.hidden = true;
      els.playtime.replaceChildren();
      return;
    }
    const stat = state.playtime.games[game.id];
    const playing = state.playtime.playing.includes(game.id);
    els.playtime.hidden = false;
    els.playtime.replaceChildren(h('span', {}, `За неделю: ${F.formatPlaytime(stat?.total || 0)}`), playing && h('span', { class: 'ptime-chip__live' }, 'сейчас'));
  }

  function paintPlaytime() {
    if (!state.playtime || !desktop?.playtime) return;
    if (state.view === 'home' && homeView) {
      const next = playtimePanel(state.playtime);
      if (homeView.ptime?.isConnected) homeView.ptime.replaceWith(next);
      else homeView.grid.before(next);
      homeView.ptime = next;
    }
    if (state.view === 'game') renderPlaytimeChip(currentGame());
    else els.playtime.hidden = true;
  }

  async function refreshPlaytime() {
    if (!desktop?.playtime) return;
    try {
      state.playtime = await desktop.playtime.get();
    } catch (e) {
      return;
    }
    paintPlaytime();
  }

  function renderHome(force) {
    state.view = 'home';
    toolbar.hidden = true;
    document.title = 'GameHub: главная';
    renderFooter(null);
    const token = ++homeToken;
    const header = h(
      'div',
      { class: 'home-head' },
      h('h1', { class: 'home-head__title' }, 'Главная'),
      h('p', { class: 'home-head__sub' }, 'Что нового в ваших играх: свежие версии, последние изменения и ближайшие обновления.')
    );
    const grid = h('div', { class: 'home-grid' });
    const slots = new Map();
    const ptime = state.playtime ? playtimePanel(state.playtime) : null;
    homeView = { grid, slots, ptime };
    orderedGames().forEach((game) => {
      const cached = state.cache.get(game.id);
      const node = cached?.data && !force ? homeCard(game, cached) : homeCardSkeleton(game);
      slots.set(game.id, node);
      grid.append(node);
    });
    els.content.replaceChildren(header, ...(ptime ? [ptime] : []), grid);

    state.games.forEach((game) => {
      const cached = state.cache.get(game.id);
      if (cached?.data && !force) return;
      fetchGame(game.id, { force: Boolean(force) })
        .then((payload) => ({ payload }))
        .catch((err) => ({ error: err.message }))
        .then(({ payload, error }) => {
          if (token !== homeToken || state.gameId) return;
          const next = homeCard(game, payload, error);
          slots.get(game.id).replaceWith(next);
          slots.set(game.id, next);
        });
    });
  }

  const THEME_CHOICES = [
    ['light', 'Светлая'],
    ['dark', 'Тёмная'],
    ['auto', 'Как в системе'],
  ];

  function choiceGroup(label, options, value, onPick) {
    return h(
      'div',
      { class: 'choice', role: 'radiogroup', 'aria-label': label },
      options.map(([id, text, hint]) =>
        h(
          'button',
          { class: 'choice__item', type: 'button', role: 'radio', 'aria-checked': String(id === value), title: hint, onclick: () => id !== value && onPick(id) },
          text
        )
      )
    );
  }

  function switchRow(title, hint, checked, onToggle) {
    const toggle = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(checked), 'aria-label': title, onclick: () => onToggle(!checked) }, h('span', { class: 'switch__knob' }));
    return h('div', { class: 'setting' }, h('div', { class: 'setting__text' }, h('div', { class: 'setting__title' }, title), h('p', { class: 'setting__hint' }, hint)), toggle);
  }

  function settingRow(title, hint, control) {
    return h('div', { class: 'setting' }, h('div', { class: 'setting__text' }, h('div', { class: 'setting__title' }, title), h('p', { class: 'setting__hint' }, hint)), control);
  }

  const isFullscreen = () => (desktop ? Boolean(state.desktop?.fullscreen) : Boolean(document.fullscreenElement));

  async function setDisplayMode(mode) {
    if (desktop?.settings) {
      state.desktop = await desktop.settings.set({ displayMode: mode });
    } else if (mode === 'fullscreen') {
      await document.documentElement.requestFullscreen?.().catch(() => showToast('Браузер не разрешил полноэкранный режим', 'error'));
    } else if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
    if (state.view === 'settings') renderSettings();
  }

  async function setDesktopFlag(patch) {
    state.desktop = await desktop.settings.set(patch);
    if (state.view === 'settings') renderSettings();
  }

  function renderSettings() {
    state.view = 'settings';
    homeToken += 1;
    toolbar.hidden = true;
    document.title = 'Настройки · GameHub';
    renderFooter(null);

    const sections = [
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'panel__title' }, 'Оформление'),
        settingRow(
          'Режим фона',
          'Светлая или тёмная тема. «Как в системе» следует настройке Windows, macOS или браузера.',
          choiceGroup('Режим фона', THEME_CHOICES, themeMode(), (mode) => {
            setThemeMode(mode);
            renderSettings();
          })
        )
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'panel__title' }, 'Окно'),
        settingRow(
          'Режим отображения',
          desktop ? 'Полноэкранный режим также включается клавишей F11.' : 'Полноэкранный режим браузера. Выйти из него можно клавишей Esc.',
          choiceGroup(
            'Режим отображения',
            [
              ['windowed', 'Оконный'],
              ['fullscreen', 'Полноэкранный'],
            ],
            isFullscreen() ? 'fullscreen' : 'windowed',
            setDisplayMode
          )
        )
      ),
    ];

    if (desktop?.settings && state.desktop) {
      const launchRows = [
        switchRow(
          'Скрывать GameHub во время игры',
          'После нажатия «Играть» окно убирается, а когда вы выходите из игры, возвращается само. Если игра не запустится за 10 минут, окно вернётся автоматически. Вернуть его вручную можно через значок GameHub рядом с часами.',
          state.desktop.autoHide,
          (value) => setDesktopFlag({ autoHide: value })
        ),
      ];
      if (state.desktop.autoStartSupported) {
        launchRows.push(
          switchRow(
            'Запускать вместе с Windows',
            'GameHub стартует свёрнутым в трее и продолжает считать время в играх. Крестик тоже убирает окно в трей. Полностью выйти можно через меню значка рядом с часами.',
            state.desktop.autoStart,
            (value) => setDesktopFlag({ autoStart: value })
          )
        );
      }
      if (desktop.playtime) {
        launchRows.push(
          h(
            'div',
            { class: 'setting' },
            h(
              'div',
              { class: 'setting__text' },
              h('div', { class: 'setting__title' }, 'Статистика времени'),
              h('p', { class: 'setting__hint' }, 'Удаляет накопленные сеансы на этом компьютере. Текущая игра начнёт считаться заново.')
            ),
            h(
              'button',
              {
                class: 'btn btn--ghost',
                type: 'button',
                onclick: async () => {
                  if (!window.confirm('Сбросить статистику времени во всех играх?')) return;
                  state.playtime = await desktop.playtime.reset();
                  paintPlaytime();
                  showToast('Статистика времени сброшена', 'ok');
                },
              },
              'Сбросить'
            )
          )
        );
      }
      sections.push(h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Запуск и игры'), ...launchRows));
    }

    sections.push(
      h(
        'section',
        { class: 'panel' },
        h('h2', { class: 'panel__title' }, 'Новое'),
        switchRow(
          'Выделять игры с новыми событиями',
          'Игры, в которых за последние 3 дня началось обновление или событие, выводятся первыми и обводятся красным. Пометка снимается, когда вы откроете игру.',
          state.highlightNew,
          (value) => {
            state.highlightNew = value;
            save('gamehub.highlightNew', value ? '1' : '0');
            onFreshChanged();
            renderGameTabs();
            renderSettings();
          }
        )
      )
    );

    els.content.replaceChildren(
      h('div', { class: 'home-head' }, h('h1', { class: 'home-head__title' }, 'Настройки'), h('p', { class: 'home-head__sub' }, 'Внешний вид, режим окна и поведение GameHub при запуске игр.')),
      h('div', { class: 'settings' }, sections),
      h('div', { class: 'settings__back' }, h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => (location.hash = state.returnHash) }, '← Назад'))
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
    if (state.gameId && state.gameId !== parsed.gameId) markSeen(state.gameId);
    state.gameId = parsed.gameId;
    state.section = parsed.section;
    state.view = parsed.view;
    els.settings.setAttribute('aria-pressed', String(parsed.view === 'settings'));
    if (parsed.view !== 'settings') state.returnHash = location.hash || '#/';
    const game = currentGame();
    applyAccent();
    renderGameTabs();
    if (parsed.view === 'settings') {
      renderSettings();
      return;
    }
    if (!game) {
      renderHome();
      return;
    }
    toolbar.hidden = false;
    renderSectionTabs();
    renderPlay(game);
    renderPlaytimeChip(game);
    document.title = `${game.name}: ${state.section === 'current' ? 'текущая версия' : 'предстоящее'} · GameHub`;

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
    if (!game) {
      renderHome(true);
      return;
    }
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

  async function refreshAll() {
    await Promise.allSettled(state.games.map((g) => fetchGame(g.id, { force: true })));
    if (state.view !== 'settings') render();
  }

  function onGameSession(info) {
    const game = state.games.find((g) => g.id === info.gameId);
    if (info.reason === 'exited' && game) {
      const played = info.durationMs >= 60000 ? ` Вы играли в ${game.name}: ${F.humanDuration(info.durationMs)}.` : '';
      showToast(`С возвращением!${played}`, 'ok');
    }
    refreshAll();
    refreshPlaytime();
  }

  async function init() {
    applyTheme();
    systemDark.addEventListener?.('change', () => themeMode() === 'auto' && applyTheme());
    els.settings.onclick = () => {
      location.hash = state.view === 'settings' ? state.returnHash : '#/settings';
    };
    window.addEventListener('pagehide', () => markSeen(state.gameId));
    document.addEventListener('fullscreenchange', () => state.view === 'settings' && !desktop && renderSettings());
    if (desktop?.settings) {
      state.desktop = await desktop.settings.get().catch(() => null);
      desktop.settings.onChange((value) => {
        state.desktop = value;
        if (state.view === 'settings') renderSettings();
      });
    }
    desktop?.onGameSession?.(onGameSession);
    desktop?.playtime?.onChange((summary) => {
      state.playtime = summary;
      paintPlaytime();
    });
    els.refresh.onclick = () => reload(true);
    modalEls.close.onclick = closeArticle;
    modalEls.root.addEventListener('mousedown', (e) => {
      if (e.target === modalEls.root || e.target.classList.contains('modal__backdrop')) closeArticle();
    });
    document.addEventListener('keydown', (e) => {
      if (!modalEls.root.hidden) trapFocus(e);
      else if (e.key === 'Escape') closePlayMenu();
    });
    document.addEventListener('click', (e) => {
      if (!els.play.contains(e.target)) closePlayMenu();
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
    await refreshPlaytime();
    prefetchOthers();
    setInterval(() => {
      if (!document.hidden) refreshPlaytime();
    }, 10000);
    state.timer = setInterval(tickCountdowns, 1000);
    setInterval(() => {
      if (document.hidden) return;
      state.games.forEach((g) =>
        fetchGame(g.id)
          .then((p) => g.id === state.gameId && p.data && draw(p, g))
          .catch(() => {})
      );
    }, 10 * 60 * 1000);
  }

  init();
})();
