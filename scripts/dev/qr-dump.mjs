// سكربت تطوير (خارج الحزمة): يولّد حالات اختبار لـ src/utils/qr.js ويكتب مصفوفاتها JSON ليفكّها qr-verify.py بـ OpenCV.
// الاستعمال: node scripts/dev/qr-dump.mjs > /tmp/qr-cases.json
import { encodeQr, qrCapacityBytes } from '../../src/utils/qr.js';

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/:.?=&%';
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const randStr = (n) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');

const cases = [];
for (let v = 1; v <= 10; v += 1) {
  const cap = qrCapacityBytes(v);
  const prev = v > 1 ? qrCapacityBytes(v - 1) + 1 : 1;
  for (const len of new Set([prev, Math.floor((prev + cap) / 2), cap])) cases.push(randStr(len));
}
cases.push('https://fsa-iae.netlify.app/verify/' + randStr(22));
cases.push('https://example.org/verify/AbCdEfGhIjKlMnOpQrStUv');
cases.push('https://fsa-iae.netlify.app/verify/AbCdEfGhIjKlMnOpQrStUv'); // البصمة الذهبية في tests/qr.test.js
cases.push('HELLO WORLD');
for (let i = 0; i < 30; i += 1) cases.push(randStr(1 + Math.floor(rnd() * 200)));
cases.push('IAE · الفوج 2026'); // UTF-8 متعدد البايتات (يُفكّ بـ OpenCV كنص UTF-8)

const out = cases.map((text) => {
  const q = encodeQr(text);
  return { text, version: q.version, size: q.size, mask: q.mask, rows: q.modules.map((r) => r.map((b) => (b ? 1 : 0)).join('')) };
});
process.stdout.write(JSON.stringify(out));
