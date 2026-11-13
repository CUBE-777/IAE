import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getChallenges, getGameBySlug, getGameCategories, getMyChallengeStatus, getMyLearningTracks } from '../services';
import { pickLocalized } from '../services/gamesCore.shared';
import { GAMES_PATHS } from '../constants/games';
import { useAsyncData } from '../player/hooks/useAsyncData';
import { ChallengeCard, SectionState } from '../player/components/PlayerUi';
import { isOpenNow, sortChallenges, statusMap } from '../player/utils';

/** تفاصيل لعبة: معلوماتها وتحدياتها المتاحة للاعب فقط (منشورة + داخل نافذتها الزمنية) مع ترتيب بالصعوبة أو النقاط. */
export default function GameDetails() {
  const { slug } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [sort, setSort] = useState('order');

  const data = useAsyncData(async () => {
    const [game, categories] = await Promise.all([getGameBySlug(slug), getGameCategories()]);
    const category = game ? categories.find((c) => c.id === game.category_id) : null;
    if (!game || !category) return { game: null };
    // مسارات التعلم لهذه اللعبة: إضافة اختيارية، فشلها (مثلًا قبل تطبيق 0058) لا يعطّل صفحة اللعبة
    const [challenges, status, tracks] = await Promise.all([
      getChallenges(game.id), getMyChallengeStatus().catch(() => []), getMyLearningTracks({ gameId: game.id }).catch(() => []),
    ]);
    return { game, category, challenges, status, tracks };
  }, [slug]);

  const game = data.data?.game || null;
  useEffect(() => {
    document.title = `${game ? pickLocalized(game.title, lang) : t('games.pageTitle')} — ${t('brand.name')}`;
  }, [game, lang, t]);

  const st = useMemo(() => statusMap(data.data?.status), [data.data]);
  const list = useMemo(
    () => sortChallenges((data.data?.challenges || []).filter((c) => isOpenNow(c)), sort),
    [data.data, sort],
  );
  const solved = list.filter((c) => st[c.id]?.solved).length;

  if (data.state !== 'ready') {
    return <div className="gp-page"><SectionState state={data.state} error={data.error} onRetry={data.reload} /></div>;
  }
  if (!game) {
    return (
      <div className="gp-page">
        <div className="gp-state gp-state-error" role="alert">
          <span>{t('games.play.gameNotFound')}</span>
          <Link className="btn btn-ghost" to={GAMES_PATHS.home}>{t('games.play.backHome')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="gp-page">
      <nav className="gp-crumbs" aria-label={t('games.play.breadcrumb')}>
        <Link to={GAMES_PATHS.home}>{t('games.play.games')}</Link><span aria-hidden="true">/</span>
        <span aria-current="page">{pickLocalized(game.title, lang)}</span>
      </nav>
      <header className="gp-card gp-game-head">
        <span className="gp-chip gp-chip-static">{pickLocalized(data.data.category.name, lang)}</span>
        <h1>{pickLocalized(game.title, lang)}</h1>
        {game.description && <p className="gp-desc gp-desc-full">{pickLocalized(game.description, lang)}</p>}
        {list.length > 0 && <p className="gp-sub">{t('games.play.solvedOf', { solved, total: list.length })}</p>}
      </header>

      {data.data.tracks?.length > 0 && (
        <section className="gp-section" aria-labelledby="gp-tracks">
          <div className="gp-section-head">
            <h2 id="gp-tracks">{t('games.play.paths.title')}</h2>
            <Link className="gp-link" to={GAMES_PATHS.paths}>{t('games.play.paths.viewAll')}</Link>
          </div>
          <ul className="gp-grid">
            {data.data.tracks.map((tr) => (
              <li key={tr.id}>
                <Link className="gp-card gp-path-card" to={GAMES_PATHS.track(tr.id)}>
                  <h3>{pickLocalized(tr.title, lang)}</h3>
                  <p className="gp-sub">{t('games.play.paths.stagesProgress', { done: tr.stages_completed, total: tr.stages_count })}</p>
                  <span className="gp-cta">{t('games.play.paths.open')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="gp-section" aria-labelledby="gp-ch">
        <div className="gp-section-head">
          <h2 id="gp-ch">{t('games.play.challenges')}</h2>
          {list.length > 1 && (
            <label className="gp-sort">
              <span>{t('games.play.sortBy')}</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                {['order', 'difficulty_asc', 'difficulty_desc', 'points_desc'].map((k) => <option key={k} value={k}>{t(`games.play.sort.${k}`)}</option>)}
              </select>
            </label>
          )}
        </div>
        <SectionState state={list.length ? '' : 'empty'} emptyText={t('games.play.noChallengesInGame')} />
        {list.length > 0 && (
          <div className="gp-grid">
            {list.map((c) => (
              <ChallengeCard key={c.id} challenge={c} title={pickLocalized(c.title, lang)}
                subtitle={c.description ? pickLocalized(c.description, lang) : null} status={st[c.id]} to={GAMES_PATHS.challenge(c.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
