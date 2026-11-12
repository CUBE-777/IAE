import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Award, Lock, Trophy } from 'lucide-react';
import {
  getChallengesByIds, getGameAchievements, getGameLevels, getMyAchievements, getMyAttempts, getMyGameSummary, getMyPoints, getMyResults,
} from '../services';
import { pickLocalized } from '../services/gamesCore.shared';
import { GAMES_PATHS } from '../constants/games';
import { useAsyncData } from '../player/hooks/useAsyncData';
import { LevelProgress, SectionState } from '../player/components/PlayerUi';
import { formatDateTime, formatDurationMs } from '../player/utils';

const PAGE = 25;
const MAX = 200; // سقف clampLimit في الخدمات

/** ملفي: النقاط والمستوى والتقدم والإنجازات وسجلّ النتائج والمحاولات والنقاط. قراءة فقط من خدمات/RLS اللاعب نفسه. */
export default function PlayerProfile() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [tab, setTab] = useState('results');
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    document.title = `${t('games.play.profile')} — ${t('brand.name')}`;
  }, [t]);

  const summary = useAsyncData(async () => {
    const [s, levels] = await Promise.all([getMyGameSummary(), getGameLevels()]);
    return { s, levels };
  });
  const ach = useAsyncData(async () => {
    const [defs, mine] = await Promise.all([getGameAchievements(), getMyAchievements()]);
    return { defs, mine };
  });
  const hist = useAsyncData(async () => {
    const [results, attempts, points] = await Promise.all([getMyResults({ limit }), getMyAttempts({ limit }), getMyPoints({ limit })]);
    const ids = [...results, ...attempts, ...points].map((r) => r.challenge_id);
    const titles = Object.fromEntries((await getChallengesByIds(ids).catch(() => [])).map((c) => [c.id, pickLocalized(c.title, lang)]));
    return { results, attempts, points, titles };
  }, [limit, lang]);

  const unlocked = useMemo(() => new Map((ach.data?.mine || []).map((m) => [m.achievement?.id, m.unlocked_at])), [ach.data]);
  const pickName = (v, l) => pickLocalized(v, l);
  const titleOf = (id) => hist.data?.titles?.[id] || t('games.play.unavailableChallenge');
  const list = hist.data?.[tab] || [];
  const canMore = hist.state === 'ready' && list.length >= limit && limit < MAX;

  return (
    <div className="gp-page">
      <header className="gp-hero">
        <span className="gp-hero-icon"><Trophy size={30} aria-hidden="true" /></span>
        <div><h1>{t('games.play.profile')}</h1><p>{t('games.play.profileTagline')}</p></div>
      </header>

      <section className="gp-section" aria-labelledby="gp-sum">
        <div className="gp-section-head"><h2 id="gp-sum">{t('games.play.myProgress')}</h2>
          <Link className="gp-link" to={GAMES_PATHS.leaderboard}>{t('games.play.leaderboard')}</Link></div>
        <SectionState state={summary.state} error={summary.error} onRetry={summary.reload} />
        {summary.data && (
          <div className="gp-card gp-me">
            <dl className="gp-stats">
              <div><dt>{t('games.play.totalPoints')}</dt><dd>{summary.data.s.total_points}</dd></div>
              <div><dt>{t('games.play.solvedCount')}</dt><dd>{summary.data.s.solved_challenges}</dd></div>
              <div><dt>{t('games.play.attemptsCount')}</dt><dd>{summary.data.s.attempts_count}</dd></div>
              <div><dt>{t('games.play.achievementsCount')}</dt><dd>{summary.data.s.achievements_count}</dd></div>
            </dl>
            <LevelProgress total={summary.data.s.total_points} level={summary.data.s.level} next={summary.data.s.next_level} lang={lang} pickName={pickName} />
            {summary.data.levels.length > 0 && (
              <ol className="gp-levels" aria-label={t('games.play.allLevels')}>
                {summary.data.levels.map((l) => (
                  <li key={l.level} className={summary.data.s.level?.level === l.level ? 'on' : summary.data.s.total_points >= l.min_points ? 'done' : ''}>
                    <b>{l.level}</b> {pickLocalized(l.title, lang)} <span>{l.min_points}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>

      <section className="gp-section" aria-labelledby="gp-ach">
        <div className="gp-section-head"><h2 id="gp-ach">{t('games.play.achievements')}</h2></div>
        <SectionState state={ach.state === 'ready' ? (ach.data.defs.length ? '' : 'empty') : ach.state} error={ach.error} onRetry={ach.reload} emptyText={t('games.play.noAchievementDefs')} />
        {ach.data && ach.data.defs.length > 0 && (
          <ul className="gp-grid gp-ach">
            {ach.data.defs.map((a) => {
              const at = unlocked.get(a.id);
              return (
                <li key={a.id} className={`gp-card gp-ach-item${at ? ' on' : ''}`}>
                  <span className="gp-ach-icon" aria-hidden="true">{at ? <Award size={22} /> : <Lock size={20} />}</span>
                  <div>
                    <h3>{pickLocalized(a.title, lang)}</h3>
                    {a.description && <p className="gp-sub">{pickLocalized(a.description, lang)}</p>}
                    <p className="gp-sub">{at ? `${t('games.play.unlockedOn')} ${formatDateTime(at, lang)}` : t('games.play.locked')}
                      {a.points_bonus > 0 ? ` · +${a.points_bonus}` : ''}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="gp-section" aria-labelledby="gp-hist">
        <div className="gp-section-head"><h2 id="gp-hist">{t('games.play.history')}</h2></div>
        <div className="gp-chips" role="group" aria-label={t('games.play.history')}>
          {['results', 'attempts', 'points'].map((k) => (
            <button key={k} type="button" className={`gp-chip${tab === k ? ' on' : ''}`} aria-pressed={tab === k} onClick={() => setTab(k)}>{t(`games.play.tab.${k}`)}</button>
          ))}
        </div>
        <SectionState state={hist.state === 'ready' ? (list.length ? '' : 'empty') : hist.state === 'loading' && hist.data ? '' : hist.state}
          error={hist.error} onRetry={hist.reload} emptyText={t(`games.play.empty.${tab}`)} />
        {list.length > 0 && (
          <div className="gp-table-wrap">
            <table className="gp-table">
              <thead>
                {tab === 'results' && <tr><th>{t('games.play.challenge')}</th><th>{t('games.play.outcome')}</th><th>{t('games.play.score')}</th><th>{t('games.play.duration')}</th><th>{t('games.play.date')}</th></tr>}
                {tab === 'attempts' && <tr><th>{t('games.play.challenge')}</th><th>{t('games.play.status')}</th><th>{t('games.play.startedAt')}</th><th>{t('games.play.finishedAt')}</th></tr>}
                {tab === 'points' && <tr><th>{t('games.play.date')}</th><th>{t('games.play.delta')}</th><th>{t('games.play.source')}</th><th>{t('games.play.detail')}</th></tr>}
              </thead>
              <tbody>
                {tab === 'results' && list.map((r) => (
                  <tr key={r.id}><td>{titleOf(r.challenge_id)}</td><td>{r.is_correct ? t('games.play.correctShort') : t('games.play.incorrectShort')}</td><td>{r.score}</td><td dir="ltr">{formatDurationMs(r.duration_ms)}</td><td>{formatDateTime(r.created_at, lang)}</td></tr>
                ))}
                {tab === 'attempts' && list.map((a) => (
                  <tr key={a.id}><td>{titleOf(a.challenge_id)}</td><td>{t(`games.play.attemptStatus.${a.status}`, { defaultValue: a.status })}</td><td>{formatDateTime(a.started_at, lang)}</td><td>{formatDateTime(a.finished_at, lang)}</td></tr>
                ))}
                {tab === 'points' && list.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDateTime(p.created_at, lang)}</td>
                    <td dir="ltr" className={p.delta < 0 ? 'gp-neg' : 'gp-pos'}>{p.delta > 0 ? `+${p.delta}` : p.delta}</td>
                    <td>{t(`games.play.reasons.${p.reason}`, { defaultValue: p.reason })}</td>
                    <td>{p.reason === 'challenge_solved' ? titleOf(p.challenge_id) : p.reason === 'achievement' ? (ach.data?.defs.find((a) => a.id === p.achievement_id) ? pickLocalized(ach.data.defs.find((a) => a.id === p.achievement_id).title, lang) : '—') : (p.note || '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canMore && <div className="gp-more"><button type="button" className="btn btn-ghost" onClick={() => setLimit((n) => Math.min(MAX, n + PAGE))}>{t('games.play.loadMore')}</button></div>}
      </section>
    </div>
  );
}
