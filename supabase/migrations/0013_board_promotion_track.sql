-- ============================================================
-- 0013_board_promotion_track.sql
-- يضيف سنة التخرج (promotion) والتخصص (track) إلى board_members.
-- نموذج المكتب في لوحة الإدارة يستعملهما، ولا يوجد في المشروع ملف يضيفهما
-- (الترقيم يقفز من 0012 إلى 0014، وهذا هو الملف المفقود على الأرجح).
-- إضافات فقط وآمن لإعادة التشغيل (idempotent).
-- ============================================================

alter table public.board_members
  add column if not exists promotion text,
  add column if not exists track     text;

alter table public.board_members
  drop constraint if exists board_members_promotion_len_chk,
  drop constraint if exists board_members_track_len_chk;

-- الحدان يطابقان maxLength في النموذج (60 و200)
alter table public.board_members
  add constraint board_members_promotion_len_chk check (promotion is null or char_length(promotion) <= 60),
  add constraint board_members_track_len_chk     check (track is null or char_length(track) <= 200);

notify pgrst, 'reload schema';
