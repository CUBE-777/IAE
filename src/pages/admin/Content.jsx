import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import StateBox from '../../components/admin/StateBox';
import InlineTranslationInputs from '../../components/admin/InlineTranslationInputs';
import { cleanTr, hasTr } from '../../utils/translationForm';
import { CONTENT_FIELDS, fetchSiteContentAdmin, saveSiteContent } from '../../services/supabase/adminContent.service';

// أسماء الأقسام للتبويبات (المفتاح = section في site_content)
const SECTION_LABELS = { homepage: 'الصفحة الرئيسية', footer: 'الفوتر' };

export default function Content() {
  const [values, setValues] = useState(null); // null = يحمَّل
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [trs, setTrs] = useState({}); // ترجمات كل حقل ("section.key" → {fr:{value}, en:{value}})
  const [trColumn, setTrColumn] = useState(false); // هل عمود translations موجود في القاعدة (0013)
  const sections = useMemo(() => [...new Set(CONTENT_FIELDS.map((f) => f.section))], []);
  const [active, setActive] = useState(sections[0]);

  const load = useCallback(() => {
    setValues(null);
    setError(false);
    fetchSiteContentAdmin()
      .then((data) => {
        const v = {};
        const tr = {};
        CONTENT_FIELDS.forEach((f) => {
          const row = data.find((d) => d.section === f.section && d.key === f.key);
          v[`${f.section}.${f.key}`] = row?.value || '';
          tr[`${f.section}.${f.key}`] = row?.translations && typeof row.translations === 'object' ? row.translations : {};
        });
        setTrColumn(data.some((d) => 'translations' in d));
        setTrs(tr);
        setValues(v);
      })
      .catch((err) => {
        console.error('تعذر تحميل المحتوى:', err);
        window.notify?.fromError(err, 'تعذر تحميل المحتوى');
        setError(true);
      });
  }, []);

  useEffect(() => {
    document.title = 'محتوى الموقع — لوحة إدارة النادي';
    load();
  }, [load]);

  const handleChange = (field, value) => setValues((v) => ({ ...v, [`${field.section}.${field.key}`]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const t = window.notify?.loading('جاري الحفظ...');
    try {
      // الترجمات (0013): تُرسل لكل الصفوف أو لا تُرسل أبدًا (صفوف الدفعة الواحدة يجب أن تتطابق أعمدتها)
      const includeTr = trColumn || CONTENT_FIELDS.some((f) => hasTr(trs[`${f.section}.${f.key}`]));
      const rows = CONTENT_FIELDS.map((f) => {
        const k = `${f.section}.${f.key}`;
        const row = { section: f.section, key: f.key, value: values[k] };
        if (includeTr) row.translations = cleanTr(trs[k], 500);
        return row;
      });
      const result = await saveSiteContent(rows);
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
      <AdminPageHeader title="محتوى الموقع" subtitle="عدّل النصوص الظاهرة في الصفحة الرئيسية والفوتر دون لمس الكود" />
      <div className="admin-panel">
        <StateBox state={error ? 'error' : values === null ? 'loading' : ''} errorText="تعذر تحميل المحتوى." onRetry={load} />
        {values !== null && (
          <form onSubmit={handleSubmit}>
            <div className="admin-tabs" role="tablist" aria-label="أقسام المحتوى">
              {sections.map((s) => (
                <button key={s} type="button" role="tab" id={`tab_${s}`} aria-selected={active === s} aria-controls={`panel_${s}`}
                  className={`admin-tab-btn${active === s ? ' active' : ''}`} onClick={() => setActive(s)}>
                  {SECTION_LABELS[s] || s}
                </button>
              ))}
            </div>
            {sections.map((s) => (
              <div key={s} id={`panel_${s}`} role="tabpanel" aria-labelledby={`tab_${s}`} hidden={active !== s}>
                {CONTENT_FIELDS.filter((f) => f.section === s).map((f) => (
                  <div className="admin-form-group" key={`${f.section}.${f.key}`}>
                    <label htmlFor={`fld_${f.section}_${f.key}`}>{f.label}</label>
                    <textarea
                      id={`fld_${f.section}_${f.key}`}
                      className="admin-textarea"
                      rows={2}
                      value={values[`${f.section}.${f.key}`]}
                      onChange={(e) => handleChange(f, e.target.value)}
                    />
                    <InlineTranslationInputs
                      id={`fld_${f.section}_${f.key}`}
                      translations={trs[`${f.section}.${f.key}`]}
                      onChange={(next) => setTrs((m) => ({ ...m, [`${f.section}.${f.key}`]: next }))}
                      placeholder={values[`${f.section}.${f.key}`]}
                      rows={2}
                      maxLength={500}
                    />
                  </div>
                ))}
              </div>
            ))}
            <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
              {saving && <span className="admin-btn-spinner" aria-hidden="true" />}
              {saving ? 'جاري الحفظ...' : 'حفظ كل التعديلات'}
            </button>
          </form>
        )}
      </div>
    </AdminLayout>
  );
}
