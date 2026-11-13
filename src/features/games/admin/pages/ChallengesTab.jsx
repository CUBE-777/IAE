import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../../components/admin/Modal';
import StateBox from '../../../../components/admin/StateBox';
import { useAdminData } from '../hooks/useAdminData';
import { deleteChallenge, getChallengeSolution, listChallenges, listGames, reorderItems, saveChallenge } from '../services/gamesAdmin.service';
import { cleanI18n, fillI18n, fromLocalInput, pickName, slugify, SLUG_RE, toLocalInput } from '../services/gamesAdmin.shared';
import { CONTENT_FORBIDDEN_KEY, DIFFICULTIES, VERIFY_MODES } from '../constants/gamesAdmin';
import ChallengeBuilder from '../builder/ChallengeBuilder';
import { ConfirmModal, Field, LocalizedFields, MoveButtons, StatusPill, moveItem, notifyError } from '../components/adminUi';

const pretty = (v) => JSON.stringify(v, null, 2);

/** مفتاح محظور في أي مستوى من content (إجابة/حل لا مكان لهما في الجزء العلني). */
function hasForbiddenKey(node) {
  if (Array.isArray(node)) return node.some(hasForbiddenKey);
  if (node && typeof node === 'object') {
    return Object.entries(node).some(([k, val]) => CONTENT_FORBIDDEN_KEY.test(k) || hasForbiddenKey(val));
  }
  return false;
}

const intOrNull = (s) => (String(s).trim() === '' ? null : Number(s));
const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

function ChallengeForm({ item, games, defaultGameId, nextOrder, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const [v, setV] = useState({
    game_id: item?.game_id || defaultGameId || games[0]?.id || '',
    slug: item?.slug || '',
    title: fillI18n(item?.title),
    description: fillI18n(item?.description),
    difficulty: String(item?.difficulty || 1),
    points_reward: String(item?.points_reward ?? 10),
    time_limit_seconds: item?.time_limit_seconds == null ? '' : String(item.time_limit_seconds),
    max_attempts: item?.max_attempts == null ? '' : String(item.max_attempts),
    content: pretty(item?.content || {}),
    status: item?.status || 'draft',
    starts_at: toLocalInput(item?.starts_at),
    ends_at: toLocalInput(item?.ends_at),
    verify_mode: VERIFY_MODES[0],
    solution: '',
  });
  const [solState, setSolState] = useState(item ? 'loading' : 'ready'); // loading | ready | error | missing
  const [solDirty, setSolDirty] = useState(!item);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (patch) => setV((p) => ({ ...p, ...patch }));

  useEffect(() => {
    if (!item) return undefined;
    let alive = true;
    getChallengeSolution(item.id)
      .then((row) => {
        if (!alive) return;
        if (!row) {
          setSolState('missing');
          setSolDirty(true);
        } else {
          setV((p) => ({ ...p, solution: pretty(row.solution), verify_mode: VERIFY_MODES.includes(row.verify_mode) ? row.verify_mode : VERIFY_MODES[0] }));
          setSolState('ready');
        }
      })
      .catch(() => alive && setSolState('error'));
    return () => {
      alive = false;
    };
  }, [item]);

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    const title = cleanI18n(v.title);
    const slug = (v.slug.trim() || slugify(v.title.en || v.title.fr)).trim();
    if (!title) er.title = t('games.admin.errors.nameRequired');
    if (!SLUG_RE.test(slug)) er.slug = t('games.admin.errors.slugInvalid');
    if (!v.game_id) er.game_id = t('games.admin.errors.gameRequired');
    const points = Number(v.points_reward);
    if (!isInt(points, 0, 10000)) er.points_reward = t('games.admin.errors.pointsRange');
    const limit = intOrNull(v.time_limit_seconds);
    if (limit !== null && !isInt(limit, 5, 86400)) er.time_limit_seconds = t('games.admin.errors.timeRange');
    const maxAtt = intOrNull(v.max_attempts);
    if (maxAtt !== null && !isInt(maxAtt, 1, 1000)) er.max_attempts = t('games.admin.errors.attemptsRange');
    const starts = fromLocalInput(v.starts_at);
    const ends = fromLocalInput(v.ends_at);
    if (starts && ends && ends <= starts) er.ends_at = t('games.admin.errors.datesInvalid');

    let content = {};
    try {
      content = JSON.parse(v.content || '{}');
      if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('obj');
      if (hasForbiddenKey(content)) er.content = t('games.admin.errors.content_has_answer');
    } catch {
      er.content = er.content || t('games.admin.errors.invalid_json');
    }
    let solution;
    let sendSolution = false;
    if (solDirty) {
      if (!v.solution.trim()) {
        if (v.status === 'published') er.solution = t('games.admin.errors.solutionRequired');
      } else {
        try {
          solution = JSON.parse(v.solution);
          if (solution === null) throw new Error('null');
          sendSolution = true;
        } catch {
          er.solution = t('games.admin.errors.invalid_json');
        }
      }
    }
    setErrors(er);
    if (Object.keys(er).length) return;

    const data = {
      game_id: v.game_id, slug, title, description: cleanI18n(v.description), difficulty: Number(v.difficulty), points_reward: points,
      time_limit_seconds: limit, max_attempts: maxAtt, content, status: v.status, starts_at: starts, ends_at: ends, verify_mode: v.verify_mode,
    };
    if (!item) data.sort_order = nextOrder;
    if (sendSolution) data.solution = solution;
    setSaving(true);
    try {
      await saveChallenge(item?.id, data);
      window.notify?.success(t('admin.common.saved'));
      onSaved();
    } catch (err) {
      notifyError(t, err);
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <h3>{item ? t('games.admin.challenges.edit') : t('games.admin.challenges.new')}</h3>
      <form onSubmit={submit} noValidate>
        <div className="admin-form-grid-2">
          <Field id="c_game" label={t('games.admin.fields.game')} error={errors.game_id}>
            <select id="c_game" className="admin-select" value={v.game_id} onChange={(e) => set({ game_id: e.target.value })}>
              {games.map((g) => <option key={g.id} value={g.id}>{pickName(g.title, i18n.language)}</option>)}
            </select>
          </Field>
          <Field id="c_slug" label={t('games.admin.fields.slug')} hint={t('games.admin.fields.slugHint')} error={errors.slug}>
            <input id="c_slug" className="admin-input" dir="ltr" maxLength={64} value={v.slug} onChange={(e) => set({ slug: e.target.value })} />
          </Field>
        </div>
        <LocalizedFields label={t('games.admin.fields.title')} required value={v.title} onChange={(title) => set({ title })} error={errors.title} />
        <LocalizedFields label={t('games.admin.fields.description')} multiline maxLength={2000} value={v.description} onChange={(description) => set({ description })} />

        <div className="admin-form-grid-2">
          <Field id="c_diff" label={t('games.admin.fields.difficulty')}>
            <select id="c_diff" className="admin-select" value={v.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d} — {t(`games.admin.difficulty.${d}`)}</option>)}
            </select>
          </Field>
          <Field id="c_points" label={t('games.admin.fields.points')} error={errors.points_reward}>
            <input id="c_points" type="number" min="0" max="10000" className="admin-input" dir="ltr" value={v.points_reward} onChange={(e) => set({ points_reward: e.target.value })} />
          </Field>
          <Field id="c_time" label={t('games.admin.fields.timeLimit')} hint={t('games.admin.fields.timeLimitHint')} error={errors.time_limit_seconds}>
            <input id="c_time" type="number" min="5" max="86400" className="admin-input" dir="ltr" value={v.time_limit_seconds} onChange={(e) => set({ time_limit_seconds: e.target.value })} />
          </Field>
          <Field id="c_att" label={t('games.admin.fields.maxAttempts')} hint={t('games.admin.fields.maxAttemptsHint')} error={errors.max_attempts}>
            <input id="c_att" type="number" min="1" max="1000" className="admin-input" dir="ltr" value={v.max_attempts} onChange={(e) => set({ max_attempts: e.target.value })} />
          </Field>
          <Field id="c_start" label={t('games.admin.fields.startsAt')}>
            <input id="c_start" type="datetime-local" className="admin-input" dir="ltr" value={v.starts_at} onChange={(e) => set({ starts_at: e.target.value })} />
          </Field>
          <Field id="c_end" label={t('games.admin.fields.endsAt')} error={errors.ends_at}>
            <input id="c_end" type="datetime-local" className="admin-input" dir="ltr" value={v.ends_at} onChange={(e) => set({ ends_at: e.target.value })} />
          </Field>
          <Field id="c_status" label={t('games.admin.fields.status')}>
            <select id="c_status" className="admin-select" value={v.status} onChange={(e) => set({ status: e.target.value })}>
              {['draft', 'published', 'archived'].map((s) => <option key={s} value={s}>{t(`games.admin.status.${s}`)}</option>)}
            </select>
          </Field>
          <Field id="c_verify" label={t('games.admin.fields.verifyMode')} hint={t('games.admin.fields.verifyModeHint')}>
            <select id="c_verify" className="admin-select" value={v.verify_mode} onChange={(e) => set({ verify_mode: e.target.value })}>
              {VERIFY_MODES.map((m) => <option key={m} value={m}>{t(`games.admin.verifyModes.${m}`)}</option>)}
            </select>
          </Field>
        </div>

        <Field id="c_content" label={t('games.admin.fields.content')} hint={t('games.admin.fields.contentHint')} error={errors.content}>
          <textarea id="c_content" className="admin-textarea ga-code" dir="ltr" rows={6} spellCheck={false} value={v.content} onChange={(e) => set({ content: e.target.value })} />
        </Field>

        <div className="ga-solution">
          <Field id="c_solution" label={t('games.admin.fields.solution')} error={errors.solution}
            hint={solState === 'missing' ? t('games.admin.fields.solutionMissing') : t('games.admin.fields.solutionHint')}>
            {solState === 'loading' && <p className="admin-hint" role="status">{t('admin.common.loading')}</p>}
            {solState === 'error' && <p className="admin-inline-error" role="alert">{t('games.admin.fields.solutionLoadError')}</p>}
            {solState !== 'loading' && (
              <textarea id="c_solution" className="admin-textarea ga-code" dir="ltr" rows={4} spellCheck={false}
                placeholder={item && solState === 'error' ? t('games.admin.fields.solutionKeep') : undefined}
                value={v.solution} onChange={(e) => { set({ solution: e.target.value }); setSolDirty(true); }} />
            )}
          </Field>
          <p className="admin-hint">{t('games.admin.fields.solutionPrivate')}</p>
        </div>

        <div className="admin-modal-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving || solState === 'loading'}>
            {saving && <span className="admin-btn-spinner" aria-hidden="true" />}{t('admin.common.save')}
          </button>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{t('admin.common.cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function ChallengesTab() {
  const { t, i18n } = useTranslation();
  const { data, state, reload } = useAdminData(() => Promise.all([listChallenges(), listGames()]));
  const [gameFilter, setGameFilter] = useState('');
  const [form, setForm] = useState(undefined);
  const [builder, setBuilder] = useState(undefined); // undefined = مغلق، null = تحدٍّ جديد، صف = تعديل
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [challenges, games] = data || [[], []];
  const gameName = useMemo(() => Object.fromEntries(games.map((g) => [g.id, pickName(g.title, i18n.language)])), [games, i18n.language]);
  const rows = gameFilter ? challenges.filter((c) => c.game_id === gameFilter) : challenges;

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

  const st = state === 'ready' ? (rows.length ? '' : 'empty') : state;
  return (
    <section aria-label={t('games.admin.tabs.challenges')}>
      <div className="ga-toolbar">
        <select className="admin-select ga-filter" aria-label={t('games.admin.fields.game')} value={gameFilter} onChange={(e) => setGameFilter(e.target.value)}>
          <option value="">{t('games.admin.allGames')}</option>
          {games.map((g) => <option key={g.id} value={g.id}>{gameName[g.id]}</option>)}
        </select>
        <button type="button" className="admin-quick-action" disabled={state !== 'ready' || games.length === 0} onClick={() => setForm(null)}>
          {t('games.admin.challenges.new')}
        </button>
        <button type="button" className="admin-quick-action" disabled={state !== 'ready' || games.length === 0} onClick={() => setBuilder(null)}>
          {t('games.admin.builder.open')}
        </button>
      </div>
      {state === 'ready' && games.length === 0 && <p className="admin-hint">{t('games.admin.challenges.needGame')}</p>}
      {gameFilter === '' && rows.length > 1 && <p className="admin-hint">{t('games.admin.challenges.reorderHint')}</p>}
      <div className="admin-panel">
        <StateBox state={st} emptyText={t('games.admin.challenges.empty')} errorText={t('games.admin.loadError')} onRetry={reload} />
        {rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('games.admin.fields.title')}</th><th>{t('games.admin.fields.game')}</th><th>{t('games.admin.fields.difficulty')}</th>
                  <th>{t('games.admin.fields.points')}</th><th>{t('games.admin.fields.status')}</th>
                  {gameFilter && <th>{t('games.admin.fields.order')}</th>}<th>{t('games.admin.actions')}</th>
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
                    {gameFilter && <td data-label={t('games.admin.fields.order')}><MoveButtons index={i} count={rows.length} disabled={busy} onMove={move} /></td>}
                    <td className="admin-cell-actions">
                      {c.status === 'published'
                        ? <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => setStatus(c, 'draft', 'games.admin.unpublishedOk')}>{t('games.admin.unpublish')}</button>
                        : <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={busy} onClick={() => setStatus(c, 'published', 'games.admin.publishedOk')}>{t('games.admin.publish')}</button>}
                      <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setBuilder(c)}>{t('games.admin.builder.edit')}</button>
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setForm(c)}>{t('admin.common.edit')}</button>
                      <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" disabled={busy} onClick={() => setDel(c)}>{t('admin.common.delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form !== undefined && (
        <ChallengeForm item={form} games={games} defaultGameId={gameFilter} nextOrder={challenges.filter((c) => c.game_id === (gameFilter || games[0]?.id)).length + 1}
          onClose={() => setForm(undefined)} onSaved={() => { setForm(undefined); reload(); }} />
      )}
      {del && (
        <ConfirmModal title={t('admin.common.confirmDelete')} confirmLabel={t('admin.common.delete')} busy={busy} onConfirm={doDelete} onClose={() => setDel(null)}>
          <p><strong>{pickName(del.title, i18n.language)}</strong></p>
          <p>{t('games.admin.challenges.deleteConfirm')}</p>
        </ConfirmModal>
      )}
    </section>
  );
}
