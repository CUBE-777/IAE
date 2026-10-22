/**
 * src/services/supabase/projects.service.js
 * Lecture PUBLIQUE des projets (RLS : uniquement publiés et non supprimés).
 * Aucune donnée personnelle dans cette table.
 */
import { supabase } from './client';

const COLUMNS =
  'id, slug, title, summary, description, status, technologies, image_url, github_url, demo_url, sort_order, created_at, translations';

export async function fetchPublishedProjects(limit = 100) {
  const { data, error } = await supabase
    .from('projects')
    .select(COLUMNS)
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function fetchProjectBySlug(slug) {
  const { data, error } = await supabase
    .from('projects')
    .select(COLUMNS)
    .eq('slug', slug)
    .eq('is_published', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Existence de projets publiés (pour afficher le lien du menu) : une seule requête par session.
let existsPromise = null;
export function fetchPublishedProjectsExist() {
  if (!existsPromise) {
    existsPromise = supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('is_published', true)
      .is('deleted_at', null)
      .then(({ count, error }) => {
        if (error) throw error;
        return (count || 0) > 0;
      })
      .catch((err) => {
        existsPromise = null; // réessayer à la prochaine occasion
        console.error('Impossible de vérifier la présence de projets :', err);
        return false;
      });
  }
  return existsPromise;
}
