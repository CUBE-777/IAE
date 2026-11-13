import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Hourglass, Lock, PlayCircle, ShieldCheck } from 'lucide-react';
import { pickLocalized } from '../../services/gamesCore.shared';
import { GAMES_PATHS } from '../../constants/games';

/**
 * مكوّنات عرض مسارات التعلم (6.4). كلها عرض فقط: الفتح والإكمال والنسب وسبب القفل تأتي من الخادم (0058)،
 * ولا تُشتقّ هنا ولا يُبنى عليها سماح؛ الحدّ الفعلي start_game_attempt.
 */

/** هيكل تحميل (Skeleton) لقوائم البطاقات/الصفوف. */
export function PathsSkeleton({ rows = 3, label }) {
  const { t } = useTranslation();
  return (
    <div className="gp-skel-list" role="status" aria-live="polite" aria-label={label || t('games.play.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="gp-skel" aria-hidden="true">
          <span className="gp-skel-line gp-skel-w60" />
          <span className="gp-skel-line gp-skel-w90" />
          <span className="gp-skel-line gp-skel-w40" />
        </div>
      ))}
    </div>
  );
}

/** شريط تقدّم (النسبة من الخادم، تُقيَّد 0..100 للعرض فقط). */
export function ProgressMeter({ percent, label, caption }) {
  const pct = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  return (
    <div className="gp-prog">
      <div className="gp-prog-row">
        {caption ? <span>{caption}</span> : <span />}
        <b>{pct}%</b>
      </div>
      <div className="gp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
        <span style={{ inlineSize: `${pct}%` }} />
      </div>
    </div>
  );
}

/** حالة المرحلة: completed | unlocked | locked. */
export function StageStateBadge({ state }) {
  const { t } = useTranslation();
  if (state === 'completed') {
    return <span className="gp-badge gp-badge-ok"><CheckCircle2 size={13} aria-hidden="true" />{t('games.play.paths.state.completed')}</span>;
  }
  if (state === 'unlocked') {
    return <span className="gp-badge gp-badge-open"><PlayCircle size={13} aria-hidden="true" />{t('games.play.paths.state.unlocked')}</span>;
  }
  return <span className="gp-badge gp-badge-lock"><Lock size={13} aria-hidden="true" />{t('games.play.paths.state.locked')}</span>;
}

/** نص سبب القفل. reason = { code, previous_stage_id?, previous_stage_title? } من الخادم. */
export function lockReasonText(reason, t, lang) {
  const code = reason?.code;
  if (code === 'previous_stage_incomplete') {
    return t('games.play.paths.lock.previous_stage_incomplete', { name: pickLocalized(reason.previous_stage_title, lang) || t('games.play.paths.lock.previousFallback') });
  }
  if (code === 'manual_unlock_required') return t('games.play.paths.lock.manual_unlock_required');
  return t('games.play.paths.lock.locked');
}

/** إشعار القفل. withLink يضيف وصلة إلى المرحلة السابقة المطلوبة عند التسلسل. */
export function LockNotice({ reason, lang, withLink = false, compact = false }) {
  const { t } = useTranslation();
  if (!reason) return null;
  return (
    <p className={`gp-lock-note${compact ? ' gp-lock-compact' : ''}`} role={compact ? undefined : 'status'}>
      <Lock size={15} aria-hidden="true" />
      <span>
        {lockReasonText(reason, t, lang)}
        {withLink && reason.code === 'previous_stage_incomplete' && reason.previous_stage_id && (
          <> <Link to={GAMES_PATHS.stage(reason.previous_stage_id)}>{t('games.play.paths.lock.goPrevious')}</Link></>
        )}
      </span>
    </p>
  );
}

/** نصّ قاعدة الإكمال + المتبقي، من progress المحسوب على الخادم. */
export function RequirementPanel({ progress }) {
  const { t } = useTranslation();
  if (!progress) return null;
  const mode = progress.mode;
  const rule = t(`games.play.paths.rule.${['all_required', 'min_success_rate', 'min_points', 'manual'].includes(mode) ? mode : 'all_required'}`, {
    n: progress.threshold ?? 0,
  });

  let facts = [];
  let remaining = null;
  if (mode === 'all_required') {
    facts = [t('games.play.paths.fact.requiredDone', { done: progress.required_done, total: progress.required_total })];
    if (progress.required_total === 0) remaining = t('games.play.paths.remaining.noRequired');
    else if (progress.remaining_required > 0) remaining = t('games.play.paths.remaining.required', { n: progress.remaining_required });
  } else if (mode === 'min_success_rate') {
    facts = [
      t('games.play.paths.fact.solvedOf', { solved: progress.solved, total: progress.total }),
      t('games.play.paths.fact.rate', { n: progress.success_rate }),
    ];
    if (progress.total === 0) remaining = t('games.play.paths.remaining.noChallenges');
    else if (progress.needed_solved > 0) remaining = t('games.play.paths.remaining.solve', { n: progress.needed_solved });
  } else if (mode === 'min_points') {
    facts = [t('games.play.paths.fact.points', { earned: progress.points_earned, needed: progress.threshold })];
    if (progress.points_missing > 0) remaining = t('games.play.paths.remaining.points', { n: progress.points_missing });
  } else if (mode === 'manual') {
    facts = [
      t('games.play.paths.fact.solvedOf', { solved: progress.solved, total: progress.total }),
      progress.manual_approved ? t('games.play.paths.fact.approved') : t('games.play.paths.fact.awaiting'),
    ];
    if (!progress.manual_approved) remaining = t('games.play.paths.remaining.approval');
  }

  return (
    <section className="gp-card gp-req" aria-labelledby="gp-req-title">
      <h2 id="gp-req-title"><ShieldCheck size={18} aria-hidden="true" />{t('games.play.paths.requirements')}</h2>
      <p className="gp-req-rule">{rule}</p>
      <ProgressMeter percent={progress.percent} label={t('games.play.paths.stageProgress')} caption={t('games.play.paths.stageProgress')} />
      <ul className="gp-mini">{facts.map((f) => <li key={f}>{f}</li>)}</ul>
      {progress.is_complete ? (
        <p className="gp-note"><CheckCircle2 size={14} aria-hidden="true" />{t('games.play.paths.stageDone')}</p>
      ) : remaining && (
        <p className="gp-req-left"><Hourglass size={14} aria-hidden="true" />{remaining}</p>
      )}
    </section>
  );
}

/** شارة حالة تحدٍّ داخل مرحلة: solved | in_progress | available | locked | upcoming | no_attempts. */
export function ChallengeStateBadge({ state }) {
  const { t } = useTranslation();
  const label = t(`games.play.paths.cstate.${state}`, { defaultValue: '' });
  if (!label) return null;
  if (state === 'solved') return <span className="gp-badge gp-badge-ok"><CheckCircle2 size={13} aria-hidden="true" />{label}</span>;
  if (state === 'in_progress' || state === 'available') return <span className="gp-badge gp-badge-open">{label}</span>;
  return <span className="gp-badge gp-badge-lock">{label}</span>;
}
