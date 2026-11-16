import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pruneUntranslated } from '../src/lib/i18n-resources.ts';

test('drops empty strings and half-blank lists, keeps the rest', () => {
  const tree = {
    common: { save: 'Zapisz', cancel: '' },
    options: ['', ''],
    mixed: ['Tak', ''],
    list: ['Nie', 'Tak'],
    empty: { a: '', b: { c: '' } },
    count: 0,
  };
  assert.deepEqual(pruneUntranslated(tree), {
    common: { save: 'Zapisz' },
    list: ['Nie', 'Tak'],
    count: 0,
  });
});

test('every shipped locale keeps no blank values after pruning', () => {
  const dir = new URL('../src/locales/', import.meta.url);
  const hasBlank = (v: unknown): boolean =>
    v === '' ||
    (Array.isArray(v) && v.some(hasBlank)) ||
    (!!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).some(hasBlank));
  for (const code of readdirSync(dir)) {
    const tree = JSON.parse(readFileSync(new URL(`${code}/translation.json`, dir), 'utf8'));
    assert.equal(hasBlank(pruneUntranslated(tree)), false, code);
  }
});
