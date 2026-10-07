const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranslator, needsTranslation, chunkText } = require('../lib/translate');
const { createStore } = require('../lib/store');

const fake = (name, map, calls = []) => ({
  name,
  maxChunk: 450,
  async translate(text) {
    calls.push(text);
    if (map === null) throw new Error('недоступен');
    return map[text] || `RU(${text})`;
  },
});

test('needsTranslation пропускает русский текст и короткие токены', () => {
  assert.equal(needsTranslation('Map Reworks and Rebalances'), true);
  assert.equal(needsTranslation('Обновление 2.4.1'), false);
  assert.equal(needsTranslation('Версия «Dreamscape»'), false);
  assert.equal(needsTranslation('1.19.3'), false);
});

test('chunkText делит длинный текст по предложениям', () => {
  const text = 'Первое предложение. Второе предложение! Третье предложение?';
  const parts = chunkText(text, 25);
  assert.ok(parts.length >= 3);
  assert.ok(parts.every((p) => p.length <= 25));
  assert.equal(chunkText('коротко', 100).length, 1);
});

test('localize переводит title/summary, помнит оригинал и кэширует', async () => {
  const calls = [];
  const tr = createTranslator({ providers: [fake('p', { 'Hello world': 'Привет, мир' }, calls)] });
  const data = {
    current: {
      headline: { title: 'Обновление 2.4', subtitle: 'Overdrive', chips: [{ label: 'Версия', value: '2.4' }] },
      blocks: [{ title: 'Блок', items: [{ title: 'Hello world', summary: 'Hello world', tag: 'news' }] }],
    },
  };
  const { data: out, stats } = await tr.localize(data);
  const item = out.current.blocks[0].items[0];
  assert.equal(item.title, 'Привет, мир');
  assert.equal(item.titleOriginal, 'Hello world');
  assert.equal(item.tag, 'news');
  assert.equal(out.current.headline.title, 'Обновление 2.4');
  assert.equal(out.current.headline.subtitle, 'RU(Overdrive)');
  assert.equal(stats.failed, 0);
  assert.equal(calls.filter((c) => c === 'Hello world').length, 1);
});

test('localize переводит только отмеченные маркерами фрагменты', async () => {
  const tr = createTranslator({ providers: [fake('p', { 'Thunder at our Gates': 'Гром у ворот' })] });
  const { data } = await tr.localize({ headline: { subtitle: 'Текущее дополнение: ⟦Thunder at our Gates⟧' } });
  assert.equal(data.headline.subtitle, 'Текущее дополнение: Гром у ворот');
});

test('при отказе основного провайдера используется запасной, а при отказе всех остаётся оригинал', async () => {
  const backup = createTranslator({ providers: [fake('main', null), fake('backup', { 'Some text here': 'Какой-то текст' })] });
  const ok = await backup.localize({ summary: 'Some text here', marked: 'x', title: 'Some text here' });
  assert.equal(ok.data.summary, 'Какой-то текст');

  const dead = createTranslator({ providers: [fake('a', null), fake('b', null)] });
  const bad = await dead.localize({ title: 'Untranslated title', subtitle: 'Текущее ⟦Another name⟧' });
  assert.equal(bad.data.title, 'Untranslated title');
  assert.equal(bad.data.titleOriginal, undefined);
  assert.equal(bad.data.subtitle, 'Текущее Another name');
  assert.ok(bad.stats.failed > 0);
});

test('хранилище применяет перевод и отдаёт статистику', async () => {
  const tr = createTranslator({ providers: [fake('p', {})] });
  const game = {
    id: 'g',
    load: async () => ({ sources: [], current: { headline: { title: 'Hello there' }, blocks: [] }, upcoming: { headline: null, blocks: [] } }),
  };
  const store = createStore([game], { localize: tr.localize });
  const res = await store.get('g');
  assert.equal(res.data.current.headline.title, 'RU(Hello there)');
  assert.equal(res.translation.translated, 1);
});

test('глоссарий сохраняет названия игр и рубрик', async () => {
  const tr = createTranslator({ providers: [fake('p', { 'Minecraft snapshot news': 'Новости снимка Майнкрафт', 'Weekly dev diary': 'Уголок разработчиков недели' })] });
  assert.equal(await tr.translate('Minecraft snapshot news'), 'Новости снимка Minecraft');
  assert.equal(await tr.translate('Weekly dev diary'), 'Dev Corner недели');
});

test('needsTranslation не трогает собственные названия', () => {
  assert.equal(needsTranslation('Girls und Panzer'), false);
  assert.equal(needsTranslation('Boosteroid'), false);
  assert.equal(needsTranslation('Girls und Panzer returns this week'), true);
});
