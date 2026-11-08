import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encodeQr, qrMatrix, qrSvgPath, qrCapacityBytes, qrMinVersion, qrSize, QR_QUIET_ZONE } from '../src/utils/qr.js';

// سعة الوضع bytes بالمستوى M للإصدارات 1..10 (ISO/IEC 18004، جدول السعات)
const CAPACITY_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
const str = (n) => 'a'.repeat(n);
// v4 / قناع 2 / sha256 للمصفوفة (صفوف من 0/1 مفصولة بسطر) لرابط تحقق ثابت؛ هذا النص بعينه ضمن حالات scripts/dev/qr-dump.mjs المفكوكة بـ OpenCV
const GOLDEN = 'v4/m2/651ac5253978a483c16b251eadd670c30e894a04c715d8942ecf5c653a4ea886';

test('QR: الأبعاد لكل إصدار = 17 + 4×الإصدار', () => {
  for (let v = 1; v <= 10; v += 1) {
    assert.equal(qrSize(v), 17 + 4 * v);
    const q = encodeQr(str(CAPACITY_M[v - 1])); // أقصى سعة الإصدار → يُنتج الإصدار نفسه
    assert.equal(q.version, v);
    assert.equal(q.size, 17 + 4 * v);
    assert.equal(q.modules.length, q.size);
    for (const row of q.modules) assert.equal(row.length, q.size);
  }
});

test('QR: السعات المعلنة تطابق الجدول، والإصدار الأدنى حسب الطول عند كل حدّ', () => {
  assert.deepEqual(Array.from({ length: 10 }, (_, i) => qrCapacityBytes(i + 1)), CAPACITY_M);
  for (let v = 1; v <= 10; v += 1) {
    assert.equal(qrMinVersion(CAPACITY_M[v - 1]), v, `آخر طول في الإصدار ${v}`);
    if (v < 10) assert.equal(qrMinVersion(CAPACITY_M[v - 1] + 1), v + 1, `أول طول في الإصدار ${v + 1}`);
  }
  assert.equal(qrMinVersion(0), 1);
  assert.equal(qrMinVersion(1), 1);
  // رابط التحقق الفعلي (أصل + /verify/ + 22 خانة) يتّسع في إصدار صغير
  const url = `https://fsa-iae.netlify.app/verify/${'A'.repeat(22)}`;
  assert.ok(encodeQr(url).version <= 4);
});

test('QR: رفض ما يتجاوز السعة (213 بايت) وحساب البايتات لا الأحرف (UTF-8)', () => {
  assert.throws(() => encodeQr(str(214)), RangeError);
  assert.throws(() => qrSvgPath(str(300)), RangeError);
  assert.equal(qrMinVersion(214), null);
  assert.throws(() => qrCapacityBytes(11), RangeError);
  assert.doesNotThrow(() => encodeQr(str(213)));
  // 107 حرفًا عربيًا = 214 بايت (حرفان لكل حرف): يتجاوز السعة رغم أن عدد الأحرف أقل بكثير
  assert.throws(() => encodeQr('ب'.repeat(107)), RangeError);
  assert.equal(encodeQr('ب'.repeat(7)).version, 1); // 14 بايت
  assert.equal(encodeQr('ب'.repeat(8)).version, 2); // 16 بايت
});

test('QR: ثبات الناتج لمدخل ثابت (حتمي) وبصمة ذهبية فُكّت بـ OpenCV', () => {
  const text = 'https://fsa-iae.netlify.app/verify/AbCdEfGhIjKlMnOpQrStUv';
  const a = encodeQr(text);
  const b = encodeQr(text);
  assert.deepEqual(a.modules, b.modules);
  assert.equal(a.mask, b.mask);
  const bits = a.modules.map((r) => r.map((x) => (x ? '1' : '0')).join('')).join('\n');
  const digest = crypto.createHash('sha256').update(bits).digest('hex');
  assert.equal(`v${a.version}/m${a.mask}/${digest}`, GOLDEN);
  // مدخلان مختلفان → مصفوفتان مختلفتان
  assert.notDeepEqual(qrMatrix(text), qrMatrix(`${text}x`));
});

function finderAt(m, x0, y0) {
  // 7×7: إطار داكن، حلقة فاتحة، مركز 3×3 داكن
  for (let dy = 0; dy < 7; dy += 1) {
    for (let dx = 0; dx < 7; dx += 1) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      const expectDark = ring !== 2;
      if (m[y0 + dy][x0 + dx] !== expectDark) return false;
    }
  }
  return true;
}

test('QR: نمط finder 7×7 في الزوايا الثلاث (وليس في الرابعة) مع فاصل فاتح', () => {
  for (const len of [5, 40, 100, 213]) {
    const { modules: m, size: n } = encodeQr(str(len));
    assert.ok(finderAt(m, 0, 0), `أعلى اليسار len=${len}`);
    assert.ok(finderAt(m, n - 7, 0), `أعلى اليمين len=${len}`);
    assert.ok(finderAt(m, 0, n - 7), `أسفل اليسار len=${len}`);
    // الفاصل الفاتح حول الأول
    for (let i = 0; i < 8; i += 1) { assert.equal(m[7][i], false); assert.equal(m[i][7], false); }
    // الزاوية السفلية اليمنى بلا finder
    assert.ok(!finderAt(m, n - 7, n - 7));
    // أنماط التوقيت على الصف/العمود 6 بين الـ finders
    for (let i = 8; i < n - 8; i += 1) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
    // الوحدة الداكنة الثابتة
    assert.equal(m[n - 8][8], true);
  }
});

test('QR: نسختا معلومات التنسيق متطابقتان وتحملان قناع الناتج (BCH صالح، المستوى M)', () => {
  const FORMAT_MASK = 0x5412;
  const bch = (data) => { let r = data; for (let i = 0; i < 10; i += 1) r = (r << 1) ^ ((r >>> 9) * 0x537); return ((data << 10) | r) ^ FORMAT_MASK; };
  for (const len of [3, 50, 150]) {
    const { modules: m, size: n, mask } = encodeQr(str(len));
    const bit = (v) => (v ? 1 : 0);
    // النسخة الأولى حول الـ finder العلوي الأيسر (بترتيب المواصفة: البت 0 هو الأقل أهمية)
    const first = [];
    for (let i = 0; i <= 5; i += 1) first[i] = bit(m[i][8]);
    first[6] = bit(m[7][8]); first[7] = bit(m[8][8]); first[8] = bit(m[8][7]);
    for (let i = 9; i < 15; i += 1) first[i] = bit(m[8][14 - i]);
    const second = [];
    for (let i = 0; i < 8; i += 1) second[i] = bit(m[8][n - 1 - i]);
    for (let i = 8; i < 15; i += 1) second[i] = bit(m[n - 15 + i][8]);
    const toInt = (a) => a.reduce((acc, b, i) => acc | (b << i), 0);
    assert.equal(toInt(first), toInt(second));
    assert.equal(toInt(first), bch((0 << 3) | mask)); // 00 = مستوى M
  }
});

test('QR: معلومات الإصدار للإصدارات ≥ 7 (BCH 18,6) ومحاذاة النمط في الإصدارات ≥ 2', () => {
  const bch18 = (v) => { let r = v; for (let i = 0; i < 12; i += 1) r = (r << 1) ^ ((r >>> 11) * 0x1f25); return (v << 12) | r; };
  for (const v of [7, 8, 9, 10]) {
    const { modules: m, size: n } = encodeQr(str(CAPACITY_M[v - 1]));
    let read = 0;
    for (let i = 0; i < 18; i += 1) {
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      assert.equal(m[b][a], m[a][b], 'النسختان متناظرتان');
      read |= (m[b][a] ? 1 : 0) << i;
    }
    assert.equal(read, bch18(v));
  }
  // محاذاة الإصدار 2 عند (18,18): مركز داكن، حلقة فاتحة، إطار داكن
  const { modules: m2 } = encodeQr(str(20));
  assert.equal(m2[18][18], true);
  assert.equal(m2[18][19], false);
  assert.equal(m2[16][18], true);
});

test('QR: مسار SVG — منطقة هدوء 4 وحدات، ومجموع أطوال المقاطع = عدد الوحدات الداكنة', () => {
  assert.equal(QR_QUIET_ZONE, 4);
  const text = 'https://fsa-iae.netlify.app/verify/AbCdEfGhIjKlMnOpQrStUv';
  const { modules, size } = encodeQr(text);
  const svg = qrSvgPath(text);
  assert.equal(svg.size, size + 8);
  assert.equal(svg.viewBox, `0 0 ${size + 8} ${size + 8}`);
  const runs = [...svg.d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)];
  assert.equal(runs.length, (svg.d.match(/M/g) || []).length, 'كل المقاطع بالصيغة المتوقعة');
  const dark = modules.flat().filter(Boolean).length;
  assert.equal(runs.reduce((s, m) => s + Number(m[3]), 0), dark);
  // لا شيء داخل منطقة الهدوء، وكل مقطع يطابق المصفوفة
  for (const [, x, y, w] of runs) {
    assert.ok(Number(x) >= 4 && Number(y) >= 4 && Number(x) + Number(w) <= size + 4 && Number(y) < size + 4);
    for (let i = 0; i < Number(w); i += 1) assert.equal(modules[Number(y) - 4][Number(x) - 4 + i], true);
  }
  // منطقة هدوء مخصّصة
  assert.equal(qrSvgPath(text, 0).size, size);
});
