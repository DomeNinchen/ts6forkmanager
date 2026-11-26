import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDistance } from 'date-fns';
import { de, enUS, fr, pl, ptBR, zhCN } from 'date-fns/locale';
import { getDateFnsLocale } from '../src/lib/date-fns-locale.ts';

test('each UI language maps to its date-fns locale', () => {
  const cases: [string | undefined, unknown][] = [
    ['de', de], ['de-AT', de], ['en', enUS], ['fr', fr], ['pl', pl],
    ['pt', ptBR], ['pt-BR', ptBR], ['pt-PT', ptBR],
    ['zh', zhCN], ['zh-CN', zhCN], ['zh-TW', zhCN],
    ['', enUS], [undefined, enUS], ['xx', enUS],
  ];
  for (const [lang, expected] of cases) assert.equal(getDateFnsLocale(lang), expected, String(lang));
});

test('relative times come out in the language', () => {
  const ago = (lang: string) => formatDistance(0, 2 * 3600_000, { addSuffix: true, locale: getDateFnsLocale(lang) });
  assert.equal(ago('en'), 'about 2 hours ago');
  assert.notEqual(ago('zh'), ago('en'));
  assert.notEqual(ago('fr'), ago('en'));
  assert.notEqual(ago('pl'), ago('en'));
  assert.notEqual(ago('pt'), ago('en'));
});
