import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../../components/admin/Modal';
import StateBox from '../../../../components/admin/StateBox';
import { useAdminData } from '../hooks/useAdminData';
import { deleteGame, listCategories, listGames, reorderItems, saveGame, setGameStatus } from '../services/gamesAdmin.service';
import { cleanI18n, fillI18n, KIND_RE, pickName, slugify, SLUG_RE } from '../services/gamesAdmin.shared';
import { ConfirmModal, Field, LocalizedFields, MoveButtons, StatusPill, moveItem, notifyError } from '../components/adminUi';

function GameForm({ item, categories, nextOrder, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const [v, setV] = useState({
    category_id: item?.category_id || categories[0]?.id || '',
    slug: item?.slug || '',
    kind: item?.kind || '',
    title: fillI18n(item?.title),
    description: fillI18n(item?.description),
    status: item?.status || 'draft',
    config: item?.config && Object.keys(item.config).length ? JSON.stringify(item.config, null, 2) : '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const title = cleanI18n(v.title);
    const slug = (v.slug.trim() || slugify(v.title.en || v.title.fr)).trim();
    const er = {};
    if (!title) er.title = t('games.admin.errors.nameRequired');
    if (!SLUG_RE.test(slug)) er.slug = t('games.admin.errors.slugInvalid');
    if (!KIND_RE.test(v.kind.trim())) er.kind = t('games.admin.errors.kindInvalid');
    if (!v.category_id) er.category_id = t('games.admin.errors.categoryRequired');
    let config = {};
    if (v.config.trim()) {
      try {
        config = JSON.parse(v.config);
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('obj');
      } catch {
        er.config = t('games.admin.errors.invalid_json');
      }
    }
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      const payload = { category_id: v.category_id, slug, kind: v.kind.trim(), title, description: cleanI18n(v.description), status: v.status, config };
      if (!item) payload.sort_order = nextOrder;
      await saveGame(item?.id, payload);
      window.notify?.success(t('admin.common.saved'));
      onSaved();
    } catch (err) {
      notifyError(t, err);
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <h3>{item ? t('games.admin.games.edit') : t('games.admin.games.new')}</h3>
      <form onSubmit={submit} noValidate>
        <LocalizedFields label={t('games.admin.fields.title')} required value={v.title} onChange={(title) => setV({ ...v, title })} error={errors.title} />
        <LocalizedFields label={t('games.admin.fields.description')} multiline maxLength={2000} value={v.description} onChange={(description) => setV({ ...v, description })} />
        <div className="admin-form-grid-2">
          <Field id="g_cat" label={t('games.admin.fields.category')} error={errors.category_id}>
            <select id="g_cat" className="admin-select" value={v.category_id} onChange={(e) => setV({ ...v, category_id: e.target.value })}>
              {categories.map((c) => <option key={c.id} value={c.id}>{pickName(c.name, i18n.language)}</option>)}
            </select>
          </Field>
          <Field id="g_status" label={t('games.admin.fields.status')}>
            <select id="g_status" className="admin-select" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
              {['draft', 'published', 'archived'].map((s) => <option key={s} value={s}>{t(`games.admin.status.${s}`)}</option>)}
            </select>
          </Field>
          <Field id="g_slug" label={t('games.admin.fields.slug')} hint={t('games.admin.fields.slugHint')} error={errors.slug}>
            <input id="g_slug" className="admin-input" dir="ltr" maxLength={64} value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value })} />
          </Field>
          <Field id="g_kind" label={t('games.admin.fields.kind')} hint={t('games.admin.fields.kindHint')} error={errors.kind}>
            <input id="g_kind" className="admin-input" dir="ltr" maxLength={32} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} />
          </Field>
        </div>
        <Field id="g_config" label={t('games.admin.fields.config')} hint={t('games.admin.fields.configHint')} error={errors.config}>
          <textarea id="g_config" className="admin-textarea ga-code" dir="ltr" rows={4} value={v.config} onChange={(e) => setV({ ...v, config: e.target.value })} />
        </Field>
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

export default function GamesTab() {
  const { t, i18n } = useTranslation();
  const { data, state, reload } = useAdminData(() => Promise.all([listGames(), listCategories()]));
  const [catFilter, setCatFilter] = useState('');
  const [form, setForm] = useState(undefined);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [games, categories] = data || [[], []];
  const catName = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, pickName(c.name, i18n.language)])), [categories, i18n.language]);
  const rows = catFilter ? games.filter((g) => g.category_id === catFilter) : games;

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
  const move = (from, to) => run(() => reorderItems('game', moveItem(rows, from, to).map((r) => r.id)));
  const setStatus = (g, status, okKey) => run(async () => {
    await setGameStatus(g.id, status);
    window.notify?.success(t(okKey));
  });
  const doDelete = async () => {
    const g = del;
    setBusy(true);
    try {
      const res = await deleteGame(g.id);
      window.notify?.success(t(res?.result === 'archived' ? 'games.admin.archivedOk' : 'games.admin.deletedOk'));
      setDel(null);
      reload();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };

  const st = state === 'ready' ? (rows.length ? '' : 'empty') : state;
  return (
    <section aria-label={t('games.admin.tabs.games')}>
      <div className="ga-toolbar">
        <select className="admin-select ga-filter" aria-label={t('games.admin.fields.category')} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">{t('games.admin.allCategories')}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{catName[c.id]}</option>)}
        </select>
        <button type="button" className="admin-quick-action" disabled={state !== 'ready' || categories.length === 0} onClick={() => setForm(null)}>
          {t('games.admin.games.new')}
        </button>
      </div>
      {state === 'ready' && categories.length === 0 && <p className="admin-hint">{t('games.admin.games.needCategory')}</p>}
      <div className="admin-panel">
        <StateBox state={st} emptyText={t('games.admin.games.empty')} errorText={t('games.admin.loadError')} onRetry={reload} />
        {rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('games.admin.fields.title')}</th><th>{t('games.admin.fields.category')}</th><th>{t('games.admin.fields.kind')}</th>
                  <th>{t('games.admin.fields.status')}</th><th>{t('games.admin.fields.order')}</th><th>{t('games.admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g, i) => (
                  <tr key={g.id}>
                    <td data-label={t('games.admin.fields.title')}><span className="admin-ann-title">{pickName(g.title, i18n.language)}</span><span className="admin-ann-sub" dir="ltr">{g.slug}</span></td>
                    <td data-label={t('games.admin.fields.category')}>{catName[g.category_id] || '—'}</td>
                    <td data-label={t('games.admin.fields.kind')} dir="ltr"><code>{g.kind}</code></td>
                    <td data-label={t('games.admin.fields.status')}><StatusPill status={g.status} /></td>
                    <td data-label={t('games.admin.fields.order')}><MoveButtons index={i} count={rows.length} disabled={busy} onMove={move} /></td>
                    <td className="admin-cell-actions">
                      {g.status === 'published'
                        ? <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => setStatus(g, 'draft', 'games.admin.unpublishedOk')}>{t('games.admin.unpublish')}</button>
                        : <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy}
                            onClick={() => setStatus(g, 'published', 'games.admin.publishedOk')}>{g.status === 'archived' ? t('games.admin.restorePublish') : t('games.admin.publish')}</button>}
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setForm(g)}>{t('admin.common.edit')}</button>
                      <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" disabled={busy} onClick={() => setDel(g)}>{t('admin.common.delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form !== undefined && (
        <GameForm item={form} categories={categories} nextOrder={games.length + 1} onClose={() => setForm(undefined)} onSaved={() => { setForm(undefined); reload(); }} />
      )}
      {del && (
        <ConfirmModal title={t('admin.common.confirmDelete')} confirmLabel={t('admin.common.delete')} busy={busy} onConfirm={doDelete} onClose={() => setDel(null)}>
          <p><strong>{pickName(del.title, i18n.language)}</strong></p>
          <p>{t('games.admin.games.deleteConfirm')}</p>
        </ConfirmModal>
      )}
    </section>
  );
}
