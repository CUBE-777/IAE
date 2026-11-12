import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Medal, Trophy } from 'lucide-react';
import { getLeaderboard } from '../services';
import { pageWindow } from '../../../utils/pagination';
import { useAsyncData } from '../player/hooks/useAsyncData';
import { SectionState } from '../player/components/PlayerUi';

const SIZE = 20;

/**
 * الصدارة: الترتيب والمستوى والنقاط فقط، بأسماء مختصرة من الخادم (get_game_leaderboard، 0053). لا بريد ولا معرّفات.
 * المراتب الأولى (1–3) كبطاقات في الصفحة الأولى، والبقية جدول بترقيم صفحات.
 */
export default function Leaderboard() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  useEffect(() => {
    document.title = `${t('games.play.leaderboard')} — ${t('brand.name')}`;
  }, [t]);

  const q = useAsyncData(() => getLeaderboard({ page, pageSize: SIZE }), [page]);
  const rows = q.data?.rows || [];
  const total = q.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / SIZE));
  const me = q.data?.me;
  const name = (r) => r.display_name || t('games.play.anonymous');
  const podium = page === 1 ? rows.filter((r) => r.rank <= 3) : [];
  const rest = page === 1 ? rows.filter((r) => r.rank > 3) : rows;
  const n = (v) => Number(v).toLocaleString(i18n.language);

  return (
    <div className="gp-page">
      <header className="gp-hero">
        <span className="gp-hero-icon"><Medal size={30} aria-hidden="true" /></span>
        <div><h1>{t('games.play.leaderboard')}</h1><p>{t('games.play.leaderboardTagline')}</p></div>
      </header>

      {q.data && (
        <div className="gp-card gp-myrank" aria-live="polite">
          {me
            ? <p><Trophy size={16} aria-hidden="true" /> {t('games.play.yourRank', { rank: n(me.rank), points: n(me.total_points) })}</p>
            : <p>{t('games.play.notRanked')}</p>}
        </div>
      )}

      <SectionState state={q.state === 'ready' ? (rows.length ? '' : 'empty') : q.data && q.state === 'loading' ? '' : q.state}
        error={q.error} onRetry={q.reload} emptyText={t('games.play.noRanking')} />

      {podium.length > 0 && (
        <ol className="gp-podium" aria-label={t('games.play.topPlayers')}>
          {podium.map((r, i) => (
            <li key={`${r.rank}-${i}`} className={`gp-card gp-pod gp-pod-${r.rank}${r.is_me ? ' me' : ''}`}>
              <span className="gp-rank" aria-label={t('games.play.rank')}>{n(r.rank)}</span>
              <strong>{name(r)}{r.is_me ? ` (${t('games.play.you')})` : ''}</strong>
              <span>{n(r.total_points)} {t('games.play.pointsUnit')}</span>
              {r.level != null && <span className="gp-sub">{t('games.play.level')} {r.level}</span>}
            </li>
          ))}
        </ol>
      )}

      {rest.length > 0 && (
        <div className="gp-table-wrap">
          <table className="gp-table">
            <thead><tr><th>{t('games.play.rank')}</th><th>{t('games.play.player')}</th><th>{t('games.play.level')}</th><th>{t('games.play.pointsUnit')}</th></tr></thead>
            <tbody>
              {rest.map((r, i) => (
                <tr key={`${r.rank}-${i}`} className={r.is_me ? 'me' : ''} aria-current={r.is_me ? 'true' : undefined}>
                  <td>{n(r.rank)}</td><td>{name(r)}{r.is_me ? ` (${t('games.play.you')})` : ''}</td><td>{r.level ?? '—'}</td><td>{n(r.total_points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="gp-pager" aria-label={t('games.play.pagination')}>
          {pageWindow(page, pages).map((p, i) => (p === '…'
            ? <span key={`g${i}`} aria-hidden="true">…</span>
            : <button key={p} type="button" className={`btn ${p === page ? 'btn-gold' : 'btn-ghost'}`} aria-current={p === page ? 'page' : undefined} onClick={() => setPage(p)}>{n(p)}</button>))}
        </nav>
      )}
    </div>
  );
}
