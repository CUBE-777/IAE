import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import './i18n';
import './utils/notifications';
import './styles/global.css';
import { router } from './app/router';
import { AuthProvider } from './app/providers/AuthProvider';
// آخر استيراد دائمًا: تحسينات تتقدّم على الأنماط الأصلية عند تساوي الخصوصية
import './styles/enhancements.css';
import './styles/admin-enhancements.css';
import './styles/theme.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>
);
