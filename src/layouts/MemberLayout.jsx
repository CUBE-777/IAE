import { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import InteriorLayout from './InteriorLayout';
import PageHero from '../components/layout/PageHero';
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
  const { status, session, logout } = useAuth();
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
    body = <section className="mf-section"><div className="container"><p className="mf-loading">{t('member.loading')}</p></div></section>;
  } else if (state.phase === 'error') {
    body = (
      <section className="mf-section"><div className="container">
        <div className="mf-state" role="alert">
          <h2>{t('member.home.loadErrorTitle')}</h2>
          <p>{t('member.home.loadErrorText')}</p>
          <button type="button" className="btn btn-gold" onClick={() => { setState({ phase: 'loading', member: null }); load(); }}>{t('member.home.retry')}</button>
        </div>
      </div></section>
    );
  } else if (state.phase === 'notMember') {
    body = (
      <section className="mf-section"><div className="container">
        <div className="mf-state" role="alert">
          <h2>{t('member.home.notMemberTitle')}</h2>
          <p>{t('member.home.notMemberText')}</p>
          <button type="button" className="btn btn-gold" onClick={() => logout()}>{t('member.nav.logout')}</button>
        </div>
      </div></section>
    );
  } else {
    body = <Outlet context={{ member: state.member, reload: load }} />;
  }

  return (
    <InteriorLayout>
      {state.phase === 'ready' ? body : (
        <>
          <PageHero crumbs={[{ label: t('member.crumb') }]} title={t('member.home.title')} description={t('member.home.description')} />
          {body}
        </>
      )}
    </InteriorLayout>
  );
}
