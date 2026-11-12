import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../../components/admin/Modal';
import StateBox from '../../../../components/admin/StateBox';
import { pageWindow } from '../../../../utils/pagination';
import { useAdminData } from '../hooks/useAdminData';
import {
  adjustPoints, getPlayer, getPlayerAchievements, getPlayerAttempts, getPlayerPoints, getPlayerProgress, getPlayerResults,
  listAchievements, listChallenges, listPlayers,
} from '../services/gamesAdmin.service';
import { pickName } from '../services/gamesAdmin.shared';
import { ADJUST_NOTE_MAX, PLAYERS_PAGE_SIZE, POINTS_MAX_DELTA } from '../constants/gamesAdmin';
import { Field, notifyError } from '../components/adminUi';

const fmtDate = (v, lang) => (v ? new Date(v).toLocaleString(lang) : '—');
const fmtDuration = (ms) => (ms == null ? '—' : `${(Number(ms) / 1000).toFixed(1)}s`);

function AdjustPointsForm({ userId, onDone }) {
  const { t } = useTranslation();
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false); // التسوية غير متكرّرة بطبيعتها (كل إرسال صفّ جديد في الدفتر): قفل متزامن لا ينتظر إعادة الرسم

  const submit = async (e) => {
    e.preventDefault();
    if (inFlight.current) return;
    const n = Number(delta);
    const er = {};
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > POINTS_MAX_DELTA) er.delta = t('games.admin.errors.invalid_delta');
    if (!note.trim()) er.note = t('games.admin.errors.note_required');
    setErrors(er);
    if (Object.keys(er).length) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await adjustPoints(userId, n, note.trim()); // الدالة الوحيدة المسموحة لتعديل النقاط
      window.notify?.success(t('games.admin.players.adjustedOk'));
      setDelta('');
      setNote('');
      onDone();
    } catch (err) {
      notifyError(t, err);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <form className="ga-adjust" onSubmit={submit} noValidate>
      <h4>{t('games.admin.players.adjustTitle')}</h4>
      <p className="admin-hint">{t('games.admin.players.adjustHint')}</p>
      <div className="admin-form-grid-2">
        <Field id="adj_delta" label={t('games.admin.players.delta')} hint={t('games.admin.players.deltaHint', { max: POINTS_MAX_DELTA })} error={errors.delta}>
          <input id="adj_delta" type="number" step="1" className="admin-input" dir="ltr" value={delta} onChange={(e) => setDelta(e.target.value)} />
        </Field>
        <Field id="adj_note" label={t('games.admin.players.reason')} error={errors.note}>
          <textarea id="adj_note" className="admin-textarea" rows={2} maxLength={ADJUST_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
        {saving && <span className="admin-btn-spinner" aria-hidden="true" />}{t('games.admin.players.applyAdjust')}
      </button>
    </form>
  );
}

function PlayerModal({ userId, onClose, onChanged }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data, state, reload } = useAdminData(async () => {
    const [player, progress, points, results, attempts, achievements, challenges, defs] = await Promise.all([
      getPlayer(userId), getPlayerProgress(userId), getPlayerPoints(userId, 50), getPlayerResults(userId, 30),
      getPlayerAttempts(userId, 30), getPlayerAchievements(userId), listChallenges(), listAchievements(),
    ]);
    return { player, progress, points, results, attempts, achievements, challenges, defs };
  }, [userId]);

  const cName = Object.fromEntries((data?.challenges || []).map((c) => [c.id, pickName(c.title, lang)]));
  const aName = Object.fromEntries((data?.defs || []).map((a) => [a.id, pickName(a.title, lang)]));
  const p = data?.player;

  return (
    <Modal onClose={onClose} wide>
      <h3>{p ? p.display_name : t('games.admin.tabs.players')}</h3>
      <StateBox state={state === 'ready' ? '' : state} errorText={t('games.admin.loadError')} onRetry={reload} />
      {data && p && (
        <div className="ga-player">
          <p className="admin-hint" dir="ltr">{p.email} · {t(`games.admin.players.kind.${p.kind}`)}</p>
          <dl className="ga-stats">
            <div><dt>{t('games.admin.players.totalPoints')}</dt><dd>{p.total_points}</dd></div>
            <div><dt>{t('games.admin.players.level')}</dt><dd>{p.level ? `${p.level.level} — ${pickName(p.level.title, lang)}` : '—'}</dd></div>
            <div><dt>{t('games.admin.players.nextLevel')}</dt><dd>{p.next_level ? `${pickName(p.next_level.title, lang)} (${p.next_level.min_points})` : '—'}</dd></div>
            <div><dt>{t('games.admin.players.attempts')}</dt><dd>{p.attempts_count}</dd></div>
            <div><dt>{t('games.admin.players.solved')}</dt><dd>{p.solved_challenges}</dd></div>
            <div><dt>{t('games.admin.players.achievements')}</dt><dd>{p.achievements_count}</dd></div>
          </dl>

          <AdjustPointsForm userId={userId} onDone={() => { reload(); onChanged(); }} />

          <h4>{t('games.admin.players.progress')}</h4>
          {data.progress.length === 0 ? <p className="admin-hint">{t('games.admin.players.noProgress')}</p> : (
            <div className="admin-table-wrap">
              <table className="admin-data-table">
                <thead><tr><th>{t('games.admin.fields.challenge')}</th><th>{t('games.admin.players.attempts')}</th><th>{t('games.admin.players.solvedCol')}</th><th>{t('games.admin.players.bestScore')}</th><th>{t('games.admin.players.bestTime')}</th><th>{t('games.admin.fields.points')}</th></tr></thead>
                <tbody>
                  {data.progress.map((r) => (
                    <tr key={r.challenge_id}>
                      <td>{cName[r.challenge_id] || '—'}</td><td>{r.attempts}</td>
                      <td>{r.solved ? t('games.admin.yes') : t('games.admin.no')}</td><td>{r.best_score}</td><td>{fmtDuration(r.best_duration_ms)}</td><td>{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4>{t('games.admin.players.achievementsList')}</h4>
          {data.achievements.length === 0 ? <p className="admin-hint">{t('games.admin.players.noAchievements')}</p> : (
            <ul className="ga-list">
              {data.achievements.map((a) => <li key={a.achievement_id}>{aName[a.achievement_id] || '—'} <span className="admin-hint">{fmtDate(a.unlocked_at, lang)}</span></li>)}
            </ul>
          )}

          <h4>{t('games.admin.players.results')}</h4>
          {data.results.length === 0 ? <p className="admin-hint">{t('games.admin.players.noResults')}</p> : (
            <div className="admin-table-wrap">
              <table className="admin-data-table">
                <thead><tr><th>{t('games.admin.fields.challenge')}</th><th>{t('games.admin.players.correct')}</th><th>{t('games.admin.players.score')}</th><th>{t('games.admin.players.bestTime')}</th><th>{t('games.admin.players.date')}</th></tr></thead>
                <tbody>
                  {data.results.map((r) => (
                    <tr key={r.id}>
                      <td>{cName[r.challenge_id] || '—'}</td><td>{r.is_correct ? t('games.admin.yes') : t('games.admin.no')}</td>
                      <td>{r.score}</td><td>{fmtDuration(r.duration_ms)}</td><td>{fmtDate(r.created_at, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4>{t('games.admin.players.attemptsList')}</h4>
          {data.attempts.length === 0 ? <p className="admin-hint">{t('games.admin.players.noAttempts')}</p> : (
            <div className="admin-table-wrap">
              <table className="admin-data-table">
                <thead><tr><th>{t('games.admin.fields.challenge')}</th><th>{t('games.admin.fields.status')}</th><th>{t('games.admin.players.startedAt')}</th><th>{t('games.admin.players.finishedAt')}</th></tr></thead>
                <tbody>
                  {data.attempts.map((a) => (
                    <tr key={a.id}>
                      <td>{cName[a.challenge_id] || '—'}</td><td>{t(`games.admin.players.attemptStatus.${a.status}`, { defaultValue: a.status })}</td>
                      <td>{fmtDate(a.started_at, lang)}</td><td>{fmtDate(a.finished_at, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4>{t('games.admin.players.ledger')}</h4>
          {data.points.length === 0 ? <p className="admin-hint">{t('games.admin.players.noPoints')}</p> : (
            <div className="admin-table-wrap">
              <table className="admin-data-table">
                <thead><tr><th>{t('games.admin.players.date')}</th><th>{t('games.admin.players.delta')}</th><th>{t('games.admin.players.source')}</th><th>{t('games.admin.players.reason')}</th></tr></thead>
                <tbody>
                  {data.points.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.created_at, lang)}</td>
                      <td dir="ltr" className={r.delta < 0 ? 'ga-neg' : 'ga-pos'}>{r.delta > 0 ? `+${r.delta}` : r.delta}</td>
                      <td>{t(`games.admin.players.reasons.${r.reason}`, { defaultValue: r.reason })}</td>
                      <td>{r.note || (r.challenge_id ? cName[r.challenge_id] : r.achievement_id ? aName[r.achievement_id] : '') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="admin-modal-actions">
        <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>{t('admin.common.close')}</button>
      </div>
    </Modal>
  );
}

export default function PlayersTab() {
  const { t, i18n } = useTranslation();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const { data, state, reload } = useAdminData(() => listPlayers({ search, page, pageSize: PLAYERS_PAGE_SIZE }), [search, page]);
  const rows = data?.rows || [];
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PLAYERS_PAGE_SIZE));

  const onSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setSearch(input.trim());
  };

  const st = state === 'ready' ? (rows.length ? '' : 'empty') : state;
  return (
    <section aria-label={t('games.admin.tabs.players')}>
      <form className="ga-toolbar" onSubmit={onSearch} role="search">
        <input className="admin-input ga-search" type="search" maxLength={80} aria-label={t('games.admin.players.search')} placeholder={t('games.admin.players.search')} value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" className="admin-btn admin-btn-ghost">{t('games.admin.players.searchBtn')}</button>
      </form>
      <p className="admin-hint">{t('games.admin.players.hint')}</p>
      <div className="admin-panel">
        <StateBox state={st} emptyText={t('games.admin.players.empty')} errorText={t('games.admin.loadError')} onRetry={reload} />
        {rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>
                  <th>{t('games.admin.players.player')}</th><th>{t('games.admin.players.totalPoints')}</th><th>{t('games.admin.players.level')}</th>
                  <th>{t('games.admin.players.attempts')}</th><th>{t('games.admin.players.solved')}</th><th>{t('games.admin.players.achievements')}</th><th>{t('games.admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id}>
                    <td data-label={t('games.admin.players.player')}><span className="admin-ann-title">{r.display_name}</span><span className="admin-ann-sub" dir="ltr">{r.email} · {t(`games.admin.players.kind.${r.kind}`)}</span></td>
                    <td data-label={t('games.admin.players.totalPoints')}>{r.total_points}</td>
                    <td data-label={t('games.admin.players.level')}>{r.level ?? '—'}</td>
                    <td data-label={t('games.admin.players.attempts')}>{r.attempts_count}</td>
                    <td data-label={t('games.admin.players.solved')}>{r.solved_challenges}</td>
                    <td data-label={t('games.admin.players.achievements')}>{r.achievements_count}</td>
                    <td className="admin-cell-actions">
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setSelected(r.user_id)}>{t('games.admin.players.details')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav className="ga-pager" aria-label={t('games.admin.players.pagination')}>
            {pageWindow(page, pages).map((p, i) => (p === '…'
              ? <span key={`gap-${i}`} aria-hidden="true">…</span>
              : <button key={p} type="button" className={`admin-btn admin-btn-sm ${p === page ? 'admin-btn-primary' : 'admin-btn-ghost'}`} aria-current={p === page ? 'page' : undefined} onClick={() => setPage(p)}>{p.toLocaleString(i18n.language)}</button>))}
          </nav>
        )}
      </div>
      {selected && <PlayerModal userId={selected} onClose={() => setSelected(null)} onChanged={reload} />}
    </section>
  );
}
