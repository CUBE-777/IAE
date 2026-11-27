# عامل بريد الشهادات (Certificate Email Worker)

Edge Function: `supabase/functions/certificate-email-worker` — يرسل رسائل الشهادات من طابور `certificate_email_queue` عبر Resend.
الرسالة تحمل رابط التحقق `/verify-certificate/:token` فقط (لا PDF ولا مرفقات). **لا يعمل تلقائيًا**: يلزم نشره وضبط الأسرار وجدولة خارجية.

## 1) ما يجب تطبيقه يدويًا (بالترتيب)
1. تأكد أن 0063 و0064 و0065 مطبّقة. ثم طبّق `supabase/migrations/0066_certificate_email_worker_guard.sql` (جرّبه أولًا بتبديل `commit;` الأخيرة إلى `rollback;`).
   - يضيف التحقق من هوية العامل (`claimed_by`) إلى `certificate_email_recheck` و`certificate_email_complete`، ويحذف التوقيعين القديمين.
   - الرجوع: `supabase/rollback/0066_certificate_email_worker_guard_down.sql`.
2. اضبط الأسرار:
   ```
   supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="IAE <noreply@your-domain.org>" \
     SITE_URL=https://fsa-iae.netlify.app CERTIFICATE_EMAIL_WORKER_SECRET=$(openssl rand -hex 32)
   ```
   `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` يحقنهما Supabase تلقائيًا. نطاق `MAIL_FROM` يجب أن يكون موثّقًا في Resend.
3. انشر: `supabase functions deploy certificate-email-worker --no-verify-jwt`
4. اختبر يدويًا (راجع §3) ثم فعّل الجدولة.

## 2) الجدولة (Cron خارجي)
استدعِ كل 5 دقائق مثلًا (GitHub Actions أو cron-job.org أو pg_cron + pg_net):
```
curl -sS -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/certificate-email-worker" \
  -H "x-worker-secret: $CERTIFICATE_EMAIL_WORKER_SECRET" -H "content-type: application/json" -d '{"max_jobs":10}'
```
- خزّن السرّ في secrets مزوّد الجدولة فقط، لا في المستودع.
- كل تشغيل يعالج حتى `max_jobs` (الافتراضي 10، السقف 25) ضمن ميزانية 50 ثانية وبفاصل ~0.6 ثانية بين الرسائل (حدّ Resend). يُرجع أعدادًا فقط.
- يستدعي `certificate_email_release_stale(15)` في بداية كل تشغيل: المهمة العالقة في `sending` تصبح `failed (stale_sending)` ولا تُعاد تلقائيًا (تفاديًا للتكرار)؛ يعيدها المسؤول بـ `certificate_retry_email`.

## 3) اختبار حقيقي قبل الاعتماد
جدولة شهادة واحدة صالحة ببريدك من صفحة الحملة، ثم استدعِ العامل بـ curl أعلاه؛ الاستجابة المتوقعة `{"ok":true,"sent":1,...}`، وتحقق من وصول الرسالة وفتح الرابط.
أي استجابة: `401` سرّ خاطئ، `503` إعداد ناقص (لا تُحجز مهام)، `405` غير POST.

## 4) حدود معروفة
- إن أُلغيت الشهادة بعد `recheck` وقبل وصول طلب Resend قد تصل الرسالة؛ الرابط يعرض «ملغاة».
- انتهاء مهلة Resend بعد إرسال فعلي قد يؤدي إلى إعادة إرسال في المحاولة التالية (لا idempotency key عن قصد، لأن إعادة المحاولة الإدارية تعيد المحاولات إلى 0).
- نجاح Resend ثم فشل `complete` يترك المهمة `sending` حتى تُحرَّر.
