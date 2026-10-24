import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearchValue, matchesMemberSearch } from '../src/utils/arabicSearch.js';
import { parseTechnologies, slugifyProject, httpsUrlOrEmpty, MAX_TECHNOLOGIES } from '../src/utils/projects.js';
import { normalizeWhatsappNumber, buildWhatsappLink } from '../src/utils/whatsapp.js';

test('arabicSearch: يوحّد الألف والياء ويحذف التشكيل والتطويل', () => {
  assert.equal(normalizeSearchValue('أَحمَد'), normalizeSearchValue('احمد'));
  assert.equal(normalizeSearchValue('إبراهيم'), normalizeSearchValue('ابراهيم'));
  assert.equal(normalizeSearchValue('مصطفى'), normalizeSearchValue('مصطفي'));
  assert.equal(normalizeSearchValue(null), '');
});

test('arabicSearch: matchesMemberSearch', () => {
  const p = { name: 'أحمد بنعلي', university: 'جامعة ابن زهر', promo: '2024' };
  assert.ok(matchesMemberSearch(p, normalizeSearchValue('احمد')));
  assert.ok(matchesMemberSearch(p, '')); // استعلام فارغ = الكل
  assert.ok(!matchesMemberSearch(p, normalizeSearchValue('فاطمة')));
});

test('projects: parseTechnologies يزيل التكرار ويحترم الحد', () => {
  assert.deepEqual(parseTechnologies('Python, python, ESP32 ،TensorFlow Lite'), ['Python', 'ESP32', 'TensorFlow Lite']);
  const many = Array.from({ length: 50 }, (_, i) => `t${i}`).join(',');
  assert.equal(parseTechnologies(many).length, MAX_TECHNOLOGIES);
});

test('projects: slugifyProject و httpsUrlOrEmpty', () => {
  assert.equal(slugifyProject('Café Robot!', 'x1'), 'cafe-robot-x1');
  assert.equal(slugifyProject('مشروع عربي', 'x1'), 'projet-x1');
  assert.equal(httpsUrlOrEmpty('http://a.com'), '');
  assert.equal(httpsUrlOrEmpty('javascript:alert(1)'), '');
  assert.equal(httpsUrlOrEmpty('https://a.com/x'), 'https://a.com/x');
});

test('whatsapp: تطبيع الأرقام المغربية والدولية', () => {
  assert.equal(normalizeWhatsappNumber('06 12 34 56 78'), '212612345678');
  assert.equal(normalizeWhatsappNumber('+212 612345678'), '212612345678');
  assert.equal(normalizeWhatsappNumber('00212612345678'), '212612345678');
  assert.equal(normalizeWhatsappNumber(''), '');
  assert.ok(buildWhatsappLink('0612345678', 'مرحبا').startsWith('https://wa.me/212612345678?text='));
});
