import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Route } from 'lucide-react';
import { getMyLearningTracks } from '../services';
import { pickLocalized } from '../services/gamesCore.shared';
import { GAMES_PATHS } from '../constants/games';
import { useAsyncData } from '../player/hooks/useAsyncData';
import { SectionState } from '../player/components/PlayerUi';
import { PathsSkeleton, ProgressMeter } from '../player/components/PathsUi';

/** قائمة مسارات التعلم المنشورة (من الخادم) مع ملخص تقدّمي لكل مسار، وتصفية اختيارية بحسب اللعبة. */
export default function LearningPaths() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [gameId, setGameId] = useState('');
  const data = useAsyncData(() => getMyLearningTracks(), []);

  useEffect(() => {
    document.title = `${t('games.play.paths.title')} — ${t('brand.name')}`;
  }, [t]);

  const tracks = useMemo(() => data.data || [], [data.data]);
  const games = useMemo(() => {
    const map = new Map();
    for (const tr of tracks) if (tr.game && !map.has(tr.game.id)) map.set(tr.game.id, tr.game);
    return [...map.values()];
  }, [tracks]);
  const shown = tracks.filter((tr) => !gameId || tr.game?.id === gameId);

  return (
    <div className="gp-page">
      <header className="gp-hero">
        <span className="gp-hero-icon"><Route size={32} aria-hidden="true" /></span>
        <div>
          <h1>{t('games.play.paths.title')}</h1>
          <p>{t('games.play.paths.tagline')}</p>
        </div>
      </header>

      {games.length > 1 && (
        <div className="gp-chips" role="group" aria-label={t('games.play.paths.filterByGame')}>
          <button type="button" className={`gp-chip${gameId ? '' : ' on'}`} aria-pressed={!gameId} onClick={() => setGameId('')}>{t('games.play.allCategories')}</button>
          {games.map((g) => (
            <button key={g.id} type="button" className={`gp-chip${gameId === g.id ? ' on' : ''}`} aria-pressed={gameId === g.id} onClick={() => setGameId(g.id)}>
              {pickLocalized(g.title, lang)}
            </button>
          ))}
        </div>
      )}

      {data.state === 'loading' && <PathsSkeleton rows={3} />}
      {data.state === 'error' && <SectionState state="error" error={data.error} onRetry={data.reload} />}
      {data.state === 'ready' && shown.length === 0 && <SectionState state="empty" emptyText={t('games.play.paths.empty')} />}
      {data.state === 'ready' && shown.length > 0 && (
        <ul className="gp-grid">
          {shown.map((tr) => (
            <li key={tr.id}>
              <Link className="gp-card gp-path-card" to={GAMES_PATHS.track(tr.id)}>
                <span className="gp-chip gp-chip-static">{pickLocalized(tr.game?.title, lang)}</span>
                <h2>{pickLocalized(tr.title, lang)}</h2>
                {tr.description && <p className="gp-desc">{pickLocalized(tr.description, lang)}</p>}
                <ul className="gp-meta">
                  <li>{t('games.play.paths.categoriesCount', { n: tr.categories_count })}</li>
                  <li>{t('games.play.paths.stagesCount', { n: tr.stages_count })}</li>
                  <li>{t('games.play.paths.challengesCount', { n: tr.challenges_total })}</li>
                </ul>
                <ProgressMeter
                  percent={tr.progress_percent}
                  label={t('games.play.paths.progress')}
                  caption={t('games.play.paths.stagesProgress', { done: tr.stages_completed, total: tr.stages_count })}
                />
                <span className="gp-cta">{t('games.play.paths.open')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
