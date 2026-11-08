import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MemberPage from '../../components/member/MemberPage';
import MemberSkeleton from '../../components/member/MemberSkeleton';
import FormField from '../../components/common/FormField';
import ImagePicker from '../../components/common/ImagePicker';
import { compressImage } from '../../utils/imageCompress';
import {
  getMyBoardCard, submitMyBoardCard, cancelMyBoardCardRequest, uploadBoardCardPhoto,
} from '../../services/supabase/boardCard.service';
import { initProfileState, buildProfile, BOARD_TR_FIELDS, MAX_EXTRA_ITEMS } from '../../components/admin/PublicProfileFields';
import { SOCIAL_PLATFORMS } from '../../constants/socialPlatforms';
import { scrollBehavior } from '../../utils/motion';
import '../../styles/membership-flow.css';

/**
 * بطاقة المكتب لعضو المكتب (0046): يرى بطاقته العامة ويقترح تعديل ملفه. لا يُنشر شيء قبل اعتماد مسؤول المحتوى.
 * الاسم والصفة والترتيب لا يظهرون في النموذج (يقرّرها المسؤول، والخادم لا يقبلها أصلًا).
 * الصورة تُرفع إلى مجلد العضو الخاص ثم تُراجَع قبل أي نشر.
 */
const TR_FIELDS = BOARD_TR_FIELDS.filter((f) => f.key !== 'position');
const TR_LANGS = ['fr', 'en'];
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PICK_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const s = (v) => (typeof v === 'string' ? v : '');

export default function MemberBoardCard() {
  const { t } = useTranslation();
  const { member } = useOutletContext();
  const uploadedRef = useRef(null);
  const [card, setCard] = useState(undefined);        // undefined = جارٍ التحميل، null = لا بطاقة
  const [loadError, setLoadError] = useState(false);
  const [values, setValues] = useState({ university: '', promotion: '', track: '', bio: '' });
  const [profile, setProfile] = useState(() => initProfileState(null, TR_FIELDS));
  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [trLang, setTrLang] = useState('fr');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState('idle');
  const [done, setDone] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);

  const hydrate = (data) => {
    // المسودة المرسلة سابقًا (قيد المراجعة) تتقدّم على الملف المنشور
    const req = data?.request;
    const src = (req?.status === 'submitted' && req.draft) || data?.current || {};
    setValues({ university: s(src.university), promotion: s(src.promotion), track: s(src.track), bio: s(src.bio) });
    setProfile(initProfileState(src, TR_FIELDS));
  };

  const load = () => {
    setLoadError(false);
    getMyBoardCard()
      .then((data) => {
        setCard(data);
        if (data) hydrate(data);
      })
      .catch((err) => {
        console.error('board card load failed', err);
        setLoadError(true);
      });
  };
  useEffect(load, []);

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
    const path = await uploadBoardCardPhoto(member.id, prepared);
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
      let photoPath = null;
      if (photo) {
        setStage('uploading');
        photoPath = await ensureUploaded();
      }
      step = 'send';
      setStage('sending');
      await submitMyBoardCard({
        university: values.university.trim(),
        promotion: values.promotion.trim(),
        track: values.track.trim(),
        bio: values.bio.trim(),
        ...built.data,
        ...(photoPath ? { photo_path: photoPath } : {}),
      });
      setDone(true);
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    } catch (err) {
      console.error('board card submit failed', err);
      if (!navigator.onLine) setFormError(t('forms.networkError'));
      else if (err?.code === 'IMAGE_REJECTED') setFormError(t('membershipForm.errors.imageTooBig'));
      else setFormError(step === 'upload' ? t('member.boardCard.uploadError') : t('member.boardCard.submitError'));
    } finally {
      setSubmitting(false);
      setStage('idle');
    }
  };

  const handleWithdraw = async () => {
    setWithdrawing(true);
    setFormError('');
    try {
      await cancelMyBoardCardRequest();
      setWithdrawn(true);
      setDone(false);
      load();
    } catch (err) {
      console.error('board card withdraw failed', err);
      setFormError(t('member.boardCard.withdrawError'));
    } finally {
      setWithdrawing(false);
    }
  };

  const labelOf = (p) => (p.key === 'website' ? t('boardProfile.website') : p.label);
  const fieldLabel = (key) => t(`boardProfile.fields.${key}`);
  const filledExtra = profile.extraItems.some((it) => it.label.trim() && it.value.trim());
  const shell = (children) => (
    <MemberPage titleKey="member.boardCard.title" descriptionKey="member.boardCard.description" pageTitleKey="member.boardCard.pageTitle">
      {children}
    </MemberPage>
  );

  if (loadError) {
    return shell(
      <div className="mf-state" role="alert">
        <h2>{t('member.home.loadErrorTitle')}</h2>
        <p>{t('member.home.loadErrorText')}</p>
        <button type="button" className="btn btn-gold" onClick={() => { setCard(undefined); load(); }}>{t('member.home.retry')}</button>
      </div>
    );
  }
  if (card === undefined) return shell(<MemberSkeleton />);
  if (card === null) {
    return shell(
      <div className="mf-state" role="status">
        <h2>{t('member.boardCard.noCardTitle')}</h2>
        <p>{t('member.boardCard.noCardText')}</p>
        <Link className="btn btn-gold" to="/member">{t('member.boardCard.backToProfile')}</Link>
      </div>
    );
  }
  if (done) {
    return shell(
      <div className="mf-state" role="status">
        <h2>{t('member.boardCard.successTitle')}</h2>
        <p>{t('member.boardCard.successText')}</p>
        <Link className="btn btn-gold" to="/member">{t('member.boardCard.backToProfile')}</Link>
      </div>
    );
  }

  const req = card.request;
  const pending = req?.status === 'submitted';
  const returned = req?.status === 'sent' && !!req.review_note;
  const hasPhoto = !!card.photo_url || !!req?.has_draft_photo;

  return shell(
    <form className="membership-form mf-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <div className="mf-fee" role="note">
        {t('member.boardCard.greeting', { name: card.full_name, position: card.position })}
      </div>
      <p className="mf-privacy" role="note">{t('member.boardCard.intro')}</p>
      {pending && (
        <div className="member-confirm" role="status">
          <p className="mf-hint">{t('member.boardCard.pendingNote')}</p>
          <div className="member-actions">
            <button type="button" className="btn btn-ghost" onClick={handleWithdraw} disabled={withdrawing || submitting}>
              {withdrawing ? t('member.boardCard.withdrawing') : t('member.boardCard.withdraw')}
            </button>
          </div>
        </div>
      )}
      {withdrawn && !pending && <p className="mf-hint" role="status">{t('member.boardCard.withdrawn')}</p>}
      {returned && (
        <div className="form-alert form-alert-error" role="note">
          <strong>{t('member.boardCard.returned')}</strong> {req.review_note}
        </div>
      )}
      {formError && <div className="form-alert form-alert-error" role="alert">{formError}</div>}

      <fieldset className="mf-group">
        <legend>{t('boardProfile.groups.photo')}</legend>
        <ImagePicker
          id="bc-photo"
          shape="avatar"
          label={fieldLabel('photo')}
          hint={hasPhoto ? t('boardProfile.hints.hasPhoto') : t('boardProfile.hints.photo')}
          error={photoError || undefined}
          file={photo}
          onPick={handlePick}
          disabled={submitting}
        />
        <FormField id="bc-name-latin" label={fieldLabel('nameLatin')}>
          {(a) => (
            <input {...a} type="text" dir="ltr" lang="fr" maxLength={120} placeholder="Mohamed El Alaoui"
              value={profile.name_latin} onChange={(e) => patch({ name_latin: e.target.value })} />
          )}
        </FormField>
      </fieldset>

      <fieldset className="mf-group">
        <legend>{t('boardProfile.groups.study')}</legend>
        <div className="form-row">
          <FormField id="bc-univ" label={fieldLabel('university')}>
            {(a) => <input {...a} name="university" type="text" maxLength={200} value={values.university} onChange={handleChange} />}
          </FormField>
          <FormField id="bc-promo" label={fieldLabel('promotion')}>
            {(a) => <input {...a} name="promotion" type="text" maxLength={60} value={values.promotion} onChange={handleChange} />}
          </FormField>
        </div>
        <FormField id="bc-track" label={fieldLabel('track')}>
          {(a) => <input {...a} name="track" type="text" maxLength={200} value={values.track} onChange={handleChange} />}
        </FormField>
        <FormField id="bc-study" label={fieldLabel('studyPath')}>
          {(a) => (
            <textarea {...a} rows={3} maxLength={800} placeholder={t('boardProfile.hints.studyPath')}
              value={profile.study_path} onChange={(e) => patch({ study_path: e.target.value })} />
          )}
        </FormField>
      </fieldset>

      <fieldset className="mf-group">
        <legend>{t('boardProfile.groups.about')}</legend>
        <FormField id="bc-bio" label={fieldLabel('bio')}>
          {(a) => <textarea {...a} name="bio" rows={3} maxLength={400} placeholder={t('boardProfile.hints.bio')} value={values.bio} onChange={handleChange} />}
        </FormField>
        <FormField id="bc-public-bio" label={fieldLabel('publicBio')}>
          {(a) => <textarea {...a} rows={4} maxLength={600} value={profile.public_bio} onChange={(e) => patch({ public_bio: e.target.value })} />}
        </FormField>
      </fieldset>

      <fieldset className="mf-group">
        <legend>{t('boardProfile.groups.social')}</legend>
        <p className="mf-hint">{t('boardProfile.hints.social')}</p>
        <div className="form-row">
          {SOCIAL_PLATFORMS.map((p) => (
            <FormField key={p.key} id={`bc-soc-${p.key}`} label={labelOf(p)}>
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
            <FormField id={`bc-ex-l-${i}`} label={fieldLabel('extraLabel')}>
              {(a) => <input {...a} type="text" maxLength={40} value={it.label} onChange={(e) => setExtra(i, 'label', e.target.value)} />}
            </FormField>
            <FormField id={`bc-ex-v-${i}`} label={fieldLabel('extraValue')}>
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
          const id = `bc-tr-${trLang}-${f.key}`;
          const common = { dir: 'ltr', maxLength: f.max, value: profile.tr[trLang][f.key], onChange: (e) => setTr(trLang, f.key, e.target.value) };
          return (
            <FormField key={id} id={id} label={fieldLabel(f.key === 'public_bio' ? 'publicBio' : f.key === 'study_path' ? 'studyPath' : f.key)}>
              {(a) => (f.rows ? <textarea {...a} rows={f.rows} {...common} /> : <input {...a} type="text" {...common} />)}
            </FormField>
          );
        })}
        {filledExtra && profile.extraItems.map((it, i) =>
          it.label.trim() && it.value.trim() ? (
            <div key={`${trLang}-ex-${i}`} className="form-row">
              <FormField id={`bc-extr-l-${trLang}-${i}`} label={`${fieldLabel('extraLabel')}: ${it.label}`}>
                {(a) => <input {...a} type="text" dir="ltr" maxLength={40} placeholder={it.label} value={it[trLang].label} onChange={(e) => setExtraTr(i, trLang, 'label', e.target.value)} />}
              </FormField>
              <FormField id={`bc-extr-v-${trLang}-${i}`} label={`${fieldLabel('extraValue')}: ${it.value}`}>
                {(a) => <input {...a} type="text" dir="ltr" maxLength={200} placeholder={it.value} value={it[trLang].value} onChange={(e) => setExtraTr(i, trLang, 'value', e.target.value)} />}
              </FormField>
            </div>
          ) : null
        )}
      </fieldset>

      <div className="ms-savebar">
        <button type="submit" className="btn btn-gold mf-submit" disabled={submitting}>
          {submitting ? (stage === 'uploading' ? t('member.boardCard.uploading') : t('member.boardCard.submitting')) : t('member.boardCard.submit')}
        </button>
      </div>
      <p className="mf-privacy">{t('member.boardCard.privacy')}</p>
    </form>
  );
}
