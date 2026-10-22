/**
 * src/services/supabase/adminProjects.service.js
 * CRUD d'administration des projets. Les droits réels sont appliqués par la RLS
 * (can_manage_content) ; l'audit est écrit par un trigger de la base (0016).
 */
import { supabase } from './client';
import { deleteImageByUrl } from './storage.service';
import { slugifyProject } from '../../utils/projects';

export async function fetchProjectsAdmin() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Crée (existing = null) ou met à jour un projet. Un nouveau projet est toujours créé en brouillon. */
export async function saveProject(existing, payload) {
  if (!existing) {
    const { data, error } = await supabase
      .from('projects')
      .insert({ ...payload, slug: slugifyProject(payload.title), is_published: false })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('projects')
    .update(payload)
    .eq('id', existing.id)
    .select()
    .single();
  if (error) throw error;
  // Ancienne image devenue orpheline après remplacement : nettoyage sans bloquer
  if (existing.image_url && existing.image_url !== payload.image_url) {
    deleteImageByUrl(existing.image_url);
  }
  return data;
}

export async function setProjectPublished(project, isPublished) {
  const { error } = await supabase.from('projects').update({ is_published: isPublished }).eq('id', project.id);
  if (error) throw error;
}

export async function softDeleteProject(project) {
  const { error } = await supabase
    .from('projects')
    .update({ deleted_at: new Date().toISOString(), is_published: false })
    .eq('id', project.id);
  if (error) throw error;
}
