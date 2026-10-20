import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// راجع /mnt/skills أو README.md للتفاصيل. لا تضع أي مفاتيح سرية (service_role) هنا؛
// فقط مفتاح Supabase publishable (آمن للعرض في المتصفح) يُقرأ من .env عبر import.meta.env.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
