import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Award, CheckCircle2, Clock, Star, Target } from 'lucide-react';
import { formatClock } from '../utils';

/** حالة قسم: تحميل/خطأ/فارغ بنفس الشكل في كل الصفحات. */
export function SectionState({ state, error, onRetry, emptyText, loadingLabel }) {
  const { t } = useTranslation();
  if (state === 'loading') {
    return (
      <div className="gp-state" role="status" aria-live="polite">
        <span className="gp-spinner" aria-hidden="true" />{loadingLabel || t('games.play.loading')}
      </div>
    );
  }
  if (state === 'error') {
    const code = error?.code && error.code !== 'unknown' ? t(`games.play.errors.${error.code}`, { defaultValue: '' }) : '';
    return (
      <div className="gp-state gp-state-error" role="alert">
        <span>{code || t('games.play.loadError')}</span>
        {onRetry && <button type="button" className="btn btn-ghost" onClick={onRetry}>{t('games.play.retry')}</button>}
      </div>
    );
  }
  if (state === 'empty') return <div className="gp-state">{emptyText}</div>;
  return null;
}

export function Difficulty({ level }) {
  const { t } = useTranslation();
  const n = Math.min(5, Math.max(1, Number(level) || 1));
  return (
    <span className="gp-diff" title={t(`games.play.difficulty.${n}`)}>
      <span className="gp-diff-dots" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}
      </span>
      <span>{t(`games.play.difficulty.${n}`)}</span>
    </span>
  );
}

export function ChallengeMeta({ challenge }) {
  const { t } = useTranslation();
  return (
    <ul className="gp-meta">
      <li><Difficulty level={challenge.difficulty} /></li>
      <li title={t('games.play.points')}><Star size={14} aria-hidden="true" />{t('games.play.pointsValue', { count: challenge.points_reward })}</li>
      {challenge.time_limit_seconds ? (
        <li title={t('games.play.timeLimit')}><Clock size={14} aria-hidden="true" />{formatClock(challenge.time_limit_seconds)}</li>
      ) : null}
      {challenge.max_attempts ? (
        <li title={t('games.play.maxAttempts')}><Target size={14} aria-hidden="true" />{t('games.play.attemptsValue', { count: challenge.max_attempts })}</li>
      ) : null}
    </ul>
  );
}

export function SolvedBadge() {
  const { t } = useTranslation();
  return <span className="gp-badge gp-badge-ok"><CheckCircle2 size={13} aria-hidden="true" />{t('games.play.solved')}</span>;
}

export function ChallengeCard({ challenge, title, subtitle, status, to }) {
  const { t } = useTranslation();
  return (
    <Link className="gp-card gp-challenge" to={to}>
      <div className="gp-card-head">
        <h3>{title}</h3>
        {status?.solved && <SolvedBadge />}
      </div>
      {subtitle && <p className="gp-sub">{subtitle}</p>}
      <ChallengeMeta challenge={challenge} />
      <span className="gp-cta">{status?.open_attempt_id ? t('games.play.resume') : status?.solved ? t('games.play.playAgain') : t('games.play.play')}</span>
    </Link>
  );
}

/** شريط تقدّم المستوى: القيم كلّها من الخادم (النقاط والعتبات)، والنسبة للعرض فقط. */
export function LevelProgress({ total, level, next, lang, pickName }) {
  const { t } = useTranslation();
  const from = level?.min_points ?? 0;
  const to = next?.min_points ?? null;
  const pct = to == null ? 100 : Math.min(100, Math.max(0, Math.round(((total - from) / Math.max(1, to - from)) * 100)));
  return (
    <div className="gp-level">
      <div className="gp-level-row">
        <strong><Award size={16} aria-hidden="true" /> {level ? `${t('games.play.level')} ${level.level} — ${pickName(level.title, lang)}` : t('games.play.noLevel')}</strong>
        <span>{next ? t('games.play.toNext', { count: Math.max(0, to - total), name: pickName(next.title, lang) }) : t('games.play.maxLevel')}</span>
      </div>
      <div className="gp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('games.play.levelProgress')}>
        <span style={{ inlineSize: `${pct}%` }} />
      </div>
    </div>
  );
}
