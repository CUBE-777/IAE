import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getMyLearningTrack } from '../services';
import { pickLocalized } from '../services/gamesCore.shared';
import { GAMES_PATHS } from '../constants/games';
import { useAsyncData } from '../player/hooks/useAsyncData';
import { SectionState } from '../player/components/PlayerUi';
import { LockNotice, PathsSkeleton, ProgressMeter, StageStateBadge } from '../player/components/PathsUi';

/** صفحة مسار: وصفه، فئاته، ومراحل كل فئة بحالتها (مفتوحة/مغلقة/مكتملة) وتقدّمها وسبب قفلها. كل القيم من الخادم. */
export default function LearningTrack() {
  const { trackId } = useParams();
  const { hash } = useLocation();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const data = useAsyncData(() => getMyLearningTrack(trackId), [trackId]);
  const track = data.data?.track || null;
  const categories = data.data?.categories || [];

  useEffect(() => {
    document.title = `${track ? pickLocalized(track.title, lang) : t('games.play.paths.title')} — ${t('brand.name')}`;
  }, [track, lang, t]);

  // الانتقال إلى فئة محدّدة (#cat-<id>) بعد وصول البيانات
  useEffect(() => {
    if (data.state !== 'ready' || !hash.startsWith('#cat-')) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [data.state, hash]);

  if (data.state === 'loading') return <div className="gp-page"><PathsSkeleton rows={3} /></div>;
  if (data.state === 'error') {
    if (data.error?.code === 'path_not_available') {
      return (
        <div className="gp-page">
          <div className="gp-state gp-state-error" role="alert">
            <span>{t('games.play.paths.notFound')}</span>
            <Link className="btn btn-ghost" to={GAMES_PATHS.paths}>{t('games.play.paths.backToPaths')}</Link>
          </div>
        </div>
      );
    }
    return <div className="gp-page"><SectionState state="error" error={data.error} onRetry={data.reload} /></div>;
  }

  const allStages = categories.flatMap((c) => c.stages || []);
  const doneStages = allStages.filter((s) => s.state === 'completed').length;
  const pct = allStages.length ? Math.floor((doneStages * 100) / allStages.length) : 0;

  return (
    <div className="gp-page">
      <nav className="gp-crumbs" aria-label={t('games.play.breadcrumb')}>
        <Link to={GAMES_PATHS.paths}>{t('games.play.paths.title')}</Link><span aria-hidden="true">/</span>
        <span aria-current="page">{pickLocalized(track.title, lang)}</span>
      </nav>

      <header className="gp-card gp-game-head">
        <Link className="gp-chip gp-chip-static" to={GAMES_PATHS.game(track.game.slug)}>{pickLocalized(track.game.title, lang)}</Link>
        <h1>{pickLocalized(track.title, lang)}</h1>
        {track.description && <p className="gp-desc-full">{pickLocalized(track.description, lang)}</p>}
        {allStages.length > 0 && (
          <ProgressMeter percent={pct} label={t('games.play.paths.progress')} caption={t('games.play.paths.stagesProgress', { done: doneStages, total: allStages.length })} />
        )}
      </header>

      {categories.length === 0 && <SectionState state="empty" emptyText={t('games.play.paths.noCategories')} />}

      {categories.map((cat) => {
        const stages = cat.stages || [];
        const done = stages.filter((s) => s.state === 'completed').length;
        return (
          <section key={cat.id} id={`cat-${cat.id}`} className="gp-section gp-cat" aria-labelledby={`cat-h-${cat.id}`}>
            <div className="gp-section-head">
              <h2 id={`cat-h-${cat.id}`}>{pickLocalized(cat.title, lang)}</h2>
              <span className="gp-sub">{t('games.play.paths.stagesProgress', { done, total: stages.length })}</span>
            </div>
            {cat.description && <p className="gp-sub">{pickLocalized(cat.description, lang)}</p>}
            <p className="gp-sub gp-unlock-mode">{t(`games.play.paths.unlockMode.${cat.stage_unlock_mode}`, { defaultValue: '' })}</p>

            {stages.length === 0 ? (
              <SectionState state="empty" emptyText={t('games.play.paths.noStages')} />
            ) : (
              <ol className="gp-stage-list">
                {stages.map((s) => (
                  <li key={s.id}>
                    <Link className={`gp-stage-row gp-stage-${s.state}`} to={GAMES_PATHS.stage(s.id)}>
                      <div className="gp-stage-top">
                        <h3>{pickLocalized(s.title, lang)}</h3>
                        <StageStateBadge state={s.state} />
                      </div>
                      {s.description && <p className="gp-desc">{pickLocalized(s.description, lang)}</p>}
                      {s.state === 'locked'
                        ? <LockNotice reason={s.lock_reason} lang={lang} compact />
                        : (
                          <ProgressMeter
                            percent={s.progress?.percent}
                            label={t('games.play.paths.stageProgress')}
                            caption={t('games.play.paths.fact.solvedOf', { solved: s.progress?.solved ?? 0, total: s.progress?.total ?? 0 })}
                          />
                        )}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
