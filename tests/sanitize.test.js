import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeUrl } from '../src/utils/sanitize.js';

test('escapeHtml يهرّب الرموز الخطرة', () => {
  assert.equal(escapeHtml('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  assert.equal(escapeHtml(null), '');
});

test('safeUrl يرفض البروتوكولات الخطرة ويقبل الآمنة', () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x', '  javascript:alert(1)']) {
    assert.equal(safeUrl(bad), '', bad);
  }
  for (const good of ['https://a.com', 'http://a.com', '/path', './p', '../p', '//cdn.x/y', 'page.html']) {
    assert.equal(safeUrl(good), good, good);
  }
});
