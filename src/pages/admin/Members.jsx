import { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import Modal from '../../components/admin/Modal';
import MembershipDocs from '../../components/admin/MembershipDocs';
import MemberFormModal from './MemberFormModal';
import MemberActivationModal from './MemberActivationModal';
import MemberAccessRequestsModal from './MemberAccessRequestsModal';
import MemberCardRequestsModal from './MemberCardRequestsModal';
import { useAuth } from '../../app/providers/AuthProvider';
import { ROLES_MEMBER_SYSTEM } from '../../constants/roles';
import { countPendingCardRequests, countPendingAccessRequests, fetchMemberCardRequests, fetchMemberActivationOverview } from '../../services/supabase/memberSpace.service';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { downloadCsv } from '../../utils/csvExport';
import { pageWindow } from '../../utils/pagination';
import { fetchLinkedBoardMemberIds } from '../../services/supabase/adminBoard.service';
import {
  fetchMembersPage, softDeleteMember, restoreMember, fetchAllMembersForExport, PAGE_SIZE,
} from '../../services/supabase/adminMembers.service';

import { tr, trStrong, dateLocale } from '../../i18n/adminDict';
import {
  fetchMembershipSettings, fetchPaidMemberIds, recordAnnualMembership, fetchMemberPrivate, fetchMemberMemberships, cancelMemberMembership,
} from '../../services/supabase/membershipFlow.service';
// حالة رابط التفعيل: لون/شارة لكل حالة؛ من لا يظهر في الملخص لم يُرسَل له رابط
const ACTIVATION_BADGE = {
  sent: { cls: 'admin-badge-sent', label: 'أُرسل رابط التفعيل' },
  expired: { cls: 'admin-badge-rejected', label: 'انتهى رابط التفعيل' },
  activated: { cls: 'admin-badge-approved', label: 'حساب مفعّل' },
};
const CARD_STATUS = { pending: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغى' };
const FIELD = (v) => (v == null || v === '' ? '—' : v);
const CSV_HEADERS = ['full_name', 'university', 'promotion', 'track', 'profession', 'city', 'email', 'phone', 'status'];
const CSV_HEADERS_WITH_MEMBERSHIP = [...CSV_HEADERS, 'membership'];

export default function Members() {
  // نظام الأعضاء للأدوار الأربعة فقط (can_manage_member_system)؛ صفحة الأعضاء نفسها أوسع (تشمل النواب)
  const { profile } = useAuth();
  const canMemberSystem = ROLES_MEMBER_SYSTEM.includes(profile?.role);
  const [activationTarget, setActivationTarget] = useState(null);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [pendingCards, setPendingCards] = useState(0);
  const [accessOpen, setAccessOpen] = useState(false);
  const [pendingAccess, setPendingAccess] = useState(0);
  const [activation, setActivation] = useState(null); // Map(member_id → {state,...}) أو null قبل التحميل/قبل تشغيل 0047
  const [activationFilter, setActivationFilter] = useState(''); // '' | 'none' | 'sent' | 'expired' | 'activated'
  const loadActivation = () => {
    if (!canMemberSystem) return;
    fetchMemberActivationOverview().then(setActivation).catch(() => setActivation(null)); // قبل تشغيل 0047: لا شارات ولا فرز
  };
  useEffect(loadActivation, [canMemberSystem]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadPendingCards = () => {
    if (!canMemberSystem) return;
    // فشل العدّ (مثلًا قبل تشغيل 0036) لا يكسر الصفحة: يبقى الزر بلا عدّاد
    countPendingCardRequests().then(setPendingCards).catch(() => {});
    countPendingAccessRequests().then(setPendingAccess).catch(() => {}); // قبل تشغيل 0039: يبقى الزر بلا عدّاد
  };
  useEffect(loadPendingCards, [canMemberSystem]); // eslint-disable-line react-hooks/exhaustive-deps
  // العدّادات تُحدَّث كل دقيقة والتبويب ظاهر، وعند العودة إليه (لا تحتاج الصفحة إلى إعادة تحميل لترى طلبًا جديدًا)
  useEffect(() => {
    if (!canMemberSystem) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') loadPendingCards(); };
    const id = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [canMemberSystem]); // eslint-disable-line react-hooks/exhaustive-deps

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const [showDeleted, setShowDeleted] = useState(false); // عرض المحذوفين للاسترجاع
  const [paidFilter, setPaidFilter] = useState(''); // '' | 'paid' | 'unpaid' (للموسم الحالي)
  const search = useDebouncedValue(searchInput, 350);

  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);

  const [formTarget, setFormTarget] = useState(undefined); // undefined = closed, null = add, object = edit
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exporting, setExporting] = useState(false);

  // الانخراط السنوي: الموسم الحالي + من دفع فيه + نوافذ التجديد والتفاصيل
  const [settings, setSettings] = useState({ fee: null, season: null });
  const [paid, setPaid] = useState(new Set());
  const [renewTarget, setRenewTarget] = useState(null);
  const [selected, setSelected] = useState(() => new Map()); // تجديد جماعي: id → عضو (يبقى التحديد عبر الصفحات)
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null); // { membership, memberName }
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);
  const [detail, setDetail] = useState(undefined); // undefined = تحميل، null = لا شيء

  const [boardOf, setBoardOf] = useState(new Map());
  useEffect(() => {
    fetchLinkedBoardMemberIds().then(setBoardOf).catch(() => {});
  }, []);

  const loadMembership = () => {
    fetchMembershipSettings()
      .then(async (st) => {
        setSettings(st);
        setPaid(await fetchPaidMemberIds(st.season));
      })
      .catch((err) => console.error('membership status load failed', err));
  };
  useEffect(loadMembership, []);

  const openDetails = async (m) => {
    setDetailTarget(m);
    setDetail(undefined);
    try {
      const [priv, history, cardRequests] = await Promise.all([
        fetchMemberPrivate(m.id),
        fetchMemberMemberships(m.id),
        // قبل تشغيل 0036 أو لمن لا يملك الصلاحية: يبقى القسم فارغًا ولا تفشل التفاصيل
        canMemberSystem ? fetchMemberCardRequests(m.id).catch(() => []) : Promise.resolve([]),
      ]);
      setDetail({ priv, history, cardRequests });
    } catch (err) {
      console.error('member details load failed', err);
      setDetail(null);
    }
  };

  const doRenew = async (member) => {
    setRenewTarget(null);
    const t = window.notify?.loading(tr('جارٍ تسجيل الانخراط…'));
    try {
      await recordAnnualMembership({ memberId: member.id });
      t?.remove();
      window.notify?.success(tr('تم تسجيل الانخراط وإضافة الإيراد إلى الميزانية'));
      loadMembership();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذّر تسجيل الانخراط'));
    }
  };

  const toggleSelected = (m) => setSelected((prev) => {
    const next = new Map(prev);
    if (next.has(m.id)) next.delete(m.id); else next.set(m.id, m);
    return next;
  });

  const doBulkRenew = async () => {
    const targets = [...selected.values()];
    setBulkBusy(true);
    const t = window.notify?.loading(tr('جارٍ تسجيل الانخراط…'));
    let ok = 0;
    const failed = [];
    for (const m of targets) { // تسلسلي: كل عضو معاملة مستقلة، فيفشل المكرر وحده دون إيقاف الباقي
      try {
        await recordAnnualMembership({ memberId: m.id });
        ok += 1;
      } catch (err) {
        console.error('bulk renew failed', err);
        failed.push(m.full_name);
      }
    }
    t?.remove();
    if (ok) window.notify?.success(tr('تم تسجيل انخراط {{n}} عضوًا وإضافة الإيرادات إلى الميزانية', { n: ok }));
    if (failed.length) window.notify?.error(tr('تعذّر تسجيل: {{names}}', { names: failed.slice(0, 5).join('، ') + (failed.length > 5 ? '…' : '') }));
    setSelected(new Map());
    setBulkOpen(false);
    setBulkBusy(false);
    loadMembership();
  };

  const doCancelMembership = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    try {
      await cancelMemberMembership(cancelTarget.membership.id, cancelReason.trim());
      window.notify?.success(tr('تم إلغاء الانخراط وإلغاء الإيراد في الميزانية'));
      const target = detailTarget;
      setCancelTarget(null);
      setCancelReason('');
      loadMembership();
      if (target) openDetails(target);
    } catch (err) {
      window.notify?.fromError(err, tr('تعذّر إلغاء الانخراط'));
    } finally {
      setCancelBusy(false);
    }
  };

  useEffect(() => {
    document.title = tr('الأعضاء — لوحة إدارة النادي');
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, status, paidFilter, showDeleted, activationFilter]);

  const load = () => {
    setRows(null);
    setError(false);
    const useAct = !showDeleted && activation && activationFilter;
    const idsOf = (st) => [...activation.entries()].filter(([, v]) => v.state === st).map(([id]) => id);
    fetchMembersPage({
      page, search, status, paid: showDeleted ? '' : paidFilter, season: settings.season, deleted: showDeleted,
      includeIds: useAct && activationFilter !== 'none' ? idsOf(activationFilter) : null,
      excludeIds: useAct && activationFilter === 'none' ? [...activation.keys()] : null,
    })
      .then(({ rows: r, total: t }) => {
        setRows(r);
        setTotal(t);
      })
      .catch((err) => {
        // 416: رقم الصفحة تجاوز عدد النتائج (تغيّر الفلتر/البحث أو حُذف آخر عضو في الصفحة الأخيرة): نعود للصفحة الأولى بصمت
        if (page > 1 && (err?.code === 'PGRST103' || /range not satisfiable/i.test(err?.message || ''))) {
          setPage(1);
          return;
        }
        console.error('تعذر تحميل الأعضاء:', err);
        window.notify?.fromError(err, tr('تعذر تحميل الأعضاء'));
        setError(true);
      });
  };

  useEffect(load, [page, search, status, paidFilter, showDeleted, settings.season, activationFilter, activation]);

  const doDelete = async (member) => {
    setDeleteTarget(null);
    const t = window.notify?.loading(tr('جاري الحذف...'));
    try {
      await softDeleteMember(member);
      t?.remove();
      window.notify?.success(tr('تم حذف العضو'));
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر الحذف'));
    }
  };

  const doRestore = async (member) => {
    const t = window.notify?.loading(tr('جاري الاسترجاع...'));
    try {
      await restoreMember(member);
      t?.remove();
      window.notify?.success(tr('تم استرجاع العضو'));
      load();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر الاسترجاع'));
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    const t = window.notify?.loading(tr('جاري تجهيز الملف...'));
    try {
      const data = await fetchAllMembersForExport({ paidIds: settings.season ? paid : null });
      downloadCsv('members.csv', data, settings.season ? CSV_HEADERS_WITH_MEMBERSHIP : CSV_HEADERS);
      t?.remove();
    } catch (err) {
      t?.remove();
      window.notify?.fromError(err, tr('تعذر تصدير الملف'));
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AdminLayout>
      <AdminPageHeader
        title={tr('الأعضاء')}
        subtitle={tr('إدارة جميع أعضاء النادي')}
        actions={
          <>
            {canMemberSystem && (
              <button className="admin-quick-action" onClick={() => setRequestsOpen(true)}>
                {tr('طلبات تعديل البطاقات')}{pendingCards > 0 ? ` (${pendingCards})` : ''}
              </button>
            )}
            {canMemberSystem && (
              <button className="admin-quick-action" onClick={() => setAccessOpen(true)}>
                {tr('طلبات المساعدة في الدخول')}{pendingAccess > 0 ? ` (${pendingAccess})` : ''}
              </button>
            )}
            {settings.season && selected.size > 0 && (
              <button className="admin-quick-action" onClick={() => setBulkOpen(true)}>
                {tr('تجديد المحدد')} ({selected.size})
              </button>
            )}
            <button className="admin-quick-action" disabled={exporting} onClick={exportCsv}>{tr('تصدير CSV')}</button>
            <button className="admin-quick-action" onClick={() => setFormTarget(null)}>{tr('+ إضافة عضو')}</button>
          </>
        }
      />

      <div className="admin-panel">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
          <input
            type="text"
            className="admin-input"
            style={{ minWidth: 220, flex: 1 }}
            placeholder={tr('ابحث بالاسم، الجامعة، المهنة، المدينة، الدفعة...')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select className="admin-select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{tr('كل الحالات')}</option>
            <option value="active">{tr('نشط')}</option>
            <option value="inactive">{tr('غير نشط')}</option>
          </select>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '.9rem' }}>
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> {tr('عرض المحذوفين')}
          </label>
          {settings.season && !showDeleted && (
            <select className="admin-select" style={{ width: 'auto' }} value={paidFilter} onChange={(e) => setPaidFilter(e.target.value)} aria-label={tr('الانخراط')}>
              <option value="">{tr('كل حالات الانخراط')}</option>
              <option value="unpaid">{tr('غير منخرط هذا الموسم')}</option>
              <option value="paid">{tr('منخرط هذا الموسم')}</option>
            </select>
          )}
          {canMemberSystem && activation && !showDeleted && (
            <select className="admin-select" style={{ width: 'auto' }} value={activationFilter} onChange={(e) => setActivationFilter(e.target.value)} aria-label={tr('حالة التفعيل')}>
              <option value="">{tr('كل حالات التفعيل')}</option>
              <option value="sent">{tr('أُرسل لهم رابط التفعيل')}</option>
              <option value="none">{tr('لم يُرسَل لهم رابط')}</option>
              <option value="expired">{tr('انتهى رابطهم')}</option>
              <option value="activated">{tr('حساب مفعّل')}</option>
            </select>
          )}
        </div>

        {rows === null && !error && <div className="admin-state-box">{tr('جاري التحميل...')}</div>}
        {error && <div className="admin-state-box">{tr('تعذر تحميل الأعضاء.')}</div>}
        {rows && rows.length === 0 && <div className="admin-state-box">{tr('لا يوجد أعضاء مطابقون.')}</div>}
        {rows && rows.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-data-table admin-table-cards">
              <thead>
                <tr>{settings.season && !showDeleted && <th style={{ width: 32 }} aria-label={tr('تحديد')} />}<th>{tr('الاسم')}</th><th>{tr('الجامعة')}</th><th>{tr('الدفعة')}</th><th>{tr('المهنة')}</th><th>{tr('المدينة')}</th><th>{tr('الحالة')}</th><th>{tr('الانخراط')}</th><th>{tr('إجراءات')}</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className={!showDeleted && activation?.get(m.id) ? `admin-row-act-${activation.get(m.id).state}` : undefined}>
                    {settings.season && !showDeleted && (
                      <td data-label={tr('تحديد')}>
                        {!paid.has(m.id) && m.status === 'active' ? (
                          <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSelected(m)} aria-label={`${tr('تحديد')}: ${m.full_name}`} />
                        ) : null}
                      </td>
                    )}
                    <td className="admin-name-cell" data-label={tr('الاسم')}>{m.full_name}
                      {boardOf.has(m.id) && <> <span className="admin-badge admin-badge-approved" title={boardOf.get(m.id)}>{tr('عضو مكتب')}</span></>}
                      {!showDeleted && activation?.get(m.id) && (() => {
                        const a = activation.get(m.id);
                        const b = ACTIVATION_BADGE[a.state];
                        const when = new Date(a.sent_at).toLocaleDateString(dateLocale());
                        return b ? <> <span className={`admin-badge ${b.cls}`} title={a.state === 'activated' ? undefined : tr('أُصدر الرابط بتاريخ {{date}}', { date: when })}>{tr(b.label)}</span></> : null;
                      })()}
                    </td>
                    <td data-label={tr('الجامعة')}>{FIELD(m.university)}</td>
                    <td data-label={tr('الدفعة')}>{FIELD(m.promotion)}</td>
                    <td data-label={tr('المهنة')}>{FIELD(m.profession)}</td>
                    <td data-label={tr('المدينة')}>{FIELD(m.city)}</td>
                    <td data-label={tr('الحالة')}><span className={`admin-badge admin-badge-${m.status === 'active' ? 'approved' : 'rejected'}`}>{m.status === 'active' ? tr('نشط') : tr('غير نشط')}</span>
                      {m.status === 'active' && m.show_in_directory === false && (
                        <> <span className="admin-badge admin-badge-pending" title={tr('بموافقة العضو. عند إلغاء التحديد لا يظهر اسمه ولا صورته في الموقع.')}>{tr('غير ظاهر للعامة')}</span></>
                      )}
                    </td>
                    <td data-label={tr('الانخراط')}>
                      {settings.season ? (
                        <span className={`admin-badge admin-badge-${paid.has(m.id) ? 'approved' : 'pending'}`}>
                          {paid.has(m.id) ? tr('منخرط') : tr('غير منخرط')}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="admin-cell-actions">
                      {showDeleted ? (
                        <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => doRestore(m)}>{tr('استرجاع')}</button>
                      ) : (
                        <>
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => openDetails(m)}>{tr('تفاصيل')}</button>
                      {canMemberSystem && m.status === 'active' && (
                        <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setActivationTarget(m)}>{tr('رابط التفعيل')}</button>
                      )}
                      {settings.season && !paid.has(m.id) && (
                        <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setRenewTarget(m)}>{tr('تجديد')}</button>
                      )}
                      <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(m)}>{tr('تعديل')}</button>
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setDeleteTarget(m)}>{tr('حذف')}</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            {pageWindow(page, totalPages).map((p, i) => (p === '…' ? (
              <span key={`gap-${i}`} aria-hidden="true" style={{ alignSelf: 'center', padding: '0 4px' }}>…</span>
            ) : (
              <button
                key={p}
                className="admin-btn admin-btn-ghost admin-btn-sm"
                aria-current={p === page ? 'page' : undefined}
                style={p === page ? { background: 'var(--admin-accent)', color: 'var(--admin-bg)', borderColor: 'var(--admin-accent)' } : undefined}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            )))}
          </div>
        )}
      </div>

      {formTarget !== undefined && (
        <MemberFormModal
          member={formTarget}
          onClose={() => setFormTarget(undefined)}
          onSaved={() => {
            setFormTarget(undefined);
            load();
          }}
        />
      )}

      {activationTarget && <MemberActivationModal member={activationTarget} onClose={() => setActivationTarget(null)} onIssued={loadActivation} />}
      {accessOpen && <MemberAccessRequestsModal onClose={() => setAccessOpen(false)} onChanged={loadPendingCards} />}
      {requestsOpen && (
        <MemberCardRequestsModal
          onClose={() => setRequestsOpen(false)}
          onChanged={() => { loadPendingCards(); load(); }}
        />
      )}

      {renewTarget && (
        <Modal onClose={() => setRenewTarget(null)}>
          <h3>{tr('تأكيد الانخراط السنوي')}</h3>
          <p>{trStrong('سيتم تسجيل انخراط <strong>{{name}}</strong> للموسم {{season}} بمبلغ {{fee}} درهم وإضافته إلى الميزانية.', { name: renewTarget.full_name, season: settings.season, fee: settings.fee || '—' })}</p>
          {!settings.fee && <div className="admin-state-box">{tr('اضبط مبلغ الانخراط والموسم من صفحة الإعدادات أولاً.')}</div>}
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-primary" disabled={!settings.fee} onClick={() => doRenew(renewTarget)}>{tr('تأكيد الدفع وتسجيل الانخراط')}</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setRenewTarget(null)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}

      {detailTarget && (
        <Modal onClose={() => setDetailTarget(null)}>
          <h3>{tr('تفاصيل العضو')}</h3>
          <p><strong>{tr('الاسم')}:</strong> {detailTarget.full_name}</p>
          <p><strong>{tr('البريد الإلكتروني')}:</strong> {FIELD(detailTarget.email)}</p>
          <p><strong>{tr('الهاتف')}:</strong> {FIELD(detailTarget.phone)}</p>
          {detail === undefined && <p>{tr('جارٍ التحميل…')}</p>}
          {detail === null && <p>{tr('تعذّر تحميل التفاصيل')}</p>}
          {detail && (
            <>
              {detail.priv ? (
                <>
                  <p><strong>{tr('تاريخ الميلاد')}:</strong> {FIELD(detail.priv.birth_date)}</p>
                  <p><strong>{tr('المستوى الدراسي')}:</strong> {FIELD(detail.priv.level)}</p>
                  <p><strong>{tr('رقم أبوجي / مسار')}:</strong> {FIELD(detail.priv.form_data?.apogee)}</p>
                  <p><strong>{tr('المهارات')}:</strong> {FIELD(detail.priv.skills)}</p>
                  <p><strong>{tr('الاهتمامات')}:</strong> {FIELD(detail.priv.interests)}</p>
                  {(detail.priv.emergency_name || detail.priv.emergency_phone) && (
                    <>
                      <p><strong>{tr('جهة الاتصال الطارئة')}:</strong> {FIELD(detail.priv.emergency_name)} ({FIELD(detail.priv.emergency_relation)})</p>
                      <p><strong>{tr('هاتف الطوارئ')}:</strong> <span dir="ltr">{FIELD(detail.priv.emergency_phone)}</span></p>
                    </>
                  )}
                  {detail.priv.form_data?.motivation && (
                    <p><strong>{tr('سبب الانضمام')}:</strong> {detail.priv.form_data.motivation}</p>
                  )}
                  <MembershipDocs data={detail.priv.form_data} />
                  <p><strong>{tr('الموافقة على النظام الداخلي')}:</strong> {detail.priv.rules_accepted_at ? tr('نعم') : tr('لا')}</p>
                </>
              ) : (
                <p>{tr('لا توجد بيانات إضافية لهذا العضو.')}</p>
              )}
              <h4>{tr('سجل الانخراطات')}</h4>
              {detail.history.length === 0 ? <p>—</p> : (
                <ul className="admin-summary-list">
                  {detail.history.map((h) => (
                    <li key={h.id || h.season}>
                      {h.season} — {h.amount} MAD ({h.paid_at})
                      {h.id && canMemberSystem && (
                        <> <button className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => { setCancelReason(''); setCancelTarget({ membership: h, memberName: detailTarget.full_name }); }}>{tr('إلغاء الانخراط')}</button></>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {detail.cardRequests?.length > 0 && (
                <>
                  <h4>{tr('طلبات تعديل البطاقة')}</h4>
                  <ul className="admin-summary-list">
                    {detail.cardRequests.map((r) => (
                      <li key={r.id}>
                        {new Date(r.created_at).toLocaleDateString(dateLocale())} — {tr(CARD_STATUS[r.status] || r.status)}
                        {r.status === 'rejected' && r.review_note ? ` (${r.review_note})` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-ghost" onClick={() => setDetailTarget(null)}>{tr('إغلاق')}</button>
          </div>
        </Modal>
      )}

      {bulkOpen && (
        <Modal onClose={() => !bulkBusy && setBulkOpen(false)}>
          <h3>{tr('تأكيد التجديد الجماعي')}</h3>
          <p>{tr('سيتم تسجيل انخراط {{n}} عضوًا للموسم {{season}} بمبلغ {{fee}} درهم لكل منهم (المجموع {{total}} درهم) وإضافته إلى الميزانية.', {
            n: selected.size, season: settings.season, fee: settings.fee || '—', total: settings.fee ? Math.round(Number(settings.fee) * selected.size * 100) / 100 : '—',
          })}</p>
          {!settings.fee && <div className="admin-state-box">{tr('اضبط مبلغ الانخراط والموسم من صفحة الإعدادات أولاً.')}</div>}
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-primary" disabled={!settings.fee || bulkBusy} onClick={doBulkRenew}>{tr('تأكيد الدفع وتسجيل الانخراط')}</button>
            <button className="admin-btn admin-btn-ghost" disabled={bulkBusy} onClick={() => setBulkOpen(false)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}

      {cancelTarget && (
        <Modal onClose={() => !cancelBusy && setCancelTarget(null)}>
          <h3>{tr('إلغاء الانخراط')}</h3>
          <p>{trStrong('سيُلغى انخراط <strong>{{name}}</strong> لموسم {{season}} ويُلغى إيراده في الميزانية (يبقى ظاهرًا كمعاملة ملغاة مع السبب). يمكن تسجيل الانخراط من جديد بعد ذلك.', { name: cancelTarget.memberName, season: cancelTarget.membership.season })}</p>
          <div className="admin-form-group">
            <label htmlFor="cancel_membership_reason">{tr('سبب الإلغاء (إلزامي)')}</label>
            <textarea id="cancel_membership_reason" className="admin-textarea" rows={2} maxLength={300} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" disabled={cancelBusy || cancelReason.trim().length < 3} onClick={doCancelMembership}>{tr('تأكيد الإلغاء')}</button>
            <button className="admin-btn admin-btn-ghost" disabled={cancelBusy} onClick={() => setCancelTarget(null)}>{tr('تراجع')}</button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)}>
          <h3>{tr('تأكيد الحذف')}</h3>
          <p>{trStrong('هل تريد حذف العضو <strong>{{name}}</strong>؟ يمكنك استرجاعه لاحقًا بخيار «عرض المحذوفين».', { name: deleteTarget.full_name })}</p>
          <div className="admin-modal-actions">
            <button className="admin-btn admin-btn-danger" onClick={() => doDelete(deleteTarget)}>{tr('حذف')}</button>
            <button className="admin-btn admin-btn-ghost" onClick={() => setDeleteTarget(null)}>{tr('إلغاء')}</button>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
