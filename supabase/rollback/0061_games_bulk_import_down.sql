-- ============================================================
-- 0061_games_bulk_import_down.sql — الرجوع عن Bulk Challenge Import
--
-- يُسقط الـ RPC والفهرس والقيد وعمود import_key. لا يحذف أي تحدٍّ ولا إصدار ولا حلّ (التحديات المستوردة تبقى مسودّات عادية).
-- ⚠️ حذف import_key يفقد ربط التحديات بملفات الاستيراد: إعادة رفع ملف قديم بعد الرجوع ثم إعادة 0061 ستنشئ نسخًا مكررة منها (سيُرفض slug المكرر).
-- آمن لإعادة التشغيل.
-- ============================================================
begin;

drop function if exists public.admin_import_game_challenges(text, jsonb, boolean);
drop index if exists public.uq_game_challenges_import_key;
alter table public.game_challenges drop constraint if exists game_challenges_import_key_len;
alter table public.game_challenges drop column if exists import_key;

notify pgrst, 'reload schema';

commit;
