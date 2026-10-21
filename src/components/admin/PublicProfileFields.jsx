import { useState } from 'react';
import { SOCIAL_PLATFORMS, isKnownPlatform, normalizeSocialUrl } from '../../constants/socialPlatforms';

import { tr } from '../../i18n/adminDict';
/**
 * قسم "الملف العام" + "الترجمات" المشترك بين نموذج العضو ونموذج عضو المكتب.
 * يعمل على حالة profile واحدة (انظر initProfileState) ويُنتج الحمولة عبر buildProfile.
 *
 * شكل الترجمات المحفوظ في عمود translations (jsonb):
 *   { name_latin: "Mohamed Alaoui",
 *     fr: { position, bio, public_bio, study_path, profession, track, extra: [{label, value}] },
 *     en: { ... } }
 * العربية هي الأصل في الأعمدة الأساسية، وأي حقل ترجمة فارغ يعود للعربية في الموقع.
 */

export const MAX_EXTRA_ITEMS = 8;
const TR_LANGS = [
  { code: 'fr', label: 'Français (FR)' },
  { code: 'en', label: 'English (EN)' },
];

// الحقول القابلة للترجمة لكل نوع (key = مفتاح الترجمة، وهو نفس اسم العمود الأصلي)
export const MEMBER_TR_FIELDS = [
  { key: 'profession', label: 'المهنة', max: 200 },
  { key: 'track', label: 'الشعبة', max: 200 },
  { key: 'public_bio', label: 'نبذة عن العضو', rows: 3, max: 600 },
  { key: 'study_path', label: 'المسار الدراسي', rows: 3, max: 800 },
];
export const BOARD_TR_FIELDS = [
  { key: 'position', label: 'الصفة', max: 100 },
  { key: 'track', label: 'التخصص (الشعبة)', max: 200 },
  { key: 'bio', label: 'النبذة المختصرة (بطاقة المكتب)', rows: 2, max: 400 },
  { key: 'public_bio', label: 'النبذة العامة', rows: 3, max: 600 },
  { key: 'study_path', label: 'المسار الدراسي', rows: 3, max: 800 },
];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

export function initProfileState(record, trFields) {
  const trData = isObj(record?.translations) ? record.translations : {};
  const langObj = (code) => (isObj(trData[code]) ? trData[code] : {});
  const items = record && isObj(record.extra) && Array.isArray(record.extra.items) ? record.extra.items : [];
  return {
    public_bio: record?.public_bio || '',
    study_path: record?.study_path || '',
    socials: isObj(record?.socials) ? { ...record.socials } : {},
    name_latin: str(trData.name_latin),
    extraItems: items.map((it, i) => {
      const row = { label: str(it?.label), value: str(it?.value) };
      TR_LANGS.forEach(({ code }) => {
        const t = Array.isArray(langObj(code).extra) ? langObj(code).extra[i] : null;
        row[code] = { label: str(t?.label), value: str(t?.value) };
      });
      return row;
    }),
    tr: Object.fromEntries(
      TR_LANGS.map(({ code }) => [code, Object.fromEntries(trFields.map((f) => [f.key, str(langObj(code)[f.key])]))])
    ),
  };
}

/**
 * يبني الحمولة النهائية. يُرجع { error } إن كان رابط غير صالح، وإلا { data, filled }.
 * data = { public_bio, study_path, socials, extra, translations } — يحافظ على أي مفاتيح غير معروفة موجودة أصلًا.
 */
export function buildProfile(profile, record, trFields) {
  const socials = {};
  for (const [key, raw] of Object.entries(profile.socials)) {
    const val = String(raw || '').trim();
    if (!val) continue;
    if (!isKnownPlatform(key)) {
      socials[key] = val; // مفتاح غير معروف (من نسخة مستقبلية): نُبقيه كما هو
      continue;
    }
    const href = normalizeSocialUrl(val);
    if (!href) {
      const label = SOCIAL_PLATFORMS.find((p) => p.key === key)?.label || key;
      return { error: tr('رابط غير صالح: {{label}}', { label: label }) };
    }
    socials[key] = href;
  }

  const kept = profile.extraItems
    .map((it) => ({ label: it.label.trim().slice(0, 40), value: it.value.trim().slice(0, 200), src: it }))
    .filter((it) => it.label && it.value);
  const items = kept.map(({ label, value }) => ({ label, value }));

  const extra = { ...(isObj(record?.extra) ? record.extra : {}) };
  if (items.length) extra.items = items; else delete extra.items;

  const translations = { ...(isObj(record?.translations) ? record.translations : {}) };
  const nameLatin = profile.name_latin.trim().slice(0, 120);
  if (nameLatin) translations.name_latin = nameLatin; else delete translations.name_latin;
  TR_LANGS.forEach(({ code }) => {
    const obj = { ...(isObj(translations[code]) ? translations[code] : {}) };
    trFields.forEach((f) => {
      const v = String(profile.tr[code][f.key] || '').trim().slice(0, f.max);
      if (v) obj[f.key] = v; else delete obj[f.key];
    });
    const exItems = kept.map(({ src }) => ({
      label: String(src[code].label || '').trim().slice(0, 40),
      value: String(src[code].value || '').trim().slice(0, 200),
    }));
    if (exItems.some((it) => it.label || it.value)) obj.extra = exItems; else delete obj.extra;
    if (Object.keys(obj).length) translations[code] = obj; else delete translations[code];
  });

  const data = {
    public_bio: profile.public_bio.trim() || null,
    study_path: profile.study_path.trim() || null,
    socials,
    extra,
    translations,
  };
  const filled = {
    public_bio: !!data.public_bio,
    study_path: !!data.study_path,
    socials: Object.keys(socials).length > 0,
    extra: items.length > 0,
    translations: Object.keys(translations).length > 0,
  };
  return { data, filled };
}

/**
 * يضيف حقول الملف العام/الترجمات إلى payload بنفس قاعدة النموذج الأصلي:
 * تُرسل فقط إن كانت الأعمدة موجودة أصلًا (عند التعديل) أو إن كتب المسؤول فيها شيئًا،
 * فلا يتأثر الحفظ العادي إن لم تُشغَّل ملفات SQL بعد.
 */
export function applyProfileToPayload(payload, built, record, isEdit) {
  const profileCols = isEdit && record && 'socials' in record;
  ['public_bio', 'study_path', 'socials', 'extra'].forEach((k) => {
    if (profileCols || built.filled[k]) payload[k] = built.data[k];
  });
  const trCol = isEdit && record && 'translations' in record;
  if (trCol || built.filled.translations) payload.translations = built.data.translations;
  return payload;
}

const noteStyle = { fontSize: '.8rem', color: 'var(--admin-text-muted)', marginTop: 4 };
const fieldsetStyle = { border: '1px solid var(--admin-border)', borderRadius: 12, padding: '12px 14px', margin: '4px 0 14px' };
const legendStyle = { padding: '0 8px', fontWeight: 700, fontSize: '.9rem' };

/**
 * props:
 *  profile / setProfile : حالة الملف (initProfileState)
 *  trFields             : MEMBER_TR_FIELDS أو BOARD_TR_FIELDS
 *  source               : نصوص عربية أصلية تظهر كـ placeholder داخل خانات الترجمة (key → text)
 *  bioLabel             : عنوان خانة النبذة العامة
 */
export default function PublicProfileFields({ profile, setProfile, trFields, source = {}, bioLabel = tr('نبذة عن العضو') }) {
  const [trLang, setTrLang] = useState('fr');
  const patch = (p) => setProfile((v) => ({ ...v, ...p }));
  const setSocial = (key, val) => setProfile((v) => ({ ...v, socials: { ...v.socials, [key]: val } }));
  const setExtra = (i, field, val) =>
    setProfile((v) => ({ ...v, extraItems: v.extraItems.map((it, idx) => (idx === i ? { ...it, [field]: val } : it)) }));
  const addExtra = () =>
    setProfile((v) => {
      if (v.extraItems.length >= MAX_EXTRA_ITEMS) return v;
      const blank = { label: '', value: '' };
      return { ...v, extraItems: [...v.extraItems, { ...blank, fr: { ...blank }, en: { ...blank } }] };
    });
  const removeExtra = (i) => setProfile((v) => ({ ...v, extraItems: v.extraItems.filter((_, idx) => idx !== i) }));
  const setTr = (code, key, val) =>
    setProfile((v) => ({ ...v, tr: { ...v.tr, [code]: { ...v.tr[code], [key]: val } } }));
  const setExtraTr = (i, code, field, val) =>
    setProfile((v) => ({
      ...v,
      extraItems: v.extraItems.map((it, idx) => (idx === i ? { ...it, [code]: { ...it[code], [field]: val } } : it)),
    }));

  const placeholderFor = (key) => {
    if (key === 'public_bio') return profile.public_bio;
    if (key === 'study_path') return profile.study_path;
    return source[key] || '';
  };

  return (
    <>
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>{tr('الملف العام — اختياري (يظهر في الموقع)')}</legend>
        <div className="admin-form-group">
          <label htmlFor="f_public_bio">{bioLabel}</label>
          <textarea id="f_public_bio" className="admin-textarea" rows={3} maxLength={600} value={profile.public_bio} onChange={(e) => patch({ public_bio: e.target.value })} />
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_study_path">{tr('المسار الدراسي')}</label>
          <textarea
            id="f_study_path"
            className="admin-textarea"
            rows={3}
            maxLength={800}
            placeholder={tr('مثال: باكالوريا علوم فيزيائية 2024 ← الكلية المتعددة التخصصات ← إجازة في المعلوميات')}
            value={profile.study_path}
            onChange={(e) => patch({ study_path: e.target.value })}
          />
        </div>
        <div className="admin-form-group">
          <label>{tr('حسابات التواصل (الصق الرابط)')}</label>
          <div className="admin-form-grid-2">
            {SOCIAL_PLATFORMS.map((p) => (
              <input
                key={p.key}
                className="admin-input"
                dir="ltr"
                aria-label={tr(p.label)}
                placeholder={`${tr(p.label)} — ${p.placeholder}`}
                value={profile.socials[p.key] || ''}
                onChange={(e) => setSocial(p.key, e.target.value)}
              />
            ))}
          </div>
        </div>
        <div className="admin-form-group" style={{ marginBottom: 0 }}>
          <label>{tr('معلومات إضافية (عنوان + قيمة، مثل: اللغات ← العربية، الفرنسية)')}</label>
          {profile.extraItems.map((it, i) => (
            <div key={i} className="admin-form-grid-2" style={{ alignItems: 'center', marginBottom: 8 }}>
              <input className="admin-input" aria-label={tr('العنوان')} placeholder={tr('العنوان')} maxLength={40} value={it.label} onChange={(e) => setExtra(i, 'label', e.target.value)} />
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="admin-input" aria-label={tr('القيمة')} placeholder={tr('القيمة')} maxLength={200} value={it.value} onChange={(e) => setExtra(i, 'value', e.target.value)} />
                <button type="button" className="admin-btn admin-btn-ghost" aria-label={tr('حذف هذا الحقل')} onClick={() => removeExtra(i)}>×</button>
              </div>
            </div>
          ))}
          {profile.extraItems.length < MAX_EXTRA_ITEMS && (
            <button type="button" className="admin-btn admin-btn-ghost" onClick={addExtra}>{tr('+ إضافة معلومة')}</button>
          )}
        </div>
      </fieldset>

      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>{tr('الترجمات — اختيارية (تظهر عند تغيير لغة الموقع)')}</legend>
        <div style={{ ...noteStyle, marginTop: 0, marginBottom: 10 }}>
          {tr('أي خانة تتركها فارغة سيظهر نصها العربي للزائر. اكتب النص العربي أولًا ثم ترجمته هنا.')}
        </div>
        <div className="admin-form-group">
          <label htmlFor="f_name_latin">{tr('الاسم بالحروف اللاتينية (يظهر في الفرنسية والإنجليزية)')}</label>
          <input id="f_name_latin" className="admin-input" dir="ltr" maxLength={120} placeholder={tr('مثال: Mohamed El Alaoui')} value={profile.name_latin} onChange={(e) => patch({ name_latin: e.target.value })} />
          <div style={noteStyle}>{tr('اكتب الاسم كما يريده صاحبه تمامًا (لا تُحوَّل الأسماء تلقائيًا لأن لكل اسم عدة كتابات صحيحة).')}</div>
        </div>

        <div role="tablist" aria-label={tr('لغة الترجمة')} style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {TR_LANGS.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={trLang === code}
              className={`admin-btn ${trLang === code ? 'admin-btn-primary' : 'admin-btn-ghost'}`}
              onClick={() => setTrLang(code)}
            >
              {label}
            </button>
          ))}
        </div>

        {trFields.map((f) => {
          const id = `f_tr_${trLang}_${f.key}`;
          const common = {
            id,
            dir: 'ltr',
            maxLength: f.max,
            placeholder: placeholderFor(f.key),
            value: profile.tr[trLang][f.key],
            onChange: (e) => setTr(trLang, f.key, e.target.value),
          };
          return (
            <div className="admin-form-group" key={`${trLang}-${f.key}`}>
              <label htmlFor={id}>{tr(f.label)}</label>
              {f.rows ? <textarea className="admin-textarea" rows={f.rows} {...common} /> : <input className="admin-input" {...common} />}
            </div>
          );
        })}

        {profile.extraItems.some((it) => it.label.trim() && it.value.trim()) && (
          <div className="admin-form-group" style={{ marginBottom: 0 }}>
            <label>{tr('ترجمة المعلومات الإضافية')}</label>
            {profile.extraItems.map((it, i) =>
              it.label.trim() && it.value.trim() ? (
                <div key={`${trLang}-extra-${i}`} className="admin-form-grid-2" style={{ marginBottom: 8 }}>
                  <input className="admin-input" dir="ltr" aria-label={tr('ترجمة العنوان: {{label}}', { label: it.label })} placeholder={it.label} maxLength={40} value={it[trLang].label} onChange={(e) => setExtraTr(i, trLang, 'label', e.target.value)} />
                  <input className="admin-input" dir="ltr" aria-label={tr('ترجمة القيمة: {{value}}', { value: it.value })} placeholder={it.value} maxLength={200} value={it[trLang].value} onChange={(e) => setExtraTr(i, trLang, 'value', e.target.value)} />
                </div>
              ) : null
            )}
          </div>
        )}
      </fieldset>
    </>
  );
}
