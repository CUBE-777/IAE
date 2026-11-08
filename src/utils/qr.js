/**
 * src/utils/qr.js
 * مشفّر QR مدمج بلا اعتماديات (لا eval ولا شبكة، فالـ CSP هي script-src 'self').
 *
 * - الوضع: bytes (UTF-8) فقط. مستوى التصحيح: M فقط. الإصدارات 1–10 (حتى 213 بايت).
 * - يُرجع مصفوفة modules (true = وحدة داكنة) ومسار SVG واحدًا يرسم الوحدات الداكنة، بمنطقة هدوء 4 وحدات.
 * - الناتج حتمي: النص نفسه يعطي المصفوفة نفسها (اختيار القناع بالعقوبات مع كسر التعادل بأقل رقم).
 * - التحقق: scripts/dev/qr-verify.py يولّد صورًا من هذا الملف ويفكّها بـ OpenCV (سكربت تطوير خارج الحزمة).
 *
 * مرجع: ISO/IEC 18004 (جداول الإصدارات 1–10 للمستوى M، أنماط المحاذاة، BCH للتنسيق والإصدار، عقوبات القناع).
 */

export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 10;
export const QR_QUIET_ZONE = 4;

// المستوى M: [بايتات تصحيح لكل كتلة، [[عدد الكتل، بايتات البيانات لكل كتلة], ...]] لكل إصدار 1..10
const M_BLOCKS = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
};

const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const FORMAT_ECC_M = 0; // بتّا مستوى التصحيح M في معلومات التنسيق

export const qrSize = (version) => 17 + 4 * version;

function dataCodewords(version) {
  const [, groups] = M_BLOCKS[version];
  return groups.reduce((s, [n, k]) => s + n * k, 0);
}

/** سعة الإصدار بالبايتات (وضع bytes، المستوى M). */
export function qrCapacityBytes(version) {
  if (!M_BLOCKS[version]) throw new RangeError('unsupported QR version');
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCodewords(version) * 8 - 4 - countBits) / 8);
}

/** أدنى إصدار يتّسع لـ byteLength بايت، أو null إن تجاوز سعة الإصدار 10. */
export function qrMinVersion(byteLength) {
  for (let v = QR_MIN_VERSION; v <= QR_MAX_VERSION; v += 1) if (byteLength <= qrCapacityBytes(v)) return v;
  return null;
}

/* ---------- حقل غالوا GF(256) (كثير الحدود 0x11D) وReed-Solomon ---------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly; // المعامل الأعلى أولًا (يساوي 1)
}

function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    if (factor !== 0) for (let i = 0; i < degree; i += 1) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

/* ---------- تحويل النص إلى كلمات البيانات ثم الكتل المتشابكة ---------- */

function buildCodewords(bytes, version) {
  const totalData = dataCodewords(version);
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  push(0b0100, 4);                              // وضع bytes
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, totalData * 8 - bits.length)); // المُنهي
  while (bits.length % 8 !== 0) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < totalData; pad ^= 0xec ^ 0x11) data.push(pad);

  const [ecLen, groups] = M_BLOCKS[version];
  const blocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i += 1) {
      const d = data.slice(offset, offset + size);
      offset += size;
      blocks.push({ d, ec: rsRemainder(d, ecLen) });
    }
  }
  const out = [];
  const maxLen = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxLen; i += 1) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecLen; i += 1) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

/* ---------- BCH: معلومات التنسيق والإصدار ---------- */

function formatBits(mask) {
  const data = (FORMAT_ECC_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

/* ---------- المصفوفة ---------- */

function makeGrid(size) {
  return {
    size,
    mod: Array.from({ length: size }, () => new Array(size).fill(false)),
    fn: Array.from({ length: size }, () => new Array(size).fill(false)), // وحدات وظيفية (لا تُقنَّع)
  };
}

function setFn(g, x, y, dark) {
  g.mod[y][x] = dark;
  g.fn[y][x] = true;
}

function drawFinder(g, cx, cy) {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= g.size || y >= g.size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFn(g, x, y, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlignment(g, cx, cy) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) setFn(g, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
}

function drawFormat(g, mask) {
  const bits = formatBits(mask);
  const bit = (i) => ((bits >>> i) & 1) !== 0;
  const n = g.size;
  for (let i = 0; i <= 5; i += 1) setFn(g, 8, i, bit(i));
  setFn(g, 8, 7, bit(6));
  setFn(g, 8, 8, bit(7));
  setFn(g, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFn(g, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) setFn(g, n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFn(g, 8, n - 15 + i, bit(i));
  setFn(g, 8, n - 8, true); // الوحدة الداكنة الثابتة
}

function drawFunctionPatterns(g, version) {
  const n = g.size;
  for (let i = 0; i < n; i += 1) { // أنماط التوقيت
    setFn(g, 6, i, i % 2 === 0);
    setFn(g, i, 6, i % 2 === 0);
  }
  drawFinder(g, 3, 3);
  drawFinder(g, n - 4, 3);
  drawFinder(g, 3, n - 4);
  const pos = ALIGN[version];
  for (let i = 0; i < pos.length; i += 1) {
    for (let j = 0; j < pos.length; j += 1) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      drawAlignment(g, pos[i], pos[j]);
    }
  }
  drawFormat(g, 0); // حجز الخانات؛ تُكتب القيمة الفعلية بعد اختيار القناع
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(g, a, b, dark);
      setFn(g, b, a, dark);
    }
  }
}

function placeData(g, codewords) {
  const n = g.size;
  let i = 0;
  const total = codewords.length * 8;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (g.fn[y][x] || i >= total) continue;
        g.mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
        i += 1;
      }
    }
  }
  return i === total;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(g, mask) {
  for (let y = 0; y < g.size; y += 1) for (let x = 0; x < g.size; x += 1) if (!g.fn[y][x] && MASKS[mask](x, y)) g.mod[y][x] = !g.mod[y][x];
}

function runPenalty(line) {
  let p = 0;
  let run = 1;
  for (let i = 1; i <= line.length; i += 1) {
    if (i < line.length && line[i] === line[i - 1]) run += 1;
    else {
      if (run >= 5) p += 3 + (run - 5);
      run = 1;
    }
  }
  // نمط 1:1:3:1:1 مع أربع وحدات فاتحة على أحد الجانبين (40 لكل ظهور)
  const s = line.map((v) => (v ? '1' : '0')).join('');
  for (const re of [/10111010000/g, /00001011101/g]) {
    const m = s.match(re);
    if (m) p += 40 * m.length;
  }
  return p;
}

function penalty(g) {
  const n = g.size;
  const m = g.mod;
  let p = 0;
  for (let y = 0; y < n; y += 1) p += runPenalty(m[y]);
  for (let x = 0; x < n; x += 1) p += runPenalty(m.map((row) => row[x]));
  for (let y = 0; y < n - 1; y += 1) {
    for (let x = 0; x < n - 1; x += 1) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark += 1;
  const pct = (dark * 100) / (n * n);
  p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

/**
 * يشفّر النص (UTF-8) في QR بالمستوى M. الإصدار الأدنى الكافي.
 * @returns {{ version: number, size: number, mask: number, modules: boolean[][] }}
 * @throws {RangeError} إن تجاوز النص سعة الإصدار 10 (213 بايت)
 */
export function encodeQr(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const version = qrMinVersion(bytes.length);
  if (version === null) throw new RangeError(`QR payload too large (${bytes.length} > ${qrCapacityBytes(QR_MAX_VERSION)} bytes)`);
  const codewords = buildCodewords(bytes, version);

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const g = makeGrid(qrSize(version));
    drawFunctionPatterns(g, version);
    placeData(g, codewords);
    applyMask(g, mask);
    drawFormat(g, mask);
    const score = penalty(g);
    if (best === null || score < best.score) best = { score, mask, g };
  }
  return { version, size: best.g.size, mask: best.mask, modules: best.g.mod };
}

/** مصفوفة الوحدات فقط. */
export function qrMatrix(text) {
  return encodeQr(text).modules;
}

/**
 * مسار SVG واحد (fill-rule افتراضي) يرسم الوحدات الداكنة بمنطقة هدوء `quiet` وحدة.
 * @returns {{ size: number, viewBox: string, d: string, version: number }} size = الأبعاد الكلية بما فيها منطقة الهدوء
 */
export function qrSvgPath(text, quiet = QR_QUIET_ZONE) {
  const { modules, size, version } = encodeQr(text);
  const parts = [];
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      if (!modules[y][x]) { x += 1; continue; }
      let w = 1;
      while (x + w < size && modules[y][x + w]) w += 1;
      parts.push(`M${x + quiet} ${y + quiet}h${w}v1h-${w}z`);
      x += w;
    }
  }
  const total = size + quiet * 2;
  return { size: total, viewBox: `0 0 ${total} ${total}`, d: parts.join(''), version };
}
