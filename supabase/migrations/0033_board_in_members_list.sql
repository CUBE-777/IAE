-- ============================================================
-- 0033_board_in_members_list.sql
-- يتيح إظهار أعضاء المكتب أيضًا في صفحة "الأعضاء" العامة، مع تحكم لكل عضو من لوحة الإدارة.
--   show_in_members_list: true (افتراضي) = يظهر عضو المكتب النشط في قائمة الأعضاء بشارة منصبه.
-- إن كان لعضو المكتب member_id يطابق عضوًا ظاهرًا فلا يتكرر: تُضاف الشارة إلى بطاقة العضو.
-- إضافات فقط وآمن لإعادة التشغيل.
-- ============================================================
alter table public.board_members
  add column if not exists show_in_members_list boolean not null default true;

notify pgrst, 'reload schema';
