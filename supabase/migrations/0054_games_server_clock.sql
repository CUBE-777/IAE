-- ============================================================
-- 0054_games_server_clock.sql — ساعة الخادم المرجعية للعدّاد (IAE Games) — المرحلة 5: دالة قراءة واحدة
--
-- لماذا؟ (0049/0050/0052/0053 مطبّقة ولا تُعدَّل)
--   عدّاد التحدي في الواجهة للعرض فقط، لكنه يحتاج مرجعًا زمنيًا من الخادم كي لا يتأثر بانحراف ساعة الجهاز:
--     * عند بدء محاولة جديدة تُرجع start_game_attempt() الحقل started_at (= الآن على الخادم) فيمكن تقدير الانحراف منه.
--     * عند استئناف محاولة جارية تُرجع started_at القديم (وقت البدء الأصلي) ولا شيء يدلّ على «الآن» عند الخادم،
--       فكانت الواجهة تفترض انحرافًا صفرًا وتعتمد على ساعة الجهاز وحدها.
--   هذه الدالة تُرجع «الآن» عند الخادم فقط، فتقيس الواجهة الانحراف بالطريقة نفسها في الحالتين (منتصف زمن الذهاب والإياب).
--
-- ما لا تغيّره: منطق احتساب الوقت والنتائج والنقاط في start_game_attempt / submit_game_attempt (يبقى now() على الخادم هو الحَكَم).
-- الدالة قراءة فقط، لا تمسّ جدولًا ولا تكشف حلًّا ولا إجابة ولا بيانات لاعب. الأصل: الرفض (can_access_games()).
-- الواجهة تتراجع بأمان إلى التقدير القديم إن لم تُطبَّق هذه الـ Migration بعد، فلا ترتبط الواجهة بها ارتباطًا صلبًا.
--
-- يتطلب: 0049. آمن لإعادة التشغيل (create or replace). الرجوع: supabase/rollback/0054_games_server_clock_down.sql
-- ⚠️ تجربة جافة أولًا: استبدل `commit;` الأخيرة بـ `rollback;` ثم شغّل الملف، وإن نجح أعدها `commit;`.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.can_access_games()') is null then
    raise exception 'شغّل 0049_games_access.sql أولاً';
  end if;
end $$;

-- now() = بداية المعاملة، وهي نفس القيمة التي تقارن بها start_game_attempt / submit_game_attempt الانتهاء (expires_at).
create or replace function public.get_game_server_time()
returns timestamptz
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.can_access_games() then
    raise exception 'games_access_denied' using errcode = '42501';
  end if;
  return now();
end;
$$;

revoke all on function public.get_game_server_time() from public, anon, authenticated;
grant execute on function public.get_game_server_time() to authenticated;

notify pgrst, 'reload schema';

commit;
