import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import StateBox from '../../../../components/admin/StateBox';
import { useAdminData } from '../hooks/useAdminData';
import { listGames, importChallengesChunk } from '../services/gamesAdmin.service';
import { listPaths } from '../services/gamesPaths.service';
import { pickName } from '../services/gamesAdmin.shared';
import { notifyError } from '../components/adminUi';
import {
  autoResolveRef, buildStageIndex, buildTemplate, collectStageRefs, parseImportText, prepareAll, summarize,
} from './importModel';
import { runChunks } from './importRunner';

const downloadJson = (obj, name) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

async function loadStageIndex() {
  const games = await listGames();
  const paths = await Promise.all(games.map(async (game) => ({ game, ...(await listPaths(game.id)) })));
  return buildStageIndex(paths);
}

/** استيراد دفعة تحديات من JSON: مسودّات فقط، لا نشر، لا تعديل لموجود. الحماية الحقيقية في الخادم (0061). */
export default function BulkImport({ onClose }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data: stageIndex, state, reload } = useAdminData(loadStageIndex);
  const fileRef = useRef(null);
  const [file, setFile] = useState(null); // { name, size, doc }
  const [parseError, setParseError] = useState('');
  const [stageMap, setStageMap] = useState({});
  const [phase, setPhase] = useState('idle'); // idle | validating | validated | importing | done
  const [progress, setProgress] = useState(null);
  const [server, setServer] = useState(new Map());
  const [failure, setFailure] = useState(null);
  const [results, setResults] = useState(null);

  const stageLabel = (x) => `${pickName(x.track.title, lang)} › ${pickName(x.category.title, lang)} › ${pickName(x.stage.title, lang)}`;
  const refs = useMemo(() => (file ? collectStageRefs(file.doc) : []), [file]);
  const items = useMemo(
    () => (file && stageIndex ? prepareAll(file.doc, { stageMap, stageIndex }) : []),
    [file, stageIndex, stageMap],
  );
  const summary = useMemo(() => summarize(items, server), [items, server]);
  const busy = phase === 'validating' || phase === 'importing';
  const blocked = items.some((it) => it.errors.length) || [...server.values()].some((r) => r.status === 'error');

  useEffect(() => {
    if (!file || !stageIndex) return;
    setStageMap((prev) => {
      const next = { ...prev };
      refs.forEach(({ ref }) => { if (!next[ref]) { const id = autoResolveRef(ref, stageIndex); if (id) next[ref] = id; } });
      return next;
    });
  }, [file, stageIndex, refs]);

  const resetRun = () => { setPhase('idle'); setServer(new Map()); setFailure(null); setResults(null); setProgress(null); };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    resetRun();
    setStageMap({});
    setParseError('');
    setFile(null);
    if (f.size > 2 * 1024 * 1024) { setParseError('file_too_large'); return; }
    const parsed = parseImportText(await f.text());
    if (!parsed.ok) { setParseError(parsed.code); return; }
    setFile({ name: f.name, size: f.size, doc: parsed.doc });
  };

  const validate = async () => {
    resetRun();
    setPhase('validating');
    const ok = items.filter((it) => it.payload);
    const { rows, failed } = await runChunks(ok, (p, dry) => importChallengesChunk(file.doc.import_id, p, dry), { dryRun: true, onProgress: setProgress });
    setServer(rows);
    if (failed) { setFailure(failed.error); notifyError(t, failed.error); setPhase('idle'); return; }
    setPhase('validated');
  };

  const doImport = async () => {
    setPhase('importing');
    setFailure(null);
    const ok = items.filter((it) => it.payload && server.get(it.index)?.status === 'new');
    const { rows, failed } = await runChunks(ok, (p, dry) => importChallengesChunk(file.doc.import_id, p, dry), { dryRun: false, onProgress: setProgress });
    setResults(rows);
    if (failed) { setFailure(failed.error); notifyError(t, failed.error); }
    setPhase('done');
  };

  const errText = (e) => {
    const c = e.code || '';
    const keys = c.startsWith('problem:')
      ? [`games.admin.builder.problems.${c.slice(8)}`, `games.admin.errors.${c.slice(8)}`]
      : [`games.admin.bulk.errors.${c}`, `games.admin.errors.${c}`];
    return t(keys, { defaultValue: c, ...(e.vars || {}) });
  };
  const rowErrors = (it) => {
    const own = it.errors.map((e) => ({ field: e.field, text: errText(e) }));
    const sv = server.get(it.index);
    return sv?.status === 'error' ? [...own, { field: sv.field, text: errText({ code: sv.code }) }] : own;
  };
  const created = results ? [...results.values()].filter((r) => r.status === 'created').length : 0;
  const skipped = results ? [...results.values()].filter((r) => r.status === 'skipped' || r.status === 'duplicate').length : 0;
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <section aria-label={t('games.admin.bulk.title')} className="ga-bulk">
      <div className="ga-toolbar">
        <h3 className="ga-bulk-title">{t('games.admin.bulk.title')}</h3>
        <button type="button" className="admin-btn admin-btn-ghost" disabled={busy} onClick={onClose}>{t('games.admin.bulk.back')}</button>
      </div>
      <p className="admin-hint">{t('games.admin.bulk.intro')}</p>
      <StateBox state={state} errorText={t('games.admin.loadError')} onRetry={reload} />
      {state === 'ready' && (
        <>
          <div className="admin-panel ga-bulk-panel">
            <div className="ga-bulk-actions">
              <button type="button" className="admin-btn admin-btn-ghost" onClick={() => downloadJson(buildTemplate(), 'iae-challenges-import-template.json')}>
                {t('games.admin.bulk.template')}
              </button>
              <button type="button" className="admin-btn admin-btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>{t('games.admin.bulk.upload')}</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
            </div>
            {parseError && <p className="admin-error" role="alert">{t(`games.admin.bulk.errors.${parseError}`)}</p>}
            {file && (
              <dl className="ga-bulk-meta">
                <div><dt>{t('games.admin.bulk.fileName')}</dt><dd dir="ltr">{file.name}</dd></div>
                <div><dt>{t('games.admin.bulk.importId')}</dt><dd dir="ltr">{file.doc.import_id}</dd></div>
                <div><dt>{t('games.admin.bulk.count')}</dt><dd>{file.doc.challenges.length}</dd></div>
              </dl>
            )}
          </div>

          {file && (
            <div className="admin-panel ga-bulk-panel">
              <h4>{t('games.admin.bulk.mapping')}</h4>
              <p className="admin-hint">{t('games.admin.bulk.mappingHint')}</p>
              <div className="admin-table-wrap">
                <table className="admin-data-table admin-table-cards">
                  <thead><tr><th>{t('games.admin.bulk.stageRef')}</th><th>{t('games.admin.bulk.count')}</th><th>{t('games.admin.bulk.stage')}</th></tr></thead>
                  <tbody>
                    {refs.map(({ ref, count }) => {
                      const sel = stageIndex.byId.get(stageMap[ref]);
                      return (
                        <tr key={ref || '∅'}>
                          <td data-label={t('games.admin.bulk.stageRef')} dir="ltr">{ref || '—'}</td>
                          <td data-label={t('games.admin.bulk.count')}>{count}</td>
                          <td data-label={t('games.admin.bulk.stage')}>
                            <select className="admin-select" aria-label={t('games.admin.bulk.stage')} disabled={busy} value={stageMap[ref] || ''}
                              onChange={(e) => { resetRun(); setStageMap((m) => ({ ...m, [ref]: e.target.value })); }}>
                              <option value="">{t('games.admin.bulk.unmapped')}</option>
                              {stageIndex.list.map((x) => <option key={x.id} value={x.id}>{pickName(x.game.title, lang)} › {stageLabel(x)}</option>)}
                            </select>
                            {sel && <span className="admin-ann-sub">{stageLabel(sel)}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="ga-bulk-actions">
                <button type="button" className="admin-btn admin-btn-primary" disabled={busy} onClick={validate}>
                  {busy && phase === 'validating' && <span className="admin-btn-spinner" aria-hidden="true" />}{t('games.admin.bulk.validate')}
                </button>
              </div>
            </div>
          )}

          {busy && (
            <div className="admin-panel ga-bulk-panel" role="status" aria-live="polite">
              <progress className="ga-bulk-progress" max="100" value={pct} aria-label={t('games.admin.bulk.progress')} />
              <span>{t('games.admin.bulk.progressText', { done: progress?.done || 0, total: progress?.total || 0 })}</span>
            </div>
          )}

          {(phase === 'validated' || phase === 'done') && (
            <div className="admin-panel ga-bulk-panel">
              <h4>{t('games.admin.bulk.preview')}</h4>
              <ul className="ga-bulk-stats">
                <li><b>{summary.total}</b> {t('games.admin.bulk.total')}</li>
                <li><b>{summary.valid}</b> {t('games.admin.bulk.valid')}</li>
                <li><b>{summary.invalid}</b> {t('games.admin.bulk.invalid')}</li>
                <li><b>{summary.duplicate}</b> {t('games.admin.bulk.duplicate')}</li>
              </ul>
              <p><b>{t('games.admin.bulk.byType')}:</b> {Object.entries(summary.byType).map(([k, n]) => `${t(`games.admin.builder.types.${k}`, { defaultValue: k })} ${n}`).join(' · ')}</p>
              <p><b>{t('games.admin.bulk.byStage')}:</b> {Object.entries(summary.byStage).map(([k, n]) => `${stageIndex.byId.get(k) ? stageLabel(stageIndex.byId.get(k)) : k} ${n}`).join(' · ')}</p>
              {items.some((it) => rowErrors(it).length) && (
                <div className="admin-table-wrap">
                  <table className="admin-data-table admin-table-cards">
                    <thead><tr><th>#</th><th>external_id</th><th>{t('games.admin.bulk.field')}</th><th>{t('games.admin.bulk.problem')}</th></tr></thead>
                    <tbody>
                      {items.flatMap((it) => rowErrors(it).map((e, i) => (
                        <tr key={`${it.index}-${i}`}>
                          <td data-label="#">{it.index + 1}</td><td data-label="external_id" dir="ltr">{it.external_id || '—'}</td>
                          <td data-label={t('games.admin.bulk.field')} dir="ltr">{e.field || '—'}</td><td data-label={t('games.admin.bulk.problem')}>{e.text}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              )}
              {phase === 'validated' && (
                <div className="ga-bulk-actions">
                  {blocked && <p className="admin-error" role="alert">{t('games.admin.bulk.blocked')}</p>}
                  <button type="button" className="admin-btn admin-btn-primary" disabled={blocked || summary.valid === 0} onClick={doImport}>
                    {t('games.admin.bulk.import', { count: summary.valid })}
                  </button>
                  <span className="admin-hint">{t('games.admin.bulk.draftOnly')}</span>
                </div>
              )}
            </div>
          )}

          {phase === 'done' && (
            <div className="admin-panel ga-bulk-panel" role="status">
              <h4>{t('games.admin.bulk.results')}</h4>
              <ul className="ga-bulk-stats">
                <li><b>{created}</b> {t('games.admin.bulk.created')}</li>
                <li><b>{skipped + summary.duplicate}</b> {t('games.admin.bulk.skipped')}</li>
                <li><b>{summary.valid - created}</b> {t('games.admin.bulk.notImported')}</li>
              </ul>
              {failure && <p className="admin-error" role="alert">{t('games.admin.bulk.partial')}</p>}
              <div className="ga-bulk-actions">
                {failure && <button type="button" className="admin-btn admin-btn-primary" onClick={validate}>{t('games.admin.bulk.retry')}</button>}
                <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{t('games.admin.bulk.finish')}</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
