import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import StateBox from '../../../../components/admin/StateBox';
import { ConfirmModal, Field, StatusPill, notifyError } from '../components/adminUi';
import { DIFFICULTIES, LANGS } from '../constants/gamesAdmin';
import { pickName, slugify, SLUG_RE } from '../services/gamesAdmin.shared';
import { getChallengeRow, getVersionSolution, listChallengeVersions, publishChallengeVersion, saveChallengeDraft, setChallengeStatus } from '../services/gamesBuilder.service';
import { BUILDER_TYPES, LIMITS, emptyData, emptyModel, fromVersion, toDraftData, translationStats, validateModel } from './builderModel';
import { LText } from './builderUi';
import ChallengePreview from './ChallengePreview';
import TypeEditor from './TypeEditors';

/**
 * محرر التحديات (6.3). تحدٍّ جديد (challenge = null) أو قائم. الحفظ دائمًا في مسودّة إصدار؛ النشر ينتج إصدارًا جديدًا غير قابل للتعديل
 * (آلية 0055). المحاولات الجارية تكمل على إصدارها. الحلّ والشرح لا يُعرضان إلا هنا (للمدير) ولا يُرسلان للاعب.
 */
export default function ChallengeBuilder({ challenge, games, defaultGameId, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const [phase, setPhase] = useState(challenge ? 'loading' : 'ready');
  const [model, setModel] = useState(() => emptyModel('multiple_choice'));
  const [legacy, setLegacy] = useState(false);
  const [row, setRow] = useState(challenge || null);       // صف التحدي الحالي
  const [versions, setVersions] = useState([]);
  const [meta, setMeta] = useState({ gameId: challenge?.game_id || defaultGameId || games[0]?.id || '', slug: challenge?.slug || '' });
  const [editLang, setEditLang] = useState(i18n.language && LANGS.includes(i18n.language) ? i18n.language : 'ar');
  const [pvLang, setPvLang] = useState(editLang);
  const [showSol, setShowSol] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [dialog, setDialog] = useState(null);   // 'type:<t>' | 'publish' | 'archive' | 'close'
  const [makeLive, setMakeLive] = useState(true);

  const load = useCallback(async () => {
    if (!challenge) return;
    setPhase('loading');
    try {
      const [fresh, vs] = await Promise.all([getChallengeRow(challenge.id), listChallengeVersions(challenge.id)]);
      const base = vs.find((v) => v.status === 'draft') || vs.find((v) => v.status === 'published') || null;
      const sol = base ? await getVersionSolution(base.id) : null;
      setRow(fresh || challenge);
      setVersions(vs);
      if (base) {
        const r = fromVersion(base, sol);
        setModel(r.model);
        setLegacy(r.legacy);
      } else {
        setModel(emptyModel('multiple_choice', { title: challenge.title, description: challenge.description, difficulty: challenge.difficulty, points: challenge.points_reward, timeLimit: challenge.time_limit_seconds ?? '', maxAttempts: challenge.max_attempts ?? '' }));
        setLegacy(true);
      }
      setDirty(false);
      setPhase('ready');
    } catch (err) {
      notifyError(t, err);
      setPhase('error');
    }
  }, [challenge, t]);

  useEffect(() => { load(); }, [load]);

  const patch = (p) => { setModel((m) => ({ ...m, ...p })); setDirty(true); };
  const setData = (p) => { setModel((m) => ({ ...m, data: { ...m.data, ...p } })); setDirty(true); };
  const problems = useMemo(() => validateModel(model), [model]);
  const stats = useMemo(() => translationStats(model), [model]);
  const draft = versions.find((v) => v.status === 'draft');
  const published = versions.find((v) => v.status === 'published');

  const changeType = (type) => {
    setModel((m) => ({ ...m, type, data: emptyData(type) }));
    setDirty(true);
    setDialog(null);
    setErrors([]);
  };
  const askType = (type) => {
    if (type === model.type) return;
    setDialog(`type:${type}`);
  };

  const preflight = () => {
    const er = [];
    if (!model.title[model.defaultLang]?.trim()) er.push({ code: 'titleDefault', vars: {} });
    if (!row) {
      const slug = (meta.slug.trim() || slugify(model.title.en || model.title.fr)).trim();
      if (!SLUG_RE.test(slug)) er.push({ code: 'slugInvalid', vars: {} });
      if (!meta.gameId) er.push({ code: 'gameRequired', vars: {} });
    }
    return er;
  };

  /** يحفظ المسودّة ويعيد { challenge_id, version_id } أو null عند الفشل. */
  const saveDraft = async () => {
    const er = preflight();
    setErrors(er);
    if (er.length) return null;
    const data = toDraftData(model);
    if (!row) {
      data.game_id = meta.gameId;
      data.slug = (meta.slug.trim() || slugify(model.title.en || model.title.fr)).trim();
    }
    const res = await saveChallengeDraft(row?.id, draft?.id, data);
    if (!row) setRow({ id: res.challenge_id, game_id: meta.gameId, slug: data.slug, status: 'draft', title: data.title });
    return res;
  };

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };

  const reloadAfter = async (res) => {
    if (!challenge && res) {
      // تحدٍّ جديد: بعد أول حفظ نكمل على المرجع الجديد دون إعادة تحميل النموذج الذي بين يدي المستخدم
      const [fresh, vs] = await Promise.all([getChallengeRow(res.challenge_id), listChallengeVersions(res.challenge_id)]);
      setRow(fresh);
      setVersions(vs);
    } else {
      const [fresh, vs] = await Promise.all([getChallengeRow((row || challenge).id), listChallengeVersions((row || challenge).id)]);
      setRow(fresh);
      setVersions(vs);
    }
    setDirty(false);
  };

  const onSaveDraft = () => run(async () => {
    const res = await saveDraft();
    if (!res) return;
    await reloadAfter(res);
    window.notify?.success(t('games.admin.builder.draftSaved'));
    onSaved?.();
  });

  const onPublish = () => run(async () => {
    setDialog(null);
    const res = await saveDraft();
    if (!res) return;
    await publishChallengeVersion(res.version_id);
    const cur = await getChallengeRow(res.challenge_id);
    if (makeLive && cur && cur.status !== 'published') await setChallengeStatus(res.challenge_id, 'published');
    await reloadAfter(res);
    window.notify?.success(t('games.admin.builder.publishedOk', { n: res.version_no }));
    onSaved?.();
  });

  const onArchive = () => run(async () => {
    setDialog(null);
    await setChallengeStatus(row.id, 'archived');
    await reloadAfter(null);
    window.notify?.success(t('games.admin.archivedOk'));
    onSaved?.();
  });

  const tryClose = () => (dirty ? setDialog('close') : onClose());
  const openPublish = () => {
    const er = preflight();
    const all = [...er, ...problems.filter((p) => !er.some((e) => e.code === p.code))];
    setErrors(all);
    if (all.length) return;
    setMakeLive(!row || row.status !== 'published');
    setDialog('publish');
  };

  if (phase === 'loading') return <StateBox state="loading" />;
  if (phase === 'error') return <StateBox state="error" errorText={t('games.admin.loadError')} onRetry={load} />;

  const nextNo = (versions[0]?.version_no ?? 0) + 1;
  const probText = (p) => t(`games.admin.builder.problems.${p.code}`, p.vars);
  const set = (k) => (v) => patch({ [k]: v });

  return (
    <section className="gb-root" aria-label={t('games.admin.builder.title')}>
      <div className="gb-head">
        <h3>{row ? t('games.admin.builder.editTitle') : t('games.admin.builder.title')}</h3>
        <div className="gb-head-info">
          {row && <StatusPill status={row.status} />}
          {published && <span className="admin-badge admin-badge-muted">{t('games.admin.builder.liveVersion', { n: published.version_no })}</span>}
          {draft && <span className="admin-badge admin-badge-pending">{t('games.admin.builder.draftVersion', { n: draft.version_no })}</span>}
          {dirty && <span className="admin-badge admin-badge-pending">{t('games.admin.builder.unsaved')}</span>}
        </div>
        <button type="button" className="admin-btn admin-btn-ghost" onClick={tryClose}>{t('games.admin.builder.back')}</button>
      </div>

      {row && !draft && published && <p className="admin-hint gb-banner">{t('games.admin.builder.newVersionNote', { n: nextNo, live: published.version_no })}</p>}
      {legacy && row && <p className="admin-hint gb-banner">{t('games.admin.builder.legacyNote')}</p>}

      <div className="admin-panel gb-section">
        <h4 className="ga-sub">{t('games.admin.builder.sectionBasics')}</h4>
        <div className="admin-form-grid-2">
          <Field id="gb_game" label={t('games.admin.fields.game')}>
            <select id="gb_game" className="admin-select" disabled={!!row} value={meta.gameId} onChange={(e) => { setMeta({ ...meta, gameId: e.target.value }); setDirty(true); }}>
              {games.map((g) => <option key={g.id} value={g.id}>{pickName(g.title, i18n.language)}</option>)}
            </select>
          </Field>
          <Field id="gb_slug" label={t('games.admin.fields.slug')} hint={row ? undefined : t('games.admin.fields.slugHint')}>
            <input id="gb_slug" className="admin-input" dir="ltr" maxLength={64} disabled={!!row} value={meta.slug} onChange={(e) => { setMeta({ ...meta, slug: e.target.value }); setDirty(true); }} />
          </Field>
        </div>

        <span className="gb-label" id="gb_type_label">{t('games.admin.builder.type')}</span>
        <div className="gb-types" role="group" aria-labelledby="gb_type_label">
          {BUILDER_TYPES.map((k) => (
            <button key={k} type="button" aria-pressed={model.type === k} className={`gb-type-btn${model.type === k ? ' is-active' : ''}`} onClick={() => askType(k)}>
              <strong>{t(`games.admin.builder.types.${k}`)}</strong>
              <span>{t(`games.admin.builder.typeDesc.${k}`)}</span>
            </button>
          ))}
        </div>

        <div className="admin-form-grid-2">
          <Field id="gb_def" label={t('games.admin.builder.defaultLang')} hint={t('games.admin.builder.defaultLangHint')}>
            <select id="gb_def" className="admin-select" value={model.defaultLang} onChange={(e) => patch({ defaultLang: e.target.value })}>
              {LANGS.map((l) => <option key={l} value={l}>{t(`games.admin.langs.${l}`)}</option>)}
            </select>
          </Field>
          <Field id="gb_fb" label={t('games.admin.builder.fallback')} hint={t('games.admin.builder.fallbackHint')}>
            <label className="gb-check"><input id="gb_fb" type="checkbox" checked={model.allowFallback} onChange={(e) => patch({ allowFallback: e.target.checked })} /> {t('games.admin.builder.fallbackOn')}</label>
          </Field>
          <Field id="gb_diff" label={t('games.admin.fields.difficulty')}>
            <select id="gb_diff" className="admin-select" value={model.difficulty} onChange={(e) => patch({ difficulty: Number(e.target.value) })}>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d} — {t(`games.admin.difficulty.${d}`)}</option>)}
            </select>
          </Field>
          <Field id="gb_pts" label={t('games.admin.fields.points')}>
            <input id="gb_pts" type="number" min="0" max="10000" className="admin-input" dir="ltr" value={model.points} onChange={(e) => patch({ points: e.target.value })} />
          </Field>
          <Field id="gb_time" label={t('games.admin.fields.timeLimit')} hint={t('games.admin.fields.timeLimitHint')}>
            <input id="gb_time" type="number" min="5" max="86400" className="admin-input" dir="ltr" value={model.timeLimit} onChange={(e) => patch({ timeLimit: e.target.value })} />
          </Field>
          <Field id="gb_att" label={t('games.admin.fields.maxAttempts')} hint={t('games.admin.fields.maxAttemptsHint')}>
            <input id="gb_att" type="number" min="1" max="1000" className="admin-input" dir="ltr" value={model.maxAttempts} onChange={(e) => patch({ maxAttempts: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="gb-langbar" role="group" aria-label={t('games.admin.builder.editLang')}>
        <span className="gb-label">{t('games.admin.builder.editLang')}</span>
        {LANGS.map((l) => (
          <button key={l} type="button" aria-pressed={editLang === l} className={`gb-lang-btn${editLang === l ? ' is-active' : ''}`} onClick={() => setEditLang(l)}>
            {t(`games.admin.langs.${l}`)}{l === model.defaultLang ? ` ★` : ''}
            <small>{stats[l].filled}/{stats[l].total}</small>
          </button>
        ))}
        <span className="admin-hint">{t('games.admin.builder.langHint')}</span>
      </div>

      <div className="admin-panel gb-section">
        <h4 className="ga-sub">{t('games.admin.builder.sectionContent')}</h4>
        <LText label={t('games.admin.fields.title')} value={model.title} onChange={set('title')} lang={editLang} defaultLang={model.defaultLang} maxLength={LIMITS.title} />
        <LText label={t('games.admin.fields.description')} value={model.description} onChange={set('description')} lang={editLang} defaultLang={model.defaultLang} multiline maxLength={LIMITS.description} />
        <LText label={t('games.admin.builder.prompt')} value={model.prompt} onChange={set('prompt')} lang={editLang} defaultLang={model.defaultLang} multiline rows={3} maxLength={LIMITS.prompt} />
        <LText label={t('games.admin.builder.instructions')} value={model.instructions} onChange={set('instructions')} lang={editLang} defaultLang={model.defaultLang} multiline maxLength={LIMITS.instructions} hint={t('games.admin.builder.instructionsHint')} />
        <TypeEditor type={model.type} data={model.data} set={setData} lang={editLang} defaultLang={model.defaultLang} />
      </div>

      <div className="admin-panel gb-section">
        <h4 className="ga-sub">{t('games.admin.builder.hintsTitle')}</h4>
        <p className="admin-hint">{t('games.admin.builder.hintsNote')}</p>
        {model.hints.map((h, i) => (
          <div className="gb-row" key={i}>
            <div className="gb-grow"><LText ariaLabel={`${t('games.admin.builder.hintN', { n: i + 1 })}`} value={h} onChange={(v) => patch({ hints: model.hints.map((x, k) => (k === i ? v : x)) })} lang={editLang} defaultLang={model.defaultLang} maxLength={500} /></div>
            <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" aria-label={t('games.admin.builder.remove')} onClick={() => patch({ hints: model.hints.filter((_, k) => k !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={model.hints.length >= LIMITS.hints} onClick={() => patch({ hints: [...model.hints, { ar: '', fr: '', en: '' }] })}>+ {t('games.admin.builder.addHint')}</button>
        <div className="ga-solution gb-feedback">
          <LText label={t('games.admin.builder.feedback')} value={model.feedback} onChange={set('feedback')} lang={editLang} defaultLang={model.defaultLang} multiline rows={3} maxLength={LIMITS.feedback} hint={t('games.admin.builder.feedbackHint')} />
          <p className="admin-hint">{t('games.admin.fields.solutionPrivate')}</p>
        </div>
        <Field id="gb_note" label={t('games.admin.builder.changeNote')}>
          <input id="gb_note" className="admin-input" maxLength={500} value={model.changeNote} onChange={(e) => patch({ changeNote: e.target.value })} />
        </Field>
      </div>

      <div className="admin-panel gb-section">
        <h4 className="ga-sub">{t('games.admin.builder.preview')}</h4>
        <div className="gb-langbar">
          <span className="gb-label">{t('games.admin.builder.previewLang')}</span>
          {LANGS.map((l) => <button key={l} type="button" aria-pressed={pvLang === l} className={`gb-lang-btn${pvLang === l ? ' is-active' : ''}`} onClick={() => setPvLang(l)}>{t(`games.admin.langs.${l}`)}</button>)}
          <label className="gb-check"><input type="checkbox" checked={showSol} onChange={(e) => setShowSol(e.target.checked)} /> {t('games.admin.builder.showSolution')}</label>
        </div>
        <ChallengePreview model={model} lang={pvLang} showSolution={showSol} />
        <p className="admin-hint">{t('games.admin.builder.previewNote')}</p>
      </div>

      {versions.length > 0 && (
        <div className="admin-panel gb-section">
          <h4 className="ga-sub">{t('games.admin.builder.versions')}</h4>
          <ul className="gb-versions">
            {versions.map((v) => (
              <li key={v.id}>
                <strong>v{v.version_no}</strong> <StatusPill status={v.status} />
                <span className="admin-hint">{v.published_at ? new Date(v.published_at).toLocaleString(i18n.language) : ''}{v.change_note ? ` — ${v.change_note}` : ''}</span>
              </li>
            ))}
          </ul>
          <p className="admin-hint">{t('games.admin.builder.versionsNote')}</p>
        </div>
      )}

      {errors.length > 0 && (
        <div className="admin-inline-error gb-problems" role="alert">
          <strong>{t('games.admin.builder.fixFirst')}</strong>
          <ul>{errors.map((p, i) => <li key={i}>{probText(p)}</li>)}</ul>
        </div>
      )}
      {problems.length > 0 && errors.length === 0 && <p className="admin-hint">{t('games.admin.builder.incomplete', { n: problems.length })}</p>}

      <div className="admin-modal-actions gb-actions">
        <button type="button" className="admin-btn admin-btn-primary" disabled={busy} onClick={onSaveDraft}>
          {busy && <span className="admin-btn-spinner" aria-hidden="true" />}{t('games.admin.builder.saveDraft')}
        </button>
        <button type="button" className="admin-btn admin-btn-primary" disabled={busy} onClick={openPublish}>{t('games.admin.builder.publishVersion', { n: draft ? draft.version_no : nextNo })}</button>
        {row && row.status !== 'archived' && <button type="button" className="admin-btn admin-btn-danger" disabled={busy} onClick={() => setDialog('archive')}>{t('games.admin.builder.archive')}</button>}
      </div>

      {dialog?.startsWith('type:') && (
        <ConfirmModal title={t('games.admin.builder.changeTypeTitle')} confirmLabel={t('games.admin.builder.changeType')} onConfirm={() => changeType(dialog.slice(5))} onClose={() => setDialog(null)}>
          <p>{t('games.admin.builder.changeTypeWarn')}</p>
        </ConfirmModal>
      )}
      {dialog === 'publish' && (
        <ConfirmModal title={t('games.admin.builder.publishTitle')} confirmLabel={t('games.admin.builder.publish')} danger={false} busy={busy} onConfirm={onPublish} onClose={() => setDialog(null)}>
          <p>{t('games.admin.builder.publishWarn', { n: draft ? draft.version_no : nextNo })}</p>
          {(!row || row.status !== 'published') && (
            <label className="gb-check"><input type="checkbox" checked={makeLive} onChange={(e) => setMakeLive(e.target.checked)} /> {t('games.admin.builder.makeLive')}</label>
          )}
        </ConfirmModal>
      )}
      {dialog === 'archive' && (
        <ConfirmModal title={t('games.admin.builder.archiveTitle')} confirmLabel={t('games.admin.builder.archive')} busy={busy} onConfirm={onArchive} onClose={() => setDialog(null)}>
          <p>{t('games.admin.builder.archiveWarn')}</p>
        </ConfirmModal>
      )}
      {dialog === 'close' && (
        <ConfirmModal title={t('games.admin.builder.discardTitle')} confirmLabel={t('games.admin.builder.discard')} onConfirm={onClose} onClose={() => setDialog(null)}>
          <p>{t('games.admin.builder.discardWarn')}</p>
        </ConfirmModal>
      )}
    </section>
  );
}
