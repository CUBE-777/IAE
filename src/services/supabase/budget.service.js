/**
 * src/services/supabase/budget.service.js
 * قسم الميزانية. الحماية الفعلية في قاعدة البيانات (RLS + can_manage_budget)،
 * وسجل التدقيق يُكتب تلقائيًا بـ triggers (لا يُستدعى logAction من هنا).
 */
import { supabase } from './client';
import { compressImage } from '../../utils/imageCompress';

import { tr } from '../../i18n/adminDict';
const RECEIPT_BUCKET = 'budget-receipts';
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_RECEIPT = 5 * 1024 * 1024;
const MAX_RECEIPT_INPUT = 15 * 1024 * 1024;

export async function fetchCategories() {
  const { data, error } = await supabase.from('budget_categories').select('*').order('name');
  if (error) throw error;
  return data || [];
}

export async function createCategory({ name, kind }) {
  const { data, error } = await supabase
    .from('budget_categories')
    .insert({ name: name.trim(), kind })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id, patch) {
  const { error } = await supabase.from('budget_categories').update(patch).eq('id', id);
  if (error) throw error;
}

/** كل المعاملات (جمعية صغيرة: آلاف قليلة كحد أقصى). الفرز والتصفية في الواجهة. */
export async function fetchTransactions() {
  const { data, error } = await supabase
    .from('budget_transactions')
    .select('*, budget_categories(name)')
    .order('tx_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;
  return data || [];
}

export async function createTransaction(payload) {
  const { data, error } = await supabase.from('budget_transactions').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateTransaction(id, patch) {
  const { error } = await supabase.from('budget_transactions').update(patch).eq('id', id);
  if (error) throw error;
}

export async function voidTransaction(id, reason) {
  const { error } = await supabase
    .from('budget_transactions')
    .update({ status: 'voided', void_reason: reason.trim() })
    .eq('id', id);
  if (error) throw error;
}

/** يرفع إيصالًا (صورة تُضغط تلقائيًا أو PDF) إلى المخزن الخاص ويُرجع مساره (ليس رابطًا عامًا). */
export async function uploadReceipt(file) {
  if (!RECEIPT_TYPES.includes(file.type)) {
    throw new Error(tr('نوع الإيصال غير مدعوم، استخدم صورة (JPG/PNG/WEBP) أو PDF.'));
  }
  if (file.size > MAX_RECEIPT_INPUT) throw new Error(tr('حجم الإيصال أكبر من 15MB.'));
  const prepared = file.type === 'application/pdf' ? file : await compressImage(file);
  if (prepared.size > MAX_RECEIPT) throw new Error(tr('حجم الإيصال أكبر من 5MB.'));
  const safe = prepared.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${new Date().getFullYear()}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, prepared, { upsert: false, contentType: prepared.type });
  if (error) throw error;
  return path;
}

/** رابط مؤقت (5 دقائق) لعرض الإيصال. */
export async function getReceiptUrl(path) {
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}
