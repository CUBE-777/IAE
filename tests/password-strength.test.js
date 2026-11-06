import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordStrength, MIN_LEN, MAX_LEN } from '../src/utils/passwordStrength.js';

test('passwordStrength: الحدود تطابق الخادم (8..72)', () => {
  assert.equal(MIN_LEN, 8);
  assert.equal(MAX_LEN, 72);
});

test('passwordStrength: null لما دون الحد الأدنى أو لغير النص', () => {
  assert.equal(passwordStrength('abc1234'), null);
  assert.equal(passwordStrength(''), null);
  assert.equal(passwordStrength(undefined), null);
});

test('passwordStrength: ضعيفة ومتوسطة وقوية', () => {
  assert.equal(passwordStrength('abcdefgh'), 'weak');
  assert.equal(passwordStrength('abcdefgh12'), 'medium');
  assert.equal(passwordStrength('Abcdefgh12!xyz'), 'strong');
});
