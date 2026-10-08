import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTranslation } from '../src/validation.ts';

test('valid localized text can move placeholders and keep rich-text tags', () => {
  assert.deepEqual(validateTranslation('Open {name}: {count}', '{count}개: {name} 열기'), []);
  assert.deepEqual(validateTranslation('<color=#fff><b>Watch Office</b></color>', '<color=#fff><b>감시국</b></color>'), []);
  assert.deepEqual(validateTranslation('<a href="doc>one">Open</a>', '<a href="doc>one">열기</a>'), []);
});

test('placeholder multiplicity, names, and additions are protected', () => {
  for (const [source, target] of [
    ['{name} {name}', '{name}'],
    ['{name}', '{person}'],
    ['Open', '열기 {name}'],
  ]) assert.ok(validateTranslation(source, target).some(issue => issue.code === 'placeholder_mismatch'));
});

test('tag contents, order, and link targets are protected', () => {
  assert.ok(validateTranslation('<b>x</b>', '번역').some(issue => issue.code === 'tag_mismatch'));
  assert.ok(validateTranslation('<b><i>x</i></b>', '<i><b>번역</b></i>').some(issue => issue.code === 'tag_mismatch'));
  assert.ok(validateTranslation('<a href="doc>one">x</a>', '<a href="doc>two">번역</a>').some(issue => issue.code === 'link_target_mismatch'));
  assert.ok(validateTranslation('<l target=doc-one>x</l>', '<l target=doc-two>번역</l>').some(issue => issue.code === 'link_target_mismatch'));
});

test('blank text fails; numbers and ordinary comparisons are not required-failure tokens', () => {
  assert.ok(validateTranslation('Hello', ' \n\t ').some(issue => issue.code === 'empty_translation'));
  assert.deepEqual(validateTranslation('Code 731', '코드'), []);
  assert.deepEqual(validateTranslation('x < 3', 'x는 3보다 작다'), []);
});
