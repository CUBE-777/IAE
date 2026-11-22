import { useState } from 'react';
import StateBox from './StateBox';
import { tr } from '../../i18n/adminDict';
import { saveGamesSectionStatus } from '../../services/supabase/adminSettings.service';
import { GAMES_STATUS } from '../../features/games/maintenance/gamesStatusCore';
import { useGamesSectionStatus } from '../../features/games/maintenance/useGamesSectionStatus';

/**
 * «حالة قسم الألعاب» (وضع الصيانة) داخل صفحة الإعدادات (/admin/settings: super_admin + developer فقط في الراوتر).
 * منفصلة عن نموذج الإعدادات العامة عمدًا: تُحفظ فورًا بزرّها (لا تُرسل مع «حفظ الإعدادات»)، فلا يغيّرها حفظ عام عن غير قصد.
 * الحدّ الفعلي للصلاحية: RLS على site_settings (is_super_admin) + مشغّل التحقق (0062) — الواجهة للعرض فقط.
 * الحالة المعروضة تتزامن مع الخادم (Realtime + مؤقّت)، فإن غيّرها مسؤول آخر تتحدّث هنا دون إعادة تحميل.
 */
export default function GamesSectionStatusPanel() {
  const { phase, status, retry, refresh } = useGamesSectionStatus();
  const [choice, setChoice] = useState(null); // null = يتبع الحالة الحالية
  const [saving, setSaving] = useState(false);

  const selected = choice ?? status ?? GAMES_STATUS.ENABLED;
  const changed = status != null && selected !== status;
  const isMaint = status === GAMES_STATUS.MAINTENANCE;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!changed || saving) return;
    if (selected === GAMES_STATUS.MAINTENANCE
      && !window.confirm(tr('سيرى كل اللاعبين صفحة الصيانة فورًا ولن يتمكنوا من اللعب. تبقى إدارة الألعاب متاحة لك. متابعة؟'))) return;
    setSaving(true);
    const t = window.notify?.loading(tr('جاري الحفظ...'));
    try {
      await saveGamesSectionStatus(selected);
      t?.remove();
      window.notify?.success(tr(selected === GAMES_STATUS.MAINTENANCE ? 'تم تفعيل وضع الصيانة لقسم الألعاب' : 'تمت إعادة تفعيل قسم الألعاب'));
      setChoice(null);
      await refresh();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر تحديث حالة قسم الألعاب'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-panel" id="games-section-status">
      <h2>{tr('حالة قسم الألعاب')}</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--admin-text-muted, var(--muted))' }}>
        {tr('يتحكم في إتاحة قسم الألعاب للأعضاء. التغيير فوري ولا يحتاج إعادة نشر، ولا يحذف أي لعبة أو نقاط أو بيانات.')}
      </p>
      {phase !== 'ready' ? (
        <StateBox state={phase === 'error' ? 'error' : 'loading'} errorText={tr('تعذر تحميل حالة قسم الألعاب.')} onRetry={retry} />
      ) : (
        <form onSubmit={handleSave}>
          <div className="admin-form-group">
            <span>{tr('الحالة الحالية')}: </span>
            <span className={`admin-badge ${isMaint ? 'admin-badge-pending' : 'admin-badge-approved'}`}>
              {tr(isMaint ? 'قيد الصيانة' : 'مفعّل')}
            </span>
          </div>
          <div className="admin-form-group">
            <label htmlFor="games_section_status">{tr('حالة قسم الألعاب')}</label>
            <select
              id="games_section_status"
              className="admin-select"
              value={selected}
              onChange={(e) => setChoice(e.target.value)}
              disabled={saving}
            >
              <option value={GAMES_STATUS.ENABLED}>{tr('مفعّل: الألعاب تعمل بشكل طبيعي')}</option>
              <option value={GAMES_STATUS.MAINTENANCE}>{tr('صيانة: القسم غير متاح وتظهر صفحة الصيانة')}</option>
            </select>
          </div>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={!changed || saving}>
            {saving && <span className="admin-btn-spinner" aria-hidden="true" />}
            {saving ? tr('جاري الحفظ...') : tr('حفظ حالة القسم')}
          </button>
        </form>
      )}
    </div>
  );
}
