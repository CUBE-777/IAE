import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Type, Image as ImageIcon, Square, Circle, Minus, QrCode, Eye, EyeOff, Lock, Unlock, ArrowUp, ArrowDown,
  Bold, Italic, AlignLeft, AlignCenter, AlignRight,
} from 'lucide-react';
import { FONTS, VARIABLES, textOf, dirOf, MIN_SIZE_MM } from './certificateDesign';

const typeKey = (el) => {
  if (el.type === 'image') return el.role || 'image';
  if (el.type === 'shape') return el.shape;
  return el.type;
};
const TYPE_ICON = { text: Type, image: ImageIcon, logo: ImageIcon, background: ImageIcon, rect: Square, ellipse: Circle, line: Minus, qr: QrCode };

/** الطبقات: الأعلى أولًا (العنصر الأخير في المصفوفة هو الأعلى في الرسم) */
export function LayersPanel({ elements, selectedId, lang, onSelect, onPatch, onMove }) {
  const { t } = useTranslation();
  const rows = elements.slice().reverse();
  return (
    <div>
      <h2 className="cd-h2">{t('admin.certificates.designer.layers.heading')}</h2>
      {rows.length === 0 && <p className="admin-hint">{t('admin.certificates.designer.layers.empty')}</p>}
      <ul className="cd-layers-list">
        {rows.map((el) => {
          const k = typeKey(el);
          const Icon = TYPE_ICON[k] || Square;
          const label = el.type === 'text' ? (textOf(el, lang).replace(/\s+/g, ' ').slice(0, 26) || t('admin.certificates.designer.layers.types.text')) : t(`admin.certificates.designer.layers.types.${k}`);
          const idx = elements.indexOf(el);
          return (
            <li key={el.id} className={`cd-layer${el.id === selectedId ? ' is-selected' : ''}${el.hidden ? ' is-hidden' : ''}`}>
              <button type="button" className="cd-layer-main" onClick={() => onSelect(el.id)} aria-pressed={el.id === selectedId}>
                <Icon size={15} aria-hidden="true" />
                <span className="cd-layer-label">{label}</span>
              </button>
              <button type="button" className="cd-icon-btn" onClick={() => onMove(el.id, 1)} disabled={idx === elements.length - 1} title={t('admin.certificates.designer.layers.up')} aria-label={t('admin.certificates.designer.layers.up')}><ArrowUp size={14} /></button>
              <button type="button" className="cd-icon-btn" onClick={() => onMove(el.id, -1)} disabled={idx === 0} title={t('admin.certificates.designer.layers.down')} aria-label={t('admin.certificates.designer.layers.down')}><ArrowDown size={14} /></button>
              <button type="button" className="cd-icon-btn" onClick={() => onPatch(el.id, { hidden: !el.hidden })} title={el.hidden ? t('admin.certificates.designer.layers.show') : t('admin.certificates.designer.layers.hide')} aria-label={el.hidden ? t('admin.certificates.designer.layers.show') : t('admin.certificates.designer.layers.hide')} aria-pressed={el.hidden}>
                {el.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button type="button" className="cd-icon-btn" onClick={() => onPatch(el.id, { locked: !el.locked })} title={el.locked ? t('admin.certificates.designer.layers.unlock') : t('admin.certificates.designer.layers.lock')} aria-label={el.locked ? t('admin.certificates.designer.layers.unlock') : t('admin.certificates.designer.layers.lock')} aria-pressed={el.locked}>
                {el.locked ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NumberField({ id, label, value, min, max, step = 0.5, onChange }) {
  return (
    <div className="admin-form-group cd-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" className="admin-input" dir="ltr" value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step}
        onChange={(e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(n); }} />
    </div>
  );
}

function ColorField({ id, label, value, onChange, allowNone = false }) {
  const { t } = useTranslation();
  const none = value === 'transparent';
  return (
    <div className="admin-form-group cd-field">
      <label htmlFor={id}>{label}</label>
      <div className="cd-color-row">
        <input id={id} type="color" className="cd-color" value={none ? '#ffffff' : value} onChange={(e) => onChange(e.target.value.toUpperCase())} disabled={none} />
        {allowNone && (
          <label className="cd-check">
            <input type="checkbox" checked={none} onChange={(e) => onChange(e.target.checked ? 'transparent' : '#E8EDF3')} />
            {t('admin.certificates.designer.props.noFill')}
          </label>
        )}
      </div>
    </div>
  );
}

/** خصائص العنصر المحدّد؛ بلا تحديد: خلفية الصفحة */
export function PropsPanel({ el, design, lang, onPatch, onBackground, onReplaceImage, onSetUrl }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(''), [el?.id]);

  if (!el) {
    return (
      <div>
        <h2 className="cd-h2">{t('admin.certificates.designer.props.heading')}</h2>
        <p className="admin-hint">{t('admin.certificates.designer.props.noSelection')}</p>
        <ColorField id="cd_bg" label={t('admin.certificates.designer.props.pageBackground')} value={design.background.color} onChange={onBackground} />
      </div>
    );
  }

  const p = (patch, key) => onPatch(el.id, patch, key);
  const dis = el.locked;
  const startIcon = lang === 'ar' ? AlignRight : AlignLeft;
  const endIcon = lang === 'ar' ? AlignLeft : AlignRight;
  const alignBtns = [['start', startIcon], ['center', AlignCenter], ['end', endIcon]];

  return (
    <div>
      <h2 className="cd-h2">{t('admin.certificates.designer.props.heading')}</h2>
      {dis && <p className="admin-hint">{t('admin.certificates.designer.props.lockedNote')}</p>}
      <fieldset className="cd-fieldset" disabled={dis}>
        <div className="cd-grid-2">
          <NumberField id="cd_x" label={t('admin.certificates.designer.props.x')} value={el.x} min={-100} max={400} onChange={(v) => p({ x: v }, 'geo')} />
          <NumberField id="cd_y" label={t('admin.certificates.designer.props.y')} value={el.y} min={-100} max={300} onChange={(v) => p({ y: v }, 'geo')} />
          <NumberField id="cd_w" label={t('admin.certificates.designer.props.w')} value={el.w} min={MIN_SIZE_MM} max={400} onChange={(v) => p({ w: Math.max(MIN_SIZE_MM, v) }, 'geo')} />
          <NumberField id="cd_h" label={t('admin.certificates.designer.props.h')} value={el.h} min={0.2} max={300} step={el.type === 'shape' && el.shape === 'line' ? 0.1 : 0.5} onChange={(v) => p({ h: Math.max(0.2, v) }, 'geo')} />
        </div>

        {el.type === 'text' && (
          <>
            <div className="admin-form-group cd-field">
              <label htmlFor="cd_text">{t('admin.certificates.designer.props.content')} ({lang.toUpperCase()})</label>
              <textarea id="cd_text" className="admin-input" rows={4} dir={dirOf(lang)} maxLength={400} value={el.text[lang] || ''}
                onChange={(e) => p({ text: { ...el.text, [lang]: e.target.value } }, 'text')} />
              {!el.text[lang] && lang !== 'fr' && <p className="admin-hint">{t('admin.certificates.designer.props.contentFallback')}</p>}
            </div>
            <div className="cd-vars" role="group" aria-label={t('admin.certificates.designer.props.insertVariable')}>
              <span className="admin-hint">{t('admin.certificates.designer.props.insertVariable')}</span>
              {VARIABLES.map((v) => (
                <button key={v} type="button" className="cd-chip" onClick={() => p({ text: { ...el.text, [lang]: `${el.text[lang] || ''}{{${v}}}` } }, 'text')}>
                  {t(`admin.certificates.designer.vars.${v}`)}
                </button>
              ))}
            </div>
            <div className="cd-grid-2">
              <div className="admin-form-group cd-field">
                <label htmlFor="cd_font">{t('admin.certificates.designer.props.font')}</label>
                <select id="cd_font" className="admin-select" value={el.font} onChange={(e) => p({ font: e.target.value })}>
                  {Object.keys(FONTS).map((k) => <option key={k} value={k}>{t(`admin.certificates.designer.fonts.${k}`)}</option>)}
                </select>
              </div>
              <NumberField id="cd_size" label={t('admin.certificates.designer.props.size')} value={el.size} min={4} max={120} step={1} onChange={(v) => p({ size: Math.min(120, Math.max(4, v)) }, 'size')} />
            </div>
            <ColorField id="cd_color" label={t('admin.certificates.designer.props.color')} value={el.color} onChange={(v) => p({ color: v }, 'color')} />
            <div className="cd-row">
              <div className="cd-seg" role="group" aria-label={t('admin.certificates.designer.props.align')}>
                {alignBtns.map(([k, Icon]) => (
                  <button key={k} type="button" className={`cd-seg-btn${el.align === k ? ' is-active' : ''}`} aria-pressed={el.align === k}
                    title={t(`admin.certificates.designer.props.align_${k}`)} aria-label={t(`admin.certificates.designer.props.align_${k}`)} onClick={() => p({ align: k })}>
                    <Icon size={15} />
                  </button>
                ))}
              </div>
              <button type="button" className={`cd-seg-btn cd-solo${el.bold ? ' is-active' : ''}`} aria-pressed={el.bold} title={t('admin.certificates.designer.props.bold')} aria-label={t('admin.certificates.designer.props.bold')} onClick={() => p({ bold: !el.bold })}><Bold size={15} /></button>
              <button type="button" className={`cd-seg-btn cd-solo${el.italic ? ' is-active' : ''}`} aria-pressed={el.italic} title={t('admin.certificates.designer.props.italic')} aria-label={t('admin.certificates.designer.props.italic')} onClick={() => p({ italic: !el.italic })}><Italic size={15} /></button>
            </div>
          </>
        )}

        {el.type === 'shape' && (
          <>
            <div className="admin-form-group cd-field">
              <label htmlFor="cd_shape">{t('admin.certificates.designer.props.shape')}</label>
              <select id="cd_shape" className="admin-select" value={el.shape} onChange={(e) => p({ shape: e.target.value })}>
                {['rect', 'ellipse', 'line'].map((k) => <option key={k} value={k}>{t(`admin.certificates.designer.layers.types.${k}`)}</option>)}
              </select>
            </div>
            <ColorField id="cd_fill" label={t('admin.certificates.designer.props.fill')} value={el.fill} onChange={(v) => p({ fill: v }, 'fill')} allowNone={el.shape !== 'line'} />
            {el.shape !== 'line' && (
              <>
                <ColorField id="cd_stroke" label={t('admin.certificates.designer.props.stroke')} value={el.stroke} onChange={(v) => p({ stroke: v }, 'stroke')} />
                <NumberField id="cd_sw" label={t('admin.certificates.designer.props.strokeWidth')} value={el.strokeWidth} min={0} max={10} step={0.1} onChange={(v) => p({ strokeWidth: Math.min(10, Math.max(0, v)) }, 'sw')} />
              </>
            )}
            <NumberField id="cd_op" label={t('admin.certificates.designer.props.opacity')} value={el.opacity} min={0} max={1} step={0.1} onChange={(v) => p({ opacity: Math.min(1, Math.max(0, v)) }, 'op')} />
          </>
        )}

        {el.type === 'image' && (
          <>
            <div className="admin-form-group cd-field">
              <label htmlFor="cd_fit">{t('admin.certificates.designer.props.fit')}</label>
              <select id="cd_fit" className="admin-select" value={el.fit} onChange={(e) => p({ fit: e.target.value })}>
                <option value="contain">{t('admin.certificates.designer.props.fit_contain')}</option>
                <option value="cover">{t('admin.certificates.designer.props.fit_cover')}</option>
              </select>
            </div>
            <NumberField id="cd_iop" label={t('admin.certificates.designer.props.opacity')} value={el.opacity} min={0} max={1} step={0.1} onChange={(v) => p({ opacity: Math.min(1, Math.max(0, v)) }, 'op')} />
            <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => onReplaceImage(el.id)}>{t('admin.certificates.designer.props.replaceImage')}</button>
            <div className="admin-form-group cd-field">
              <label htmlFor="cd_url">{t('admin.certificates.designer.props.imageUrl')}</label>
              <div className="cd-color-row">
                <input id="cd_url" type="url" dir="ltr" className="admin-input" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
                <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={!url.trim()} onClick={() => onSetUrl(el.id, url.trim())}>{t('admin.certificates.designer.props.applyUrl')}</button>
              </div>
            </div>
          </>
        )}

        {el.type === 'qr' && <p className="admin-hint">{t('admin.certificates.designer.props.qrNote')}</p>}
      </fieldset>
    </div>
  );
}
