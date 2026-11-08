import { useCallback, useEffect, useRef, useState } from 'react';
import { issueMemberCardToken } from '../services/supabase/memberSpace.service';
import {
  CARD_TOKEN_TTL_MS, CARD_REFRESH_MS, CARD_RETRY_MS, CARD_RATE_LIMIT_RETRY_MS,
  classifyIssueError, secondsLeft, shouldRefreshOnReturn,
} from '../utils/memberCardToken';

/**
 * رمز بطاقة العضوية المتجدد (0040). يجلب عند التحميل ويجدّد كل 90 ثانية (صلاحيته 120)، ويتوقف حين تُخفى الصفحة
 * ويجدّد عند العودة إن حان وقته. فشل الشبكة أو rate_limited يُبقيان الرمز الأخير حتى ينتهي ثم تظهر `problem`.
 *
 * الرمز يعيش في ذاكرة المكوّن فقط: لا localStorage ولا sessionStorage ولا رابط ولا console.
 * الانتهاء يُحسب محليًا من لحظة إرسال الطلب (+120ث): أدقّ تحفّظًا من الاعتماد على ساعة الجهاز مقابل ساعة الخادم.
 *
 * @returns {{ token: string|null, secondsLeft: number, loading: boolean,
 *            problem: null|'rate_limited'|'forbidden'|'error', refresh: () => void }}
 */
export function useMemberCardToken() {
  const [current, setCurrent] = useState(null); // { value, expiresAt, refreshAt }
  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);

  const currentRef = useRef(null);
  const timerRef = useRef(null);
  const inflightRef = useRef(false);
  const aliveRef = useRef(false);
  const fetchRef = useRef(() => {});

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback((ms) => {
    clearTimer();
    timerRef.current = setTimeout(() => fetchRef.current(), ms);
  }, [clearTimer]);

  const fetchToken = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);
    const startedAt = Date.now();
    try {
      const res = await issueMemberCardToken();
      if (!aliveRef.current) return;
      if (!res || typeof res.token !== 'string' || !res.token) throw new Error('empty token');
      const next = { value: res.token, expiresAt: startedAt + CARD_TOKEN_TTL_MS, refreshAt: startedAt + CARD_REFRESH_MS };
      currentRef.current = next;
      setCurrent(next);
      setProblem(null);
      setNow(Date.now());
      if (!document.hidden) schedule(CARD_REFRESH_MS);
    } catch (err) {
      if (!aliveRef.current) return;
      const kind = classifyIssueError(err);
      setProblem(kind);
      setNow(Date.now());
      if (kind !== 'forbidden' && !document.hidden) schedule(kind === 'rate_limited' ? CARD_RATE_LIMIT_RETRY_MS : CARD_RETRY_MS);
    } finally {
      inflightRef.current = false;
      if (aliveRef.current) setLoading(false);
    }
  }, [schedule]);

  useEffect(() => { fetchRef.current = fetchToken; }, [fetchToken]);

  // التحميل الأول + تنظيف المؤقتات عند unmount
  useEffect(() => {
    aliveRef.current = true;
    fetchToken();
    return () => {
      aliveRef.current = false;
      clearTimer();
    };
  }, [fetchToken, clearTimer]);

  // الإخفاء يوقف المؤقتات؛ الظهور يجدّد إن حان الوقت وإلا يعيد الجدولة بما تبقّى
  useEffect(() => {
    const onVisibility = () => {
      const isVisible = !document.hidden;
      setVisible(isVisible);
      if (!isVisible) { clearTimer(); return; }
      const t = currentRef.current;
      setNow(Date.now());
      if (shouldRefreshOnReturn(t, Date.now())) fetchRef.current();
      else schedule(Math.max(0, t.refreshAt - Date.now()));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [clearTimer, schedule]);

  // نبضة الثانية للعدّ التنازلي: فقط والصفحة ظاهرة ويوجد رمز
  useEffect(() => {
    if (!visible || !current) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, current]);

  const refresh = useCallback(() => {
    clearTimer();
    fetchToken();
  }, [clearTimer, fetchToken]);

  const left = current ? secondsLeft(current.expiresAt, now) : 0;
  return {
    token: current && left > 0 ? current.value : null,
    secondsLeft: left,
    loading,
    problem,
    refresh,
  };
}
