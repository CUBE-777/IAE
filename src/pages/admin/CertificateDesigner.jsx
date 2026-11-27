import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Type, ImagePlus, Image as ImageIcon, Square, Circle, Minus, QrCode, Undo2, Redo2, Copy, Trash2, Eye, Pencil, Save, RotateCcw, Layers as LayersIcon,
} from 'lucide-react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import StateBox from '../../components/admin/StateBox';
import {
  fetchCertificateTemplatesWithDesign, saveCertificateTemplate, isCertificateSchemaMissing,
} from '../../services/supabase/adminCertificates.service';
import {
  STYLES, LANGS, MAX_ELEMENTS, MAX_DESIGN_BYTES, createHistory, historyReducer, hasLayout, sanitizeDesign, presetDesign, validateForSave,
  designBytes, newText, newShape, newImage, newQr, duplicateElement, moveLayer, isSafeImageSrc,
} from './certificateDesign';
import { compressImage, IMAGE_ACCEPT } from './certificateImage';
import CertificateDesignerCanvas from './CertificateDesignerCanvas';
import { LayersPanel, PropsPanel } from './CertificateDesignerPanels';
import { ConfirmModal } from './CertificateRecipientModals';
import { notifyCertError } from './certificateUi';
import '../../styles/certificate-designer.css';

const isTyping = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
const NEW = '__new__';

export default function CertificateDesigner() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const fileRef = useRef(null);
  const pendingUpload = useRef('image'); // image | logo | background | replace:<id>

  const [templates, setTemplates] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [templateId, setTemplateId] = useState(null); // null = قالب جديد غير محفوظ
  const [meta, setMeta] = useState({ name: '', style: 'academic', isActive: true, isSystem: false });
  const [hist, dispatch] = useReducer(historyReducer, null, () => createHistory(presetDesign('academic')));
  const [baseline, setBaseline] = useState('');
  const [fromPreset, setFromPreset] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [lang, setLang] = useState('fr'); // لغة المحتوى والمعاينة (الواجهة تبقى بلغتها)
  const [preview, setPreview] = useState(false);
  const [dialog, setDialog] = useState(null); // { type: 'switch'|'reset'|'reload'|'back', target? }
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const design = hist.present;
  const latestDesign = useRef(design);
  latestDesign.current = design;
  const selected = design.elements.find((e) => e.id === selectedId) || null;
  const snapshot = useMemo(() => JSON.stringify({ d: design, n: meta.name, s: meta.style, a: meta.isActive }), [design, meta]);
  const dirty = baseline !== '' && snapshot !== baseline;
  const bytes = useMemo(() => designBytes(design), [design]);

  useEffect(() => { document.title = t('admin.certificates.designer.pageTitle'); }, [t]);

  // ------------------------------------------------------------ تحميل/فتح قالب
  const openTemplate = useCallback((tpl) => {
    let next;
    let preset = false;
    let m;
    if (tpl) {
      preset = !hasLayout(tpl.design);
      next = preset ? presetDesign(tpl.style, tpl.design) : sanitizeDesign(tpl.design);
      m = { name: tpl.name, style: tpl.style, isActive: tpl.is_active, isSystem: !!tpl.is_system };
    } else {
      next = presetDesign('academic');
      m = { name: '', style: 'academic', isActive: true, isSystem: false };
    }
    dispatch({ type: 'reset', next });
    setTemplateId(tpl ? tpl.id : null);
    setMeta(m);
    setFromPreset(preset);
    setSelectedId(null);
    setPreview(false);
    setBaseline(JSON.stringify({ d: next, n: m.name, s: m.style, a: m.isActive }));
    setParams(tpl ? { t: tpl.id } : {}, { replace: true });
  }, [setParams]);

  const loadTemplates = useCallback(() => {
    setLoadError(null);
    return fetchCertificateTemplatesWithDesign()
      .then((list) => { setTemplates(list); return list; })
      .catch((err) => {
        console.error('تعذر تحميل القوالب:', err);
        if (!isCertificateSchemaMissing(err)) window.notify?.fromError(err, t('admin.certificates.designer.template.loadError'));
        setLoadError(err);
        return null;
      });
  }, [t]);

  useEffect(() => {
    let alive = true;
    loadTemplates().then((list) => {
      if (!alive || !list) return;
      const wanted = list.find((x) => x.id === params.get('t')) || list[0] || null;
      openTemplate(wanted);
    });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ------------------------------------------------------------ تعديل التصميم
  const record = useCallback((next, key) => dispatch({ type: 'record', next, key, at: Date.now() }), []);
  const mapEl = (id, fn) => { const d = latestDesign.current; return { ...d, elements: d.elements.map((e) => (e.id === id ? fn(e) : e)) }; };

  const patchEl = (id, patch, key) => record(mapEl(id, (e) => ({ ...e, ...patch })), key ? `${key}:${id}` : null);
  const onBegin = useCallback(() => dispatch({ type: 'begin' }), []);
  const onLive = useCallback((id, patch) => {
    const d = latestDesign.current;
    dispatch({ type: 'live', next: { ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) } });
  }, []);

  const addElement = (el) => {
    const d = latestDesign.current;
    if (d.elements.length >= MAX_ELEMENTS) { window.notify?.error(t('admin.certificates.designer.messages.tooManyElements')); return; }
    record({ ...d, elements: [...d.elements, el] });
    setSelectedId(el.id);
  };
  const removeSelected = () => {
    if (!selected) return;
    const d = latestDesign.current;
    record({ ...d, elements: d.elements.filter((e) => e.id !== selected.id) });
    setSelectedId(null);
  };
  const duplicateSelected = () => {
    if (!selected) return;
    const d = latestDesign.current;
    if (d.elements.length >= MAX_ELEMENTS) { window.notify?.error(t('admin.certificates.designer.messages.tooManyElements')); return; }
    const copy = duplicateElement(selected);
    const i = d.elements.findIndex((e) => e.id === selected.id);
    const els = d.elements.slice();
    els.splice(i + 1, 0, copy);
    record({ ...d, elements: els });
    setSelectedId(copy.id);
  };
  const undo = () => dispatch({ type: 'undo' });
  const redo = () => dispatch({ type: 'redo' });

  // ------------------------------------------------------------ الصور
  const pickImage = (role) => { pendingUpload.current = role; fileRef.current?.click(); };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const role = pendingUpload.current;
    setUploading(true);
    try {
      const isBg = role === 'background';
      const { src, ratio } = await compressImage(file, { background: isBg });
      if (role.startsWith('replace:')) {
        patchEl(role.slice(8), { src });
      } else if (isBg) {
        const d = latestDesign.current;
        const without = d.elements.filter((x) => !(x.type === 'image' && x.role === 'background'));
        const bg = newImage(src, 'background');
        record({ ...d, elements: [bg, ...without] });
        setSelectedId(bg.id);
      } else {
        const base = newImage(src, role);
        addElement({ ...base, h: Math.round((base.w / ratio) * 10) / 10 });
      }
    } catch (err) {
      const code = err?.message === 'image_unsupported' || err?.message === 'image_too_large' ? err.message : 'image_failed';
      window.notify?.error(t(`admin.certificates.designer.messages.${code}`));
    } finally {
      setUploading(false);
    }
  };
  const setImageUrl = (id, url) => {
    if (!/^https:\/\//.test(url) || !isSafeImageSrc(url)) { window.notify?.error(t('admin.certificates.designer.messages.imageUrlInvalid')); return; }
    patchEl(id, { src: url });
  };

  // ------------------------------------------------------------ الحفظ / الاسترجاع / التبديل
  const save = async () => {
    const clean = sanitizeDesign(design);
    const errs = validateForSave(clean, meta.name);
    if (errs.length) { window.notify?.error(t(`admin.certificates.designer.messages.${errs[0]}`)); return; }
    setSaving(true);
    try {
      const id = await saveCertificateTemplate({ id: templateId, name: meta.name.trim(), style: meta.style, design: clean, isActive: meta.isActive });
      window.notify?.success(t('admin.certificates.designer.messages.saveOk'));
      setTemplateId(id);
      setFromPreset(false);
      setBaseline(JSON.stringify({ d: design, n: meta.name.trim(), s: meta.style, a: meta.isActive }));
      setMeta((m) => ({ ...m, name: m.name.trim() }));
      setParams({ t: id }, { replace: true });
      loadTemplates();
    } catch (err) {
      notifyCertError(err, t, 'admin.certificates.designer.messages.saveFailed');
    } finally {
      setSaving(false);
    }
  };

  const goTo = (target) => {
    if (target === NEW) openTemplate(null);
    else openTemplate((templates || []).find((x) => x.id === target) || null);
  };
  const requestSwitch = (target) => {
    if ((target === NEW ? null : target) === templateId) return;
    if (dirty) setDialog({ type: 'switch', target });
    else goTo(target);
  };
  const reloadSaved = async () => {
    const list = await loadTemplates();
    const tpl = list?.find((x) => x.id === templateId);
    if (tpl) { openTemplate(tpl); window.notify?.success(t('admin.certificates.designer.messages.reloaded')); }
  };
  const resetFromStyle = () => {
    record(presetDesign(meta.style, latestDesign.current));
    setSelectedId(null);
    setDialog(null);
  };

  // ------------------------------------------------------------ لوحة المفاتيح
  const onKeyDown = (e) => {
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (!selected || preview) return;
    if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeSelected(); return; }
    const step = e.shiftKey ? 5 : 1;
    const move = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k];
    if (move && !selected.locked) { e.preventDefault(); patchEl(selected.id, { x: selected.x + move[0], y: selected.y + move[1] }, 'nudge'); }
  };

  // ------------------------------------------------------------ العرض
  const header = (
    <AdminPageHeader
      title={t('admin.certificates.designer.title')}
      subtitle={t('admin.certificates.designer.subtitle')}
      actions={<button type="button" className="admin-quick-action" onClick={() => (dirty ? setDialog({ type: 'back' }) : navigate('/admin/certificates'))}>{t('admin.certificates.designer.back')}</button>}
    />
  );

  if (loadError || templates === null) {
    return (
      <AdminLayout>
        {header}
        <div className="admin-panel">
          <StateBox state={loadError ? 'error' : 'loading'} errorText={isCertificateSchemaMissing(loadError) ? t('admin.certificates.unavailable') : t('admin.certificates.designer.template.loadError')} onRetry={() => loadTemplates().then((l) => l && openTemplate(l[0] || null))} />
        </div>
      </AdminLayout>
    );
  }

  const tb = (Icon, label, onClick, extra = {}) => (
    <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm cd-tool" onClick={onClick} title={label} aria-label={label} {...extra}>
      <Icon size={15} aria-hidden="true" /><span className="cd-tool-label">{label}</span>
    </button>
  );
  const D = 'admin.certificates.designer';
  const tooBig = bytes > MAX_DESIGN_BYTES;

  return (
    <AdminLayout>
      {header}
      <div className="cd-root" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}
        onPointerDownCapture={(e) => { if (!isTyping(e.target) && e.target.tagName !== 'BUTTON') rootRef.current?.focus({ preventScroll: true }); }}>

        <div className="admin-panel cd-meta">
          <div className="admin-form-group cd-field">
            <label htmlFor="cd_tpl">{t(`${D}.template.label`)}</label>
            <select id="cd_tpl" className="admin-select" value={templateId || NEW} onChange={(e) => requestSwitch(e.target.value)}>
              <option value={NEW}>{t(`${D}.template.new`)}</option>
              {templates.map((x) => <option key={x.id} value={x.id}>{x.name}{x.is_system ? ` · ${t(`${D}.template.system`)}` : ''}{x.is_active ? '' : ` · ${t(`${D}.template.inactive`)}`}</option>)}
            </select>
          </div>
          <div className="admin-form-group cd-field">
            <label htmlFor="cd_name">{t(`${D}.template.name`)} *</label>
            <input id="cd_name" className="admin-input" maxLength={80} value={meta.name} disabled={meta.isSystem} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} />
          </div>
          <div className="admin-form-group cd-field">
            <label htmlFor="cd_style">{t(`${D}.template.style`)}</label>
            <select id="cd_style" className="admin-select" value={meta.style} disabled={meta.isSystem} onChange={(e) => setMeta((m) => ({ ...m, style: e.target.value }))}>
              {STYLES.map((s) => <option key={s} value={s}>{t(`${D}.styles.${s}`)}</option>)}
            </select>
          </div>
          <label className="cd-check cd-meta-active">
            <input type="checkbox" checked={meta.isActive} onChange={(e) => setMeta((m) => ({ ...m, isActive: e.target.checked }))} />
            {t(`${D}.template.active`)}
          </label>
          <div className="cd-meta-actions">
            <span className={`admin-badge admin-badge-${dirty ? 'pending' : 'approved'}`} role="status">{dirty ? t(`${D}.status.dirty`) : (templateId ? t(`${D}.status.saved`) : t(`${D}.status.unsaved`))}</span>
            <span className={`cd-size${tooBig ? ' is-over' : ''}`} dir="ltr" title={t(`${D}.status.sizeHint`)}>{bytes} / {MAX_DESIGN_BYTES} B</span>
            <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={save} disabled={saving || tooBig}>
              <Save size={15} aria-hidden="true" /> {saving ? t('admin.common.saving') : t(`${D}.toolbar.save`)}
            </button>
            {templateId && <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={saving} onClick={() => (dirty ? setDialog({ type: 'reload' }) : reloadSaved())}><RotateCcw size={15} aria-hidden="true" /> {t(`${D}.toolbar.reload`)}</button>}
          </div>
          {meta.isSystem && <p className="admin-hint cd-meta-note">{t(`${D}.template.systemLocked`)}</p>}
          {fromPreset && <p className="admin-hint cd-meta-note">{t(`${D}.template.noLayout`)}</p>}
        </div>

        <div className="admin-panel cd-toolbar" role="toolbar" aria-label={t(`${D}.toolbar.label`)}>
          <div className="cd-tool-group">
            {tb(Type, t(`${D}.toolbar.text`), () => addElement(newText()), { disabled: preview })}
            {tb(ImagePlus, t(`${D}.toolbar.image`), () => pickImage('image'), { disabled: preview || uploading })}
            {tb(ImageIcon, t(`${D}.toolbar.logo`), () => pickImage('logo'), { disabled: preview || uploading })}
            {tb(LayersIcon, t(`${D}.toolbar.background`), () => pickImage('background'), { disabled: preview || uploading })}
            {tb(Square, t(`${D}.toolbar.rect`), () => addElement(newShape('rect')), { disabled: preview })}
            {tb(Circle, t(`${D}.toolbar.ellipse`), () => addElement(newShape('ellipse')), { disabled: preview })}
            {tb(Minus, t(`${D}.toolbar.line`), () => addElement(newShape('line')), { disabled: preview })}
            {tb(QrCode, t(`${D}.toolbar.qr`), () => addElement(newQr()), { disabled: preview || design.elements.some((x) => x.type === 'qr') })}
          </div>
          <div className="cd-tool-group">
            {tb(Undo2, t(`${D}.toolbar.undo`), undo, { disabled: !hist.past.length })}
            {tb(Redo2, t(`${D}.toolbar.redo`), redo, { disabled: !hist.future.length })}
            {tb(Copy, t(`${D}.toolbar.duplicate`), duplicateSelected, { disabled: !selected || preview })}
            {tb(Trash2, t(`${D}.toolbar.delete`), removeSelected, { disabled: !selected || preview })}
          </div>
          <div className="cd-tool-group">
            <div className="cd-seg" role="group" aria-label={t(`${D}.lang.label`)}>
              {LANGS.map((l) => (
                <button key={l} type="button" className={`cd-seg-btn${lang === l ? ' is-active' : ''}`} aria-pressed={lang === l} onClick={() => setLang(l)}>{t(`${D}.lang.${l}`)}</button>
              ))}
            </div>
            {preview
              ? tb(Pencil, t(`${D}.toolbar.edit`), () => setPreview(false), { 'aria-pressed': true })
              : tb(Eye, t(`${D}.toolbar.preview`), () => { setSelectedId(null); setPreview(true); }, { 'aria-pressed': false })}
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={preview} onClick={() => setDialog({ type: 'reset' })}>{t(`${D}.toolbar.resetStyle`)}</button>
          </div>
          <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={onFile} />
        </div>
        {preview && <p className="admin-hint cd-preview-note" role="status">{t(`${D}.previewNote`)}</p>}
        {uploading && <p className="admin-hint" role="status">{t(`${D}.messages.uploading`)}</p>}

        <div className="cd-grid">
          <aside className="admin-panel cd-layers">
            <LayersPanel elements={design.elements} selectedId={selectedId} lang={lang} onSelect={(id) => !preview && setSelectedId(id)}
              onPatch={(id, patch) => patchEl(id, patch)} onMove={(id, dir) => record({ ...design, elements: moveLayer(design.elements, id, dir) })} />
          </aside>
          <section className="cd-canvas-col" aria-label={t(`${D}.canvasLabel`)}>
            <CertificateDesignerCanvas design={design} lang={lang} preview={preview} selectedId={selectedId} onSelect={setSelectedId} onBegin={onBegin} onLive={onLive} />
            <p className="admin-hint">{t(`${D}.canvasHint`)}</p>
          </section>
          <aside className="admin-panel cd-props">
            <PropsPanel el={preview ? null : selected} design={design} lang={lang} onPatch={patchEl}
              onBackground={(c) => record({ ...design, background: { color: c } }, 'bg')}
              onReplaceImage={(id) => pickImage(`replace:${id}`)} onSetUrl={setImageUrl} />
          </aside>
        </div>
      </div>

      {dialog?.type === 'switch' && (
        <ConfirmModal title={t(`${D}.messages.unsavedTitle`)} confirmLabel={t(`${D}.messages.discard`)} danger onClose={() => setDialog(null)}
          onConfirm={() => { const tg = dialog.target; setDialog(null); goTo(tg); }}>
          <p>{t(`${D}.messages.unsavedBody`)}</p>
        </ConfirmModal>
      )}
      {dialog?.type === 'back' && (
        <ConfirmModal title={t(`${D}.messages.unsavedTitle`)} confirmLabel={t(`${D}.messages.discard`)} danger onClose={() => setDialog(null)}
          onConfirm={() => { setDialog(null); navigate('/admin/certificates'); }}>
          <p>{t(`${D}.messages.unsavedBody`)}</p>
        </ConfirmModal>
      )}
      {dialog?.type === 'reload' && (
        <ConfirmModal title={t(`${D}.messages.reloadTitle`)} confirmLabel={t(`${D}.messages.discard`)} danger onClose={() => setDialog(null)}
          onConfirm={() => { setDialog(null); reloadSaved(); }}>
          <p>{t(`${D}.messages.reloadBody`)}</p>
        </ConfirmModal>
      )}
      {dialog?.type === 'reset' && (
        <ConfirmModal title={t(`${D}.messages.resetTitle`)} confirmLabel={t(`${D}.messages.resetConfirm`)} danger onClose={() => setDialog(null)} onConfirm={resetFromStyle}>
          <p>{t(`${D}.messages.resetBody`, { style: t(`${D}.styles.${meta.style}`) })}</p>
        </ConfirmModal>
      )}
    </AdminLayout>
  );
}
