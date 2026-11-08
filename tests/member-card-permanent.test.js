import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPdfFromJpeg } from '../src/utils/pdfBuilder.js';
import { pdfFileName } from '../src/utils/attendanceCardPdf.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

test('0042: رمز ثابت مشتق من سرّ + عضو + epoch، بانتهاء infinity، وتغييره بطلب العضو فقط', () => {
  const sql = strip(read('supabase/migrations/0042_member_card_permanent_token.sql'));
  assert.match(sql, /function public\.member_card_token_for\(p_member uuid, p_epoch integer\)/);
  assert.match(sql, /'infinity'::timestamptz/);
  assert.match(sql, /function public\.regenerate_member_card_token\(\)/);
  assert.match(sql, /v_cnt >= 5/);                               // حدّ إعادة الإنشاء
  assert.match(sql, /epoch = public\.member_card_epoch\.epoch \+ 1/);
  assert.match(sql, /delete from public\.member_card_tokens where member_id = v_id;/); // القديم يتوقف فورًا
  assert.doesNotMatch(sql, /interval '120 seconds'/);
  // الدوال الداخلية لا تُمنح لأحد، والعامة للمصادقين فقط
  assert.match(sql, /revoke all on function public\.member_card_token_for\(uuid, integer\)\s+from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /grant execute on function public\.member_card_token_for/);
  assert.match(sql, /grant execute on function public\.regenerate_member_card_token\(\)\s+to authenticated;/);
  assert.doesNotMatch(sql, /grant execute[^;]*\bto anon\b/);
  // الجدولان مغلقان
  assert.match(sql, /alter table public\.member_card_secret enable row level security/);
  assert.match(sql, /alter table public\.member_card_epoch\s+enable row level security/);
  // الرجوع موجود
  assert.ok(fs.existsSync(new URL('../supabase/rollback/0042_member_card_permanent_token_down.sql', import.meta.url)));
});

test('pdfBuilder: ملف PDF صالح الهيكل (ترويسة، 5 كائنات، xref بإزاحات صحيحة، JPEG مضمَّن كما هو)', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
  const pdf = buildPdfFromJpeg(jpeg, 1240, 1754);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /\/Width 1240 \/Height 1754/);
  // كل إزاحة في xref تشير إلى "n 0 obj"
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(xrefAt).startsWith('xref'));
  const entries = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  assert.equal(entries.length, 5);
  entries.forEach((off, i) => assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `obj ${i + 1}`));
  // بايتات JPEG موجودة كما هي
  assert.ok(Buffer.from(pdf).includes(Buffer.from(jpeg)));
  // طول الـ stream في الكائن 5 يطابق حجم JPEG
  assert.match(text, new RegExp(`/Length ${jpeg.length} >>`));
});

test('pdfBuilder: يرفض ما ليس JPEG أو أبعادًا غير صالحة', () => {
  assert.throws(() => buildPdfFromJpeg(new Uint8Array([1, 2, 3, 4]), 10, 10));
  assert.throws(() => buildPdfFromJpeg(new Uint8Array([0xff, 0xd8, 0, 0]), 0, 10));
});

test('pdfFileName: ASCII فقط ويحمل التاريخ ومقطعًا من معرّف النشاط', () => {
  assert.equal(pdfFileName({ date: '2026-11-20', activity_id: 'abcdef12-0000' }), 'iae-attendance-2026-11-20-abcdef12.pdf');
  assert.match(pdfFileName({ title: 'نشاط' }), /^iae-attendance-card\.pdf$/);
});

test('بطاقات الحضور: تعرض صورة العضو وزر PDF، والبطاقة تُمرَّر بيانات العضو', () => {
  const comp = read('src/components/member/MemberAttendanceCards.jsx');
  assert.match(comp, /export default function MemberAttendanceCards\(\{ member \}\)/);
  assert.match(comp, /member\?\.photo_url/);
  assert.match(comp, /buildAttendancePdf/);
  assert.match(comp, /member\.id\.attendance\.download/);
});
