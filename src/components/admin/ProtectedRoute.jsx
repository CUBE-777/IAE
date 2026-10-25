import { useEffect, useRef } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../app/providers/AuthProvider';
import ForcePasswordChange from './ForcePasswordChange';

/**
 * يطابق سلوك Auth.requireAuth(allowedRoles) الأصلي:
 * - لا جلسة → إعادة توجيه إلى /admin/login
 * - جلسة بلا profile نشط → تسجيل خروج (داخل useEffect، لا أثناء render) وإعادة
 *   توجيه مع reason=inactive
 * - profile موجود لكن دوره غير مسموح → رسالة "غير مصرح لك بالوصول" (بدل تحويل)
 */
export default function ProtectedRoute({ roles, children }) {
  const { t } = useTranslation();
  const { status, session, profile, profileError, mfaRequired, logout, refresh } = useAuth();
  const location = useLocation();
  const inactive = status === 'authenticated' && !profileError && (!profile || !profile.is_active);
  const loggedOutRef = useRef(false);

  // Side effect (signOut) خارج render: يُنفَّذ مرة واحدة فقط حتى تحت StrictMode
  useEffect(() => {
    if (!inactive || loggedOutRef.current) return;
    loggedOutRef.current = true;
    logout().catch((err) => console.error('تعذر تسجيل خروج الحساب غير النشط:', err));
  }, [inactive, logout]);

  // أعد تفعيل الحارس إن عاد المستخدم لحالة نشطة (مثلًا بعد تسجيل دخول جديد)
  useEffect(() => {
    if (!inactive) loggedOutRef.current = false;
  }, [inactive]);

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted, var(--muted))' }}>
        {t('admin.errors.verifyingSession')}
      </div>
    );
  }

  // فشل مؤقت في جلب الملف الشخصي (شبكة/خادم): لا نُخرج المستخدم، نعرض إعادة المحاولة
  if (status === 'authenticated' && profileError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, color: 'var(--admin-text, inherit)' }}>
        <div>
          <p style={{ marginBottom: 16 }}>{t('admin.errors.sessionRetryMessage', 'تعذر التحقق من الجلسة بسبب مشكلة اتصال. حاول مرة أخرى.')}</p>
          <button type="button" className="btn" onClick={() => refresh()}>
            {t('admin.errors.sessionRetry', 'إعادة المحاولة')}
          </button>
        </div>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  // مصادقة ثنائية مفعّلة لكن الرمز لم يُدخل بعد: شاشة الرمز في صفحة الدخول
  if (status === 'authenticated' && mfaRequired) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  if (inactive) {
    return <Navigate to="/admin/login?reason=inactive" replace />;
  }

  // حساب أُنشئ بكلمة مرور مؤقتة: لا دخول للوحة قبل اختيار كلمة مرور خاصة
  if (session?.user?.user_metadata?.must_change_password === true) {
    return <ForcePasswordChange />;
  }

  if (Array.isArray(roles) && roles.length && !roles.includes(profile.role)) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "var(--font-body)",
          textAlign: 'center',
          padding: 24,
          background: 'var(--admin-bg)',
          color: 'var(--admin-text)',
        }}
      >
        <div>
          <h1 style={{ marginBottom: 12 }}>{t('admin.errors.forbiddenTitle')}</h1>
          <p style={{ color: 'var(--admin-text-muted, var(--muted))', marginBottom: 20 }}>{t('admin.errors.forbiddenMessage')}</p>
          <Link to="/admin/dashboard" style={{ color: 'var(--admin-accent)', fontWeight: 700 }}>
            {t('admin.errors.backToDashboard')}
          </Link>
        </div>
      </div>
    );
  }

  return children;
}
