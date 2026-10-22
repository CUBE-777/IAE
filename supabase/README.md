# Supabase — Phase 1: قاعدة البيانات

## طريقة التشغيل

### الخيار أ — عبر SQL Editor في لوحة Supabase (الأسهل)
1. افتح مشروعك في supabase.com → SQL Editor.
2. نفّذ الملفات **بالترتيب** من `migrations/`:
   - `0001_extensions_and_types.sql`
   - `0002_tables.sql`
   - `0003_rls_policies.sql`
   - `0004_functions_and_triggers.sql`
   - `0005_storage.sql`
3. (اختياري) نفّذ `seed/0001_site_settings_and_content.sql` لإدخال القيم الأولية.
4. نفّذ ملفات التحصين الأمني **بالترتيب** (أُضيفت في مراجعة أمنية شاملة):
   - `0006_security_hardening.sql` — يصلح ثغرة انتحال reviewer_id في دوال قبول/رفض طلبات الانخراط، ويثبّت search_path على كل دوال SECURITY DEFINER.
   - `0007_member_privacy.sql` — **حرج**: يمنع الزوار (anon) من قراءة email/phone/age/city للأعضاء عبر تقييد صلاحيات الأعمدة (column-level GRANT)، بينما تبقى صلاحيات الإدارة كاملة.
   - `0008_constraints_and_hardening.sql` — تحقق إضافي (email format، أطوال الحقول)، حماية من تكرار طلبات الانخراط، ومنع تعديل audit_logs.

### الخيار ب — عبر Supabase CLI
```bash
supabase link --project-ref <PROJECT_REF>
supabase db push
```

## Edge Function: إنشاء مسؤولين جدد بأمان
بدل نسخ UUID يدويًا من لوحة Supabase، أضفنا `supabase/functions/admin-create-user`
الذي ينشئ حساب Auth + صف profiles في عملية واحدة على الخادم (service_role
لا يغادر بيئة الـ Edge Function أبدًا). انشره بعد ربط المشروع:

```bash
supabase functions deploy admin-create-user
```

لا حاجة لضبط أي متغير بيئة يدويًا: `SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY`
و `SUPABASE_ANON_KEY` متاحة تلقائيًا لكل Edge Function في مشروعك.
بعد النشر، زر "إنشاء مسؤول جديد" في admin/admins.html يعمل مباشرة (متاح فقط
لمن يحمل دور super_admin).

## بعد التشغيل — أنشئ أول Super Admin يدويًا
Supabase Auth لا يُنشئ صف `profiles` تلقائيًا، نفّذ بعد إنشاء أول مستخدم من تبويب Authentication:

```sql
insert into public.profiles (id, full_name, email, role)
values ('<AUTH_USER_UUID>', 'اسمك الكامل', 'admin@example.com', 'super_admin');
```

## ما بعد ذلك
أعطني `SUPABASE_URL` و `SUPABASE_ANON_KEY` (Settings → API) لأبدأ **Phase 2: ربط الموقع بـ Supabase Client**.
لا تشاركني أبدًا `service_role key`.

## 0014 — مسار الانخراط (طلب ← نموذج ← انخراط سنوي)
شروطه المسبقة: 0009 و0010 و0012. بعد تنفيذه اضبط من «الإعدادات»: مبلغ الانخراط السنوي والموسم الجامعي الحالي.

## 0015 — colonnes de traductions (remplace la « 0013 » jamais livrée)
Prérequis : 0001 à 0012. Ajoute `translations jsonb` à `activities`, `gallery`, `site_settings` et `site_content` (idempotent, aucun droit élargi). À exécuter pour que les traductions FR/EN saisies dans l'administration soient enregistrées ; sans elle, seul le texte arabe est sauvegardé. La numérotation 0013 reste inutilisée.

## 0016 — projets du club (Phase 1)
Prérequis : 0001 à 0012 (rôles, `audit_logs`, `set_updated_at`). Indépendante de 0015. Crée la table `projects` (RLS : lecture publique des projets publiés ; écriture `can_manage_content()` ; pas de suppression physique) et un trigger d'audit. Idempotente.
