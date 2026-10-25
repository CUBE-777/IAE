import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_DICT } from '../src/i18n/adminDict.data.js';

test('قاموس الإدارة: لكل نص عربي ترجمة فرنسية وإنجليزية غير فارغة', () => {
  const missing = [];
  for (const [ar, v] of Object.entries(ADMIN_DICT)) {
    if (!v || !String(v.fr || '').trim() || !String(v.en || '').trim()) missing.push(ar);
  }
  assert.deepEqual(missing, [], `نصوص بلا ترجمة كاملة: ${missing.slice(0, 5).join(' | ')}`);
});
