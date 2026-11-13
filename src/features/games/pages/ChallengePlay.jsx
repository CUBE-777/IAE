import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Timer, XCircle } from 'lucide-react';
import {
  getAttemptChallenge, getChallengeById, getChallengeLanguage, getChallenges, getGameCategories, getGames, getMyChallengeStatus, getOpenAttemptChallenge,
  measureClockOffset, startAttempt, submitAttempt,
} from '../services';
import { pickLocalized } from '../services/gamesCore.shared';
import { GAMES_PATHS } from '../constants/games';
import { KIND_RENDERERS, getPrompt, resolveAnswerType, toAnswer } from '../player/challengeTypes';
import { useAsyncData } from '../player/hooks/useAsyncData';
import { useCountdown } from '../player/hooks/useCountdown';
import ChallengeAnswer from '../player/components/ChallengeAnswer';
import { ChallengeMeta, SectionState } from '../player/components/PlayerUi';
import BuilderChallenge from '../player/interactive/BuilderChallenge';
import { isBuilderContent, sanitizeRaw } from '../player/interactive/builderContent';
import { clearDraft, loadDraft, saveDraft } from '../player/interactive/draftStore';
import { attemptsLeft, formatClock, isOpenNow, sortChallenges, statusMap } from '../player/utils';
import '../../../styles/games-interactive.css';

/** أخطاء تُنهي المحاولة الحالية في الواجهة (لا فائدة من إعادة الإرسال). غيرها يسمح بإعادة المحاولة (مثل انقطاع الشبكة). */
const FATAL_SUBMIT = ['attempt_already_finished', 'attempt_not_found', 'challenge_not_available', 'verification_unavailable', 'games_access_denied', 'attempt_version_unavailable'];

/**
 * واجهة التحدي. الخادم وحده يتحقق من الإجابة ويحسب النتيجة والنقاط والمدة (start_game_attempt/submit_game_attempt).
 * هنا: عرض المحتوى العلني، جمع الإجابة، إرسالها مرة واحدة، وعرض ما يردّه الخادم. العدّاد للعرض فقط. لا حلول ولا نقاط محلية.
 *
 * المحاولات المتبقية تأتي من الخادم دائمًا (get_my_challenge_status) وتُعاد قراءتها بعد كل نهاية محاولة (تسليم/انتهاء وقت)؛
 * ولا يُعرض «حاول مجددًا» إلا بعد وصول قراءة حديثة تثبت وجود محاولات. انتهاء الوقت في الواجهة يقفل الإدخال فقط:
 * لا إرسال تلقائي ولا نتيجة محلية، والخادم هو من يغلق المحاولة ويحسب ما يلزم.
 *
 * 6.5 — الإصدار المثبَّت: أثناء المحاولة يُعرض المحتوى دائمًا من إصدار المحاولة (game_attempts.challenge_version_id) لا من الإصدار الجاري:
 *   - فتح التحدي: get_my_open_attempt_challenge؛ إن وُجدت محاولة جارية لي تُستعاد تلقائيًا (بوقتها المتبقي) ولو سُحب نشر التحدي/اللعبة
 *     أو نُشر إصدار أحدث. لا تُنشأ محاولة ثانية.
 *   - بدء/استئناف بالزرّ: بعد start_game_attempt يُقرأ المحتوى من get_my_attempt_challenge بمعرّف المحاولة نفسها (لا من كتالوج التحدي)،
 *     فلا يختلف المعروض عن المصحَّح حتى لو نُشر إصدار جديد بين فتح الصفحة والبدء.
 *   - بلا محاولة جارية: الكتالوج المنشور كما كان (التحدي غير المنشور لا يُرى ولا تُنشأ له محاولة؛ الخادم يفرض ذلك).
 * تحديات المحرر (answer_type = 'builder') لها واجهة تفاعلية (player/interactive) وتأكيد قبل التسليم النهائي؛ والأنواع العامة القديمة كما هي.
 */
export default function ChallengePlay() {
  const { challengeId } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // 6.4: عند الوصول من صفحة مرحلة نُظهر وصلة العودة إليها (للتنقل فقط؛ لا يُبنى عليها أي قرار)
  const from = useLocation().state?.fromStage;
  const fromStage = typeof from?.id === 'string' && from.id.length <= 64 && typeof from?.title === 'string' && from.title
    ? { id: from.id, title: from.title.slice(0, 120) } : null;

  const [phase, setPhase] = useState('intro'); // intro | starting | playing | submitting | result | timeout
  const [attempt, setAttempt] = useState(null); // { id, expiresAt, offsetMs }
  const [play, setPlay] = useState(null); // { challenge, game, version } من إصدار المحاولة المثبَّت (6.5)؛ null خارج المحاولة
  const [raw, setRaw] = useState(undefined);
  const [result, setResult] = useState(null);
  const [errCode, setErrCode] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [restored, setRestored] = useState(false);
  const lock = useRef(false);
  const startingRef = useRef(false);
  const resultRef = useRef(null);
  const confirmRef = useRef(null);
  const autoRef = useRef(null); // آخر تحدٍّ استُؤنفت محاولته تلقائيًا (مرة واحدة لكل فتح)
  const runRef = useRef(0); // يتغيّر مع كل تنقّل بين التحديات فتُهمَل ردود الطلبات المتأخرة للتحدي السابق

  // حالة تحدياتي من الخادم. 'loading' أثناء أي قراءة (تُخفي «حاول مجددًا» حتى لا تُبنى على أرقام قديمة)، و'error' عند الفشل.
  const [statusRows, setStatusRows] = useState(null);
  const [statusPhase, setStatusPhase] = useState('loading'); // loading | ready | error
  const statusSeq = useRef(0);

  const data = useAsyncData(async () => {
    // محاولتي الجارية (إن وُجدت) بإصدارها المثبَّت، بالتوازي مع الكتالوج المنشور. فشلها «إصدار غير صالح» يُعرض بوضوح ولا يُستبدل بالجاري.
    const [open, challenge, games, categories, catalogVersion] = await Promise.all([
      getOpenAttemptChallenge(challengeId).then((p) => ({ p }), (err) => ({ err })),
      getChallengeById(challengeId), getGames(), getGameCategories(),
      getChallengeLanguage(challengeId).catch(() => null), // لغة الإصدار الجاري للعرض فقط؛ فشلها لا يمنع الصفحة (احتياط ar ← en ← fr)
    ]);
    if (open.err) {
      if (open.err.code === 'attempt_version_unavailable') return { challenge: null, blocked: open.err.code };
      throw open.err;
    }
    if (open.p) {
      const [offset, siblings] = await Promise.all([measureClockOffset(), getChallenges(open.p.game.id).catch(() => [])]);
      return { challenge: open.p.challenge, game: open.p.game, version: open.p.version || null, siblings, resume: open.p, offset };
    }
    const game = challenge ? games.find((g) => g.id === challenge.game_id) : null;
    const category = game ? categories.find((c) => c.id === game.category_id) : null;
    if (!challenge || !game || !category) return { challenge: null };
    const siblings = await getChallenges(game.id);
    return { challenge, game, version: catalogVersion, siblings };
  }, [challengeId]);

  const refreshStatus = useCallback(async () => {
    const seq = ++statusSeq.current;
    setStatusPhase('loading');
    try {
      const rows = await getMyChallengeStatus();
      if (seq !== statusSeq.current) return;
      setStatusRows(rows);
      setStatusPhase('ready');
    } catch (err) {
      console.error('games status failed', err);
      if (seq === statusSeq.current) setStatusPhase('error');
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [challengeId, refreshStatus]);
  useEffect(() => () => { statusSeq.current += 1; }, []);

  // تغيّر التحدي (تنقل) يعيد الحالة كاملة
  useEffect(() => {
    runRef.current += 1;
    setPhase('intro');
    setAttempt(null);
    setPlay(null);
    setRaw(undefined);
    setResult(null);
    setErrCode(null);
    setConfirming(false);
    setRestored(false);
    lock.current = false;
    startingRef.current = false;
  }, [challengeId]);

  // أثناء المحاولة: بيانات الإصدار المثبَّت (play). خارجها: الكتالوج المنشور (أو محاولتي الجارية عند أول فتح).
  const challenge = play?.challenge || data.data?.challenge || null;
  const game = play?.game || data.data?.game || null;
  // لغة الإصدار الافتراضية: من إصدار المحاولة المثبَّت أثناء اللعب، وإلا من حمولة الاستئناف/الإصدار الجاري المنشور. تحكم العنوان والوصف والمحتوى معًا.
  const defaultLang = (play?.version || data.data?.version)?.default_language || undefined;
  const st = useMemo(() => statusMap(statusRows), [statusRows]);
  const status = st[challengeId] || null;
  const type = challenge ? resolveAnswerType(challenge.content, game?.kind) : null;
  const left = useCountdown(attempt?.expiresAt || null, attempt?.offsetMs || 0, phase === 'playing');

  useEffect(() => {
    document.title = `${challenge ? pickLocalized(challenge.title, lang, defaultLang) : t('games.pageTitle')} — ${t('brand.name')}`;
  }, [challenge, lang, defaultLang, t]);

  /** يدخل وضع اللعب من حمولة محاولة (إصدارها المثبَّت). كل ما يُعرض بعدها يأتي منها. */
  const begin = useCallback((p, offsetMs) => {
    const content = p.challenge.content;
    setPlay({ challenge: p.challenge, game: p.game, version: p.version || null });
    setAttempt({ id: p.attempt.id, expiresAt: p.attempt.expires_at || null, offsetMs: Number.isFinite(offsetMs) ? offsetMs : 0 });
    // مسودّة الإجابة (اختيارات اللاعب فقط) من نفس الجلسة، مُنقّاة بمحتوى هذا الإصدار
    setRaw(isBuilderContent(content) ? sanitizeRaw(content, loadDraft(p.attempt.id)) : undefined);
    setResult(null);
    setConfirming(false);
    lock.current = false;
    setPhase('playing');
  }, []);

  // استئناف تلقائي لمحاولتي الجارية عند فتح التحدي (لا تُستهلك محاولة جديدة؛ الوقت المتبقي يأتي من expires_at على الخادم)
  useEffect(() => {
    const d = data.data;
    if (data.state !== 'ready' || !d?.resume || d.resume.challenge?.id !== challengeId || autoRef.current === challengeId || phase !== 'intro') return;
    autoRef.current = challengeId;
    if (resolveAnswerType(d.resume.challenge.content, d.resume.game?.kind) === null) {
      setErrCode('unsupported');
      return;
    }
    setRestored(true);
    begin(d.resume, d.offset);
  }, [data.state, data.data, challengeId, phase, begin]);

  // انتهى الوقت محليًا (للعرض): نقفل الإدخال ولا نرسل شيئًا. الخادم يحتسب المحاولة مستهلَكة ويغلقها عند أول طلب لاحق،
  // لذلك نعيد قراءة حالة المحاولات منه فورًا بدل الاعتماد على أرقام ما قبل البدء.
  useEffect(() => {
    if (phase === 'playing' && attempt?.expiresAt && left === 0) {
      clearDraft(attempt.id);
      setConfirming(false);
      setPhase('timeout');
      refreshStatus();
    }
  }, [phase, attempt, left, refreshStatus]);

  useEffect(() => {
    if (phase === 'result' || phase === 'timeout') resultRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  // حفظ مسودّة الاختيارات (تحدّيات المحرر فقط) كي لا تضيع بإعادة تحميل الصفحة أثناء المحاولة
  useEffect(() => {
    if (phase === 'playing' && attempt && type === 'builder') saveDraft(attempt.id, raw);
  }, [phase, attempt, type, raw]);

  const siblings = useMemo(() => sortChallenges((data.data?.siblings || []).filter((c) => isOpenNow(c)), 'order'), [data.data]);
  const next = useMemo(() => {
    const idx = siblings.findIndex((c) => c.id === challengeId);
    const after = siblings.slice(idx + 1).concat(siblings.slice(0, Math.max(idx, 0)));
    return after.find((c) => c.id !== challengeId && !st[c.id]?.solved) || null;
  }, [siblings, st, challengeId]);

  const start = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    const run = runRef.current;
    setErrCode(null);
    setRestored(false);
    setPhase('starting');
    try {
      // نقيس ساعة الخادم بالتوازي مع البدء، وبالطريقة نفسها للبدء الجديد والاستئناف. فشل القياس لا يمنع اللعب.
      const [a, serverOffset] = await Promise.all([startAttempt(challengeId), measureClockOffset()]);
      if (run !== runRef.current) return;
      let offsetMs = serverOffset;
      if (offsetMs === null) {
        // احتياط (لم تُطبَّق 0054 أو تعذّر القياس): البدء الجديد يُقدَّر من started_at (= الآن عند الخادم)، والاستئناف بلا مرجع
        offsetMs = a.resumed ? 0 : Date.now() - new Date(a.started_at).getTime();
      }
      // 6.5: المحتوى يُقرأ من إصدار هذه المحاولة بمعرّفها (للبدء الجديد والاستئناف معًا)، لا من كتالوج التحدي الذي قد يكون نُشر له إصدار أحدث
      const p = await getAttemptChallenge(a.attempt_id);
      if (run !== runRef.current) return;
      if (resolveAnswerType(p.challenge.content, p.game.kind) === null) {
        setErrCode('unsupported');
        setPhase('intro');
        refreshStatus();
        return;
      }
      setRestored(!!a.resumed);
      begin(p, offsetMs);
    } catch (err) {
      if (run !== runRef.current) return;
      setErrCode(err?.code || 'unknown');
      setPhase('intro');
      refreshStatus();
    } finally {
      if (run === runRef.current) startingRef.current = false;
    }
  };

  const submit = async () => {
    if (lock.current || phase !== 'playing' || !attempt || !challenge) return; // إرسال واحد لكل محاولة
    if (attempt.expiresAt && left === 0) return; // انتهى الوقت: لا نرسل شيئًا (ولا إرسال تلقائي أبدًا)
    const a = toAnswer(type, raw, challenge.content);
    if (!a.ok) {
      setConfirming(false);
      setErrCode(type === 'builder' ? 'answer_incomplete' : 'answer_required');
      return;
    }
    lock.current = true;
    const run = runRef.current;
    setErrCode(null);
    setConfirming(false);
    setPhase('submitting');
    try {
      const res = await submitAttempt(attempt.id, a.value);
      if (run !== runRef.current) return;
      clearDraft(attempt.id);
      if (res?.status === 'expired') setPhase('timeout');
      else {
        setResult(res);
        setPhase('result');
      }
      refreshStatus(); // في الدفعة نفسها مع تغيّر الطور: لا لحظة تُعرض فيها أرقام قديمة
    } catch (err) {
      if (run !== runRef.current) return;
      let code = err?.code || 'unknown';
      if (code === 'unknown' && typeof navigator !== 'undefined' && navigator.onLine === false) code = 'offline';
      setErrCode(code);
      if (FATAL_SUBMIT.includes(code)) {
        clearDraft(attempt.id);
        setPlay(null);
        setPhase('intro');
        refreshStatus();
      } else {
        lock.current = false; // فشل عابر (مثل انقطاع الشبكة): المحاولة ما تزال جارية على الخادم فيجوز إعادة الإرسال، والإجابة محفوظة في الصفحة
        setPhase('playing');
      }
    }
  };

  // تحدّيات المحرر: الضغط على «إرسال» يطلب تأكيدًا (إجابة واحدة لا رجعة فيها)، وغيرها يُرسل مباشرة كما كان
  const requestSubmit = () => {
    if (type !== 'builder') {
      submit();
      return;
    }
    if (lock.current || phase !== 'playing' || !challenge) return;
    if (!toAnswer(type, raw, challenge.content).ok) {
      setErrCode('answer_incomplete');
      return;
    }
    setErrCode(null);
    setConfirming(true);
  };

  if (data.state !== 'ready') {
    return <div className="gp-page"><SectionState state={data.state} error={data.error} onRetry={data.reload} /></div>;
  }
  // محاولة جارية (play أو resume) تُعرض ولو خرج التحدي من نافذته الزمنية بعد بدئها؛ الخادم هو من يقرّر المهلة والتسليم
  if (!challenge || (!play && !data.data?.resume && !isOpenNow(challenge))) {
    const blocked = data.data?.blocked;
    return (
      <div className="gp-page">
        <div className="gp-state gp-state-error" role="alert">
          <span>{blocked ? t(`games.play.errors.${blocked}`, { defaultValue: t('games.play.challengeUnavailable') }) : t('games.play.challengeUnavailable')}</span>
          <Link className="btn btn-ghost" to={game ? GAMES_PATHS.game(game.slug) : GAMES_PATHS.home}>{t('games.play.backGame')}</Link>
        </div>
      </div>
    );
  }

  const title = pickLocalized(challenge.title, lang, defaultLang);
  const gameTitle = pickLocalized(game.title, lang);
  // كل ما يخص المحاولات المتبقية يأتي من قراءة الخادم؛ بلا قراءة جاهزة لا نفترض شيئًا
  const statusReady = statusPhase === 'ready';
  const remaining = attemptsLeft(challenge, status);
  const hasOpen = statusReady && !!status?.open_attempt_id;
  const hasQuota = statusReady && (remaining === null || remaining > 0);
  const canStart = type !== null && statusPhase !== 'loading' && (statusPhase === 'error' || hasOpen || hasQuota); // عند فشل القراءة يقرّر الخادم
  const prompt = getPrompt(challenge.content, lang, defaultLang);
  const hint = challenge.content?.hint ? (typeof challenge.content.hint === 'string' ? challenge.content.hint : pickLocalized(challenge.content.hint, lang, defaultLang)) : '';
  const Custom = KIND_RENDERERS[game.kind];
  const errText = errCode ? t(`games.play.errors.${errCode}`, { defaultValue: t('games.play.errors.unknown') }) : '';
  const busy = phase === 'submitting';
  const urgent = left !== null && left <= 10;
  const isBuilder = type === 'builder';
  // العودة إلى المرحلة: من حالة التنقل إن وُجدت، وإلا من stage_id في التحدي (تبقى بعد إعادة تحميل الصفحة)
  const stageLink = fromStage || (typeof challenge.stage_id === 'string' && challenge.stage_id ? { id: challenge.stage_id, title: '' } : null);

  const backLinks = (
    <>
      {stageLink && <Link className="btn btn-ghost" to={GAMES_PATHS.stage(stageLink.id)}>{t('games.play.backStage')}</Link>}
      <Link className="btn btn-ghost" to={GAMES_PATHS.game(game.slug)}>{t('games.play.backGame')}</Link>
    </>
  );

  const renderActions = (offerPlay) => (
    <>
      {offerPlay && statusPhase === 'loading' && <p className="gp-sub" role="status">{t('games.play.checkingAttempts')}</p>}
      {offerPlay && statusPhase === 'error' && <p className="gp-sub">{t('games.play.statusUnavailable')}</p>}
      {offerPlay && statusReady && !hasOpen && !hasQuota && <p className="gp-sub">{t('games.play.noAttemptsLeft')}</p>}
      <div className="gp-actions">
        {offerPlay && statusReady && (hasOpen || hasQuota) && (
          <button type="button" className="btn btn-gold" onClick={start}>{hasOpen ? t('games.play.resume') : t('games.play.tryAgain')}</button>
        )}
        {offerPlay && statusPhase === 'error' && <button type="button" className="btn btn-ghost" onClick={refreshStatus}>{t('games.play.retry')}</button>}
        {next && <Link className="btn btn-gold" to={GAMES_PATHS.challenge(next.id)}>{t('games.play.nextChallenge')}</Link>}
        {backLinks}
      </div>
    </>
  );

  return (
    <div className={`gp-page gp-narrow${isBuilder ? ' gp-wide' : ''}`}>
      <nav className="gp-crumbs" aria-label={t('games.play.breadcrumb')}>
        <Link to={GAMES_PATHS.home}>{t('games.play.games')}</Link><span aria-hidden="true">/</span>
        <Link to={GAMES_PATHS.game(game.slug)}>{gameTitle}</Link><span aria-hidden="true">/</span>
        {fromStage && <><Link to={GAMES_PATHS.stage(fromStage.id)}>{fromStage.title}</Link><span aria-hidden="true">/</span></>}
        <span aria-current="page">{title}</span>
      </nav>

      <article className="gp-card gp-play">
        <header>
          <h1>{title}</h1>
          <ChallengeMeta challenge={challenge} />
          {status?.solved && <p className="gp-note"><CheckCircle2 size={14} aria-hidden="true" /> {t('games.play.alreadySolved')}</p>}
        </header>

        {errText && <p className="gp-alert" role="alert">{errText}</p>}

        {(phase === 'intro' || phase === 'starting') && (
          <div className="gp-intro">
            {challenge.description && <p className="gp-desc-full">{pickLocalized(challenge.description, lang, defaultLang)}</p>}
            <ul className="gp-rules">
              {challenge.time_limit_seconds ? <li>{t('games.play.ruleTimer', { time: formatClock(challenge.time_limit_seconds) })}</li> : null}
              {statusReady && remaining !== null && <li>{t('games.play.attemptsLeft', { count: remaining })}</li>}
              <li>{t('games.play.ruleOnce')}</li>
            </ul>
            {type === null && <p className="gp-alert" role="alert">{t('games.play.unsupported')}</p>}
            {type !== null && statusReady && !hasOpen && !hasQuota && <p className="gp-alert" role="alert">{t('games.play.noAttemptsLeft')}</p>}
            {statusPhase === 'error' && <p className="gp-sub">{t('games.play.statusUnavailable')}</p>}
            <div className="gp-actions">
              <button type="button" className="btn btn-gold" disabled={!canStart || phase === 'starting'} onClick={start}>
                {phase === 'starting' ? t('games.play.starting') : hasOpen ? t('games.play.resume') : t('games.play.start')}
              </button>
              {backLinks}
            </div>
          </div>
        )}

        {(phase === 'playing' || phase === 'submitting') && (
          <form className="gp-form" onSubmit={(e) => { e.preventDefault(); requestSubmit(); }} noValidate>
            {restored && phase === 'playing' && <p className="gp-sub" role="status">{t('games.play.restored')}</p>}
            {left !== null && (
              <p className={`gp-timer${urgent ? ' urgent' : ''}`} role="timer" aria-live="off">
                <Timer size={16} aria-hidden="true" /> {t('games.play.timeLeft')}: <b>{formatClock(left)}</b>
              </p>
            )}
            {isBuilder ? (
              <BuilderChallenge
                content={challenge.content}
                value={raw}
                onChange={setRaw}
                disabled={busy || confirming}
                lang={lang}
                defaultLang={defaultLang}
              />
            ) : (
              <>
                {prompt && prompt.split('\n').map((line, i) => <p key={i} className="gp-prompt">{line}</p>)}
                {hint && <p className="gp-sub">{t('games.play.hint')}: {hint}</p>}
                {Custom
                  ? <Custom challenge={challenge} content={challenge.content} value={raw} onChange={setRaw} disabled={busy} lang={lang} defaultLang={defaultLang} />
                  : <ChallengeAnswer type={type} content={challenge.content} value={raw} onChange={setRaw} disabled={busy} lang={lang} defaultLang={defaultLang} onEnter={submit} />}
              </>
            )}
            {confirming ? (
              <div className="gp-confirm" role="group" aria-label={t('games.play.confirmTitle')}>
                <p><strong>{t('games.play.confirmTitle')}</strong> {t('games.play.confirmText')}</p>
                <div className="gp-actions">
                  <button type="button" ref={confirmRef} className="btn btn-gold" disabled={busy} onClick={submit}>{t('games.play.confirmYes')}</button>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>{t('games.play.confirmBack')}</button>
                </div>
              </div>
            ) : (
              <div className="gp-actions">
                <button type="submit" className="btn btn-gold" disabled={busy}>{busy ? t('games.play.submitting') : t('games.play.submit')}</button>
              </div>
            )}
          </form>
        )}

        {phase === 'timeout' && (
          <div className="gp-result gp-result-bad" role="status">
            <h2 ref={resultRef} tabIndex={-1}><Timer size={20} aria-hidden="true" /> {t('games.play.timeUp')}</h2>
            <p>{statusReady && hasOpen ? t('games.play.timeStillOpen') : t('games.play.timeUpText')}</p>
            {renderActions(true)}
          </div>
        )}

        {phase === 'result' && result && (
          <div className={`gp-result ${result.is_correct ? 'gp-result-ok' : 'gp-result-bad'}`} role="status" aria-live="polite">
            <h2 ref={resultRef} tabIndex={-1}>
              {result.is_correct ? <CheckCircle2 size={22} aria-hidden="true" /> : <XCircle size={22} aria-hidden="true" />}{' '}
              {result.is_correct ? t('games.play.correct') : t('games.play.incorrect')}
            </h2>
            <dl className="gp-stats">
              <div><dt>{t('games.play.score')}</dt><dd>{result.score}</dd></div>
              <div><dt>{t('games.play.pointsEarned')}</dt><dd>+{result.points_awarded}</dd></div>
              <div><dt>{t('games.play.totalPoints')}</dt><dd>{result.total_points}</dd></div>
              {result.level && <div><dt>{t('games.play.level')}</dt><dd>{result.level.level} — {pickLocalized(result.level.title, lang)}</dd></div>}
            </dl>
            {result.is_correct && result.points_awarded === 0 && <p className="gp-sub">{t('games.play.noPointsRepeat')}</p>}
            {Array.isArray(result.achievements) && result.achievements.length > 0 && (
              <div className="gp-unlocked">
                <h3>{t('games.play.achievementUnlocked')}</h3>
                <ul>{result.achievements.map((a) => <li key={a.id}>{pickLocalized(a.title, lang)}{a.points_bonus > 0 ? ` (+${a.points_bonus})` : ''}</li>)}</ul>
              </div>
            )}
            {renderActions(!result.is_correct)}
          </div>
        )}
      </article>
    </div>
  );
}
