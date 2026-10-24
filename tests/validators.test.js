import test from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../src/utils/validators.js';

test('validators: exports exist', () => {
  for (const name of ['validateEmail', 'validatePhone', 'validateName', 'validateRequired', 'validateMaxLength']) {
    assert.equal(typeof v[name], 'function', name);
  }
});

test('validateEmail: accepts a normal address, rejects malformed ones', () => {
  assert.ok(!v.validateEmail('student@univ.ma'), 'valid email should return no error');
  for (const bad of ['', 'abc', 'a@b', '@x.com', 'a b@x.com']) {
    assert.ok(v.validateEmail(bad), `should reject: "${bad}"`);
  }
});

test('validatePhone: accepts local/international numbers, rejects junk', () => {
  assert.ok(!v.validatePhone('0612345678'));
  assert.ok(!v.validatePhone('+212612345678'));
  assert.ok(v.validatePhone('12'));
  assert.ok(v.validatePhone('abcdefghij'));
});

test('validateMaxLength: enforces the limit', () => {
  assert.ok(!v.validateMaxLength('x'.repeat(10), 10));
  assert.ok(v.validateMaxLength('x'.repeat(11), 10));
});
