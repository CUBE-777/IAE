import { useEffect, useState } from 'react';
import { fetchPublishedProjectsExist } from '../services/supabase/projects.service';

/** true uniquement s'il existe au moins un projet publié (le lien de menu n'apparaît pas sinon). */
export function useHasProjects() {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchPublishedProjectsExist().then((v) => alive && setHas(v));
    return () => {
      alive = false;
    };
  }, []);
  return has;
}
