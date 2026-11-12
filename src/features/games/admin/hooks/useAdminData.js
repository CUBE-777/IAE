import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * تحميل بيانات لوحة الإدارة: { data, state: 'loading'|'error'|'ready', reload }.
 * يتجاهل الردود المتأخرة بعد إلغاء التركيب أو تغيّر deps.
 */
export function useAdminData(loader, deps = []) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setState('loading');
    Promise.resolve()
      .then(() => loaderRef.current())
      .then((d) => {
        if (!alive) return;
        setData(d);
        setState('ready');
      })
      .catch((err) => {
        console.error('games admin load failed', err);
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, state, reload };
}
