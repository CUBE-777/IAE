import { useCallback, useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import StateBox from '../../components/admin/StateBox';
import InlineTranslationInputs from '../../components/admin/InlineTranslationInputs';
import { cleanTr, hasTr } from '../../utils/translationForm';
import { SETTINGS_GROUPS, TRANSLATABLE_SETTINGS, fetchSiteSettingsAdmin, saveSiteSettings } from '../../services/supabase/adminSettings.service';

export default function Settings() {
  const [values, setValues] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [trs, setTrs] = useState({}); // ترجمات الإعدادات (key → {fr:{value}, en:{value}})
  const [trColumn, setTrColumn] = useState(false); // هل عمود translations موجود في القاعدة (0013)

  const load = useCallback(() => {
    setValues(null);
    setError(false);
    fetchSiteSettingsAdmin()
      .then((data) => {
        const v = {};
        const tr = {};
        SETTINGS_GROUPS.forEach((g) => g.keys.forEach(([k]) => {
          const row = data.find((d) => d.key === k);
          v[k] = row?.value || '';
          tr[k] = row?.translations && typeof row.translations === 'object' ? row.translations : {};
        }));
        setTrColumn(data.some((d) => 'translations' in d));
        setTrs(tr);
        setValues(v);
      })
      .catch((err) => {
        console.error('تعذر تحميل الإعدادات:', err);
        window.notify?.fromError(err, 'تعذر تحميل الإعدادات');
        setError(true);
      });
  }, []);

  useEffect(() => {
    document.title = 'الإعدادات — لوحة إدارة النادي';
    load();
  }, [load]);

  const handleChange = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const t = window.notify?.loading('جاري الحفظ...');
    try {
      // الترجمات (0013): تُرسل لكل الصفوف أو لا تُرسل أبدًا (صفوف الدفعة الواحدة يجب أن تتطابق أعمدتها)
      const includeTr = trColumn || TRANSLATABLE_SETTINGS.some((k) => hasTr(trs[k]));
      const rows = [];
      SETTINGS_GROUPS.forEach((g) => g.keys.forEach(([k]) => {
        const row = { key: k, value: (values[k] || '').trim() };
        if (includeTr) row.translations = TRANSLATABLE_SETTINGS.includes(k) ? cleanTr(trs[k], 300) : {};
        rows.push(row);
      }));
      const result = await saveSiteSettings(rows);
      t?.remove();
      window.notify?.success('تم حفظ التغييرات بنجاح');
      if (result?.degraded) {
        window.notify?.info('حُفظت النصوص العربية فقط، أما الترجمات فتحتاج تشغيل ملف SQL رقم 0013 في Supabase أولًا.');
      }
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, 'تعذر حفظ التغييرات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <AdminPageHeader title="الإعدادات العامة" subtitle="معلومات النادي الأساسية الظاهرة في الموقع" />
      {values === null ? (
        <div className="admin-panel">
          <StateBox state={error ? 'error' : 'loading'} errorText="تعذر تحميل الإعدادات." onRetry={load} />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {SETTINGS_GROUPS.map((g) => (
            <div className="admin-panel" key={g.title}>
              <h2>{g.title}</h2>
              {g.keys.map(([k, label]) => (
                <div className="admin-form-group" key={k}>
                  <label htmlFor={`s_${k}`}>{label}</label>
                  <input id={`s_${k}`} className="admin-input" value={values[k]} onChange={(e) => handleChange(k, e.target.value)} />
                  {TRANSLATABLE_SETTINGS.includes(k) && (
                    <InlineTranslationInputs
                      id={`s_${k}`}
                      translations={trs[k]}
                      onChange={(next) => setTrs((m) => ({ ...m, [k]: next }))}
                      placeholder={values[k]}
                      maxLength={300}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
            {saving && <span className="admin-btn-spinner" aria-hidden="true" />}
            {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </button>
        </form>
      )}
    </AdminLayout>
  );
}
