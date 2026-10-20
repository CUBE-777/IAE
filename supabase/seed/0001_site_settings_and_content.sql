-- ============================================================
-- بيانات أولية لـ site_settings و site_content
-- مستخرجة من القيم الثابتة الموجودة حاليًا في index.html
-- (يمكن تعديلها لاحقًا من لوحة الإدارة بدون لمس HTML)
-- ============================================================

insert into public.site_settings (key, value) values
  ('association_name', 'جمعية خريجي ثانوية المرابطين ببيوكرة'),
  ('logo_url', '/logo.jpg'),
  ('email', 'a.laureats.almourabitine@gmail.com'),
  ('phone', '+212679672284'),
  ('whatsapp', '212679672284'),
  ('address', 'الثانوية التأهيلية المرابطين، بيوكرة، اشتوكة آيت باها'),
  ('facebook', ''),
  ('instagram', ''),
  ('youtube', ''),
  ('google_maps_url', '')
on conflict (key) do nothing;

insert into public.site_content (section, key, value) values
  ('homepage', 'hero_title', 'معاً نبني جسرًا بين الأجيال، من مقاعد الدراسة إلى ميدان العطاء'),
  ('homepage', 'about_title', 'قصة جيل يعود'),
  ('footer', 'copyright', '© 2026 جمعية خريجي ثانوية المرابطين. جميع الحقوق محفوظة.')
on conflict (section, key) do nothing;
