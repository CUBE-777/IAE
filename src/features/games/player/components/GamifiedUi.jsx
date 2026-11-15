import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Award, CheckCircle2, ChevronRight, Medal, Play, Star, Swords, Target } from 'lucide-react';
import { pickLocalized } from '../../services/gamesCore.shared';
import GameIcon from './GameIcon';

/** نسبة التقدّم بين عتبتي المستوى (للعرض فقط؛ القيم كلّها من الخادم). */
export function levelPct(total, level, next) {
  const from = level?.min_points ?? 0;
  const to = next?.min_points ?? null;
  return to == null ? 100 : Math.min(100, Math.max(0, Math.round(((total - from) / Math.max(1, to - from)) * 100)));
}

export function ProgressBar({ pct, label, tone }) {
  return (
    <div className={`gx-bar${tone ? ` gx-bar-${tone}` : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ inlineSize: `${pct}%` }} />
    </div>
  );
}

/** حلقة المستوى: رقم المستوى داخل حلقة تقدّم SVG. */
export function LevelRing({ level, pct, size = 92 }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <span className="gx-ring" style={{ inlineSize: size, blockSize: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" focusable="false">
        <circle className="gx-ring-bg" cx="50" cy="50" r={r} />
        <circle className="gx-ring-fg" cx="50" cy="50" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 50 50)" />
      </svg>
      <b>{level ?? '–'}</b>
    </span>
  );
}

/** لوحة اللاعب: المستوى + XP + التقدّم + إحصاءات سريعة. */
export function PlayerHero({ summary, lang, profileTo, boardTo }) {
  const { t } = useTranslation();
  const { s } = summary;
  const level = s.level;
  const next = s.next_level;
  const pct = levelPct(s.total_points, level, next);
  const stats = [
    { Icon: CheckCircle2, v: s.solved_challenges, l: t('games.play.solvedCount') },
    { Icon: Target, v: s.attempts_count, l: t('games.play.attemptsCount') },
    { Icon: Medal, v: s.achievements_count, l: t('games.play.achievementsCount') },
  ];
  return (
    <section className="gx-hero" aria-labelledby="gx-hero-t">
      <div className="gx-hero-main">
        <LevelRing level={level?.level} pct={pct} />
        <div className="gx-hero-text">
          <p className="gx-eyebrow"><Award size={14} aria-hidden="true" />{t('games.play.level')} {level?.level ?? '—'}</p>
          <h1 id="gx-hero-t">{level ? pickLocalized(level.title, lang) : t('games.play.noLevel')}</h1>
          <p className="gx-xp"><strong>{s.total_points}</strong> {t('games.play.xp')}
            <span>{next ? t('games.play.toNext', { count: Math.max(0, next.min_points - s.total_points), name: pickLocalized(next.title, lang) }) : t('games.play.maxLevel')}</span>
          </p>
          <ProgressBar pct={pct} label={t('games.play.levelProgress')} tone="gold" />
        </div>
      </div>
      <ul className="gx-stats">
        {stats.map(({ Icon, v, l }) => (
          <li key={l}><Icon size={18} aria-hidden="true" /><b>{v}</b><span>{l}</span></li>
        ))}
      </ul>
      <div className="gx-hero-links">
        <Link className="gx-link" to={profileTo}>{t('games.play.viewProfile')}<ChevronRight size={15} aria-hidden="true" /></Link>
        <Link className="gx-link" to={boardTo}>{t('games.play.leaderboard')}<ChevronRight size={15} aria-hidden="true" /></Link>
      </div>
    </section>
  );
}

/** عنوان ترحيبي يظهر قبل وصول الملخص أو عند فشله. */
export function PlainHero({ title, tagline }) {
  return (
    <header className="gx-hero gx-hero-plain">
      <GameIcon game={{ slug: 'iae-games' }} size="xl" />
      <div><h1>{title}</h1><p>{tagline}</p></div>
    </header>
  );
}

/** بطاقة لعبة: أيقونة + تصنيف + تقدّم + حالة (ابدأ/تابع/مكتملة). */
export function GameCard({ game, categoryName, title, description, stats, to }) {
  const { t } = useTranslation();
  const { count = 0, solved = 0, points = 0, min, max } = stats || {};
  const pct = count ? Math.round((solved / count) * 100) : 0;
  const done = count > 0 && solved === count;
  const state = done ? 'done' : solved > 0 ? 'progress' : 'new';
  return (
    <Link className={`gx-game gx-game--${state}`} to={to}>
      <div className="gx-game-top">
        <GameIcon game={game} category={categoryName} size="lg" />
        <span className="gx-tag">{categoryName}</span>
        {done && <span className="gx-done" title={t('games.play.gameDone')}><CheckCircle2 size={18} aria-hidden="true" /><span className="gx-sr">{t('games.play.gameDone')}</span></span>}
      </div>
      <h3>{title}</h3>
      {description && <p className="gx-desc">{description}</p>}
      {count > 0 ? (
        <>
          <ul className="gx-meta">
            <li><Swords size={14} aria-hidden="true" />{t('games.play.challengesCount', { count })}</li>
            <li><Star size={14} aria-hidden="true" />{t('games.play.pointsValue', { count: points })}</li>
            <li>{t('games.play.difficultyRange', { min, max })}</li>
          </ul>
          <div className="gx-prog">
            <ProgressBar pct={pct} label={t('games.play.solvedOf', { solved, total: count })} tone={done ? 'ok' : undefined} />
            <span>{t('games.play.solvedOf', { solved, total: count })}</span>
          </div>
        </>
      ) : <p className="gx-sub">{t('games.play.noChallengesYet')}</p>}
      <span className="gx-cta"><Play size={14} aria-hidden="true" />{done ? t('games.play.gameReview') : solved > 0 ? t('games.play.gameContinue') : t('games.play.gameStart')}</span>
    </Link>
  );
}
