import { useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MemberPage from '../../components/member/MemberPage';
import FormField from '../../components/common/FormField';
import ImagePicker from '../../components/common/ImagePicker';
import PersonCard from '../../components/common/PersonCard';
import { compressImage } from '../../utils/imageCompress';
import { submitCardRequest, uploadMemberCardPhoto } from '../../services/supabase/memberSpace.service';
import { initProfileState, buildProfile, MEMBER_TR_FIELDS, MAX_EXTRA_ITEMS } from '../../components/admin/PublicProfileFields';
import { SOCIAL_PLATFORMS } from '../../constants/socialPlatforms';
import { scrollBehavior } from '../../utils/motion';
import '../../styles/membership-flow.css';

// المهنة لا تُترجم في الخادم (_bp_clean يقبل track/bio/public_bio/study_path فقط)، فلا نعرض خانة ترجمتها
const TR_FIELDS = MEMBER_TR_FIELDS.filter((f) => f.key !== 'profession');
const TR_LANGS = ['fr', 'en'];
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PICK_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const s = (v) => (typeof v === 'string' ? v : '');

/** عدّاد أحرف تحت الحقول ذات الحد الأقصى (إرشادي؛ maxLength على الحقل هو الذي يمنع التجاوز). */
function Counter({ value, max }) {
  const n = (value || '').length;
  return <span className={`member-counter${n >= max ? ' member-counter-full' : ''}`} aria-hidden="true">{n}/{max}</span>;
}

/**
 * اقتراح تعديل على بطاقة العضو العامة. لا يُنشر شيء قبل اعتماد الإدارة.
 * الطلب المعلّق (إن وُجد) هو نقطة البداية، وإلا فالبيانات المنشورة حاليًا. الاسم والبريد والنبذة الإدارية خارج النموذج.
 */
export default function MemberCard() {
  const { t } = useTranslation();
  const { member } = useOutletContext();
  const pending = member.latest_request?.status === 'pending' ? member.latest_request : null;
  const src = pending ? { ...member, ...pending.data } : member;
  const uploadedRef = useRef(null);

  const [values, setValues] = useState({ university: s(src.university), promotion: s(src.promotion), track: s(src.track), profession: s(src.profession) });
  const [showInDirectory, setShowInDirectory] = useState(src.show_in_directory === true);
  const [profile, setProfile] = useState(() => initProfileState(src, TR_FIELDS));
  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [trLang, setTrLang] = useState('fr');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState('idle');
  const [done, setDone] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(null);
  const leaveRef = useRef(null);

  // لقطة الحالة الابتدائية (الطلب المعلّق إن وُجد وإلا المنشور): أي اختلاف عنها = تعديلات غير مرسلة
  const snapshot = JSON.stringify({ values, showInDirectory, profile });
  const [initialSnapshot] = useState(snapshot);
  const dirty = !done && (!!photo || snapshot !== initialSnapshot);

  // معاينة الصورة المختارة للبطاقة الحية
  useEffect(() => {
    if (!photo) { setPhotoUrl(null); return undefined; }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // تحذير مغادرة الصفحة (إغلاق التبويب/تحديثه) وتحذير التنقل داخل التطبيق
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked' && leaveRef.current) {
      leaveRef.current.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
      leaveRef.current.focus({ preventScroll: true });
    }
  }, [blocker.state]);

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
  const setTr = (code, key, val) => setProfile((v) => ({ ...v, tr: { ...v.tr, [code]: { ...v.tr[code], [key]: val } } }));

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
    const path = await uploadMemberCardPhoto(member.id, prepared);
    uploadedRef.current = path;
    return path;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    const built = buildProfile(profile, null, TR_FIELDS);
    if (built.error) { setFormError(built.error); return; }
    setSubmitting(true);
    let step = 'upload';
    try {
      // صورة الطلب المعلّق السابقة تبقى إن لم يختر العضو صورة جديدة
      let photoPath = pending?.photo_path || null;
      if (photo) {
        setStage('uploading');
        photoPath = await ensureUploaded();
      }
      step = 'send';
      setStage('sending');
      await submitCardRequest(
        {
          university: values.university.trim(),
          promotion: values.promotion.trim(),
          track: values.track.trim(),
          profession: values.profession.trim(),
          show_in_directory: showInDirectory,
          ...built.data,
        },
        photoPath,
      );
      setDone(true);
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    } catch (err) {
      console.error('card request failed', err);
      if (!navigator.onLine) setFormError(t('forms.networkError'));
      else if (err?.code === 'IMAGE_REJECTED') setFormError(t('membershipForm.errors.imageTooBig'));
      else if (String(err?.message || '').includes('rate_limited')) setFormError(t('member.card.rateLimited'));
      else setFormError(step === 'upload' ? t('member.card.uploadError') : t('member.card.submitError'));
    } finally {
      setSubmitting(false);
      setStage('idle');
    }
  };

  const labelOf = (p) => (p.key === 'website' ? t('boardProfile.website') : p.label);
  const fieldLabel = (key) => t(`boardProfile.fields.${key}`);
  const filledExtra = profile.extraItems.some((it) => it.label.trim() && it.value.trim());

  if (done) {
    return (
      <MemberPage titleKey="member.card.title" descriptionKey="member.card.description" pageTitleKey="member.card.pageTitle">
        <div className="mf-state" role="status">
          <h2>{t('member.card.successTitle')}</h2>
          <p>{t('member.card.successText')}</p>
          <Link className="btn btn-gold" to="/member">{t('member.card.backToProfile')}</Link>
        </div>
      </MemberPage>
    );
  }

  return (
    <MemberPage titleKey="member.card.title" descriptionKey="member.card.description" pageTitleKey="member.card.pageTitle">
      <form className="membership-form mf-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <p className="mf-privacy" role="note">{t('member.card.intro')}</p>
        {pending && <p className="mf-privacy" role="note">{t('member.card.pendingNote')}</p>}
        {formError && <div className="form-alert form-alert-error" role="alert">{formError}</div>}
        {blocker.state === 'blocked' && (
          <div ref={leaveRef} tabIndex={-1} className="member-confirm" role="alertdialog" aria-labelledby="mc-leave-title" aria-describedby="mc-leave-text">
            <strong id="mc-leave-title">{t('member.card.leaveTitle')}</strong>
            <p id="mc-leave-text" className="mf-hint">{t('member.card.leaveText')}</p>
            <div className="member-actions">
              <button type="button" className="btn btn-gold" onClick={() => blocker.reset()}>{t('member.card.stay')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => blocker.proceed()}>{t('member.card.leave')}</button>
            </div>
          </div>
        )}

        <fieldset className="mf-group">
          <legend>{t('member.card.previewTitle')}</legend>
          <p className="mf-hint">{t('member.card.previewText')}</p>
          <div className="member-preview">
            <PersonCard
              person={{
                name: member.full_name,
                image: photoUrl || member.photo_url,
                university: values.university,
                promo: values.promotion,
                track: values.track,
                profession: values.profession,
                role: t('person.memberRole'),
              }}
            />
          </div>
        </fieldset>

        <fieldset className="mf-group">
          <legend>{t('boardProfile.groups.photo')}</legend>
          <ImagePicker
            id="mc-photo"
            shape="avatar"
            label={fieldLabel('photo')}
            hint={pending?.photo_path || member.photo_url ? t('boardProfile.hints.hasPhoto') : t('boardProfile.hints.photo')}
            error={photoError || undefined}
            file={photo}
            onPick={handlePick}
            disabled={submitting}
          />
          <FormField id="mc-name-latin" label={fieldLabel('nameLatin')}>
            {(a) => (
              <input {...a} type="text" dir="ltr" lang="fr" maxLength={120} placeholder="Mohamed El Alaoui"
                value={profile.name_latin} onChange={(e) => patch({ name_latin: e.target.value })} />
            )}
          </FormField>
        </fieldset>

        <fieldset className="mf-group">
          <legend>{t('boardProfile.groups.study')}</legend>
          <div className="form-row">
            <FormField id="mc-univ" label={fieldLabel('university')}>
              {(a) => <input {...a} name="university" type="text" maxLength={200} value={values.university} onChange={handleChange} />}
            </FormField>
            <FormField id="mc-promo" label={fieldLabel('promotion')}>
              {(a) => <input {...a} name="promotion" type="text" maxLength={60} value={values.promotion} onChange={handleChange} />}
            </FormField>
          </div>
          <FormField id="mc-track" label={fieldLabel('track')}>
            {(a) => <input {...a} name="track" type="text" maxLength={200} value={values.track} onChange={handleChange} />}
          </FormField>
          <FormField id="mc-study" label={fieldLabel('studyPath')}>
            {(a) => (
              <>
                <textarea {...a} rows={3} maxLength={800} placeholder={t('boardProfile.hints.studyPath')}
                  value={profile.study_path} onChange={(e) => patch({ study_path: e.target.value })} />
                <Counter value={profile.study_path} max={800} />
              </>
            )}
          </FormField>
        </fieldset>

        <fieldset className="mf-group">
          <legend>{t('boardProfile.groups.about')}</legend>
          <FormField id="mc-profession" label={t('member.card.profession')}>
            {(a) => <input {...a} name="profession" type="text" maxLength={150} value={values.profession} onChange={handleChange} />}
          </FormField>
          <FormField id="mc-public-bio" label={fieldLabel('publicBio')}>
            {(a) => (
              <>
                <textarea {...a} rows={4} maxLength={600} value={profile.public_bio} onChange={(e) => patch({ public_bio: e.target.value })} />
                <Counter value={profile.public_bio} max={600} />
              </>
            )}
          </FormField>
        </fieldset>

        <fieldset className="mf-group">
          <legend>{t('boardProfile.groups.social')}</legend>
          <p className="mf-hint">{t('boardProfile.hints.social')}</p>
          <div className="form-row">
            {SOCIAL_PLATFORMS.map((p) => (
              <FormField key={p.key} id={`mc-soc-${p.key}`} label={labelOf(p)}>
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
              <FormField id={`mc-ex-l-${i}`} label={fieldLabel('extraLabel')}>
                {(a) => <input {...a} type="text" maxLength={40} value={it.label} onChange={(e) => setExtra(i, 'label', e.target.value)} />}
              </FormField>
              <FormField id={`mc-ex-v-${i}`} label={fieldLabel('extraValue')}>
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
            const id = `mc-tr-${trLang}-${f.key}`;
            const common = { dir: 'ltr', maxLength: f.max, value: profile.tr[trLang][f.key], onChange: (e) => setTr(trLang, f.key, e.target.value) };
            return (
              <FormField key={id} id={id} label={fieldLabel(f.key === 'public_bio' ? 'publicBio' : f.key === 'study_path' ? 'studyPath' : f.key)}>
                {(a) => (f.rows ? (
                  <>
                    <textarea {...a} rows={f.rows} {...common} />
                    <Counter value={common.value} max={f.max} />
                  </>
                ) : <input {...a} type="text" {...common} />)}
              </FormField>
            );
          })}
          {filledExtra && profile.extraItems.map((it, i) =>
            it.label.trim() && it.value.trim() ? (
              <div key={`${trLang}-ex-${i}`} className="form-row">
                <FormField id={`mc-extr-l-${trLang}-${i}`} label={`${fieldLabel('extraLabel')}: ${it.label}`}>
                  {(a) => <input {...a} type="text" dir="ltr" maxLength={40} placeholder={it.label} value={it[trLang].label} onChange={(e) => setExtraTr(i, trLang, 'label', e.target.value)} />}
                </FormField>
                <FormField id={`mc-extr-v-${trLang}-${i}`} label={`${fieldLabel('extraValue')}: ${it.value}`}>
                  {(a) => <input {...a} type="text" dir="ltr" maxLength={200} placeholder={it.value} value={it[trLang].value} onChange={(e) => setExtraTr(i, trLang, 'value', e.target.value)} />}
                </FormField>
              </div>
            ) : null
          )}
        </fieldset>

        <div className="mf-consent">
          <label htmlFor="mc-show">
            <input id="mc-show" type="checkbox" checked={showInDirectory} onChange={(e) => setShowInDirectory(e.target.checked)} />
            <span>{t('member.card.showInDirectory')}</span>
          </label>
        </div>

        {dirty && <p className="mf-hint member-unsaved" role="status">{t('member.card.unsaved')}</p>}
        <button type="submit" className="btn btn-gold mf-submit" disabled={submitting}>
          {submitting ? (stage === 'uploading' ? t('member.card.uploading') : t('member.card.submitting')) : t('member.card.submit')}
        </button>
        <p className="mf-privacy">{t('member.card.privacy')}</p>
      </form>
    </MemberPage>
  );
}
