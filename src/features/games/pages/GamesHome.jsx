import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gamepad2, Star, Trophy } from 'lucide-react';
import { getAllChallenges, getGameCategories, getGames, getMyChallengeStatus, getMyGameSummary, getGameLevels } from '../services';
import { pickLocalized } from '../services/gamesCore.shared';
import { GAMES_PATHS } from '../constants/games';
import { useAsyncData } from '../player/hooks/useAsyncData';
import { ChallengeCard, LevelProgress, SectionState } from '../player/components/PlayerUi';
import { isOpenNow, statusMap } from '../player/utils';

/**
 * الرئيسية: ملخصي، التصنيفات النشطة، الألعاب المنشورة (مع صعوبة/نقاط/تقدّم)، وتحديات متاحة لم تُحلّ بعد.
 * كل الأقسام تُحمَّل باستقلال (تحميل/فارغ/خطأ لكل قسم). الفلترة هنا للعرض؛ الحدّ الفعلي RLS/RPC.
 */
export default function GamesHome() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [cat, setCat] = useState('');
  useEffect(() => {
    document.title = `${t('games.pageTitle')} — ${t('brand.name')}`;
  }, [t]);

  const catalog = useAsyncData(async () => {
    const [categories, games, challenges] = await Promise.all([getGameCategories(), getGames(), getAllChallenges()]);
    return { categories, games, challenges };
  });
  const status = useAsyncData(getMyChallengeStatus);
  const summary = useAsyncData(async () => {
    const [s, levels] = await Promise.all([getMyGameSummary(), getGameLevels()]);
    return { s, levels };
  });

  const st = useMemo(() => statusMap(status.data), [status.data]);
  const model = useMemo(() => {
    if (!catalog.data) return null;
    const { categories, games, challenges } = catalog.data;
    const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
    const visibleGames = games.filter((g) => catById[g.category_id]); // لعبة تصنيفها معطّل لا تظهر
    const open = challenges.filter((c) => isOpenNow(c));
    const byGame = {};
    for (const c of open) (byGame[c.game_id] ||= []).push(c);
    return { categories, catById, games: visibleGames, byGame, open, gameById: Object.fromEntries(visibleGames.map((g) => [g.id, g])) };
  }, [catalog.data]);

  const shownGames = model ? model.games.filter((g) => !cat || g.category_id === cat) : [];
  const todo = model
    ? model.open.filter((c) => model.gameById[c.game_id] && !st[c.id]?.solved).slice(0, 6)
    : [];
  const pickName = (v, l) => pickLocalized(v, l);

  const catState = catalog.state === 'ready' ? (model.games.length ? '' : 'empty') : catalog.state;

  return (
    <div className="gp-page">
      <header className="gp-hero">
        <span className="gp-hero-icon"><Gamepad2 size={34} aria-hidden="true" /></span>
        <div>
          <h1>{t('games.brand')}</h1>
          <p>{t('games.play.tagline')}</p>
        </div>
      </header>

      <section className="gp-section" aria-labelledby="gp-me">
        <div className="gp-section-head">
          <h2 id="gp-me">{t('games.play.myProgress')}</h2>
          <Link to={GAMES_PATHS.profile} className="gp-link">{t('games.play.viewProfile')}</Link>
        </div>
        <SectionState state={summary.state} error={summary.error} onRetry={summary.reload} />
        {summary.data && (
          <div className="gp-card gp-me">
            <div className="gp-total"><Trophy size={22} aria-hidden="true" /><strong>{summary.data.s.total_points}</strong><span>{t('games.play.pointsUnit')}</span></div>
            <LevelProgress total={summary.data.s.total_points} level={summary.data.s.level}
              next={summary.data.s.next_level} lang={lang} pickName={pickName} />
            <ul className="gp-mini">
              <li><b>{summary.data.s.solved_challenges}</b> {t('games.play.solvedCount')}</li>
              <li><b>{summary.data.s.attempts_count}</b> {t('games.play.attemptsCount')}</li>
              <li><b>{summary.data.s.achievements_count}</b> {t('games.play.achievementsCount')}</li>
              <li><Link className="gp-link" to={GAMES_PATHS.leaderboard}>{t('games.play.leaderboard')}</Link></li>
            </ul>
          </div>
        )}
      </section>

      <section className="gp-section" aria-labelledby="gp-games">
        <div className="gp-section-head"><h2 id="gp-games">{t('games.play.games')}</h2></div>
        <SectionState state={catState} error={catalog.error} onRetry={catalog.reload} emptyText={t('games.play.noGames')} />
        {model && model.games.length > 0 && (
          <>
            {model.categories.length > 0 && (
              <div className="gp-chips" role="group" aria-label={t('games.play.categories')}>
                <button type="button" className={`gp-chip${cat === '' ? ' on' : ''}`} aria-pressed={cat === ''} onClick={() => setCat('')}>{t('games.play.allCategories')}</button>
                {model.categories.filter((c) => model.games.some((g) => g.category_id === c.id)).map((c) => (
                  <button key={c.id} type="button" className={`gp-chip${cat === c.id ? ' on' : ''}`} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
                    {pickLocalized(c.name, lang)}
                  </button>
                ))}
              </div>
            )}
            <div className="gp-grid">
              {shownGames.map((g) => {
                const list = model.byGame[g.id] || [];
                const solved = list.filter((c) => st[c.id]?.solved).length;
                const diffs = list.map((c) => c.difficulty);
                const total = list.reduce((a, c) => a + c.points_reward, 0);
                return (
                  <Link key={g.id} className="gp-card gp-game" to={GAMES_PATHS.game(g.slug)}>
                    <span className="gp-chip gp-chip-static">{pickLocalized(model.catById[g.category_id]?.name, lang)}</span>
                    <h3>{pickLocalized(g.title, lang)}</h3>
                    {g.description && <p className="gp-desc">{pickLocalized(g.description, lang)}</p>}
                    {list.length > 0 ? (
                      <ul className="gp-meta">
                        <li>{t('games.play.challengesCount', { count: list.length })}</li>
                        <li>{t('games.play.difficultyRange', { min: Math.min(...diffs), max: Math.max(...diffs) })}</li>
                        <li><Star size={14} aria-hidden="true" />{t('games.play.pointsValue', { count: total })}</li>
                      </ul>
                    ) : <p className="gp-sub">{t('games.play.noChallengesYet')}</p>}
                    {list.length > 0 && <p className="gp-sub">{t('games.play.solvedOf', { solved, total: list.length })}</p>}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="gp-section" aria-labelledby="gp-todo">
        <div className="gp-section-head"><h2 id="gp-todo">{t('games.play.availableChallenges')}</h2></div>
        <SectionState state={catalog.state === 'ready' ? (todo.length ? '' : 'empty') : catalog.state} error={catalog.error} onRetry={catalog.reload} emptyText={t('games.play.noAvailable')} />
        {todo.length > 0 && (
          <div className="gp-grid">
            {todo.map((c) => (
              <ChallengeCard key={c.id} challenge={c} title={pickLocalized(c.title, lang)}
                subtitle={pickLocalized(model.gameById[c.game_id]?.title, lang)} status={st[c.id]} to={GAMES_PATHS.challenge(c.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
