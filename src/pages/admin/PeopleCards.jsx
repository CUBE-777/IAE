import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import StateBox from '../../components/admin/StateBox';
import PersonCard from '../../components/common/PersonCard';
import PersonModal from '../../components/common/PersonModal';
import { useAuth } from '../../app/providers/AuthProvider';
import { isReadOnlyRole } from '../../constants/roles';
import { fetchPeopleCardConfigAdmin, savePeopleCardConfig } from '../../services/supabase/adminPeopleCards.service';
import { normalizeConfig, normalizeListConfig } from '../../utils/peopleCardConfig';
import '../../styles/people.css'; // أنماط البطاقة نفسها للمعاينة (تُحمَّل مع هذه الصفحة فقط)

import { tr } from '../../i18n/adminDict';

const LISTS = [
  ['members', 'الأعضاء'],
  ['board', 'أعضاء المكتب'],
];

const CARD_CHECKS = [
  ['showPhoto', 'إظهار الصورة'],
  ['showBadge', 'إظهار الصفة / المنصب'],
  ['showUniversity', 'إظهار الجامعة'],
  ['showPromo', 'إظهار الفوج'],
  ['showTrack', 'إظهار المسار'],
  ['showProfession', 'إظهار المهنة'],
  ['showProfileButton', 'إظهار زر «عرض الملف»'],
  ['highlightBoard', 'تمييز بطاقة عضو المكتب (حافة ذهبية وشارة داكنة)'],
];

const MODAL_CHECKS = [
  ['showPhoto', 'الصورة'],
  ['showBadge', 'الصفة / المنصب'],
  ['showUniversity', 'الجامعة'],
  ['showFacts', 'الفوج والمسار والمهنة'],
  ['showBio', 'النبذة'],
  ['showStudyPath', 'المسار الدراسي'],
  ['showExtra', 'المعلومات الإضافية'],
  ['showSocials', 'روابط التواصل'],
];

const SELECTS = [
  ['layout', 'تخطيط البطاقة', [['side', 'الصورة بجانب البيانات'], ['stacked', 'الصورة في الأعلى (مركزي)']]],
  ['columns', 'عدد الأعمدة على الشاشات الكبيرة', [[2, 'عمودان'], [3, '3 أعمدة'], [4, '4 أعمدة']]],
  ['photoShape', 'شكل الصورة', [['circle', 'دائرية'], ['rounded', 'مربعة بزوايا مدوّرة'], ['square', 'مربعة']]],
  ['photoSize', 'حجم الصورة', [['sm', 'صغير'], ['md', 'متوسط'], ['lg', 'كبير']]],
];

// بيانات تجريبية للمعاينة فقط (لا تُحفظ ولا تأتي من القاعدة)
const sample = (isBoard) => ({
  id: 'preview',
  isBoard,
  name: tr('اسم الشخص (مثال)'),
  role: isBoard ? tr('رئيس النادي') : null,
  university: tr('جامعة المثال'),
  promo: '2025',
  track: tr('الذكاء الاصطناعي'),
  profession: tr('طالب'),
  image: null,
  publicBio: tr('نبذة تعريفية قصيرة تظهر في نافذة الملف الشخصي.'),
  studyPath: tr('مسار دراسي: الإعلاميات ثم الأنظمة المدمجة.'),
  socials: { instagram: 'https://instagram.com/example', website: 'https://example.com' },
  extra: { items: [{ label: tr('الهواية'), value: tr('البرمجة') }] },
});

export default function PeopleCards() {
  const readOnly = isReadOnlyRole(useAuth().profile?.role);
  const [config, setConfig] = useState(null); // null = يحمَّل
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState('members');
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(() => {
    setConfig(null);
    setError(false);
    fetchPeopleCardConfigAdmin()
      .then(setConfig)
      .catch((err) => {
        console.error('تعذر تحميل إعدادات البطاقات:', err);
        window.notify?.fromError(err, tr('تعذر تحميل إعدادات البطاقات'));
        setError(true);
      });
  }, []);

  useEffect(() => {
    document.title = tr('تخصيص البطاقات — لوحة إدارة النادي');
    load();
  }, [load]);

  const list = config ? config[active] : null;
  const previewPerson = useMemo(() => sample(active === 'board'), [active]);

  const patch = (group, key, value) =>
    setConfig((c) => ({ ...c, [active]: { ...c[active], [group]: { ...c[active][group], [key]: value } } }));

  const resetActive = () => setConfig((c) => ({ ...c, [active]: normalizeListConfig(null) }));

  const copyToOther = () => {
    const other = active === 'members' ? 'board' : 'members';
    setConfig((c) => ({ ...c, [other]: normalizeListConfig(JSON.parse(JSON.stringify(c[active]))) }));
    window.notify?.info(tr('نُسخت الإعدادات إلى القائمة الأخرى. اضغط «حفظ» لتثبيتها.'));
  };

  const handleSave = async () => {
    setSaving(true);
    const t = window.notify?.loading(tr('جاري الحفظ...'));
    try {
      await savePeopleCardConfig(normalizeConfig(config));
      t?.remove();
      window.notify?.success(tr('تم حفظ شكل البطاقات. يظهر للزوار فورًا.'));
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر حفظ التغييرات'));
    } finally {
      setSaving(false);
    }
  };

  const otherLabel = active === 'members' ? 'أعضاء المكتب' : 'الأعضاء';

  return (
    <AdminLayout>
      <AdminPageHeader
        title={tr('تخصيص البطاقات')}
        subtitle={tr('تحكّم في شكل بطاقات الأعضاء وأعضاء المكتب وفي المعلومات الظاهرة للزوار')}
      />
      <div className="admin-panel">
        <StateBox state={error ? 'error' : config === null ? 'loading' : ''} errorText={tr('تعذر تحميل إعدادات البطاقات.')} onRetry={load} />
        {config !== null && list && (
          <>
            <div className="admin-tabs" role="tablist" aria-label={tr('القائمة')}>
              {LISTS.map(([key, label]) => (
                <button key={key} type="button" role="tab" id={`pc_tab_${key}`} aria-selected={active === key} aria-controls="pc_panel"
                  className={`admin-tab-btn${active === key ? ' active' : ''}`} onClick={() => setActive(key)}>
                  {tr(label)}
                </button>
              ))}
            </div>

            <div className="pc-admin-grid" id="pc_panel" role="tabpanel" aria-labelledby={`pc_tab_${active}`}>
              <fieldset disabled={readOnly} className="pc-admin-controls">
                <h3>{tr('شكل البطاقة')}</h3>
                {SELECTS.map(([key, label, options]) => (
                  <div className="admin-form-group" key={key}>
                    <label htmlFor={`pc_${key}`}>{tr(label)}</label>
                    <select id={`pc_${key}`} className="admin-select" value={list.card[key]}
                      onChange={(e) => patch('card', key, typeof list.card[key] === 'number' ? Number(e.target.value) : e.target.value)}>
                      {options.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
                    </select>
                  </div>
                ))}

                <h3>{tr('المعلومات الظاهرة على البطاقة')}</h3>
                {CARD_CHECKS.map(([key, label]) => (
                  <label className="admin-check pc-admin-check" key={key}>
                    <input type="checkbox" checked={!!list.card[key]} onChange={(e) => patch('card', key, e.target.checked)} />
                    {tr(label)}
                  </label>
                ))}
                <p className="admin-hint">{tr('الاسم يظهر دائمًا. العمر والبريد والهاتف والمدينة لا تُعرض للزوار أبدًا حمايةً للخصوصية.')}</p>

                <h3>{tr('نافذة الملف الشخصي (عند الضغط على «عرض الملف»)')}</h3>
                {MODAL_CHECKS.map(([key, label]) => (
                  <label className="admin-check pc-admin-check" key={key}>
                    <input type="checkbox" checked={!!list.modal[key]} onChange={(e) => patch('modal', key, e.target.checked)} />
                    {tr(label)}
                  </label>
                ))}
                <p className="admin-hint">{tr('إن عُطِّل كل محتوى النافذة لشخص ما فلا يظهر له زر «عرض الملف».')}</p>
              </fieldset>

              <div className="pc-admin-preview">
                <h3>{tr('معاينة مباشرة')}</h3>
                <div className="members-grid pc-admin-preview-grid">
                  <PersonCard
                    person={previewPerson}
                    fallbackBadge={tr('عضو')}
                    config={list}
                    onOpen={() => setShowModal(true)}
                  />
                </div>
                <p className="admin-hint">{tr('المعاينة ببيانات تجريبية. عدد الأعمدة يظهر على صفحة الموقع نفسها.')}</p>
                <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setShowModal(true)}>
                  {tr('معاينة نافذة الملف الشخصي')}
                </button>
              </div>
            </div>

            <div className="pc-admin-actions">
              {!readOnly && (
                <>
                  <button type="button" className="admin-btn admin-btn-primary" onClick={handleSave} disabled={saving}>
                    {saving && <span className="admin-btn-spinner" aria-hidden="true" />}
                    {saving ? tr('جاري الحفظ...') : tr('حفظ الإعدادات')}
                  </button>
                  <button type="button" className="admin-btn admin-btn-ghost" onClick={copyToOther} disabled={saving}>
                    {tr('نسخ هذه الإعدادات إلى')} {tr(otherLabel)}
                  </button>
                  <button type="button" className="admin-btn admin-btn-ghost" onClick={resetActive} disabled={saving}>
                    {tr('استرجاع الشكل الافتراضي')}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {showModal && list && (
        <PersonModal person={previewPerson} fallbackBadge={tr('عضو')} config={list} onClose={() => setShowModal(false)} />
      )}
    </AdminLayout>
  );
}
