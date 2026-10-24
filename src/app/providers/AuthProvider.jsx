import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../../services/supabase/client';
import { getSession, getProfile, login as loginRequest, logout as logoutRequest } from '../../services/supabase/auth.service';

const AuthContext = createContext(null);

/**
 * src/app/providers/AuthProvider.jsx
 * بديل React لـ js/auth.js: يحمّل الجلسة والـ profile مرة واحدة عند إقلاع
 * التطبيق، ويستمع لتغيّرات الجلسة (onAuthStateChange) بدل تكرار
 * Auth.requireAuth() في رأس كل صفحة إدارية كما كان في المشروع الأصلي.
 * status: 'loading' | 'authenticated' | 'anonymous'
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', session: null, profile: null, profileError: false });

  const refresh = useCallback(async () => {
    try {
      const session = await getSession();
      if (!session) {
        setState({ status: 'anonymous', session: null, profile: null, profileError: false });
        return;
      }
      const profile = await getProfile();
      setState({ status: 'authenticated', session, profile, profileError: false });
    } catch (err) {
      // فشل مؤقت (شبكة/خادم): لا نُسجّل الخروج. نُبقي آخر profile معروف إن وُجد، وإلا نعلّم الخطأ
      // ليعرض ProtectedRoute زر "إعادة المحاولة" بدل إخراج المستخدم.
      console.error('تعذر تحديث الجلسة/الملف الشخصي:', err);
      setState((prev) =>
        prev.profile
          ? { ...prev, profileError: false }
          : { status: 'authenticated', session: prev.session, profile: null, profileError: true },
      );
    }
  }, []);

  useEffect(() => {
    refresh();
    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => subscription.subscription.unsubscribe();
  }, [refresh]);

  const login = async (email, password) => {
    await loginRequest(email, password);
    await refresh();
  };

  const logout = async () => {
    await logoutRequest();
    setState({ status: 'anonymous', session: null, profile: null, profileError: false });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth يجب أن يُستخدم داخل <AuthProvider>');
  return ctx;
}
