/**
 * src/services/supabase/internalFiles.service.js
 * Fichiers internes (0017) : bucket privé « internal-files », métadonnées dans `internal_files`.
 * Droits appliqués par la base (RLS + fonctions) ; téléchargement par lien signé de 60 s, journalisé côté serveur.
 */
import { supabase } from './client';
import { safeStorageName, validateInternalFile } from '../../utils/internalFiles';

const BUCKET = 'internal-files';
const SIGNED_URL_SECONDS = 60;

export async function fetchInternalFiles() {
  const { data, error } = await supabase
    .from('internal_files')
    .select('id, title, category, description, file_name, mime_type, size_bytes, uploaded_by_name, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Envoie le fichier puis enregistre ses métadonnées. Lève une Error avec `code` : empty | type | size. */
export async function uploadInternalFile(file, { title, category, description }) {
  const check = validateInternalFile(file);
  if (!check.ok) {
    const err = new Error(`invalid-file:${check.reason}`);
    err.code = check.reason;
    throw err;
  }
  const id = crypto.randomUUID();
  const path = `internal/${id}-${safeStorageName(file.name)}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: check.mime });
  if (upErr) throw upErr;

  const { error: insErr } = await supabase.from('internal_files').insert({
    title,
    category,
    description: description || null,
    storage_path: path,
    file_name: file.name.slice(0, 255),
    mime_type: check.mime,
    size_bytes: file.size,
  });
  if (insErr) {
    // Nettoyage au mieux : seuls developer/super_admin ont le droit de supprimer un objet ; sinon il reste orphelin.
    supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw insErr;
  }
}

/** Lien de téléchargement signé (60 s). L'accès est vérifié et journalisé par request_internal_file_download. */
export async function getInternalFileDownloadUrl(file) {
  const { data: path, error } = await supabase.rpc('request_internal_file_download', { p_id: file.id });
  if (error) throw error;
  const { data, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS, { download: file.file_name });
  if (signErr) throw signErr;
  return data.signedUrl;
}

/** Suppression logique (developer / super_admin) : le fichier disparaît de la liste ; l'objet reste dans le stockage. */
export async function softDeleteInternalFile(file) {
  // دالة SECURITY DEFINER (migration 0019): تتحقق من الدور وتنفّذ الحذف المنطقي وتسجّله.
  // الـ UPDATE المباشر كان يُرفض بسبب سياسات RLS حتى للمطوّر.
  const { error } = await supabase.rpc('soft_delete_internal_file', { p_id: file.id });
  if (error) throw error;
}
