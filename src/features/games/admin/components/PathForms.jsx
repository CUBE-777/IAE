import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../../components/admin/Modal';
import { STAGE_COMPLETION_MODES, STAGE_UNLOCK_MODES, THRESHOLD_RANGE } from '../constants/gamesAdmin';
import { saveStage, saveTrack, saveTrackCategory } from '../services/gamesPaths.service';
import { cleanI18n, fillI18n, slugify, SLUG_RE } from '../services/gamesAdmin.shared';
import { Field, LocalizedFields, notifyError } from './adminUi';

/** هيكل مشترك: عنوان/وصف/slug/حالة (draft|published؛ الأرشفة من زرّها المؤكَّد) + حقول خاصة بكل مستوى. */
function PathFormShell({ title, item, onClose, onSaved, buildExtra, extraFields, kindKey, saver }) {
  const { t } = useTranslation();
  const [v, setV] = useState({
    slug: item?.slug || '',
    title: fillI18n(item?.title),
    description: fillI18n(item?.description),
    status: item?.status && item.status !== 'archived' ? item.status : 'draft',
    extra: buildExtra.initial(item),
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const archived = item?.status === 'archived';

  const submit = async (e) => {
    e.preventDefault();
    const ttl = cleanI18n(v.title);
    const slug = (v.slug.trim() || slugify(v.title.en || v.title.fr)).trim();
    const er = { ...buildExtra.validate(v.extra, t) };
    if (!ttl) er.title = t('games.admin.errors.nameRequired');
    if (!SLUG_RE.test(slug)) er.slug = t('games.admin.errors.slugInvalid');
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      const payload = { slug, title: ttl, description: cleanI18n(v.description), ...buildExtra.payload(v.extra) };
      if (!archived) payload.status = v.status;
      if (!item) Object.assign(payload, buildExtra.create);
      await saver(item?.id, payload);
      window.notify?.success(t('admin.common.saved'));
      onSaved();
    } catch (err) {
      notifyError(t, err);
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <h3>{title}</h3>
      <form onSubmit={submit} noValidate>
        <LocalizedFields label={t('games.admin.fields.title')} required value={v.title} onChange={(x) => setV({ ...v, title: x })} error={errors.title} />
        <LocalizedFields label={t('games.admin.fields.description')} multiline maxLength={1000} value={v.description} onChange={(x) => setV({ ...v, description: x })} />
        <div className="admin-form-grid-2">
          <Field id={`pf_slug_${kindKey}`} label={t('games.admin.fields.slug')} hint={t('games.admin.fields.slugHint')} error={errors.slug}>
            <input id={`pf_slug_${kindKey}`} className="admin-input" dir="ltr" maxLength={64} value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value })} />
          </Field>
          {!archived && (
            <Field id={`pf_status_${kindKey}`} label={t('games.admin.fields.status')}>
              <select id={`pf_status_${kindKey}`} className="admin-select" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
                <option value="draft">{t('games.admin.status.draft')}</option>
                <option value="published">{t('games.admin.status.published')}</option>
              </select>
            </Field>
          )}
        </div>
        {extraFields({ v: v.extra, set: (x) => setV({ ...v, extra: x }), errors, editing: !!item })}
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

const NO_EXTRA = { initial: () => ({}), validate: () => ({}), payload: () => ({}) };

export function TrackForm({ item, gameId, nextOrder, onClose, onSaved }) {
  const { t } = useTranslation();
  return (
    <PathFormShell
      kindKey="track" item={item} onClose={onClose} onSaved={onSaved} saver={saveTrack}
      title={item ? t('games.admin.paths.editTrack') : t('games.admin.paths.newTrack')}
      buildExtra={{ ...NO_EXTRA, create: { game_id: gameId, sort_order: nextOrder } }}
      extraFields={() => null}
    />
  );
}

export function PathCategoryForm({ item, track, nextOrder, onClose, onSaved }) {
  const { t } = useTranslation();
  const buildExtra = {
    initial: (it) => ({ mode: it?.stage_unlock_mode || 'sequential' }),
    validate: (x) => (STAGE_UNLOCK_MODES.includes(x.mode) ? {} : { mode: t('games.admin.errors.invalid_data') }),
    payload: (x) => ({ stage_unlock_mode: x.mode }),
    create: { game_id: track?.game_id, track_id: track?.id, sort_order: nextOrder },
  };
  return (
    <PathFormShell
      kindKey="category" item={item} onClose={onClose} onSaved={onSaved} saver={saveTrackCategory}
      title={item ? t('games.admin.paths.editCategory') : t('games.admin.paths.newCategory')}
      buildExtra={buildExtra}
      extraFields={({ v, set, errors, editing }) => (
        <Field id="pf_unlock_mode" label={t('games.admin.paths.fields.unlockMode')} hint={t(`games.admin.paths.unlockHints.${v.mode}`)} error={errors.mode}>
          <select id="pf_unlock_mode" className="admin-select" value={v.mode} onChange={(e) => set({ ...v, mode: e.target.value })}>
            {STAGE_UNLOCK_MODES.map((m) => <option key={m} value={m}>{t(`games.admin.paths.unlockModes.${m}`)}</option>)}
          </select>
          {editing && <p className="admin-hint">{t('games.admin.paths.modeChangeWarn')}</p>}
        </Field>
      )}
    />
  );
}

export function StageForm({ item, category, nextOrder, onClose, onSaved }) {
  const { t } = useTranslation();
  const buildExtra = {
    initial: (it) => ({ mode: it?.completion_mode || 'all_required', threshold: it?.completion_threshold == null ? '' : String(it.completion_threshold) }),
    validate: (x) => {
      const range = THRESHOLD_RANGE[x.mode];
      if (!STAGE_COMPLETION_MODES.includes(x.mode)) return { mode: t('games.admin.errors.invalid_data') };
      if (!range) return {};
      const n = Number(x.threshold);
      if (!/^\d{1,7}$/.test(x.threshold.trim()) || n < range[0] || n > range[1]) {
        return { threshold: t(x.mode === 'min_success_rate' ? 'games.admin.errors.thresholdPercent' : 'games.admin.errors.thresholdPoints') };
      }
      return {};
    },
    // العتبة تُرسل فقط لوضعين يحتاجانها؛ وإلا null (قيد الجدول يفرض ذلك)
    payload: (x) => ({ completion_mode: x.mode, completion_threshold: THRESHOLD_RANGE[x.mode] ? Number(x.threshold) : null }),
    create: { game_id: category?.game_id, category_id: category?.id, sort_order: nextOrder },
  };
  return (
    <PathFormShell
      kindKey="stage" item={item} onClose={onClose} onSaved={onSaved} saver={saveStage}
      title={item ? t('games.admin.paths.editStage') : t('games.admin.paths.newStage')}
      buildExtra={buildExtra}
      extraFields={({ v, set, errors, editing }) => (
        <>
          <Field id="pf_completion_mode" label={t('games.admin.paths.fields.completionMode')} hint={t(`games.admin.paths.completionHints.${v.mode}`)} error={errors.mode}>
            <select id="pf_completion_mode" className="admin-select" value={v.mode} onChange={(e) => set({ ...v, mode: e.target.value, threshold: THRESHOLD_RANGE[e.target.value] ? v.threshold : '' })}>
              {STAGE_COMPLETION_MODES.map((m) => <option key={m} value={m}>{t(`games.admin.paths.completionModes.${m}`)}</option>)}
            </select>
          </Field>
          {THRESHOLD_RANGE[v.mode] && (
            <Field id="pf_threshold" label={t('games.admin.paths.fields.threshold')} error={errors.threshold}
              hint={t(v.mode === 'min_success_rate' ? 'games.admin.paths.fields.thresholdPercentHint' : 'games.admin.paths.fields.thresholdPointsHint')}>
              <input id="pf_threshold" className="admin-input" dir="ltr" inputMode="numeric" maxLength={7} value={v.threshold} onChange={(e) => set({ ...v, threshold: e.target.value })} />
            </Field>
          )}
          {editing && <p className="admin-hint">{t('games.admin.paths.modeChangeWarn')}</p>}
        </>
      )}
    />
  );
}
