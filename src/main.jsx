import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import './i18n';
import './utils/notifications';
import './styles/global.css';
import { router } from './app/router';
import { AuthProvider } from './app/providers/AuthProvider';
import AppErrorBoundary from './components/common/AppErrorBoundary';
// admin.css هنا (قبل ملفات التحسينات) لا في AdminLayout وحده: لوحة الإدارة تُحمَّل عند الطلب (lazy)،
// فكان ملفها يُحقن في الصفحة بعد ملفات التحسينات ويتغلّب عليها عند تساوي الخصوصية، فيهبط z-index الدرج الجوّال
// (40 بدل 70) وتعلوه طبقة الخلفية فلا تُقبل أي نقرة على قائمة الإدارة. كل محددات admin.css تبدأ بـ admin
// فلا أثر لها على الموقع العام. (يفرض ترتيبها tests/css-order.test.js)
import './styles/admin.css';
// آخر استيراد دائمًا: تحسينات تتقدّم على الأنماط الأصلية عند تساوي الخصوصية
import './styles/enhancements.css';
import './styles/admin-enhancements.css';
import './styles/theme.css';
import './styles/nav-responsive.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </AppErrorBoundary>
  </StrictMode>
);
