# IAE Games — إعادة التصميم (CHANGES)

## الاستبدال
فك الضغط فوق جذر المشروع واستبدل الملفات بنفس المسارات. لا Migrations ولا تغيير في SQL/RPC/RLS/Edge/Auth/خدمات Supabase.

## ملفات جديدة
- `src/features/games/player/components/GameIcon.jsx` — أيقونة SVG مميزة لكل لعبة (lucide + خلفية SVG بثلاثة أنماط ونبرات)، تُختار حتميًا من slug/عنوان/تصنيف اللعبة.
- `src/features/games/player/components/GamifiedUi.jsx` — لوحة اللاعب (حلقة المستوى/XP)، بطاقة اللعبة، شريط التقدم.
- `src/styles/games-gamified.css`

## ملفات معدّلة
- اللاعبون: `pages/GamesHome.jsx`، `pages/GameDetails.jsx`، `pages/ChallengePlay.jsx` (أيقونة في الرأس فقط)، `player/components/PlayerUi.jsx` (حالات بطاقة التحدي: جديد/جارٍ/محلول)، `layout/GamesLayout.jsx` (استيراد CSS).
- الإدارة: `admin/builder/ChallengeBuilder.jsx` (4 خطوات + الجدولة بدء/انتهاء)، `admin/pages/ChallengesTab.jsx` (محرر واحد، بحث، تصفية بالحالة وعدّادات؛ حُذف نموذج JSON الخام)، `admin/pages/GamesTab.jsx` (أيقونة اللعبة)، `admin/pages/GamesAdmin.jsx` (استيراد CSS)، `styles/games-admin.css`.
- الترجمة: `src/i18n/locales/{ar,en,fr}.json` (مفاتيح مضافة فقط).
- الاختبار: `tests/games-final-integration.test.js` — اختبار 6.6 كان يتحقق من النموذج القديم المحذوف، فحُدّث ليتحقق أن القائمة تفتح ChallengeBuilder فقط.

## ما لم يُمسّ
Bulk Import، الأنواع السبعة، منطق الإصدارات/النشر/الأرشفة، تسجيل المحاولات والنقاط، صفحات المسارات/المراحل/الملف الشخصي/المتصدرين (تستفيد من الـ CSS فقط).

## التحقق الفعلي
- ESLint (قواعد المشروع الأساسية دون ملحقات React): لا أخطاء جديدة؛ `node --test`: 362/366 ناجح؛ الفاشلة 3 بيئية (`.gitignore` غير موجود في الأرشيف، وsanitize يحتاج تبعيات) + 1 حُدّث أعلاه (وينجح الآن).
- **لم يُشغَّل `vite build` ولا فُحص بصريًا في متصفح** (لا node_modules ولا شبكة في بيئة العمل). شغّل `npm run check` وراجع الصفحات في AR/FR/EN والوضعين قبل النشر.
