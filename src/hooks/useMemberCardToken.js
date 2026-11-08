import { useCallback, useEffect, useRef, useState } from 'react';
import { issueMemberCardToken, regenerateMemberCardToken } from '../services/supabase/memberSpace.service';
import { classifyIssueError } from '../utils/memberCardToken';

/**
 * رمز بطاقة العضوية الثابت (0042). يُجلب مرة واحدة عند فتح الصفحة ولا يتجدد تلقائيًا ولا يُحسب له عدّ تنازلي:
 * الرمز نفسه يظهر دائمًا حتى يضغط العضو «رمز جديد» (regenerate) فيتوقف القديم فورًا.
 * فشل الشبكة يُبقي الرمز الأخير إن وُجد ويُظهر `problem`.
 *
 * الرمز يعيش في ذاكرة المكوّن فقط: لا localStorage ولا sessionStorage ولا رابط ولا console.
 *
 * @returns {{ token: string|null, loading: boolean, regenerating: boolean,
 *            problem: null|'rate_limited'|'forbidden'|'error', refresh: () => void, regenerate: () => Promise<boolean> }}
 */
export function useMemberCardToken() {
  const [token, setToken] = useState(null);
  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const aliveRef = useRef(false);
  const inflightRef = useRef(false);

  const run = useCallback(async (call, setBusy) => {
    if (inflightRef.current) return false; // لا طلبان متوازيان
    inflightRef.current = true;
    setBusy(true);
    try {
      const res = await call();
      if (!aliveRef.current) return false;
      if (!res || typeof res.token !== 'string' || !res.token) throw new Error('empty token');
      setToken(res.token);
      setProblem(null);
      return true;
    } catch (err) {
      if (aliveRef.current) setProblem(classifyIssueError(err));
      return false;
    } finally {
      inflightRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  }, []);

  const refresh = useCallback(() => { run(issueMemberCardToken, setLoading); }, [run]);
  const regenerate = useCallback(() => run(regenerateMemberCardToken, setRegenerating), [run]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    return () => { aliveRef.current = false; };
  }, [refresh]);

  return { token, loading, regenerating, problem, refresh, regenerate };
}
