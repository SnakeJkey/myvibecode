const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { createStore } = require('../lib/store');

const section = (title) => ({ headline: { title }, blocks: [{ title: 'Блок', items: [] }] });
const sample = (title) => ({ sources: [], current: section(title), upcoming: section(`${title}+`) });

function makeGame(id, load) {
  return { id, name: id, short: id, tagline: '', accent: '#000', accentDark: '#fff', load };
}

async function withServer(games, options, fn) {
  const store = createStore(games, options);
  const server = createApp({ games, store });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('API отдаёт список игр, данные, 404 и статику', async () => {
  const games = [makeGame('a', async () => sample('A'))];
  await withServer(games, {}, async (base) => {
    const list = await (await fetch(`${base}/api/games`)).json();
    assert.deepEqual(list.games.map((g) => g.id), ['a']);
    assert.equal(list.games[0].load, undefined);

    const data = await (await fetch(`${base}/api/games/a`)).json();
    assert.equal(data.ok, true);
    assert.equal(data.data.current.headline.title, 'A');

    assert.equal((await fetch(`${base}/api/games/zzz`)).status, 404);
    assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/styles.css`)).headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal((await fetch(`${base}/..%2Fserver.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/games`, { method: 'POST' })).status, 405);
  });
});

test('нормализация превращает items в blocks (формат Minecraft)', async () => {
  const legacy = { sources: [], current: { headline: null, items: [{ title: 'x' }], itemsTitle: 'T' }, upcoming: { headline: null, items: [], itemsTitle: 'U', emptyText: 'пусто' } };
  await withServer([makeGame('m', async () => legacy)], {}, async (base) => {
    const data = await (await fetch(`${base}/api/games/m`)).json();
    assert.equal(data.data.current.blocks[0].title, 'T');
    assert.equal(data.data.upcoming.blocks[0].emptyText, 'пусто');
  });
});

test('ошибка одного источника не ломает остальные и сохраняет старые данные', async () => {
  let calls = 0;
  let clock = 0;
  const flaky = makeGame('flaky', async () => {
    calls += 1;
    if (calls > 1) throw new Error('источник упал');
    return sample('ok');
  });
  const broken = makeGame('broken', async () => {
    throw new Error('всегда падает');
  });
  await withServer([flaky, broken], { ttl: 1000, now: () => clock }, async (base) => {
    assert.equal((await (await fetch(`${base}/api/games/flaky`)).json()).ok, true);

    const bad = await (await fetch(`${base}/api/games/broken`)).json();
    assert.equal(bad.ok, false);
    assert.equal(bad.data, null);
    assert.match(bad.error, /падает/);

    clock = 5000;
    const forced = await (await fetch(`${base}/api/games/flaky?refresh=1`)).json();
    assert.equal(forced.stale, true);
    assert.equal(forced.data.current.headline.title, 'ok');
    assert.match(forced.error, /упал/);
  });
});

test('кэш не вызывает источник повторно в пределах TTL', async () => {
  let calls = 0;
  const game = makeGame('c', async () => {
    calls += 1;
    return sample('c');
  });
  await withServer([game], { ttl: 60000 }, async (base) => {
    await fetch(`${base}/api/games/c`);
    await fetch(`${base}/api/games/c`);
    await Promise.all([fetch(`${base}/api/games/c`), fetch(`${base}/api/games/c`)]);
    assert.equal(calls, 1);
    await fetch(`${base}/api/games/c?refresh=1`);
    assert.equal(calls, 2);
  });
});

test('полный текст новости: перевод блоков, ошибки и отсутствие ссылки', async () => {
  const games = [
    {
      ...makeGame('a', async () => sample('A')),
      article: async (ref) => {
        if (ref === 'boom') throw new Error('источник недоступен');
        return { url: 'https://example.com/news/1', blocks: [{ type: 'h', level: 2, text: 'Hello world' }, { type: 'p', text: 'Привет' }, { type: 'img', src: 'https://example.com/a.png' }] };
      },
    },
    makeGame('b', async () => sample('B')),
  ];
  const translateBlocks = async (texts) => texts.map((t) => (t === 'Hello world' ? 'Привет, мир' : t));
  await withServer(games, { translateBlocks }, async (base) => {
    const ok = await (await fetch(`${base}/api/games/a/article?ref=1`)).json();
    assert.equal(ok.ok, true);
    assert.equal(ok.article.url, 'https://example.com/news/1');
    assert.equal(ok.article.blocks[0].text, 'Привет, мир');
    assert.equal(ok.article.blocks[0].original, 'Hello world');
    assert.equal(ok.article.blocks[2].type, 'img');
    assert.equal(ok.article.translation.translated, 1);

    const bad = await (await fetch(`${base}/api/games/a/article?ref=boom`)).json();
    assert.equal(bad.ok, false);
    assert.match(bad.error, /недоступен/);

    const none = await (await fetch(`${base}/api/games/b/article?ref=1`)).json();
    assert.equal(none.ok, false);
    assert.equal((await fetch(`${base}/api/games/zzz/article?ref=1`)).status, 404);
  });
});
