import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import AdminPageHeader from '../../components/admin/AdminPageHeader';
import StateBox from '../../components/admin/StateBox';
import { TransactionModal, VoidModal, CategoriesModal, KIND_LABEL } from './BudgetModals';
import { fetchCategories, fetchTransactions, getReceiptUrl } from '../../services/supabase/budget.service';
import { downloadCsv } from '../../utils/csvExport';
import '../../styles/budget.css';

import { tr } from '../../i18n/adminDict';
const MONEY_UNIT = 'MAD';
const cents = (x) => Math.round(Number(x) * 100);
const money = (c) => `${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${MONEY_UNIT}`;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function periodRange(period) {
  const now = new Date();
  if (period === 'month') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  if (period === 'year') return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  return { from: '', to: '' };
}

function Breakdown({ title, kind, rows }) {
  const byCat = new Map();
  rows.filter((r) => r.kind === kind).forEach((r) => {
    const name = r.budget_categories?.name || tr('بدون فئة');
    byCat.set(name, (byCat.get(name) || 0) + cents(r.amount));
  });
  const list = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const max = list.length ? list[0][1] : 1;
  return (
    <div>
      <h2>{title}</h2>
      {list.length === 0 && <p className="admin-hint">{tr('لا توجد بيانات في هذه الفترة.')}</p>}
      {list.map(([name, c]) => (
        <div className="budget-bar-row" key={name}>
          <div><span>{name}</span><strong>{money(c)}</strong></div>
          <div className={`budget-bar budget-bar-${kind}`}><span style={{ width: `${Math.max(4, (c / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function Budget() {
  const [rows, setRows] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState(false);
  const [period, setPeriod] = useState('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [kindFilter, setKindFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showVoided, setShowVoided] = useState(false);
  const [formTarget, setFormTarget] = useState(undefined); // undefined=مغلق، null=جديد، كائن=تعديل
  const [voidTarget, setVoidTarget] = useState(null);
  const [catsOpen, setCatsOpen] = useState(false);

  useEffect(() => {
    document.title = tr('الميزانية');
  }, []);

  const load = useCallback(() => {
    setError(false);
    Promise.all([fetchTransactions(), fetchCategories()])
      .then(([tx, cats]) => {
        setRows(tx);
        setCategories(cats);
      })
      .catch((err) => {
        console.error('تعذر تحميل الميزانية:', err);
        window.notify?.fromError(err, tr('تعذر تحميل الميزانية'));
        setError(true);
      });
  }, []);
  useEffect(load, [load]);

  const range = period === 'custom' ? custom : periodRange(period);

  const filtered = useMemo(() => (rows || []).filter((r) => {
    if (!showVoided && r.status === 'voided') return false;
    if (range.from && r.tx_date < range.from) return false;
    if (range.to && r.tx_date > range.to) return false;
    if (kindFilter && r.kind !== kindFilter) return false;
    if (catFilter && r.category_id !== catFilter) return false;
    return true;
  }), [rows, showVoided, range.from, range.to, kindFilter, catFilter]);

  const totals = useMemo(() => {
    let allIncome = 0; let allExpense = 0; let income = 0; let expense = 0;
    (rows || []).forEach((r) => {
      if (r.status !== 'active') return;
      const c = cents(r.amount);
      if (r.kind === 'income') allIncome += c; else allExpense += c;
    });
    filtered.forEach((r) => {
      if (r.status !== 'active') return;
      const c = cents(r.amount);
      if (r.kind === 'income') income += c; else expense += c;
    });
    return { balance: allIncome - allExpense, income, expense, net: income - expense };
  }, [rows, filtered]);

  const openReceipt = async (path) => {
    const w = window.open('', '_blank');
    try {
      const url = await getReceiptUrl(path);
      if (w) w.location.href = url; else window.location.href = url;
    } catch (err) {
      if (w) w.close();
      window.notify?.fromError(err, tr('تعذر فتح الإيصال'));
    }
  };

  const exportCsv = () => {
    const headers = [tr('التاريخ'), tr('النوع'), tr('الفئة'), tr('الجهة'), tr('الوصف'), tr('المبلغ'), tr('الحالة')];
    const data = filtered.map((r) => ({
      [tr('التاريخ')]: r.tx_date,
      [tr('النوع')]: tr(KIND_LABEL[r.kind]),
      [tr('الفئة')]: r.budget_categories?.name || '',
      [tr('الجهة')]: r.counterparty || '',
      [tr('الوصف')]: r.description || '',
      [tr('المبلغ')]: Number(r.amount).toFixed(2),
      [tr('الحالة')]: r.status === 'voided' ? tr('ملغاة: {{v1}}', { v1: r.void_reason || '' }) : tr('سارية'),
    }));
    downloadCsv('budget.csv', data, headers);
  };

  const state = error ? 'error' : rows === null ? 'loading' : '';

  return (
    <AdminLayout>
      <AdminPageHeader
        title={tr('الميزانية')}
        subtitle={tr('الإيرادات والمصروفات — هذا القسم ظاهر للمسؤول الأعلى وأمين المال فقط')}
        actions={(
          <>
            <button type="button" className="admin-quick-action" onClick={() => setFormTarget(null)}>{tr('+ إضافة معاملة')}</button>
            <button type="button" className="admin-quick-action" onClick={() => setCatsOpen(true)}>{tr('الفئات')}</button>
            <button type="button" className="admin-quick-action" onClick={exportCsv} disabled={!rows}>{tr('تصدير CSV')}</button>
          </>
        )}
      />

      <StateBox state={state} errorText={tr('تعذر تحميل الميزانية. تأكد من تشغيل ملف SQL الخاص بها (0012_budget_and_developer_role) في Supabase.')} onRetry={load} />

      {rows && (
        <>
          <div className="admin-stat-grid">
            <div className="admin-stat-card">
              <div className="admin-stat-label">{tr('الرصيد الحالي (كل الفترات)')}</div>
              <div className={`admin-stat-value${totals.balance < 0 ? ' budget-balance-negative' : ''}`}>{money(totals.balance)}</div>
            </div>
            <div className="admin-stat-card budget-stat-income">
              <div className="admin-stat-label">{tr('إيرادات الفترة')}</div>
              <div className="admin-stat-value">{money(totals.income)}</div>
            </div>
            <div className="admin-stat-card budget-stat-expense">
              <div className="admin-stat-label">{tr('مصروفات الفترة')}</div>
              <div className="admin-stat-value">{money(totals.expense)}</div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-label">{tr('صافي الفترة')}</div>
              <div className={`admin-stat-value${totals.net < 0 ? ' budget-balance-negative' : ''}`}>{money(totals.net)}</div>
            </div>
          </div>

          <div className="admin-panel">
            <div className="budget-filters">
              <div>
                <label htmlFor="f_period">{tr('الفترة')}</label>
                <select id="f_period" className="admin-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
                  <option value="month">{tr('هذا الشهر')}</option>
                  <option value="year">{tr('هذه السنة')}</option>
                  <option value="all">{tr('كل الفترات')}</option>
                  <option value="custom">{tr('مخصصة')}</option>
                </select>
              </div>
              {period === 'custom' && (
                <>
                  <div>
                    <label htmlFor="f_from">{tr('من')}</label>
                    <input id="f_from" type="date" className="admin-input" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                  </div>
                  <div>
                    <label htmlFor="f_to">{tr('إلى')}</label>
                    <input id="f_to" type="date" className="admin-input" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                  </div>
                </>
              )}
              <div>
                <label htmlFor="f_kind">{tr('النوع')}</label>
                <select id="f_kind" className="admin-select" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
                  <option value="">{tr('الكل')}</option>
                  <option value="income">{tr('إيراد')}</option>
                  <option value="expense">{tr('مصروف')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="f_cat">{tr('الفئة')}</label>
                <select id="f_cat" className="admin-select" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                  <option value="">{tr('الكل')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
                <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
                {tr('إظهار الملغاة')}
              </label>
            </div>

            {filtered.length === 0 ? (
              <div className="admin-state-box">{tr('لا توجد معاملات في هذه الفترة.')}</div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-data-table admin-table-cards">
                  <thead>
                    <tr><th>{tr('التاريخ')}</th><th>{tr('النوع')}</th><th>{tr('الفئة')}</th><th>{tr('التفاصيل')}</th><th>{tr('المبلغ')}</th><th>{tr('إجراءات')}</th></tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const voided = r.status === 'voided';
                      return (
                        <tr key={r.id} className={voided ? 'budget-row-voided' : ''}>
                          <td data-label={tr('التاريخ')}>{r.tx_date}</td>
                          <td data-label={tr('النوع')}>{tr(KIND_LABEL[r.kind])}</td>
                          <td data-label={tr('الفئة')}>{r.budget_categories?.name || '—'}</td>
                          <td data-label={tr('التفاصيل')}>
                            <span className="budget-desc">{r.description || '—'}</span>
                            {r.counterparty && <div style={{ fontSize: '.78rem', color: 'var(--admin-text-muted)' }}>{r.counterparty}</div>}
                            {voided && <div style={{ fontSize: '.78rem' }}>{tr('ملغاة: {{reason}}', { reason: r.void_reason })}</div>}
                          </td>
                          <td data-label={tr('المبلغ')} className={`budget-amount-${r.kind}`}>
                            {r.kind === 'income' ? '+' : '−'}{money(cents(r.amount))}
                          </td>
                          <td className="admin-cell-actions">
                            {r.receipt_path && (
                              <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => openReceipt(r.receipt_path)}>{tr('الإيصال')}</button>
                            )}
                            {!voided && (
                              <>
                                <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setFormTarget(r)}>{tr('تعديل')}</button>
                                <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setVoidTarget(r)}>{tr('إلغاء')}</button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="admin-panel budget-breakdown">
            <Breakdown title={tr('المصروفات حسب الفئة')} kind="expense" rows={filtered.filter((r) => r.status === 'active')} />
            <Breakdown title={tr('الإيرادات حسب الفئة')} kind="income" rows={filtered.filter((r) => r.status === 'active')} />
          </div>
        </>
      )}

      {formTarget !== undefined && (
        <TransactionModal
          tx={formTarget}
          categories={categories}
          onClose={() => setFormTarget(undefined)}
          onSaved={() => { setFormTarget(undefined); load(); }}
        />
      )}
      {voidTarget && (
        <VoidModal tx={voidTarget} onClose={() => setVoidTarget(null)} onDone={() => { setVoidTarget(null); load(); }} />
      )}
      {catsOpen && <CategoriesModal categories={categories} onClose={() => setCatsOpen(false)} onChanged={load} />}
    </AdminLayout>
  );
}
