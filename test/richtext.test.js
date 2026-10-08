const test = require('node:test');
const assert = require('node:assert/strict');
const { htmlToBlocks, bbcodeToBlocks } = require('../lib/richtext');

test('HTML: заголовки, абзацы, списки, картинки и скрытие опасных тегов', () => {
  const blocks = htmlToBlocks(
    '<h2>Новое</h2><p>Первый <b>абзац</b> &amp; текст</p><ul><li>Один</li><li>Два</li></ul><img src="/a.png" alt="x"><script>alert(1)</script><img src="javascript:alert(1)">',
    { baseUrl: 'https://example.com/news/' }
  );
  assert.deepEqual(
    blocks.map((b) => [b.type, b.text || b.src]),
    [
      ['h', 'Новое'],
      ['p', 'Первый абзац & текст'],
      ['li', 'Один'],
      ['li', 'Два'],
      ['img', 'https://example.com/a.png'],
    ]
  );
});

test('HTML: чисто кириллический текст не теряется, маркеры превращаются в разметку', () => {
  const blocks = htmlToBlocks('<p>▼// Обновление</p><p>· пункт</p><p>■ Малый заголовок</p><p>обычный текст</p>');
  assert.deepEqual(
    blocks.map((b) => [b.type, b.text]),
    [
      ['h', 'Обновление'],
      ['li', 'пункт'],
      ['h', 'Малый заголовок'],
      ['p', 'обычный текст'],
    ]
  );
});

test('BBCode Steam: заголовки, списки, картинки', () => {
  const blocks = bbcodeToBlocks('[h2]Заголовок[/h2]\n[p]Текст[/p]\n[list]\n[*]Первый\n[*]Второй\n[/list]\n[img]{STEAM_CLAN_IMAGE}/1/a.png[/img]');
  assert.equal(blocks[0].type, 'h');
  assert.equal(blocks[1].text, 'Текст');
  assert.deepEqual(blocks.filter((b) => b.type === 'li').map((b) => b.text), ['Первый', 'Второй']);
  assert.match(blocks.find((b) => b.type === 'img').src, /^https:\/\/clan\.fastly\.steamstatic\.com\/images\/1\/a\.png$/);
});
