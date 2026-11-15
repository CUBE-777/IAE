import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import StateBox from '../../../../components/admin/StateBox';
import { useAdminData } from '../hooks/useAdminData';
import { deleteChallenge, listChallenges, listGames, reorderItems, saveChallenge } from '../services/gamesAdmin.service';
import { pickName } from '../services/gamesAdmin.shared';
import ChallengeBuilder from '../builder/ChallengeBuilder';
import BulkImport from '../bulk/BulkImport';
import { ConfirmModal, MoveButtons, StatusPill, moveItem, notifyError } from '../components/adminUi';

export default function ChallengesTab() {
  const { t, i18n } = useTranslation();
  const { data, state, reload } = useAdminData(() => Promise.all([listChallenges(), listGames()]));
  const [gameFilter, setGameFilter] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [builder, setBuilder] = useState(undefined); // undefined = مغلق، null = تحدٍّ جديد، صف = تعديل
  const [bulk, setBulk] = useState(false);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [challenges, games] = data || [[], []];
  const gameName = useMemo(() => Object.fromEntries(games.map((g) => [g.id, pickName(g.title, i18n.language)])), [games, i18n.language]);
  const byGame = gameFilter ? challenges.filter((c) => c.game_id === gameFilter) : challenges;
  const counts = useMemo(() => ({ all: byGame.length, draft: byGame.filter((c) => c.status === 'draft').length, published: byGame.filter((c) => c.status === 'published').length, archived: byGame.filter((c) => c.status === 'archived').length }), [byGame]);
  const needle = q.trim().toLowerCase();
  const rows = byGame.filter((c) => (!statusFilter || c.status === statusFilter)
    && (!needle || `${c.slug} ${Object.values(c.title || {}).join(' ')}`.toLowerCase().includes(needle)));
  const reorderable = gameFilter !== '' && !needle && !statusFilter; // إعادة الترتيب فقط على القائمة الكاملة للعبة

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };
  const move = (from, to) => run(() => reorderItems('challenge', moveItem(rows, from, to).map((r) => r.id)));
  const setStatus = (c, status, okKey) => run(async () => {
    await saveChallenge(c.id, { status });
    window.notify?.success(t(okKey));
  });
  const doDelete = async () => {
    const c = del;
    setBusy(true);
    try {
      const res = await deleteChallenge(c.id);
      window.notify?.success(t(res?.result === 'archived' ? 'games.admin.archivedOk' : 'games.admin.deletedOk'));
      setDel(null);
      reload();
    } catch (err) {
      notifyError(t, err);
    } finally {
      setBusy(false);
    }
  };

  if (builder !== undefined && state === 'ready') {
    return (
      <ChallengeBuilder challenge={builder} games={games} defaultGameId={gameFilter}
        onClose={() => { setBuilder(undefined); reload(); }} />  /* القائمة تُحدَّث عند الإغلاق فقط: reload أثناء التحرير كان سيُفرغ المحرر */
    );
  }

  if (bulk) return <BulkImport onClose={() => { setBulk(false); reload(); }} />;

  const st = state === 'ready' ? (rows.length ? '' : 'empty') : state;
  return (
    <section aria-label={t('games.admin.tabs.challenges')}>
      <div className="ga-toolbar">
        <select className="admin-select ga-filter" aria-label={t('games.admin.fields.game')} value={gameFilter} onChange={(e) => setGameFilter(e.target.value)}>
          <option value="">{t('games.admin.allGames')}</option>
          {games.map((g) => <option key={g.id} value={g.id}>{gameName[g.id]}</option>)}
        </select>
        <label className="ga-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" className="admin-input" placeholder={t('games.admin.searchChallenges')} aria-label={t('games.admin.searchChallenges')} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="button" className="admin-btn admin-btn-primary ga-new" disabled={state !== 'ready' || games.length === 0} onClick={() => setBuilder(null)}>
          <Plus size={16} aria-hidden="true" /> {t('games.admin.challenges.new')}
        </button>
        <button type="button" className="admin-quick-action" disabled={state !== 'ready' || games.length === 0} onClick={() => setBulk(true)}>
          {t('games.admin.bulk.open')}
        </button>
      </div>
      {state === 'ready' && (
        <div className="ga-chips" role="group" aria-label={t('games.admin.fields.status')}>
          {[['', 'all'], ['draft', 'draft'], ['published', 'published'], ['archived', 'archived']].map(([val, k]) => (
            <button key={k} type="button" className={`ga-chip${statusFilter === val ? ' on' : ''}`} aria-pressed={statusFilter === val} onClick={() => setStatusFilter(val)}>
              {k === 'all' ? t('games.admin.allStatuses') : t(`games.admin.status.${k}`)} <b>{counts[k]}</b>
            </button>
          ))}
        </div>
      )}
      {state === 'ready' && games.length === 0 && <p className="admin-hint">{t('games.admin.challenges.needGame')}</p>}
      {!gameFilter && rows.length > 1 && <p className="admin-hint">{t('games.admin.challenges.reorderHint')}</p>}
      <div className="admin-panel">
        <StateBox state={st} emptyText={t('games.admin.challenges.empty')} errorText={t('games.admin.loadError')} onRetry={reload} />
        {rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('games.admin.fields.title')}</th><th>{t('games.admin.fields.game')}</th><th>{t('games.admin.fields.difficulty')}</th>
                  <th>{t('games.admin.fields.points')}</th><th>{t('games.admin.fields.status')}</th>
                  {reorderable && <th>{t('games.admin.fields.order')}</th>}<th>{t('games.admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c.id}>
                    <td data-label={t('games.admin.fields.title')}><span className="admin-ann-title">{pickName(c.title, i18n.language)}</span><span className="admin-ann-sub" dir="ltr">{c.slug}</span></td>
                    <td data-label={t('games.admin.fields.game')}>{gameName[c.game_id] || '—'}</td>
                    <td data-label={t('games.admin.fields.difficulty')}>{c.difficulty} — {t(`games.admin.difficulty.${c.difficulty}`)}</td>
                    <td data-label={t('games.admin.fields.points')}>{c.points_reward}</td>
                    <td data-label={t('games.admin.fields.status')}><StatusPill status={c.status} /></td>
                    {reorderable && <td data-label={t('games.admin.fields.order')}><MoveButtons index={i} count={rows.length} disabled={busy} onMove={move} /></td>}
                    <td className="admin-cell-actions">
                      {c.status === 'published'
                        ? <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => setStatus(c, 'draft', 'games.admin.unpublishedOk')}>{t('games.admin.unpublish')}</button>
                        : <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => setStatus(c, 'published', 'games.admin.publishedOk')}>{t('games.admin.publish')}</button>}
                      <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setBuilder(c)}><Pencil size={14} aria-hidden="true" /> {t('admin.common.edit')}</button>
                      <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" disabled={busy} onClick={() => setDel(c)} aria-label={t('admin.common.delete')} title={t('admin.common.delete')}><Trash2 size={14} aria-hidden="true" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {del && (
        <ConfirmModal title={t('admin.common.confirmDelete')} confirmLabel={t('admin.common.delete')} busy={busy} onConfirm={doDelete} onClose={() => setDel(null)}>
          <p><strong>{pickName(del.title, i18n.language)}</strong></p>
          <p>{t('games.admin.challenges.deleteConfirm')}</p>
        </ConfirmModal>
      )}
    </section>
  );
}
