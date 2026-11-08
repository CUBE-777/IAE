# الأنشطة — بطاقة حضور لكل نشاط وتسجيل الحضور بالمسح من داخل الموقع (migration 0041)
## ماذا
- في **الأنشطة** زر «بطاقة الحضور» لكل نشاط (للأدوار التي تدير المحتوى؛ المستشار للقراءة لا يراه). «نشر بطاقة الحضور» يُظهر لكل عضو نشط في `/member/id` (قسم «بطاقات حضور الأنشطة») رمز QR خاصًّا به **لهذا النشاط وحده**.
- المنظِّم يفتح نفس النافذة ويشغّل الكاميرا: عند المسح تظهر **صورة العضو واسمه** و«تم تسجيل الحضور»، وعند تكرار المسح «مسجّل مسبقًا» مع وقت التسجيل. عدّاد «الحضور: n من total»، وقائمة بحث بالاسم **للتسجيل اليدوي** وإلغاء الحضور (احتياط حين لا تعمل الكاميرا).
- «إغلاق البطاقة» يمنع أي تسجيل جديد؛ «إعادة إصدار الرموز» (أو إعادة النشر بعد الإغلاق) يغيّر رموز الجميع ويُبطل القديمة عند تسرّب رمز.
- نص الرمز **مبهم**: `IAE-` + 22 خانة (لا رابط). كاميرا الهاتف العادية لا تفتح شيئًا ولا تُظهر بيانات؛ المسح الحقيقي من داخل الموقع.
## الأمان
- أربعة جداول مغلقة (`attendance_secret`, `activity_attendance_cards`, `activity_attendance_tokens`, `activity_attendance`): RLS بلا سياسات، الوصول عبر دوال SECURITY DEFINER بمسار بحث ثابت.
- الرمز 128 بت مشتق بسرّ الخادم من (نشاط، عضو، epoch): ثابت فيُعرض ويُطبع، ويخزَّن sha256 فقط. صلاحية البطاقة من النشر حتى الإغلاق أو 48 ساعة. حضور واحد لكل (نشاط، عضو).
- النشر/الإغلاق/المسح/التسجيل اليدوي/التراجع: `can_manage_content()`؛ القوائم: `is_admin()`. حدّ 600 مسحة/10 دقائق لكل مسؤول. نتيجة واحدة `invalid` للمجهول/المغلق/المنتهي. النشر والإغلاق والتراجع في `audit_logs`.
- الكشف عن QR **محلي في المتصفح** (BarcodeDetector)؛ لا تُرفع أي صورة. الكاميرا تتوقف عند الإغلاق أو إخفاء الصفحة.
## تغييرات مقصودة خارج الجداول
- `netlify.toml`: `Permissions-Policy` صار `camera=(self)` (كان `camera=()`) ليعمل الماسح داخل الموقع؛ الإطارات الخارجية ما زالت ممنوعة. تُظهر الاختبارات الجديدة هذا التغيير.
- `src/pages/member/MemberIdCard.jsx`: استُخرج رسم QR إلى `QrImage.jsx` المشترك.
## ترتيب التشغيل والرجوع والحدود
- شغّل `0041_activity_attendance.sql` **بعد 0040** (تجربة جافة أولًا). الرجوع: `supabase/rollback/0041_activity_attendance_down.sql` (يمحو بيانات الحضور).
- ⚠️ المسح بالكاميرا يعتمد `BarcodeDetector` (Chrome على أندرويد؛ غير مدعوم عمومًا في Safari/Firefox). هناك القائمة اليدوية بديلًا. إضافة فاكّ QR بالـ JavaScript (مثل jsQR) تحتاج شبكة للتثبيت ولم تتوفر.
- الرمز ثابت طوال النشاط: يمكن نسخه. الحماية: صورة العضو أمام المنظِّم، حضور واحد، الإبطال بإعادة الإصدار.
- قبل تنفيذ 0041 يخفق استدعاء الأنشطة لعدّاد الحضور بصمت (لا يكسر الصفحة)، ويظهر الخطأ داخل النافذة فقط.
## الملفات
- جديدة: `0041_activity_attendance.sql` وملف رجوعه، `ActivityAttendanceModal.jsx`، `AttendanceScanner.jsx`، `adminAttendance.service.js`، `attendanceCode.js`، `QrImage.jsx`، `MemberAttendanceCards.jsx`، `attendance.css`، واختبارا `activity-attendance-sql` و`attendance-code`.
- معدَّلة: `Activities.jsx` و`MemberIdCard.jsx` و`memberSpace.service.js` وملفات i18n الثلاثة و`adminDict.data.js` و`netlify.toml` و`tests/member-space-ui.test.js`.

---

# فضاء المنخرطين — بطاقة العضوية الرقمية برمز QR متجدد، المرحلة (أ) (migration 0040)
## ماذا
- **تبويب «بطاقة العضوية»** `/member/id`: صورة العضو واسمه «الجامعة · الفوج»، شارة انخراط الموسم الحالي (منخرط / الانخراط غير مجدَّد / غير منخرط / لم يُضبط الموسم)، رمز QR يتجدد كل 90 ثانية (صلاحيته 120) مع عدّ تنازلي نصي، وأزرار «تحديث الآن» و«ملء الشاشة» (طبقة داخل الصفحة تعمل على iOS، مع محاولة Fullscreen API).
- **صفحة عامة** `/verify/:token` يفتحها من يمسح الرمز بكاميرا هاتفه العادية: أخضر (منخرط)، برتقالي (صالح لكن غير منخرط أو الموسم غير مضبوط)، أحمر (غير صالح/منتهٍ) بنص واحد لا يفرّق بين المنتهي والمجهول. لون + أيقونة + نص. تعذّر الاتصال أو rate_limited حالة محايدة (لا تُعلن الرمز غير صالح). زر «مسح رمز آخر» يشرح أن الماسح كاميرا الهاتف.
- **شارة الانخراط** تظهر أيضًا في `MemberHome` (مستقلة عن QR).
## لماذا
إثبات الانتماء وحالة الانخراط بمسح رمز دون صورة ثابتة تُنسخ ودون بيانات شخصية في الرمز: الرمز مؤشّر عشوائي قصير العمر وكل ما يُعرض يُقرأ من القاعدة لحظة المسح.
## الأمان
- جدول `member_card_tokens` مغلق (RLS مفعّل، كل الصلاحيات مسحوبة، بلا سياسات)؛ يُخزَّن sha256 فقط والرمز الخام يُعاد مرة واحدة. 128 بت عشوائية بصيغة base64url.
- `issue_member_card_token()` (authenticated، عضو نشط غير محذوف): 120ث، أقصى 3 رموز فعّالة (الأقدم يُحذف)، حدّ 30/ساعة لكل عضو (`rate_limited`) مع قفل استشاري لكل عضو.
- `verify_member_card(token)` (anon وauthenticated): `{"valid": false}` دائمًا للمجهول/المنتهي/غير النشط/الشكل الخاطئ؛ عند النجاح الحقول العامة فقط (الاسم والصورة والجامعة والفوج والشعبة وموسم/حالة الانخراط) — لا هاتف ولا بريد ولا مدينة ولا معرّف. حدّ 30 محاولة/10 دقائق لكل عميل (بصمة IP بالملح وبادئة `:member-verify:` في جدول 0038، يُعدّ قبل فحص الرمز). الرمز الخام لا يُسجَّل في أي مكان ولا يُخزَّن في المتصفح (لا storage ولا رابط ولا console).
- `get_my_membership_status()` (authenticated): `{season, active, paid_at, has_previous}`.
- `netlify.toml`: لـ `/verify/*` الترويسات `X-Robots-Tag: noindex, nofollow` و`Referrer-Policy: no-referrer` و`Cache-Control: no-store`؛ و`Disallow: /verify/` في robots. `Permissions-Policy` (camera=()) لم يتغيّر. صفحة التحقق لا تمرّ بغلاف الصفحات الداخلية كي لا يُكتب مسارها (وفيه الرمز) في canonical/og:url.
- لا تغيير على أي جدول أو دالة قائمة (0036–0039 كما هي).
## قرارات
- لا `gen_random_bytes`: pgcrypto في Supabase يعيش في مخطط `extensions` وغير مرئي لدالة SECURITY DEFINER بمسار بحث ثابت؛ استُعمل `gen_random_uuid()` + sha256 على سابقة 0014.
- حدّ الإصدار يُعدّ في `member_activation_throttle` ببصمة بالملح لأن جدول الرموز يُحذف منه الأقدم فيصغّر العدّ.
- أُضيف `has_previous` إلى `get_my_membership_status` (لم يكن في النص) ليُفرَّق بين «غير مجدَّد» و«غير منخرط».
- مشفّر QR مدمج `src/utils/qr.js` (bytes، إصدارات 1–10، ECC M) لعدم توفر الشبكة لتثبيت مكتبة؛ تحقّق بسكربتات `scripts/dev/qr-dump.mjs` + `qr-verify.py` (OpenCV) خارج الحزمة.
## ترتيب التشغيل والرجوع والحدود
- شغّل `0040_member_card_tokens.sql` **بعد 0039** (تجربة جافة أولًا: `rollback;` بدل `commit;`). الرجوع: `supabase/rollback/0040_member_card_tokens_down.sql` (يمحو الرموز فقط).
- ⚠️ التجديد كل 90ث ≈ 40 رمزًا/ساعة لصفحة مفتوحة باستمرار أمام حدّ 30/ساعة: تتوقف عن التجديد بعد ~45 دقيقة من العرض المتواصل (تُعرض رسالة وتعاد المحاولة كل دقيقة). الصفحة المخفية لا تجدّد. رفع الحدّ = تعديل الرقم 30 في دالة الإصدار.
- حدّ التحقق لكل IP: شبكة مشتركة (جامعة) تتقاسم 30 محاولة/10 دقائق. الرمز ليس أحادي الاستعمال (يصلح لعدة مسحات خلال 120ث).
- تحقّق من ترويسات `/verify/*` بعد النشر (`curl -I`) لأن دمج Netlify لـ `Referrer-Policy` مع كتلة `/*` لم يُختبر محليًا.
## الملفات
- جديدة: `0040_member_card_tokens.sql` وملف رجوعه، `src/utils/qr.js` و`memberCardToken.js`، `useMemberCardToken.js` و`useMyMembershipStatus.js`، `MembershipBadge.jsx`، `MemberIdCard.jsx`، `VerifyCard.jsx`، `member-card.css`، `scripts/dev/qr-dump.mjs` و`qr-verify.py`، واختبارات `member-card-sql` و`qr` و`member-card-token`.
- معدَّلة: `memberSpace.service.js` والراوتر و`MemberPage.jsx` و`MemberHome.jsx` وملفات i18n الثلاثة (إدراج نصي) و`netlify.toml` و`robots.txt` و`tests/member-space-ui.test.js` و`tests/css-coverage.test.js`.

---

# فضاء المنخرطين — الدفعة السادسة: تلميع `MemberHome` وإتاحة الوصول (بلا تغيير في القاعدة)
- **التبويب في الرابط:** `/member?tab=private` يبقى بعد التحديث ويمكن العودة إليه (`useSearchParams` مع `replace` فلا يملأ سجل المتصفح). تبديل التبويب يمسح الرسالة الظاهرة.
- **رسالة النجاح تزول وحدها بعد 8 ثوانٍ**؛ رسالة الخطأ تبقى حتى يتصرف العضو.
- **مزامنة الهاتف والمدينة** مع ما يعيده الخادم بعد `reload()` (كانا يُقرآن مرة واحدة عند الفتح).
- **تقليل الحركة:** دالة `src/utils/motion.js` (`scrollBehavior()`) تحترم `prefers-reduced-motion` في كل تمرير ببرمجة في صفحات الفضاء (الرسائل، تحذير المغادرة، أعلى الصفحة بعد خطأ)، ومؤشر الاكتمال بلا انتقال عند تفعيلها.
- **أهداف اللمس:** تبويبات التنقل والتبويبات الداخلية بارتفاع ≥ 44px.
- **ما لم يُغيَّر عمدًا:** مؤشر الاكتمال يعدّ «ترجمة فرنسية أو إنجليزية» عنصرًا واحدًا (قرار تصميم سابق: واحدة تكفي)، فلا داعي لفصل اللغتين. وتبويب «بياناتي الخاصة» عنوانه واضح فلم أضف سطرًا زائدًا.
- **تحقق:** رابط بطاقة الإعلان `/announcement/:slug` مسجّل في الراوتر (مع `/announcements/:slug` مرادفًا)، فلا مشكلة في تبويب الإعلانات.
- ملفات جديدة: `src/utils/motion.js`. معدَّلة: `MemberHome.jsx` و`MemberCard.jsx` و`MemberSecurity.jsx` و`MemberActivate.jsx` و`member.css` و`tests/member-completeness.test.js`.

---

# فضاء المنخرطين — الدفعة الخامسة: «طلب مساعدة في الدخول» + إعلانات النادي داخل الفضاء (migration 0039)
## 1) طلب مساعدة في الدخول (بديل عملي للاستعادة بالبريد على الخطة المجانية)
- **العضو:** صفحة عامة `/member/help` (رابط «اطلب مساعدة في الدخول» في صفحة الدخول): يكتب بريده فيصل طلبه للإدارة. الرسالة واحدة مهما كان البريد (لا نكشف هل هو مسجّل)، والرابط لا يُعرض له أبدًا.
- **الإدارة:** زر «طلبات المساعدة في الدخول (n)» في صفحة الأعضاء (للأدوار الأربعة فقط). «إنشاء رابط وإرساله» يفتح أداة الرابط الموجودة (نسخ/واتساب إلى **هاتف العضو المسجّل لدينا**)، وبعد الإصدار يُعلَّم الطلب معالَجًا؛ «تجاهل» يُغلقه. الإجراءان مسجّلان في `audit_logs`.
- **الأمان (0039):** من أدخل بريد غيره لا يحصل على شيء، فالرابط يذهب لوسيلة الاتصال المسجّلة للعضو. جدول `member_access_requests` مغلق (قراءة لمديري نظام الأعضاء فقط)، طلب واحد قيد الانتظار لكل عضو، وحدّ 5 طلبات لكل عميل خلال 10 دقائق (بصمة sha256 بالملح السرّي في جدول 0038) وسقف عام 100 طلب/ساعة. تجاوز الحدّ يرفع `rate_limited` ولا يتعلق بوجود البريد.
- **التشغيل:** شغّل `0038` ثم `0039_member_access_requests.sql`. الرجوع: `supabase/rollback/0039_member_access_requests_down.sql` (يمحو الطلبات فقط). قبل التشغيل يبقى زر الإدارة بلا عدّاد ولا يكسر الصفحة.
- **لا يغني عن SMTP:** إن فُعّل بريد مخصّص لاحقًا تُضاف الاستعادة الذاتية (`/member/forgot` و`/member/reset` مع حارس `PASSWORD_RECOVERY`) ويبقى هذا المسار احتياطًا لمن فقد بريده.
## 2) إعلانات النادي داخل الفضاء
- تبويب «الإعلانات» في `/member/announcements`: نفس الإعلانات المنشورة علنًا (سياسة RLS نفسها، بلا جداول جديدة) مع «عرض المزيد»، وبطاقاتها تفتح صفحة الإعلان.
- **نقطة «إعلانات جديدة»** على التبويب إن وُجد إعلان أحدث مما رآه العضو. الحالة في `localStorage` لهذا المتصفح فقط (أول زيارة لا تُظهر نقطة على إعلانات قديمة؛ فتح التبويب يسجّلها «رُئيت»؛ تعطّل التخزين أو فشل الجلب = لا نقطة). الاستعلام أعمدة `start_at, created_at` لأحدث 20 إعلانًا فقط.
- **قرار:** الإعلانات علنية (لا عمود جمهور في الجدول)؛ إعلانات «للأعضاء فقط» تحتاج عمودًا وسياسة جديدين، وتبقى لدفعة لاحقة إن أُريدت.
## الملفات
- جديدة: `0039_member_access_requests.sql` وملف رجوعه، `MemberHelp.jsx`، `MemberAccessRequestsModal.jsx`، `MemberAnnouncements.jsx`، `useNewAnnouncement.js`، `announcementSeen.js`، و`tests/member-access-requests-sql.test.js` و`tests/announcement-seen.test.js`.
- معدَّلة: `memberSpace.service.js` و`announcements.service.js` و`MemberPage.jsx` و`MemberLogin.jsx` و`Members.jsx` و`MemberActivationModal.jsx` (خاصية `onIssued`) والراوتر و`member.css` وملفات i18n الثلاثة و`adminDict.data.js` و`tests/member-space-ui.test.js`.

---

# أمان: حدّ محاولات تفعيل حساب المنخرط في القاعدة (migration 0038)
- **المشكلة:** الحدّ في `member-activate` كان خريطة في ذاكرة النسخة (`recentCalls`) تُصفَّر مع كل cold start وتتوزع على النسخ، والدالة عامة (`verify_jwt = false`) وتعمل بـ `service_role`.
- **الحل:** `0038_member_activation_throttle.sql`: جدول `member_activation_throttle` مغلق على العملاء (RLS + سحب كل الصلاحيات) ودالة `member_activation_throttle_hit(p_key)` (`SECURITY DEFINER`، لـ `service_role` فقط). 8 محاولات لكل عنوان خلال 10 دقائق (كما كان)، والعنوان لا يُخزَّن خامًا بل `sha256` بالملح السرّي نفسه في `membership_throttle_secret` (0026)، وقفل استشاري يمنع تجاوز الحدّ بطلبات متزامنة، وتنظيف عشوائي للسجلات الأقدم من يوم.
- **`member-activate`:** يسأل القاعدة أولًا. إن فشل الاستدعاء أو كان العنوان مجهولًا (حتى لا يتشارك الجميع دلوًا واحدًا فيُحجبوا) يعود إلى الحدّ المحلي القديم احتياطًا، فلا يتعطل التفعيل بسبب عطل في الحدّ.
- **قرار: لا استعادة ذاتية لكلمة المرور الآن.** المشروع على الخطة المجانية بلا SMTP مخصّص، وخدمة البريد المدمجة في Supabase محدودة جدًا ومخصّصة للتجربة، فلن تصل رسائل الاستعادة لأعضاء حقيقيين. تبقى الاستعادة عبر رابط تصدره الإدارة (0037). تُراجع عند تفعيل SMTP (صفحتا `/member/forgot` و`/member/reset` مع حارس `PASSWORD_RECOVERY`، وإضافة `/member/reset` إلى Redirect URLs).
- **التنفيذ بالترتيب:** شغّل `0038_member_activation_throttle.sql` ثم `supabase functions deploy member-activate --no-verify-jwt`. الرجوع: `supabase/rollback/0038_member_activation_throttle_down.sql` (الدالة الجديدة تعود تلقائيًا للحدّ المحلي).
- **خارج النطاق:** `get_member_activation_link` (RPC عامة لـ anon تفحص صلاحية الرمز من المتصفح) لا تمرّ بـ Edge Function فلا يشملها هذا الحدّ؛ حمايتها عشوائية الرمز (256 بت).
- ملفات جديدة: `supabase/migrations/0038_member_activation_throttle.sql` و`supabase/rollback/0038_member_activation_throttle_down.sql` و`tests/member-activation-throttle.test.js`. معدَّلة: `supabase/functions/member-activate/index.ts`.

---

# تحسين: فضاء المنخرطين — الدفعة الرابعة (سجل الطلبات السابقة)
- **«طلباتي السابقة» في `/member` (تبويب بطاقتي):** قائمة بآخر 5 طلبات تعديل قبل الطلب الأخير (الحالة، تاريخ الإرسال، تاريخ الرد، وملاحظة الإدارة). كان العضو يفقد ملاحظة الرفض بمجرد إرسال طلب جديد لأن `get_my_member` تعيد آخر طلب فقط. يُخفى القسم إن لم توجد طلبات سابقة، وعند فشل التحميل تظهر رسالة مع «إعادة المحاولة»، ويتجدّد السجل عند الإرسال/الإلغاء/المراجعة.
- **بلا migration:** القراءة مباشرة من `member_card_requests` عبر السياسة الموجودة `member_card_requests_own_read` + `grant select` (0036)، مع `.eq('member_id', …)` تحصينًا إضافيًا. لا يُقرأ العمود `data` (قد يبلغ 30KB للطلب) بل أعمدة العرض فقط. تبقى `get_my_member` كما هي، فلا تغيير في القاعدة ولا في Edge Functions.
- **ملاحظة سلوكية:** تعديل طلب «قيد المراجعة» يُحدَّث في مكانه (يصفّر `review_note`) فلا يظهر كطلب سابق؛ السجل يعرض دورات الطلب المنتهية (معتمد/غير معتمد/ملغى) والمعلّق القديم فقط.
- مفاتيح جديدة في ar/fr/en: `member.history.*` (العنوان، النص، الأخطاء، `reviewedAt`، `status.{pending,approved,rejected,cancelled}`).
- ملفات جديدة: `src/utils/memberRequests.js` و`tests/member-requests.test.js`. معدَّلة: `memberSpace.service.js` (`listMyCardRequests`) و`MemberHome.jsx` و`member.css` وملفات i18n الثلاثة و`tests/member-space-ui.test.js`.

---

# تحسين: فضاء المنخرطين — الدفعة الثالثة (الأمان: تغيير كلمة المرور وإنهاء الجلسات)
- **صفحة جديدة `/member/security` («الأمان»):** تغيير كلمة المرور من الفضاء دون انتظار رابط من الإدارة. تُطلب كلمة المرور الحالية وتُعاد المصادقة بها (`signInWithPassword`) قبل `updateUser`، مع مؤشر القوة نفسه المستعمل في التفعيل وخيار «إنهاء جلساتي على الأجهزة الأخرى» (مفعّل افتراضيًا)، وزر مستقل لإنهاء الجلسات الأخرى (`signOut({ scope: 'others' })`؛ تبقى الجلسة الحالية).
- **`MemberLayout`:** من دخل بحساب إداري فعّال يرى رابط «الانتقال إلى لوحة الإدارة» بجانب زر الخروج (لا يُسجَّل خروجه تلقائيًا كما كان).
- **قرار: لا مصادقة ثنائية للأعضاء الآن.** دوال العضو (`current_member_id` وRPCs 0036) لا تفحص مستوى `aal` (على خلاف `current_admin_role`/`is_admin` في 0024)، فتفعيل TOTP من الواجهة لن يُفرض في الخادم ويعطي شعورًا زائفًا بالحماية. إن أُريد لاحقًا فيلزم أولًا فرض `mfa_satisfied()` في `current_member_id()` بـ migration.
- **إعادة هيكلة:** `passwordStrength` وحدود الطول (8..72) انتقلت إلى `src/utils/passwordStrength.js` وتشترك فيها صفحتا التفعيل والأمان.
- مفاتيح جديدة في ar/fr/en: `member.nav.security` و`member.security.*` و`member.home.goAdmin`.
- ملفات جديدة: `src/pages/member/MemberSecurity.jsx` و`src/utils/passwordStrength.js` و`tests/password-strength.test.js`. معدَّلة: `memberSpace.service.js` (`changeMyPassword`, `signOutOtherSessions`) و`MemberPage.jsx` و`MemberLayout.jsx` و`MemberActivate.jsx` وراوتر التطبيق و`tests/member-space-ui.test.js` وملفات i18n الثلاثة. لا تغيير في القاعدة أو الـ Edge Functions.
- ⚠️ للتحقق اليدوي بعد النشر: في Supabase تأكد أن «Secure password change» لا يمنع `updateUser` بعد إعادة المصادقة مباشرة (لا يوجد ما يستلزمه هنا، لكن جرّب بحساب عضو حقيقي).

---

# تحسين: فضاء المنخرطين — الدفعة الثانية (تنظيم «ملفي» وتجربة تعديل البطاقة)
- **ملفي (`MemberHome`):** رأس بصورة العضو واسمه وجامعته ودفعته، وتبويبان «بطاقتي» و«بياناتي الخاصة» (ARIA + تنقل بالأسهم) بدل صفحة واحدة طويلة.
- **مؤشر اكتمال البطاقة:** شريط نسبة وقائمة بما ينقص (صورة، نبذة، مسار، مهنة، رابط تواصل، ترجمة) مع زر «أكمل بطاقتي». الحساب في `src/utils/memberCompleteness.js` (دالة نقية، لا تغيّر القاعدة).
- **معاينة البطاقة:** في «ملفي» (كما تظهر للزوار) وفي «تعديل بطاقتي» مباشرة أثناء الكتابة وباختيار الصورة، بإعادة استخدام `PersonCard`.
- **تعديل البطاقة (`MemberCard`):** عدّاد أحرف تحت النبذة والمسار وحقول الترجمة، وتحذير من المغادرة بتعديلات غير مرسلة (`beforeunload` + `useBlocker` مع لوحة «البقاء/المغادرة»)، وسطر «لديك تعديلات لم تُرسَل».
- **غير مشمول عمدًا:** صفحة «الحساب والأمان» وتغيير كلمة المرور من الفضاء (قرار مؤجَّل)، وسجل الطلبات السابقة (يحتاج تعديل `get_my_member` في القاعدة)، وقص الصورة.
- مفاتيح جديدة في ar/fr/en: `member.home.{tabs,completeness,preview}.*` و`member.card.{previewTitle,previewText,unsaved,leaveTitle,leaveText,leave,stay}`.
- ملفات جديدة: `src/utils/memberCompleteness.js` و`tests/member-completeness.test.js`. معدَّلة: `MemberHome.jsx` و`MemberCard.jsx` و`member.css` وملفات i18n الثلاثة. لا تغيير في القاعدة أو الـ Edge Functions.

---

# تحسين: فضاء المنخرطين — الدفعة الأولى (تجربة الاستخدام)
- **رسائل الحفظ:** في `MemberHome` تُمرَّر الصفحة إلى رسالة النجاح/الخطأ ويُنقل إليها التركيز (كانت أعلى الصفحة بعيدة عن زر الحفظ).
- **إخفاء البطاقة:** خطوة تأكيد داخل الصفحة توضح أن الإظهار من جديد يحتاج اعتماد الإدارة.
- **التفعيل:** دخول تلقائي بعد نجاح `member-activate` ثم الانتقال إلى `/member` (وعند فشله تبقى رسالة النجاح ورابط الدخول)، وزر إظهار كلمة المرور، ومؤشر قوة إرشادي لا يمنع شيئًا.
- **الاكتشاف:** رابط «فضاء المنخرطين» في قائمة «المزيد» (الرئيسية والداخلية) وفي التذييلين. تبقى صفحاته `noindex` وفي `robots.txt`.
- **الجوال:** شريط `member-nav` صار تبويبات مضغوطة في سطر واحد قابلة للتمرير بدل ثلاثة أزرار بعرض كامل.
- مفاتيح جديدة في ar/fr/en: `nav.memberSpace` و`member.home.hide.{confirmTitle,confirmText,confirm,cancel}` و`member.activate.{show,strength*}`.
- ملفات معدَّلة: `MemberHome.jsx` و`MemberActivate.jsx` و`Header.jsx` و`InteriorHeader.jsx` و`Footer.jsx` و`InteriorFooter.jsx` و`member.css` وملفات i18n الثلاثة. لا تغيير في القاعدة أو الـ Edge Functions.

---

# ميزة (المرحلة 4 من نظام الأعضاء): واجهة «فضاء المنخرطين» + صفحة التفعيل + أزرار الإدارة

الواجهة تعتمد على 0036 (القاعدة) و`member-activate`، مع تعديل صغير في 0037 لاستعادة الدخول.
- **المسارات (كلها غير مفهرسة وفي robots.txt):** `/member/login` دخول، `/member/activate/:token` تفعيل الحساب (أو تغيير كلمة المرور إن كان للعضو حساب)،
  `/member` ملفي (بطاقتي المنشورة، حالة آخر طلب، الهاتف والمدينة فورًا، إخفاء بطاقتي فورًا)، `/member/card` اقتراح تعديل البطاقة (صورة، نبذة، مسار، روابط، معلومات إضافية، ترجمات fr/en، المهنة، الموافقة على الظهور).
  الحارس `MemberLayout` يعتمد `get_my_member()` لا الجلسة وحدها؛ من دخل بحساب ليس لعضو (مسؤول مثلًا) يرى رسالة وزر خروج ولا يُسجَّل خروجه تلقائيًا.
  العضو لا يكتب في `members` أبدًا: كل شيء عبر دوال 0036. لغات الواجهة ar/fr/en (مفتاح `member` في ملفات i18n الثلاثة).
- **المهنة** تظهر علنًا (0007) فتمر عبر طلب البطاقة (مراجعة الإدارة) وليس عبر الحفظ الفوري، رغم أن `update_my_member_private` تقبلها.
- **الإدارة (/admin/members):** زر «رابط التفعيل» لكل عضو نشط (نسخ + واتساب بلغة يختارها المسؤول)، وزر «طلبات تعديل البطاقات (عدد)» يفتح المراجعة: فروق عن المنشور، معاينة الصورة، اعتماد (ينشر ويرفع الصورة إلى الـ bucket العام) أو رفض بملاحظة.
  الزران للأدوار الأربعة فقط (`ROLES_MEMBER_SYSTEM`، يطابق `can_manage_member_system()` في 0035 ويفحصه الاختبار)، رغم أن صفحة الأعضاء نفسها تفتح لنواب أيضًا.
- **استعادة الدخول (0037):** يُسمح بإعادة إصدار الرابط لعضو له حساب؛ تبقى هوية مستخدم Auth وربطه بالعضو كما هي وتُغيَّر كلمة مروره فقط (`updateUserById` في `member-activate`)، ويُسجَّل ذلك في `audit_logs`.
  الجلسات المفتوحة سابقًا لا تُنهى عند تغيير كلمة المرور (سلوك Supabase الافتراضي).
- ملفات جديدة: `supabase/migrations/0037_member_reactivation.sql` و`supabase/rollback/0037_member_reactivation_down.sql` و`src/services/supabase/memberSpace.service.js`
  و`src/layouts/MemberLayout.jsx` و`src/components/member/MemberPage.jsx` و`src/pages/member/*` (4 صفحات) و`src/pages/admin/MemberActivationModal.jsx` و`MemberCardRequestsModal.jsx`
  و`src/styles/member.css` و`src/hooks/useNoindex.js` و`tests/member-space-ui.test.js`.
- ملفات معدَّلة: `supabase/functions/member-activate/index.ts` و`router/index.jsx` و`constants/roles.js` و`pages/admin/Members.jsx` وملفات i18n الثلاثة و`adminDict.data.js` (25 نصًا، منها نصّان قديمان كانا بلا ترجمة) و`public/robots.txt`.
- ترتيب النشر: (1) 0036 إن لم تُنفَّذ ثم 0037 (تجربة جافة بـ `rollback;` أولًا)، (2) `supabase functions deploy member-activate`، (3) عطّل «Allow new users to sign up» في Authentication، (4) انشر الواجهة، (5) `rls_smoke.sql`.
- لم تُشغَّل `npm run lint` ولا `vite build` في بيئة التطوير هذه (لا شبكة لتثبيت الحزم): فحصتُ صياغة الملفات الجديدة بـ esbuild وشغّلتُ `node --test` (150 ناجح؛ يفشل 3 قديمة: `.gitignore` و`.env.example` غير موجودين في الأرشيف، و`sanitize` يحتاج dompurify). شغّل `npm run check` عندك قبل النشر.
- المتبقي: بطاقة QR والحضور والأنشطة الخاصة بالأعضاء (المرحلة 5)، ثم الإعلانات والملفات الداخلية للأعضاء (المرحلة 6). لا رابط لفضاء المنخرطين في ترويسة الموقع بعد.

---

# ميزة (المرحلة 3 من نظام الأعضاء): «فضاء المنخرطين» — حسابات الأعضاء بالتفعيل الشخصي وطلبات تعديل البطاقة — القاعدة والخادم فقط

لا تغيير في الواجهة ولا في الموقع الحالي. إضافة صرفة لا تعدّل أي جدول أو دالة أو سياسة موجودة.
- `member_activation_links`: رابط تفعيل شخصي لكل عضو (رمز مُجزَّأ، 7 أيام، يُستعمل مرة واحدة). يُصدره مسؤولو نظام الأعضاء الأربعة فقط.
- `member_card_requests`: طلبات تعديل البطاقة العامة (صورة، نبذة، مسار دراسي، روابط، معلومات إضافية، ترجمات، المهنة، الظهور في الدليل).
  لا يُنشر شيء قبل اعتماد الإدارة (`approve_member_card_request`) أو رفضه (`reject_member_card_request`) مع ملاحظة.
- Edge Function جديدة `member-activate`: تنشئ حساب Auth ببريد العضو المسجّل عند الإدارة (لا بريد من العميل) وبكلمة مرور يختارها بنفسه، ثم تربطه عبر `finalize_member_activation`، وتتراجع عند أي فشل.
- دوال العضو: `get_my_member` / `update_my_member_private` (الهاتف والمدينة والمهنة فورًا + سحب الظهور في الدليل فورًا) / `submit_member_card_request` / `cancel_my_member_card_request`.
  العضو لا يكتب في `members` مباشرة أبدًا؛ `bio` (الخاص بالإدارة) والاسم والبريد خارج ما يستطيع تغييره.
- تخزين: يرفع العضو صورته المقترحة إلى `member-<id>/` في bucket الخاص `membership-docs` (سقف 10 ملفات)، وللإدارة وحدها قراءتها.
ملفات جديدة: `supabase/migrations/0036_member_space_activation_and_card_requests.sql` و`supabase/rollback/0036_member_space_down.sql` و`supabase/functions/member-activate/index.ts` و`tests/member-space-sql.test.js`.
ملفات معدَّلة (إلحاق فقط): `supabase/config.toml` و`CHANGES.md`.
ترتيب النشر: (1) تجربة جافة: استبدل `commit;` الأخيرة بـ `rollback;` في 0036 وشغّله في SQL Editor، (2) أعدها `commit;` ونفّذه فعليًا،
(3) `supabase functions deploy member-activate`، (4) في لوحة Supabase: Authentication → Sign In / Providers → عطّل «Allow new users to sign up»،
(5) شغّل `supabase/tests/rls_smoke.sql` وتأكد أن فحوصه السابقة لا تزال تنجح. لا حاجة لنشر الواجهة في هذه المرحلة.
الرجوع: `supabase/rollback/0036_member_space_down.sql`.
المتبقي (مراحل لاحقة): واجهة `/member/*` وصفحة `/member/activate/:token` وأزرار الإدارة، ثم بطاقة QR والحضور والأنشطة الخاصة بالأعضاء، ثم الإعلانات والملفات الداخلية للأعضاء.

---

# ميزة (المرحلة 2 من نظام الأعضاء): أساس حسابات الأعضاء — قاعدة البيانات فقط

لا تغيير في الواجهة ولا في الموقع الحالي ولا في أي Edge Function. إضافة صرفة في قاعدة البيانات:
- جدول جديد `member_accounts` (ربط 1:1 بين مستخدم Supabase Auth وسجل العضو، خاص: لا كتابة من أي عميل).
- دالة `can_manage_member_system()` — الأدوار الأربعة فقط: super_admin وdeveloper وsecretary_general وmembers_manager (لا نواب).
- دالة `current_member_id()` — هوية العضو الحالي (null لغير الأعضاء ولمن له صف في `profiles`).
- مشغّل حماية على الجدول الجديد فقط: يرفض ربط حساب عضو بمستخدم له `profiles` (فصل الحساب الإداري عن حساب العضو)،
  ويرفض عضوًا محذوفًا، ويجعل الربط غير قابل للتغيير.
- لا يُعدَّل: `profiles` وسياساته، `admin_role`، `is_admin` و`current_admin_role` و`mfa_satisfied` و`can_manage_members`، `members`، `auth.users`.
ملفات جديدة: `supabase/migrations/0035_member_accounts.sql` و`supabase/rollback/0035_member_accounts_down.sql` و`tests/member-accounts-sql.test.js`.
ملفات معدَّلة (إلحاق فقط): `supabase/tests/rls_smoke.sql` (قسم فحوص 0035) و`supabase/README.md` و`CHANGES.md`.
ترتيب النشر: (1) تجربة جافة: استبدل `commit;` الأخيرة بـ `rollback;` في 0035 وشغّله في SQL Editor، (2) أعدها `commit;` ونفّذه فعليًا،
(3) شغّل `supabase/tests/rls_smoke.sql` كاملًا وتأكد من ظهور «فحوص 0035 ... كل الفحوص نجحت ✔»، (4) لا حاجة لنشر الواجهة.
الرجوع: `supabase/rollback/0035_member_accounts_down.sql`.

---

# تعديل: استمارة الانخراط المرسلة عبر الواتساب (`/membership-form/:token`)

- حقل جديد **رقم مسار / أبوجي** (إلزامي، حروف وأرقام فقط) وحقل **لماذا تريد الانضمام إلينا؟** (إلزامي، حتى 1000 حرف).
- «الدفعة / السنة» أصبحت **سنة التخرج** (العمود `promotion` نفسه، تغيير في العنوان فقط).
- **بطاقة الطالب** بدل البطاقة الوطنية، بصورتين: الوجه (`id_card_path`) والظهر (`id_card_back_path`)، كلتاهما إلزامية.
- **قسما المعلومات الشخصية والدراسية إلزاميان بالكامل** (الاسم بالعربية وباللاتينية، البريد، سنة التخرج، رقم مسار/أبوجي، وغيرها) **ما عدا الصورة الشخصية فهي اختيارية** (لا نشر للصورة دون رفعها).
- تُعرض الحقول الجديدة للإدارة في «الطلبات» و«تفاصيل العضو» مع زرّي عرض الوجه والظهر. نص رسالة الواتساب مُحدَّث بالعربية والفرنسية والإنجليزية.
- ملفات جديدة: `supabase/migrations/0034_membership_form_apogee_student_card.sql` و`tests/membership-form-apogee-student-card.test.js`.
- ترتيب النشر: (1) نفّذ 0034 في SQL Editor، (2) ثم انشر الواجهة.

---

# ميزة: دور «مستشار» (consultant)

الصلاحيات: إدارة المشاريع كاملة (إضافة، تعديل، نشر، حذف منطقي، ورفع صور المشاريع فقط) + اطلاع للقراءة فقط على لوحة القيادة والأنشطة
والمعرض والإعلانات وأعضاء المكتب ومحتوى الموقع + اطلاع وتنزيل للملفات الداخلية (بلا رفع ولا حذف).
لا يصل إلى: الأعضاء، طلبات الانخراط، الميزانية، المستخدمين الإداريين، سجل العمليات، الإعدادات.

إضافة صرفة: لا تُعدَّل دوال can_manage_content / can_manage_members / can_access_internal_files / is_admin / is_super_admin،
ولا يتغيّر سلوك أي دور موجود. ملفات جديدة: `supabase/migrations/0032_consultant_role.sql` (دالتان جديدتان can_manage_projects وcan_read_internal_files
وإعادة إنشاء سياسات المشاريع وصور المشاريع والملفات الداخلية وقراءة سجل العمليات بشروطها الأصلية + حالة المستشار).
ملفات معدَّلة: `constants/roles.js` و`adminNav.js` و`router/index.jsx` (مجموعات جديدة ROLES_PROJECTS / ROLES_CONTENT_VIEW / ROLES_INTERNAL_FILES_VIEW)،
`auth.service.js` (ROLE_LABELS)، `admin-create-user/index.ts` (ALLOWED_ROLES)، `AdminUserFormModal.jsx`، ملفات الترجمة وadminDict،
وإخفاء أزرار الإضافة/التعديل/الحذف للمستشار في: Activities وBoard وGallery وAnnouncements وContent وInternalFiles وDashboard.
اختبارات: `tests/roles.test.js` (يتحقق من تطابق الواجهة مع 0032 ومن أن المستشار خارج المجموعات الحساسة).
ترتيب النشر: (1) شغّل 0032 في SQL Editor، (2) أعد نشر الدالة: `supabase functions deploy admin-create-user`، (3) انشر الواجهة،
(4) أنشئ حساب المستشار من «المستخدمون الإداريون» واطلب منه تفعيل المصادقة الثنائية، (5) شغّل rls_smoke.sql.

---

# إصلاح: أزرار قائمة لوحة الإدارة لا تُضغط على الهاتف

السبب: لوحة الإدارة تُحمَّل عند الطلب (lazy)، فكان ملف admin.css يُحقن في الصفحة بعد ملف admin-enhancements.css
ويتغلّب عليه عند تساوي الخصوصية: z-index القائمة الجانبية يصير 40 بدل 70، فتعلوها طبقة الخلفية المعتمة (60)
وتبتلع كل النقرات وتبدو القائمة باهتة.

الإصلاح: استيراد admin.css في src/main.jsx قبل ملفات التحسينات (كل محددات admin.css تخص الإدارة فقط، فلا أثر على الموقع العام).
اختبار جديد: tests/css-order.test.js. انسخ الملفين فوق المشروع ثم انشر.

---

# ميزة: أعضاء المكتب يملؤون ملفاتهم بأنفسهم (رابط شخصي + مراجعة)

ملفات جديدة: `supabase/migrations/0031_board_profile_links.sql`، `src/pages/public/BoardProfileFormPage.jsx`،
`src/pages/admin/BoardProfileLinkModal.jsx`، `src/pages/admin/BoardProfileReviewModal.jsx`،
`src/services/supabase/boardProfile.service.js`، `src/utils/boardProfileDiff.js`، `tests/board-profile-links.test.js`.
ملفات معدَّلة (إضافات فقط): `Board.jsx` (أزرار الرابط والمراجعة)، `router/index.jsx` (مسار `/board-profile/:token`)،
ملفات الترجمة الثلاثة (مفتاح `boardProfile`)، `adminDict.data.js`، `robots.txt`، `rls_smoke.sql`، `tests/css-coverage.test.js`.
ترتيب النشر: (1) شغّل 0031 في SQL Editor، (2) انسخ الملفات فوق المشروع وانشر، (3) شغّل rls_smoke.sql للتأكد.

## فضاء المنخرط — المرحلة 1 (الشكل وتجربة الهاتف)
- `MemberPage` صار غلافًا: رأس مضغوط بدل PageHero، قائمة جانبية على الحاسوب، شريط سفلي ثابت على الهاتف (الرئيسية، بطاقة QR، الإعلانات، المزيد).
- الرئيسية: بطاقة ترحيب تجمع الاسم وحالة الانخراط وزر QR، حلقة اكتمال، وأقسام السجل والإخفاء قابلة للطي.
- ملف جديد `src/styles/member-shell.css`، ومفاتيح ترجمة جديدة في `member.nav` (more, moreLabel, tabsLabel, memberSince).
- لم يُشغَّل بناء/اختبار (لا شبكة لتثبيت الحزم): شغّل `npm run check` ثم جرّب على الهاتف.
