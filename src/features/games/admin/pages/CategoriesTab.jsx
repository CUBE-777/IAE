import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../../components/admin/Modal';
import StateBox from '../../../../components/admin/StateBox';
import { useAdminData } from '../hooks/useAdminData';
import { listCategories, saveCategory, setCategoryActive, reorderItems } from '../services/gamesAdmin.service';
import { cleanI18n, fillI18n, pickName, slugify, SLUG_RE } from '../services/gamesAdmin.shared';
import { ActivePill, Field, LocalizedFields, MoveButtons, moveItem, notifyError } from '../components/adminUi';

function CategoryForm({ item, nextOrder, onClose, onSaved }) {
  const { t } = useTranslation();
  const [v, setV] = useState({
    slug: item?.slug || '',
    name: fillI18n(item?.name),
    description: fillI18n(item?.description),
    icon: item?.icon || '',
    is_active: item ? item.is_active : true,
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const name = cleanI18n(v.name);
    const slug = (v.slug.trim() || slugify(v.name.en || v.name.fr)).trim();
    const er = {};
    if (!name) er.name = t('games.admin.errors.nameRequired');
    if (!SLUG_RE.test(slug)) er.slug = t('games.admin.errors.slugInvalid');
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      const payload = { slug, name, description: cleanI18n(v.description), icon: v.icon.trim() || null, is_active: v.is_active };
      if (!item) payload.sort_order = nextOrder;
      await saveCategory(item?.id, payload);
      window.notify?.success(t('admin.common.saved'));
      onSaved();
    } catch (err) {
      notifyError(t, err);
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <h3>{item ? t('games.admin.categories.edit') : t('games.admin.categories.new')}</h3>
      <form onSubmit={submit} noValidate>
        <LocalizedFields label={t('games.admin.fields.name')} required value={v.name} onChange={(name) => setV({ ...v, name })} error={errors.name} />
        <LocalizedFields label={t('games.admin.fields.description')} multiline maxLength={1000} value={v.description} onChange={(description) => setV({ ...v, description })} />
        <div className="admin-form-grid-2">
          <Field id="gc_slug" label={t('games.admin.fields.slug')} hint={t('games.admin.fields.slugHint')} error={errors.slug}>
            <input id="gc_slug" className="admin-input" dir="ltr" maxLength={64} value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value })} />
          </Field>
          <Field id="gc_icon" label={t('games.admin.fields.icon')}>
            <input id="gc_icon" className="admin-input" dir="ltr" maxLength={64} value={v.icon} onChange={(e) => setV({ ...v, icon: e.target.value })} />
          </Field>
        </div>
        <label className="admin-check">
          <input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /> {t('games.admin.fields.isActive')}
        </label>
        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
            {saving && <span className="admin-btn-spinner" aria-hidden="true" />}{t('admin.common.save')}
          </button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{t('admin.common.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function CategoriesTab() {
  const { t, i18n } = useTranslation();
  const { data, state, reload } = useAdminData(listCategories);
  const [form, setForm] = useState(undefined); // undefined=مغلق، null=جديد، كائن=تعديل
  const [busy, setBusy] = useState(false);
  const rows = data || [];

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };
  const move = (from, to) => run(() => reorderItems('category', moveItem(rows, from, to).map((r) => r.id)));
  const toggle = (c) => run(async () => {
    await setCategoryActive(c.id, !c.is_active);
    window.notify?.success(t(c.is_active ? 'games.admin.deactivatedOk' : 'games.admin.activatedOk'));
  });

  const st = state === 'ready' ? (rows.length ? '' : 'empty') : state;
  return (
    <section aria-label={t('games.admin.tabs.categories')}>
      <div className="ga-toolbar">
        <button type="button" className="admin-quick-action" onClick={() => setForm(null)}>{t('games.admin.categories.new')}</button>
      </div>
      <div className="admin-panel">
        <StateBox state={st} emptyText={t('games.admin.categories.empty')} errorText={t('games.admin.loadError')} onRetry={reload} />
        {rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('games.admin.fields.name')}</th><th>{t('games.admin.fields.slug')}</th>
                  <th>{t('games.admin.fields.status')}</th><th>{t('games.admin.fields.order')}</th><th>{t('games.admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c.id}>
                    <td data-label={t('games.admin.fields.name')}><span className="admin-ann-title">{pickName(c.name, i18n.language)}</span></td>
                    <td data-label={t('games.admin.fields.slug')} dir="ltr"><code>{c.slug}</code></td>
                    <td data-label={t('games.admin.fields.status')}><ActivePill active={c.is_active} /></td>
                    <td data-label={t('games.admin.fields.order')}><MoveButtons index={i} count={rows.length} disabled={busy} onMove={move} /></td>
                    <td className="admin-cell-actions">
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => toggle(c)}>
                        {c.is_active ? t('games.admin.deactivate') : t('games.admin.activate')}
                      </button>
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setForm(c)}>{t('admin.common.edit')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form !== undefined && (
        <CategoryForm item={form} nextOrder={rows.length + 1} onClose={() => setForm(undefined)} onSaved={() => { setForm(undefined); reload(); }} />
      )}
    </section>
  );
}
