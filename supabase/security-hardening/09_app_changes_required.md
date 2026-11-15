# تعديلات مطلوبة خارج SQL (Edge Function / React) — لم تُنفَّذ

لم أعدّل أي ملف من المشروع. هذه التعديلات تحتاج مراجعتكم ونشرًا منفصلًا.

## 1. `supabase/functions/admin-create-user/index.ts` — أولوية عالية
**المشكلة:** تعمل بـ `service_role` فلا تعترضها triggers القاعدة (`auth.uid()` = null). تمنع منح `developer` لغير المطوّر (سطر ~164) لكنها تسمح لـ `super_admin` بإنشاء حساب `super_admin`، وهذا يخالف التسلسل المعتمد.
**التعديل:** بعد فحص `developer` مباشرة:
```ts
if ((role === 'developer' || role === 'super_admin') && callerProfile.role !== 'developer') {
  return json({ error: 'فقط المطوّر يستطيع منح هذا الدور' }, 403);
}
```
وبالمثل أي مسار في الدالة يربط مستخدمًا موجودًا (الحساب المزدوج) بدور `super_admin`.

## 2. `src/pages/admin/AdminUsers.jsx` — واجهة
السطر ~143 يخفي أزرار التعديل عن صفوف `developer` لغير المطوّر. أضف الشرط نفسه لصفوف `super_admin`، وأخفِ خيار `super_admin` من قائمة الأدوار لغير المطوّر (القاعدة سترفض على أي حال بعد `02`، لكن الواجهة يجب ألا تعرض ما سيفشل).

## 3. صور الأعضاء (خطة، قرار منكم)
أ. **حذف الملف عند الحذف/الانسحاب:** عند حذف عضو منطقيًا أو ضبط `show_in_directory = false` استدعِ `deleteImageByUrl(photo_url)` ثم صفّر `photo_url` (حاليًا لا يحدث، فتبقى الصورة متاحة برابطها).
ب. **حماية كاملة:** bucket خاص جديد للصور الشخصية (`members-private`) مع signed URLs قصيرة العمر، وتعديل ما يعرض الصورة (دليل الأعضاء، بطاقة العضو، `verify_member_card`، `MemberIdCard`). تحتاج ترحيل ملفات وتحديث الروابط — لا تُنفَّذ دون خطة متوافقة مع الكود.
ج. مراجعة `approve_member_card_request` التي تقبل أي رابط https كـ `photo_url` (معلوماتي).

## 4. دعوات الأنشطة (قرار إداري)
تحديد مدة صلاحية الرابط بعد موعد النشاط (مثلاً 30 يومًا) مع فترة سماح للروابط الحالية، ثم تعديل `get_invitation` و`respond_invitation`. لا يُطبَّق دون قرار لأنه يُبطل الروابط المرسلة.

## 5. اختبار `supabase/tests/rls_smoke.sql`
يستعمل `if public.can_manage_members() then raise ...` وهذا يمرّ مع NULL. استبدلها بـ `is distinct from false` كما في `07_post_checks.sql` (المجموعة A).
