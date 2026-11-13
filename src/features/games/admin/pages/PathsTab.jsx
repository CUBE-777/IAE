import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import StateBox from '../../../../components/admin/StateBox';
import { useAdminData } from '../hooks/useAdminData';
import { listGames } from '../services/gamesAdmin.service';
import { listPaths, reorderPathItems, setPathStatus } from '../services/gamesPaths.service';
import { pickName } from '../services/gamesAdmin.shared';
import { ConfirmModal, MoveButtons, StatusPill, moveItem, notifyError } from '../components/adminUi';
import { PathCategoryForm, StageForm, TrackForm } from '../components/PathForms';
import StageChallengesModal from '../components/StageChallengesModal';
import StageGrantsModal from '../components/StageGrantsModal';

const group = (list, key) => list.reduce((m, x) => {
  if (!m[x[key]]) m[x[key]] = [];
  m[x[key]].push(x);
  return m;
}, {});

/** عدّ ما يتأثر بإخفاء/أرشفة عقدة (للتأكيد فقط). */
function impactOf(kind, node) {
  if (kind === 'stage') return { categories: 0, stages: 0, challenges: node.challenges.length };
  if (kind === 'category') return { categories: 0, stages: node.stages.length, challenges: node.stages.reduce((n, s) => n + s.challenges.length, 0) };
  const stages = node.categories.flatMap((c) => c.stages);
  return { categories: node.categories.length, stages: stages.length, challenges: stages.reduce((n, s) => n + s.challenges.length, 0) };
}

function Node({ level, name, slug, status, badges, move, actions, children }) {
  const { t } = useTranslation();
  return (
    <div className={`ga-node ga-node-${level}${status === 'archived' ? ' is-archived' : ''}`}>
      <div className="ga-node-head">
        <div className="ga-node-title">
          <span className="ga-node-kind">{t(`games.admin.paths.kinds.${level}`)}</span>
          <strong className="ga-node-name">{name}</strong>
          <code dir="ltr">{slug}</code>
          <StatusPill status={status} />
          {badges}
        </div>
        <div className="ga-node-actions">{move}{actions}</div>
      </div>
      {children}
    </div>
  );
}

/** أزرار الحالة: draft→نشر · published→إخفاء (تأكيد) · غير مؤرشف→أرشفة (تأكيد) · archived→استعادة كمسودة. */
function StatusActions({ node, kind, busy, onSet }) {
  const { t } = useTranslation();
  const btn = (key, status, confirm) => (
    <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => onSet(kind, node, status, confirm)}>
      {t(`games.admin.paths.statusActions.${key}`)}
    </button>
  );
  return (
    <>
      {node.status === 'draft' && btn('publish', 'published', false)}
      {node.status === 'published' && btn('unpublish', 'draft', true)}
      {node.status !== 'archived' && btn('archive', 'archived', true)}
      {node.status === 'archived' && btn('restore', 'draft', false)}
    </>
  );
}

export default function PathsTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const games = useAdminData(listGames);
  const [pickedGame, setPickedGame] = useState('');
  const gameList = games.data || [];
  const gameId = pickedGame && gameList.some((g) => g.id === pickedGame) ? pickedGame : gameList[0]?.id || '';
  const paths = useAdminData(() => (gameId ? listPaths(gameId) : null), [gameId]);

  const [form, setForm] = useState(null);           // { type, item, parent }
  const [confirm, setConfirm] = useState(null);     // { kind, node, status }
  const [challengesFor, setChallengesFor] = useState(null);   // stage id
  const [grantsFor, setGrantsFor] = useState(null);           // stage id
  const [busy, setBusy] = useState(false);

  const data = paths.data && paths.data.gameId === gameId ? paths.data : null;
  const tree = useMemo(() => {
    if (!data) return [];
    const catsBy = group(data.categories, 'track_id');
    const stagesBy = group(data.stages, 'category_id');
    const chBy = group(data.challenges.filter((c) => c.stage_id), 'stage_id');
    return data.tracks.map((tr) => ({
      ...tr,
      categories: (catsBy[tr.id] || []).map((c) => ({
        ...c,
        stages: (stagesBy[c.id] || []).map((s) => ({ ...s, challenges: chBy[s.id] || [] })),
      })),
    }));
  }, [data]);

  const run = async (fn, okKey) => {
    setBusy(true);
    try {
      await fn();
      if (okKey) window.notify?.success(t(okKey));
      paths.reload();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };
  const move = (kind, siblings, from, to) => run(() => reorderPathItems(kind, moveItem(siblings, from, to).map((x) => x.id)));
  const onSet = (kind, node, status, needsConfirm) => {
    if (needsConfirm) { setConfirm({ kind, node, status }); return; }
    run(() => setPathStatus(kind, node.id, status), status === 'published' ? 'games.admin.publishedOk' : 'games.admin.paths.restoredOk');
  };
  const doConfirm = async () => {
    const c = confirm;
    setBusy(true);
    try {
      await setPathStatus(c.kind, c.node.id, c.status);
      window.notify?.success(t(c.status === 'archived' ? 'games.admin.paths.archivedOk' : 'games.admin.unpublishedOk'));
      setConfirm(null);
      paths.reload();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };
  const closeForm = () => setForm(null);
  const saved = () => { setForm(null); paths.reload(); };

  // عرض فقط (القرار للخادم): العقدة ظاهرة للاعبين إن كانت هي وكل آبائها منشورة
  const vis = (...nodes) => nodes.every((n) => n.status === 'published');
  const visBadge = (visible) => (
    <span className={`admin-badge admin-badge-${visible ? 'approved' : 'muted'}`}>
      {t(visible ? 'games.admin.paths.visible' : 'games.admin.paths.hidden')}
    </span>
  );

  // عقدة التأكيد من الشجرة الحيّة (فيها الأبناء لعدّ الأثر)
  const confirmMode = confirm?.status === 'archived' ? 'archive' : 'unpublish';
  const confirmNode = confirm
    ? tree.flatMap((x) => [x, ...x.categories.flatMap((c) => [c, ...c.stages])]).find((x) => x.id === confirm.node.id) || confirm.node
    : null;

  const stageById = (id) => data?.stages.find((s) => s.id === id);
  const catById = (id) => data?.categories.find((c) => c.id === id);
  const stageForChallenges = challengesFor && stageById(challengesFor);
  const stageForGrants = grantsFor && stageById(grantsFor);

  const topState = games.state === 'loading' ? 'loading' : games.state === 'error' ? 'error' : gameList.length ? '' : 'empty';
  const treeState = !gameId ? '' : paths.state === 'error' ? 'error' : !data ? 'loading' : tree.length ? '' : 'empty';

  return (
    <section aria-label={t('games.admin.tabs.paths')}>
      <p className="admin-hint ga-paths-intro">{t('games.admin.paths.intro')}</p>
      <div className="ga-toolbar">
        <select className="admin-select ga-filter" aria-label={t('games.admin.paths.selectGame')} value={gameId} disabled={!gameList.length} onChange={(e) => setPickedGame(e.target.value)}>
          {gameList.map((g) => <option key={g.id} value={g.id}>{pickName(g.title, lang) || g.slug}</option>)}
        </select>
        <button type="button" className="admin-quick-action" disabled={!gameId || !data} onClick={() => setForm({ type: 'track', item: null })}>
          {t('games.admin.paths.newTrack')}
        </button>
      </div>

      <div className="admin-panel">
        <StateBox state={topState} emptyText={t('games.admin.paths.noGames')} errorText={t('games.admin.loadError')} onRetry={games.reload} />
        <StateBox state={treeState} emptyText={t('games.admin.paths.emptyTracks')} errorText={t('games.admin.loadError')} onRetry={paths.reload} />

        {tree.length > 0 && (
          <div className="ga-tree">
            {tree.map((tr, ti) => (
              <Node key={tr.id} level="track" name={pickName(tr.title, lang)} slug={tr.slug} status={tr.status}
                badges={visBadge(vis(tr))}
                move={<MoveButtons index={ti} count={tree.length} disabled={busy} onMove={(f, to) => move('track', tree, f, to)} />}
                actions={(
                  <>
                    <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy || tr.status === 'archived'} onClick={() => setForm({ type: 'category', item: null, parent: tr })}>{t('games.admin.paths.addCategory')}</button>
                    <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setForm({ type: 'track', item: tr })}>{t('admin.common.edit')}</button>
                    <StatusActions node={tr} kind="track" busy={busy} onSet={onSet} />
                  </>
                )}>
                {tr.categories.length === 0 && <p className="ga-node-empty">{t('games.admin.paths.emptyCategories')}</p>}
                {tr.categories.map((c, ci) => (
                  <Node key={c.id} level="category" name={pickName(c.title, lang)} slug={c.slug} status={c.status}
                    badges={(
                      <>
                        <span className="admin-badge admin-badge-muted">{t(`games.admin.paths.unlockModes.${c.stage_unlock_mode}`)}</span>
                        {visBadge(vis(tr, c))}
                      </>
                    )}
                    move={<MoveButtons index={ci} count={tr.categories.length} disabled={busy} onMove={(f, to) => move('category', tr.categories, f, to)} />}
                    actions={(
                      <>
                        <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy || c.status === 'archived'} onClick={() => setForm({ type: 'stage', item: null, parent: c })}>{t('games.admin.paths.addStage')}</button>
                        <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setForm({ type: 'category', item: c, parent: tr })}>{t('admin.common.edit')}</button>
                        <StatusActions node={c} kind="category" busy={busy} onSet={onSet} />
                      </>
                    )}>
                    {c.stages.length === 0 && <p className="ga-node-empty">{t('games.admin.paths.emptyStages')}</p>}
                    {c.stages.map((s, si) => {
                      const required = s.challenges.filter((x) => x.is_required).length;
                      const manual = c.stage_unlock_mode === 'manual' || s.completion_mode === 'manual';
                      return (
                        <Node key={s.id} level="stage" name={pickName(s.title, lang)} slug={s.slug} status={s.status}
                          badges={(
                            <>
                              <span className="admin-badge admin-badge-muted">
                                {t(`games.admin.paths.completionModes.${s.completion_mode}`)}
                                {s.completion_threshold != null ? ` (${s.completion_threshold}${s.completion_mode === 'min_success_rate' ? '%' : ''})` : ''}
                              </span>
                              <span className="ga-node-meta">{t('games.admin.paths.stageChallenges', { count: s.challenges.length, required })}</span>
                              {visBadge(vis(tr, c, s))}
                            </>
                          )}
                          move={<MoveButtons index={si} count={c.stages.length} disabled={busy} onMove={(f, to) => move('stage', c.stages, f, to)} />}
                          actions={(
                            <>
                              <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setChallengesFor(s.id)}>{t('games.admin.paths.manageChallenges')}</button>
                              {manual && <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setGrantsFor(s.id)}>{t('games.admin.paths.manageGrants')}</button>}
                              <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setForm({ type: 'stage', item: s, parent: c })}>{t('admin.common.edit')}</button>
                              <StatusActions node={s} kind="stage" busy={busy} onSet={onSet} />
                            </>
                          )}
                        />
                      );
                    })}
                  </Node>
                ))}
              </Node>
            ))}
          </div>
        )}
      </div>

      {form?.type === 'track' && <TrackForm item={form.item} gameId={gameId} nextOrder={tree.length + 1} onClose={closeForm} onSaved={saved} />}
      {form?.type === 'category' && (
        <PathCategoryForm item={form.item} track={form.parent} nextOrder={(tree.find((x) => x.id === form.parent.id)?.categories.length || 0) + 1} onClose={closeForm} onSaved={saved} />
      )}
      {form?.type === 'stage' && (
        <StageForm item={form.item} category={form.parent}
          nextOrder={(data?.stages.filter((x) => x.category_id === form.parent.id).length || 0) + 1} onClose={closeForm} onSaved={saved} />
      )}

      {confirm && (
        <ConfirmModal title={t(`games.admin.paths.confirm.${confirmMode}Title`)} confirmLabel={t(`games.admin.paths.confirm.${confirmMode}Btn`)} busy={busy}
          danger={confirmMode === 'archive'} onConfirm={doConfirm} onClose={() => setConfirm(null)}>
          <p><strong>{pickName(confirmNode.title, lang)}</strong></p>
          <p>{t(`games.admin.paths.confirm.${confirmMode}.${confirm.kind}`)}</p>
          <p className="admin-hint">{t('games.admin.paths.confirm.impact', impactOf(confirm.kind, confirmNode))}</p>
          <p className="admin-hint">{t('games.admin.paths.confirm.history')}</p>
        </ConfirmModal>
      )}

      {stageForChallenges && (
        <StageChallengesModal stage={stageForChallenges} challenges={data.challenges} onClose={() => setChallengesFor(null)} onChanged={() => paths.reload()} />
      )}
      {stageForGrants && (
        <StageGrantsModal stage={stageForGrants} category={catById(stageForGrants.category_id)} onClose={() => setGrantsFor(null)} />
      )}
    </section>
  );
}
