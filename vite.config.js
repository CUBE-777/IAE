import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// راجع README.md للتفاصيل. لا تضع أي مفاتيح سرية (service_role) هنا؛
// فقط مفتاح Supabase publishable (آمن للعرض في المتصفح) يُقرأ من .env عبر import.meta.env.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // لا خرائط مصدر في الإنتاج (كانت تكشف الكود المصدري كاملاً للزوار).
    sourcemap: false,
    rollupOptions: {
      output: {
        // فصل المكتبات الثقيلة والنادرة التغيّر في ملفات مستقلة: تبقى في كاش المتصفح بين النشرات
        // (تغيير سطر في كود الموقع لا يُبطل تخزين React وSupabase عند الزوار).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|@remix-run|scheduler)\//.test(id)) return 'vendor-react';
          if (id.includes('node_modules/@supabase/')) return 'vendor-supabase';
          if (id.includes('i18next')) return 'vendor-i18n';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
