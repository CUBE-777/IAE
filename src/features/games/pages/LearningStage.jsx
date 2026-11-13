import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Lock } from 'lucide-react';
import { getMyLearningStage } from '../services';
import { pickLocalized } from '../services/gamesCore.shared';
import { GAMES_PATHS } from '../constants/games';
import { useAsyncData } from '../player/hooks/useAsyncData';
import { ChallengeMeta, SectionState } from '../player/components/PlayerUi';
import { ChallengeStateBadge, LockNotice, PathsSkeleton, RequirementPanel, StageStateBadge } from '../player/components/PathsUi';
import { formatDateTime } from '../player/utils';

/**
 * صفحة مرحلة: حالتها وسبب قفلها، شرط الإكمال والمتبقي، تحدياتها (المطلوبة والمنجزة والمتبقية)، والانتقال للسابقة/التالية.
 * القيم كلّها من get_my_learning_stage (0058). زر «العب» لا يمنح شيئًا: start_game_attempt يفرض الفتح على الخادم.
 */
export default function LearningStage() {
  const { stageId } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const data = useAsyncData(() => getMyLearningStage(stageId), [stageId]);
  const d = data.data;
  const dir = i18n.dir?.() === 'rtl' ? 'rtl' : 'ltr';
  const Forward = dir === 'rtl' ? ArrowLeft : ArrowRight;
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;

  useEffect(() => {
    document.title = `${d ? pickLocalized(d.stage.title, lang) : t('games.play.paths.title')} — ${t('brand.name')}`;
  }, [d, lang, t]);

  if (data.state === 'loading') return <div className="gp-page"><PathsSkeleton rows={3} /></div>;
  if (data.state === 'error') {
    if (data.error?.code === 'stage_not_available') {
      return (
        <div className="gp-page">
          <div className="gp-state gp-state-error" role="alert">
            <span>{t('games.play.paths.stageNotFound')}</span>
            <Link className="btn btn-ghost" to={GAMES_PATHS.paths}>{t('games.play.paths.backToPaths')}</Link>
          </div>
        </div>
      );
    }
    return <div className="gp-page"><SectionState state="error" error={data.error} onRetry={data.reload} /></div>;
  }

  const stageTitle = pickLocalized(d.stage.title, lang);
  const challenges = d.challenges || [];
  const required = challenges.filter((c) => c.is_required);
  const solvedCount = challenges.filter((c) => c.solved).length;
  const unlockMode = d.category.stage_unlock_mode;
  const next = d.next_stage;

  return (
    <div className="gp-page">
      <nav className="gp-crumbs" aria-label={t('games.play.breadcrumb')}>
        <Link to={GAMES_PATHS.paths}>{t('games.play.paths.title')}</Link><span aria-hidden="true">/</span>
        <Link to={GAMES_PATHS.track(d.track.id)}>{pickLocalized(d.track.title, lang)}</Link><span aria-hidden="true">/</span>
        <Link to={GAMES_PATHS.track(d.track.id, d.category.id)}>{pickLocalized(d.category.title, lang)}</Link><span aria-hidden="true">/</span>
        <span aria-current="page">{stageTitle}</span>
      </nav>

      <header className="gp-card gp-game-head">
        <div className="gp-stage-top">
          <h1>{stageTitle}</h1>
          <StageStateBadge state={d.state} />
        </div>
        {d.stage.description && <p className="gp-desc-full">{pickLocalized(d.stage.description, lang)}</p>}
        {!d.is_unlocked && <LockNotice reason={d.lock_reason} lang={lang} withLink />}
      </header>

      <RequirementPanel progress={d.progress} />

      <section className="gp-section" aria-labelledby="gp-stage-ch">
        <div className="gp-section-head">
          <h2 id="gp-stage-ch">{t('games.play.challenges')}</h2>
          {challenges.length > 0 && (
            <span className="gp-sub">
              {t('games.play.paths.fact.solvedOf', { solved: solvedCount, total: challenges.length })}
              {required.length > 0 && ` · ${t('games.play.paths.fact.requiredDone', { done: required.filter((c) => c.solved).length, total: required.length })}`}
            </span>
          )}
        </div>
        {challenges.length === 0 ? (
          <SectionState state="empty" emptyText={t('games.play.paths.noChallenges')} />
        ) : (
          <ul className="gp-chal-list">
            {challenges.map((c) => (
              <li key={c.id} className={`gp-card gp-chal-row gp-chal-${c.state}`}>
                <div className="gp-stage-top">
                  <h3>{c.upcoming ? t('games.play.paths.upcomingTitle') : pickLocalized(c.title, lang)}</h3>
                  <ChallengeStateBadge state={c.state} />
                </div>
                {!c.upcoming && c.description && <p className="gp-desc">{pickLocalized(c.description, lang)}</p>}
                <ul className="gp-meta">
                  <li>{c.is_required ? t('games.play.paths.required') : t('games.play.paths.optional')}</li>
                </ul>
                {!c.upcoming && <ChallengeMeta challenge={c} />}
                {c.attempts_left !== null && c.attempts_left !== undefined && !c.upcoming && (
                  <p className="gp-sub">{t('games.play.attemptsLeft', { count: c.attempts_left })}</p>
                )}
                <div className="gp-actions">
                  {c.can_play ? (
                    <Link
                      className="btn btn-gold"
                      to={GAMES_PATHS.challenge(c.id)}
                      state={{ fromStage: { id: d.stage.id, title: stageTitle } }}
                    >
                      {c.open_attempt_id ? t('games.play.resume') : c.solved ? t('games.play.playAgain') : t('games.play.play')}
                    </Link>
                  ) : (
                    <span className="gp-sub gp-chal-why">
                      {c.state === 'locked' && <><Lock size={13} aria-hidden="true" /> {t('games.play.paths.challengeLocked')}</>}
                      {c.state === 'upcoming' && t('games.play.paths.opensAt', { date: formatDateTime(c.starts_at, lang) })}
                      {c.state === 'no_attempts' && t('games.play.noAttemptsLeft')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(d.previous_stage || next) && (
        <nav className="gp-stage-nav" aria-label={t('games.play.paths.stageNav')}>
          {d.previous_stage ? (
            <Link className="btn btn-ghost" to={GAMES_PATHS.stage(d.previous_stage.id)}>
              <Back size={16} aria-hidden="true" /> {t('games.play.paths.previousStage')}: {pickLocalized(d.previous_stage.title, lang)}
            </Link>
          ) : <span />}
          {next && (
            <div className="gp-stage-next">
              <Link className="btn btn-ghost" to={GAMES_PATHS.stage(next.id)}>
                {t('games.play.paths.nextStage')}: {pickLocalized(next.title, lang)} <Forward size={16} aria-hidden="true" />
              </Link>
              <span className="gp-sub">
                {next.is_unlocked
                  ? t('games.play.paths.nextOpen')
                  : unlockMode === 'manual' ? t('games.play.paths.nextManual') : t('games.play.paths.nextAfterThis')}
              </span>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}
