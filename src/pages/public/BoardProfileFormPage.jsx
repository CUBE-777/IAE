import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import InteriorLayout from '../../layouts/InteriorLayout';
import PageHero from '../../components/layout/PageHero';
import FormField from '../../components/common/FormField';
import ImagePicker from '../../components/common/ImagePicker';
import { compressImage } from '../../utils/imageCompress';
import { getBoardProfileLink, submitBoardProfile, uploadBoardPhoto } from '../../services/supabase/boardProfile.service';
import { initProfileState, buildProfile, BOARD_TR_FIELDS, MAX_EXTRA_ITEMS } from '../../components/admin/PublicProfileFields';
import { SOCIAL_PLATFORMS } from '../../constants/socialPlatforms';
import { SUPPORTED_LANGUAGES, applyDocumentDirection } from '../../i18n';
import '../../styles/membership-flow.css';

/**
 * صفحة عامة غير مفهرسة: عضو المكتب يملأ ملفه العام بنفسه عبر رابط شخصي (migration 0031).
 * لا شيء يُنشر مباشرة: الإرسال يُحفظ كمقترح تعتمده الإدارة. الصفة والاسم والترتيب تبقى بيد الإدارة.
 */
const TR_FIELDS = BOARD_TR_FIELDS.filter((f) => f.key !== 'position');
const TR_LANGS = ['fr', 'en'];
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PICK_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const EMPTY_VALUES = { university: '', promotion: '', track: '', bio: '' };
const s = (v) => (typeof v === 'string' ? v : '');

function StateBox({ title, text }) {
  const { t } = useTranslation();
  return (
    <section className="mf-section">
      <div className="container">
        <div className="mf-state" role="status">
          <h2>{title}</h2>
          <p>{text}</p>
          <Link className="btn btn-gold" to="/">{t('thankYou.backHome')}</Link>
        </div>
      </div>
    </section>
  );
}

export default function BoardProfileFormPage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const formRef = useRef(null);
  const uploadedRef = useRef(null); // مسار صورة مرفوعة سلفًا (لا نعيد الرفع عند إعادة المحاولة)
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [values, setValues] = useState(EMPTY_VALUES);
  const [profile, setProfile] = useState(() => initProfileState(null, TR_FIELDS));
  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [trLang, setTrLang] = useState('fr');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState('idle');
  const [done, setDone] = useState(false);

  // لغة الرسالة التي وصلت للعضو (?lang=fr|en|ar) تُفتح بها الصفحة مرة واحدة
  useEffect(() => {
    const wanted = searchParams.get('lang');
    const known = SUPPORTED_LANGUAGES.find((l) => l.code === wanted);
    if (known && known.code !== i18n.language) {
      i18n.changeLanguage(known.code);
      applyDocumentDirection(known.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = `${t('boardProfile.pageTitle')} — ${t('brand.name')}`;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [t]);

  useEffect(() => {
    let alive = true;
    getBoardProfileLink(token)
      .then((data) => {
        if (!alive) return;
        setInfo(data);
        if (data?.state === 'ok') {
          // المسودة المرسلة سابقًا (إن وُجدت) تتقدّم على الملف الحالي المنشور
          const src = data.draft || data.current || {};
          setValues({ university: s(src.university), promotion: s(src.promotion), track: s(src.track), bio: s(src.bio) });
          setProfile(initProfileState(src, TR_FIELDS));
        }
      })
      .catch((err) => {
        console.error('board profile load failed', err);
        if (alive) setLoadError(true);
      });
    return () => { alive = false; };
  }, [token]);

  const handleChange = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }));
  const patch = (p) => setProfile((v) => ({ ...v, ...p }));
  const setSocial = (key, val) => setProfile((v) => ({ ...v, socials: { ...v.socials, [key]: val } }));
  const setExtra = (i, field, val) =>
    setProfile((v) => ({ ...v, extraItems: v.extraItems.map((it, idx) => (idx === i ? { ...it, [field]: val } : it)) }));
  const setExtraTr = (i, code, field, val) =>
    setProfile((v) => ({
      ...v,
      extraItems: v.extraItems.map((it, idx) => (idx === i ? { ...it, [code]: { ...it[code], [field]: val } } : it)),
    }));
  const addExtra = () =>
    setProfile((v) => {
      if (v.extraItems.length >= MAX_EXTRA_ITEMS) return v;
      const blank = { label: '', value: '' };
      return { ...v, extraItems: [...v.extraItems, { ...blank, fr: { ...blank }, en: { ...blank } }] };
    });
  const removeExtra = (i) => setProfile((v) => ({ ...v, extraItems: v.extraItems.filter((_, idx) => idx !== i) }));
  const setTr = (code, key, val) =>
    setProfile((v) => ({ ...v, tr: { ...v.tr, [code]: { ...v.tr[code], [key]: val } } }));

  const handlePick = (picked) => {
    uploadedRef.current = null;
    setPhotoError('');
    if (!picked) { setPhoto(null); return; }
    if (!ACCEPTED_TYPES.includes(picked.type)) { setPhoto(null); setPhotoError('membershipForm.errors.imageType'); return; }
    if (picked.size > MAX_PICK_BYTES) { setPhoto(null); setPhotoError('membershipForm.errors.imageTooBig'); return; }
    setPhoto(picked);
  };

  const ensureUploaded = async () => {
    if (uploadedRef.current) return uploadedRef.current;
    const prepared = await compressImage(photo, { maxDim: 1200, quality: 0.85 });
    if (prepared.size > MAX_UPLOAD_BYTES || !ACCEPTED_TYPES.includes(prepared.type)) {
      const bad = new Error('image rejected');
      bad.code = 'IMAGE_REJECTED';
      throw bad;
    }
    const path = await uploadBoardPhoto(token, prepared);
    uploadedRef.current = path;
    return path;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    const built = buildProfile(profile, null, TR_FIELDS);
    if (built.error) {
      setFormError(built.error);
      return;
    }
    setSubmitting(true);
    let step = 'upload';
    try {
      let photoPath = null;
      if (photo) {
        setStage('uploading');
        photoPath = await ensureUploaded();
      }
      step = 'send';
      setStage('sending');
      await submitBoardProfile(token, {
        university: values.university.trim(),
        promotion: values.promotion.trim(),
        track: values.track.trim(),
        bio: values.bio.trim(),
        ...built.data,
        ...(photoPath ? { photo_path: photoPath } : {}),
      });
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('board profile submit failed', err);
      if (!navigator.onLine) setFormError(t('forms.networkError'));
      else if (err?.code === 'IMAGE_REJECTED') setFormError(t('membershipForm.errors.imageTooBig'));
      else setFormError(step === 'upload' ? t('boardProfile.uploadError') : t('boardProfile.submitError'));
    } finally {
      setSubmitting(false);
      setStage('idle');
    }
  };

  const labelOf = (p) => (p.key === 'website' ? t('boardProfile.website') : p.label);
  const filledExtra = profile.extraItems.some((it) => it.label.trim() && it.value.trim());
  const fieldLabel = (key) => t(`boardProfile.fields.${key}`);

  let body;
  if (loadError) {
    body = <StateBox title={t('boardProfile.loadErrorTitle')} text={t('boardProfile.loadErrorText')} />;
  } else if (!info) {
    body = <section className="mf-section"><div className="container"><p className="mf-loading">{t('boardProfile.loading')}</p></div></section>;
  } else if (info.state !== 'ok') {
    const key = ['approved', 'expired'].includes(info.state) ? info.state : 'invalid';
    body = <StateBox title={t(`boardProfile.state.${key}.title`)} text={t(`boardProfile.state.${key}.text`)} />;
  } else if (done) {
    body = <StateBox title={t('boardProfile.successTitle')} text={t('boardProfile.successText')} />;
  } else {
    body = (
      <section className="mf-section">
        <div className="container">
          <form ref={formRef} className="membership-form mf-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
            <div className="mf-fee" role="note">
              {t('boardProfile.greeting', { name: info.member?.full_name || '', position: info.member?.position || '' })}
            </div>
            <p className="mf-privacy" role="note">{t('boardProfile.intro')}</p>
            {info.status === 'submitted' && <p className="mf-privacy" role="note">{t('boardProfile.draftNote')}</p>}
            {info.review_note && (
              <div className="form-alert form-alert-error" role="note">
                <strong>{t('boardProfile.returned')}</strong> {info.review_note}
              </div>
            )}
            {formError && <div className="form-alert form-alert-error" role="alert">{formError}</div>}

            <fieldset className="mf-group">
              <legend>{t('boardProfile.groups.photo')}</legend>
              <ImagePicker
                id="bp-photo"
                shape="avatar"
                label={fieldLabel('photo')}
                hint={info.current?.has_photo || info.has_draft_photo ? t('boardProfile.hints.hasPhoto') : t('boardProfile.hints.photo')}
                error={photoError || undefined}
                file={photo}
                onPick={handlePick}
                disabled={submitting}
              />
              <FormField id="bp-name-latin" label={fieldLabel('nameLatin')}>
                {(a) => (
                  <input {...a} type="text" dir="ltr" lang="fr" maxLength={120} placeholder="Mohamed El Alaoui"
                    value={profile.name_latin} onChange={(e) => patch({ name_latin: e.target.value })} />
                )}
              </FormField>
            </fieldset>

            <fieldset className="mf-group">
              <legend>{t('boardProfile.groups.study')}</legend>
              <div className="form-row">
                <FormField id="bp-univ" label={fieldLabel('university')}>
                  {(a) => <input {...a} name="university" type="text" maxLength={200} value={values.university} onChange={handleChange} />}
                </FormField>
                <FormField id="bp-promo" label={fieldLabel('promotion')}>
                  {(a) => <input {...a} name="promotion" type="text" maxLength={60} value={values.promotion} onChange={handleChange} />}
                </FormField>
              </div>
              <FormField id="bp-track" label={fieldLabel('track')}>
                {(a) => <input {...a} name="track" type="text" maxLength={200} value={values.track} onChange={handleChange} />}
              </FormField>
              <FormField id="bp-study" label={fieldLabel('studyPath')}>
                {(a) => (
                  <textarea {...a} rows={3} maxLength={800} placeholder={t('boardProfile.hints.studyPath')}
                    value={profile.study_path} onChange={(e) => patch({ study_path: e.target.value })} />
                )}
              </FormField>
            </fieldset>

            <fieldset className="mf-group">
              <legend>{t('boardProfile.groups.about')}</legend>
              <FormField id="bp-bio" label={fieldLabel('bio')}>
                {(a) => <textarea {...a} name="bio" rows={3} maxLength={400} placeholder={t('boardProfile.hints.bio')} value={values.bio} onChange={handleChange} />}
              </FormField>
              <FormField id="bp-public-bio" label={fieldLabel('publicBio')}>
                {(a) => <textarea {...a} rows={4} maxLength={600} value={profile.public_bio} onChange={(e) => patch({ public_bio: e.target.value })} />}
              </FormField>
            </fieldset>

            <fieldset className="mf-group">
              <legend>{t('boardProfile.groups.social')}</legend>
              <p className="mf-hint">{t('boardProfile.hints.social')}</p>
              <div className="form-row">
                {SOCIAL_PLATFORMS.map((p) => (
                  <FormField key={p.key} id={`bp-soc-${p.key}`} label={labelOf(p)}>
                    {(a) => (
                      <input {...a} type="text" dir="ltr" inputMode="url" autoComplete="off" placeholder={p.placeholder}
                        value={profile.socials[p.key] || ''} onChange={(e) => setSocial(p.key, e.target.value)} />
                    )}
                  </FormField>
                ))}
              </div>
            </fieldset>

            <fieldset className="mf-group">
              <legend>{t('boardProfile.groups.extra')}</legend>
              <p className="mf-hint">{t('boardProfile.hints.extra')}</p>
              {profile.extraItems.map((it, i) => (
                <div key={i} className="form-row">
                  <FormField id={`bp-ex-l-${i}`} label={fieldLabel('extraLabel')}>
                    {(a) => <input {...a} type="text" maxLength={40} value={it.label} onChange={(e) => setExtra(i, 'label', e.target.value)} />}
                  </FormField>
                  <FormField id={`bp-ex-v-${i}`} label={fieldLabel('extraValue')}>
                    {(a) => <input {...a} type="text" maxLength={200} value={it.value} onChange={(e) => setExtra(i, 'value', e.target.value)} />}
                  </FormField>
                  <button type="button" className="mf-picker-remove" onClick={() => removeExtra(i)} disabled={submitting}>
                    {t('boardProfile.extra.remove')}
                  </button>
                </div>
              ))}
              {profile.extraItems.length < MAX_EXTRA_ITEMS && (
                <button type="button" className="btn btn-ghost mf-picker-btn" onClick={addExtra} disabled={submitting}>
                  {t('boardProfile.extra.add')}
                </button>
              )}
            </fieldset>

            <fieldset className="mf-group">
              <legend>{t('boardProfile.groups.translations')}</legend>
              <p className="mf-hint">{t('boardProfile.hints.translations')}</p>
              <div role="tablist" aria-label={t('boardProfile.tr.tabs')} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {TR_LANGS.map((code) => (
                  <button
                    key={code}
                    type="button"
                    role="tab"
                    aria-selected={trLang === code}
                    className={`btn ${trLang === code ? 'btn-gold' : 'btn-ghost'} mf-picker-btn`}
                    onClick={() => setTrLang(code)}
                  >
                    {t(`boardProfile.tr.${code}`)}
                  </button>
                ))}
              </div>
              {TR_FIELDS.map((f) => {
                const id = `bp-tr-${trLang}-${f.key}`;
                const common = {
                  dir: 'ltr',
                  maxLength: f.max,
                  value: profile.tr[trLang][f.key],
                  onChange: (e) => setTr(trLang, f.key, e.target.value),
                };
                return (
                  <FormField key={id} id={id} label={fieldLabel(f.key === 'public_bio' ? 'publicBio' : f.key === 'study_path' ? 'studyPath' : f.key)}>
                    {(a) => (f.rows ? <textarea {...a} rows={f.rows} {...common} /> : <input {...a} type="text" {...common} />)}
                  </FormField>
                );
              })}
              {filledExtra && profile.extraItems.map((it, i) =>
                it.label.trim() && it.value.trim() ? (
                  <div key={`${trLang}-ex-${i}`} className="form-row">
                    <FormField id={`bp-extr-l-${trLang}-${i}`} label={`${fieldLabel('extraLabel')}: ${it.label}`}>
                      {(a) => <input {...a} type="text" dir="ltr" maxLength={40} placeholder={it.label} value={it[trLang].label} onChange={(e) => setExtraTr(i, trLang, 'label', e.target.value)} />}
                    </FormField>
                    <FormField id={`bp-extr-v-${trLang}-${i}`} label={`${fieldLabel('extraValue')}: ${it.value}`}>
                      {(a) => <input {...a} type="text" dir="ltr" maxLength={200} placeholder={it.value} value={it[trLang].value} onChange={(e) => setExtraTr(i, trLang, 'value', e.target.value)} />}
                    </FormField>
                  </div>
                ) : null
              )}
            </fieldset>

            <button type="submit" className="btn btn-gold mf-submit" disabled={submitting}>
              {submitting ? (stage === 'uploading' ? t('boardProfile.uploading') : t('boardProfile.submitting')) : t('boardProfile.submit')}
            </button>
            <p className="mf-privacy">{t('boardProfile.privacy')}</p>
          </form>
        </div>
      </section>
    );
  }

  return (
    <InteriorLayout>
      <PageHero
        crumbs={[{ label: t('boardProfile.crumb') }]}
        title={t('boardProfile.title')}
        description={t('boardProfile.description')}
      />
      {body}
    </InteriorLayout>
  );
}
