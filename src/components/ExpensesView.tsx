import React, { useMemo, useState } from 'react';
import { Trash2, Wallet } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { formatCurrency } from '../lib/permissions';
import { removeDocument } from '../lib/posService';
import { saveExpenseOfflineAware } from '../lib/syncEngine';
import { ExpensePaymentMethod } from '../types/pos';

export const ExpensesView: React.FC = () => {
  const {
    expenses,
    expenseCategories,
    settings,
    firebaseUser,
    profile,
    activeRole,
    activeStaffUids,
    notify,
    refreshOfflineState,
  } = usePos();

  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('CASH');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [filterCat, setFilterCat] = useState('ALL');

  const sym = settings.currencySymbol || '₹';

  const filtered = useMemo(() => {
    if (filterCat === 'ALL') return expenses;
    return expenses.filter((e) => e.categoryId === filterCat);
  }, [expenses, filterCat]);

  const totalFiltered = useMemo(
    () => filtered.reduce((s, e) => s + e.amount, 0),
    [filtered]
  );

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile || amount <= 0) return;
    const chosenCat =
      expenseCategories.find((c) => c.id === (categoryId || expenseCategories[0]?.id));
    if (!chosenCat) {
      notify('Select an expense category.', 'error');
      return;
    }
    try {
      const res = await saveExpenseOfflineAware({
        categoryId: chosenCat.id,
        categoryName: chosenCat.name,
        amount: Number(amount),
        paymentMethod,
        expenseDate,
        notes,
        actorUid: firebaseUser.uid,
        actorName: profile.displayName,
        staffUids: activeStaffUids,
      });
      setAmount(0);
      setNotes('');
      if (res.queuedOffline) {
        await refreshOfflineState();
        notify('Expense queued offline — will sync automatically.', 'info');
      } else {
        notify('Expense recorded.', 'success');
      }
    } catch (err: any) {
      notify(err?.message || 'Failed to save expense.', 'error');
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">
            Expense Management
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Total Shown:{' '}
            <span className="font-mono-num font-bold text-stone-900 dark:text-stone-100">
              {formatCurrency(totalFiltered, sym)}
            </span>
          </p>
        </div>

        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="min-h-[38px] px-3 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900"
        >
          <option value="ALL">All Categories</option>
          {expenseCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 text-xs">
        <form
          onSubmit={handleAdd}
          className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-3 h-fit"
        >
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Wallet className="w-4 h-4 text-orange-600" />
            Record Daily Expense
          </h3>
          <div>
            <label className="block font-medium mb-1">Category *</label>
            <select
              value={categoryId || expenseCategories[0]?.id || ''}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            >
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-medium mb-1">Amount ({sym}) *</label>
              <input
                type="number"
                min={1}
                step="0.01"
                required
                value={amount || ''}
                onChange={(e) => setAmount(Number(e.target.value) || 0)}
                className="w-full min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as ExpensePaymentMethod)}
                className="w-full min-h-[38px] px-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              >
                <option value="CASH">Cash</option>
                <option value="UPI">UPI</option>
                <option value="CARD">Card</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block font-medium mb-1">Date</label>
            <input
              type="date"
              required
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., LPG cylinder refill / Rider payout"
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <button
            type="submit"
            className="w-full min-h-[40px] rounded-lg bg-orange-600 text-white font-semibold hover:bg-orange-700 cursor-pointer"
          >
            Save Expense
          </button>
        </form>

        <div className="lg:col-span-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4">Notes</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  {activeRole === 'SUPER_ADMIN' && <th className="py-3 px-4 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {filtered.map((exp) => (
                  <tr key={exp.id}>
                    <td className="py-3 px-4 font-mono-num">{exp.expenseDate}</td>
                    <td className="py-3 px-4 font-semibold">{exp.categoryName}</td>
                    <td className="py-3 px-4">{exp.paymentMethod}</td>
                    <td className="py-3 px-4 text-stone-500">{exp.notes || '—'}</td>
                    <td className="py-3 px-4 text-right font-mono-num font-bold">
                      {formatCurrency(exp.amount, sym)}
                    </td>
                    {activeRole === 'SUPER_ADMIN' && (
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => removeDocument('expenses', exp.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-stone-500">
                      No expenses logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
