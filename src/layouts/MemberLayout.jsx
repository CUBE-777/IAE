import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import InteriorLayout from './InteriorLayout';
import MemberAuthShell from '../components/member/MemberAuthShell';
import MemberSkeleton from '../components/member/MemberSkeleton';
import { useAuth } from '../app/providers/AuthProvider';
import ForcePasswordChange from '../components/admin/ForcePasswordChange';
import { getMyMember } from '../services/supabase/memberSpace.service';
import { getMyBoardCard } from '../services/supabase/boardCard.service';
import '../styles/membership-flow.css';
import '../styles/member.css';

/**
 * حارس فضاء المنخرطين (/member/*): جلسة + حساب عضو نشط (get_my_member لا تعيد شيئًا لغير الأعضاء).
 * لا نُسجّل خروج من لا يملك حساب عضو (قد يكون مسؤولًا دخل بالخطأ)، بل نعرض له رسالة وزر خروج.
 * الصفحات الفرعية تستقبل { member, reload, hasBoardCard } عبر useOutletContext.
 * حساب مزدوج (إداري + منخرط، 0046) بكلمة مرور مؤقتة: تُعرض شاشة تغيير كلمة المرور أولًا (الخادم لا يمنحه هوية عضو قبلها).
 */
export default function MemberLayout() {
  const { t } = useTranslation();
  const { status, session, profile, logout } = useAuth();
  const location = useLocation();
  const userId = session?.user?.id || null;
  const [state, setState] = useState({ phase: 'loading', member: null, hasBoardCard: false });
  const mustChangePassword = profile?.must_change_password === true;

  const load = useCallback(async () => {
    try {
      const member = await getMyMember();
      // بطاقة المكتب ميزة إضافية: فشلها لا يمنع فتح الفضاء، بل يُخفي رابطها فقط
      const card = member ? await getMyBoardCard().catch(() => null) : null;
      setState({ phase: member ? 'ready' : 'notMember', member, hasBoardCard: !!card });
    } catch (err) {
      console.error('member load failed', err);
      setState((prev) => ({ phase: prev.member ? 'ready' : 'error', member: prev.member, hasBoardCard: prev.hasBoardCard }));
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && !mustChangePassword) {
      setState({ phase: 'loading', member: null, hasBoardCard: false });
      load();
    }
  }, [status, userId, load, mustChangePassword]);

  if (status === 'anonymous') return <Navigate to="/member/login" state={{ from: location }} replace />;
  if (status === 'authenticated' && mustChangePassword) return <ForcePasswordChange />;

  let body;
  if (status === 'loading' || state.phase === 'loading') {
    body = <MemberSkeleton />;
  } else if (state.phase === 'error') {
    body = (
      <MemberAuthShell title={t('member.home.loadErrorTitle')} description={t('member.home.loadErrorText')}>
        <button type="button" className="btn btn-gold ma-submit" onClick={() => { setState({ phase: 'loading', member: null, hasBoardCard: false }); load(); }}>{t('member.home.retry')}</button>
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
    body = <Outlet context={{ member: state.member, reload: load, hasBoardCard: state.hasBoardCard }} />;
  }

  return <InteriorLayout>{body}</InteriorLayout>;
}
