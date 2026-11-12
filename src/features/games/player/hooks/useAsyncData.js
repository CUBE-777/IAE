import { useCallback, useEffect, useRef, useState } from 'react';

/** { data, state: 'loading'|'ready'|'error', error, reload }. يتجاهل الردود المتأخرة. */
export function useAsyncData(loader, deps = []) {
  const [res, setRes] = useState({ data: null, state: 'loading', error: null });
  const [tick, setTick] = useState(0);
  const ref = useRef(loader);
  ref.current = loader;

  useEffect(() => {
    let alive = true;
    setRes((r) => ({ ...r, state: 'loading', error: null }));
    Promise.resolve()
      .then(() => ref.current())
      .then((data) => alive && setRes({ data, state: 'ready', error: null }))
      .catch((error) => {
        console.error('games data failed', error);
        if (alive) setRes({ data: null, state: 'error', error });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...res, reload };
}
