import { useState } from 'react';
import Modal from '../../components/admin/Modal';
import {
  createTransaction, updateTransaction, voidTransaction, uploadReceipt,
  createCategory, updateCategory,
} from '../../services/supabase/budget.service';

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const KIND_LABEL = { income: 'إيراد', expense: 'مصروف', both: 'الاثنان' };
export { KIND_LABEL };

/** إضافة / تعديل معاملة */
export function TransactionModal({ tx, categories, onClose, onSaved }) {
  const isEdit = !!tx;
  const [values, setValues] = useState({
    kind: tx?.kind || 'expense',
    amount: tx ? String(tx.amount) : '',
    tx_date: tx?.tx_date || todayStr(),
    category_id: tx?.category_id || '',
    counterparty: tx?.counterparty || '',
    description: tx?.description || '',
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleChange = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }));

  // الفئات المناسبة لنوع المعاملة (الفعّالة، مع إبقاء الفئة الحالية عند التعديل)
  const options = categories.filter(
    (c) => (c.kind === 'both' || c.kind === values.kind) && (c.is_active || c.id === tx?.category_id)
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amount = Math.round(Number(String(values.amount).replace(',', '.')) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      window.notify?.error('أدخل مبلغًا صحيحًا أكبر من صفر');
      return;
    }
    setSaving(true);
    const toast = window.notify?.loading('جاري الحفظ...');
    try {
      const payload = {
        kind: values.kind,
        amount,
        tx_date: values.tx_date,
        category_id: values.category_id || null,
        counterparty: values.counterparty.trim() || null,
        description: values.description.trim() || null,
      };
      if (file) payload.receipt_path = await uploadReceipt(file);
      if (isEdit) await updateTransaction(tx.id, payload);
      else await createTransaction(payload);
      toast?.remove();
      window.notify?.success(isEdit ? 'تم حفظ التعديل' : 'تمت إضافة المعاملة');
      onSaved();
    } catch (err) {
      toast?.remove();
      window.notify?.fromError(err, 'تعذر حفظ المعاملة');
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{isEdit ? 'تعديل معاملة' : 'إضافة معاملة'}</h3>
      <form onSubmit={handleSubmit}>
        <div className="admin-form-grid-2">
          <div className="admin-form-group">
            <label htmlFor="b_kind">النوع *</label>
            <select id="b_kind" name="kind" className="admin-select" value={values.kind} onChange={(e) => setValues((v) => ({ ...v, kind: e.target.value, category_id: '' }))}>
              <option value="expense">مصروف</option>
              <option value="income">إيراد</option>
            </select>
          </div>
          <div className="admin-form-group">
            <label htmlFor="b_amount">المبلغ (درهم) *</label>
            <input id="b_amount" name="amount" className="admin-input" inputMode="decimal" dir="ltr" required value={values.amount} onChange={handleChange} placeholder="0.00" />
          </div>
        </div>
        <div className="admin-form-grid-2">
          <div className="admin-form-group">
            <label htmlFor="b_date">التاريخ *</label>
            <input id="b_date" name="tx_date" type="date" className="admin-input" required value={values.tx_date} onChange={handleChange} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="b_cat">الفئة</label>
            <select id="b_cat" name="category_id" className="admin-select" value={values.category_id} onChange={handleChange}>
              <option value="">— بدون فئة —</option>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="admin-form-group">
          <label htmlFor="b_party">{values.kind === 'income' ? 'المصدر (من دفع)' : 'المستفيد (لمن دُفع)'}</label>
          <input id="b_party" name="counterparty" className="admin-input" maxLength={120} value={values.counterparty} onChange={handleChange} />
        </div>
        <div className="admin-form-group">
          <label htmlFor="b_desc">الوصف</label>
          <textarea id="b_desc" name="description" className="admin-textarea" rows={2} maxLength={300} value={values.description} onChange={handleChange} />
        </div>
        <div className="admin-form-group">
          <label htmlFor="b_file">الإيصال (صورة أو PDF — اختياري)</label>
          <input id="b_file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="admin-input" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {isEdit && tx.receipt_path && !file && (
            <p className="admin-hint">للمعاملة إيصال محفوظ. اختيار ملف جديد يستبدل المرجع إليه (الإيصال القديم يبقى محفوظًا في السجلات).</p>
          )}
        </div>
        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}

/** إلغاء معاملة (لا حذف نهائي): السبب إلزامي */
export function VoidModal({ tx, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      window.notify?.error('اكتب سبب الإلغاء (3 أحرف على الأقل)');
      return;
    }
    setSaving(true);
    try {
      await voidTransaction(tx.id, reason);
      window.notify?.success('تم إلغاء المعاملة وبقي أثرها في السجل');
      onDone();
    } catch (err) {
      window.notify?.fromError(err, 'تعذر إلغاء المعاملة');
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>إلغاء معاملة</h3>
      <p>لا تُحذف المعاملة نهائيًا، بل تُستثنى من المجاميع ويبقى سبب الإلغاء في السجل ولا يمكن التراجع عنه.</p>
      <p><strong>{tx.description || tx.counterparty || 'معاملة'}</strong> — {Number(tx.amount).toFixed(2)} د.م.</p>
      <form onSubmit={submit}>
        <div className="admin-form-group">
          <label htmlFor="v_reason">سبب الإلغاء *</label>
          <textarea id="v_reason" className="admin-textarea" rows={2} maxLength={300} required value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-danger" disabled={saving}>{saving ? '...' : 'تأكيد الإلغاء'}</button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose} disabled={saving}>رجوع</button>
        </div>
      </form>
    </Modal>
  );
}

/** إدارة الفئات */
export function CategoriesModal({ categories, onClose, onChanged }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('expense');
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      window.notify?.error('اسم الفئة قصير جدًا');
      return;
    }
    setBusy(true);
    try {
      await createCategory({ name, kind });
      setName('');
      onChanged();
    } catch (err) {
      window.notify?.fromError(err, 'تعذر إضافة الفئة (قد تكون موجودة)');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c) => {
    setBusy(true);
    try {
      await updateCategory(c.id, { is_active: !c.is_active });
      onChanged();
    } catch (err) {
      window.notify?.fromError(err, 'تعذر تحديث الفئة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>فئات الميزانية</h3>
      <form onSubmit={add} className="admin-form-grid-2" style={{ alignItems: 'end' }}>
        <div className="admin-form-group">
          <label htmlFor="c_name">فئة جديدة</label>
          <input id="c_name" className="admin-input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="admin-form-group" style={{ display: 'flex', gap: 8 }}>
          <select aria-label="نوع الفئة" className="admin-select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="expense">مصروف</option>
            <option value="income">إيراد</option>
            <option value="both">الاثنان</option>
          </select>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>إضافة</button>
        </div>
      </form>
      <ul className="budget-cat-list">
        {categories.map((c) => (
          <li key={c.id} className={c.is_active ? '' : 'is-off'}>
            <span>{c.name} <small>({KIND_LABEL[c.kind]})</small></span>
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => toggle(c)}>
              {c.is_active ? 'إيقاف' : 'تفعيل'}
            </button>
          </li>
        ))}
      </ul>
      <p className="admin-hint">الفئة الموقوفة لا تظهر عند إضافة معاملات جديدة، وتبقى ظاهرة في المعاملات القديمة. لا تُحذف الفئات حفاظًا على السجل.</p>
      <div className="admin-modal-actions">
        <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>إغلاق</button>
      </div>
    </Modal>
  );
}
