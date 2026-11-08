import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import InteriorLayout from './InteriorLayout';
import MemberAuthShell from '../components/member/MemberAuthShell';
import MemberSkeleton from '../components/member/MemberSkeleton';
import { useAuth } from '../app/providers/AuthProvider';
import { getMyMember } from '../services/supabase/memberSpace.service';
import '../styles/membership-flow.css';
import '../styles/member.css';

/**
 * حارس فضاء المنخرطين (/member/*): جلسة + حساب عضو نشط (get_my_member لا تعيد شيئًا لغير الأعضاء).
 * لا نُسجّل خروج من لا يملك حساب عضو (قد يكون مسؤولًا دخل بالخطأ)، بل نعرض له رسالة وزر خروج.
 * الصفحات الفرعية تستقبل { member, reload } عبر useOutletContext.
 */
export default function MemberLayout() {
  const { t } = useTranslation();
  const { status, session, profile, logout } = useAuth();
  const location = useLocation();
  const userId = session?.user?.id || null;
  const [state, setState] = useState({ phase: 'loading', member: null });

  const load = useCallback(async () => {
    try {
      const member = await getMyMember();
      setState({ phase: member ? 'ready' : 'notMember', member });
    } catch (err) {
      console.error('member load failed', err);
      setState((prev) => ({ phase: prev.member ? 'ready' : 'error', member: prev.member }));
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      setState({ phase: 'loading', member: null });
      load();
    }
  }, [status, userId, load]);

  if (status === 'anonymous') return <Navigate to="/member/login" state={{ from: location }} replace />;

  let body;
  if (status === 'loading' || state.phase === 'loading') {
    body = <MemberSkeleton />;
  } else if (state.phase === 'error') {
    body = (
      <MemberAuthShell title={t('member.home.loadErrorTitle')} description={t('member.home.loadErrorText')}>
        <button type="button" className="btn btn-gold ma-submit" onClick={() => { setState({ phase: 'loading', member: null }); load(); }}>{t('member.home.retry')}</button>
      </MemberAuthShell>
    );
  } else if (state.phase === 'notMember') {
    body = (
      <MemberAuthShell title={t('member.home.notMemberTitle')} description={t('member.home.notMemberText')}>
        <div className="ma-form">
          {profile?.is_active && <Link className="btn btn-ghost ma-submit" to="/admin/dashboard">{t('member.home.goAdmin')}</Link>}
          <button type="button" className="btn btn-gold ma-submit" onClick={() => logout()}>{t('member.nav.logout')}</button>
        </div>
      </MemberAuthShell>
    );
  } else {
    body = <Outlet context={{ member: state.member, reload: load }} />;
  }

  return <InteriorLayout>{body}</InteriorLayout>;
}
