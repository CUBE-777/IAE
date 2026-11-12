import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../../components/admin/Modal';
import { LANGS } from '../constants/gamesAdmin';

/** يعرض رسالة خطأ مترجمة من GamesError.code. */
export function notifyError(t, err, fallbackKey = 'games.admin.errors.unknown') {
  const code = err?.code;
  const key = `games.admin.errors.${code}`;
  const msg = code && code !== 'unknown' ? t(key, { defaultValue: '' }) : '';
  window.notify?.error(msg || t(fallbackKey));
}

/** ثلاث خانات (ar/fr/en) لقيمة jsonb متعددة اللغات. */
export function LocalizedFields({ label, value, onChange, required = false, multiline = false, maxLength = 200, error }) {
  const { t } = useTranslation();
  const uid = useId();
  return (
    <fieldset className="ga-fieldset">
      <legend>{label}{required ? ' *' : ''}</legend>
      {LANGS.map((l) => {
        const id = `${uid}-${l}`;
        const props = {
          id,
          className: multiline ? 'admin-textarea' : 'admin-input',
          dir: l === 'ar' ? 'rtl' : 'ltr',
          lang: l,
          maxLength,
          value: value?.[l] || '',
          onChange: (e) => onChange({ ...value, [l]: e.target.value }),
        };
        return (
          <div className="ga-lang-row" key={l}>
            <label htmlFor={id}>{t(`games.admin.langs.${l}`)}</label>
            {multiline ? <textarea rows={2} {...props} /> : <input {...props} />}
          </div>
        );
      })}
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
    </fieldset>
  );
}

/** حقل نموذج بتسمية وخطأ. */
export function Field({ id, label, hint, error, children }) {
  return (
    <div className="admin-form-group">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="admin-hint">{hint}</p>}
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
    </div>
  );
}

/** نافذة تأكيد موحّدة. */
export function ConfirmModal({ title, children, confirmLabel, danger = true, busy = false, onConfirm, onClose }) {
  const { t } = useTranslation();
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <h3>{title}</h3>
      {children}
      <div className="admin-modal-actions">
        <button type="button" className={`admin-btn ${danger ? 'admin-btn-danger' : 'admin-btn-primary'}`} disabled={busy} onClick={onConfirm}>
          {busy && <span className="admin-btn-spinner" aria-hidden="true" />}
          {confirmLabel}
        </button>
        <button type="button" className="admin-btn admin-btn-ghost" disabled={busy} onClick={onClose}>{t('admin.common.cancel')}</button>
      </div>
    </Modal>
  );
}

const STATUS_BADGE = { published: 'approved', draft: 'pending', archived: 'muted' };
export function StatusPill({ status }) {
  const { t } = useTranslation();
  return <span className={`admin-badge admin-badge-${STATUS_BADGE[status] || 'muted'}`}>{t(`games.admin.status.${status}`, { defaultValue: status })}</span>;
}

export function ActivePill({ active }) {
  const { t } = useTranslation();
  return <span className={`admin-badge admin-badge-${active ? 'approved' : 'muted'}`}>{t(active ? 'games.admin.active' : 'games.admin.inactive')}</span>;
}

/** أزرار نقل لأعلى/لأسفل. */
export function MoveButtons({ index, count, disabled, onMove }) {
  const { t } = useTranslation();
  return (
    <span className="ga-move">
      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={disabled || index === 0}
        aria-label={t('games.admin.moveUp')} title={t('games.admin.moveUp')} onClick={() => onMove(index, index - 1)}>▲</button>
      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={disabled || index === count - 1}
        aria-label={t('games.admin.moveDown')} title={t('games.admin.moveDown')} onClick={() => onMove(index, index + 1)}>▼</button>
    </span>
  );
}

/** ينقل عنصرًا داخل مصفوفة ويعيد نسخة جديدة. */
export function moveItem(list, from, to) {
  if (to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}
