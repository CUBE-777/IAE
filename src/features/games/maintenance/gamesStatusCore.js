/**
 * src/features/games/maintenance/gamesStatusCore.js — منطق حالة قسم الألعاب (وضع الصيانة) بلا اعتماد على Supabase أو React،
 * ليُختبر بـ node:test. الربط الفعلي بـ Supabase في gamesStatus.service.js.
 *
 * الحالة: { phase: 'loading' | 'ready' | 'error', status: 'enabled' | 'maintenance' | null }
 *  - loading: أول جلب لم يكتمل (لا حالة معروفة بعد).
 *  - ready:   حالة معروفة. أي فشل لاحق (شبكة) يُبقي آخر حالة معروفة ولا يقلب الواجهة (لا وميض ولا رفض خاطئ).
 *  - error:   فشل الجلب الأول ولا حالة معروفة ⇒ تعرض الواجهة «إعادة المحاولة». الخادم يطبّق الحماية في كل الأحوال.
 */

export const GAMES_STATUS_KEY = 'games_section_status';
export const GAMES_STATUS = Object.freeze({ ENABLED: 'enabled', MAINTENANCE: 'maintenance' });

/** أي قيمة غير 'maintenance' صراحةً تُعدّ enabled (نفس منطق games_section_enabled() في SQL). */
export function normalizeGamesStatus(value) {
  return String(value ?? '').trim().toLowerCase() === GAMES_STATUS.MAINTENANCE ? GAMES_STATUS.MAINTENANCE : GAMES_STATUS.ENABLED;
}

/** خطأ «الدالة غير موجودة» = واجهة نُشرت قبل تنفيذ 0062: نُبقي سلوك الإنتاج الحالي (enabled) بدل كسر الألعاب. */
export function isMissingStatusFunction(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(msg);
}

/**
 * مخزن حالة مشترك (مثيل واحد للتطبيق) متوافق مع useSyncExternalStore.
 * deps: { fetchStatus(): Promise<'enabled'|'maintenance'>, listen(onChange): () => void (Realtime، اختياري), pollMs, isVisible(), addVisibilityListener(cb): () => void }
 * يبدأ العمل (جلب + Realtime + مؤقّت) مع أول مشترك ويتوقف مع آخر مشترك — فلا اتصالات لمن لا يفتح الألعاب أو الإعدادات.
 */
export function createGamesStatusStore(deps) {
  const {
    fetchStatus,
    listen = () => () => {},
    pollMs = 45000,
    isVisible = () => true,
    addVisibilityListener = () => () => {},
    setTimer = setInterval,
    clearTimer = clearInterval,
  } = deps;

  let state = { phase: 'loading', status: null };
  const subs = new Set();
  let stops = null;
  let inflight = null;
  let again = false;

  const set = (next) => {
    if (next.phase === state.phase && next.status === state.status) return;
    state = next;
    subs.forEach((cb) => cb());
  };

  /**
   * جلب واحد في الوقت. طلب refresh أثناء جلب جارٍ (مثلًا حدث Realtime بعد أن بدأ الجلب القديم) يُسجَّل ويُعاد مرة واحدة
   * بعد انتهاء الجاري، فلا تبقى نتيجة قديمة (سبقت التغيير) حتى المؤقّت التالي.
   */
  function refresh() {
    if (inflight) { again = true; return inflight; }
    inflight = Promise.resolve()
      .then(fetchStatus)
      .then((value) => set({ phase: 'ready', status: normalizeGamesStatus(value) }))
      .catch((err) => {
        console.error('games section status failed', err);
        if (state.status == null) set({ phase: 'error', status: null });
      })
      .finally(() => {
        inflight = null;
        if (again && subs.size > 0) { again = false; refresh(); } else { again = false; }
      });
    return inflight;
  }

  /** إعادة المحاولة بعد خطأ: يرجع إلى loading ثم يجلب. */
  function retry() {
    if (state.status == null) set({ phase: 'loading', status: null });
    return refresh();
  }

  function start() {
    refresh();
    const stopListen = listen(() => refresh());
    const timer = setTimer(() => { if (isVisible()) refresh(); }, pollMs);
    const stopVis = addVisibilityListener(() => { if (isVisible()) refresh(); });
    stops = () => { clearTimer(timer); try { stopListen?.(); } catch { /* ignore */ } try { stopVis?.(); } catch { /* ignore */ } };
  }

  function subscribe(cb) {
    subs.add(cb);
    if (subs.size === 1) start();
    return () => {
      subs.delete(cb);
      if (subs.size === 0 && stops) { stops(); stops = null; }
    };
  }

  return { subscribe, getSnapshot: () => state, refresh, retry };
}
