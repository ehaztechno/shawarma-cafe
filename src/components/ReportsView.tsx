import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, Printer } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { formatCurrency, isSameDay, toDateObj } from '../lib/permissions';

type RangePreset = 'today' | 'weekly' | 'monthly' | 'custom';
type ReportTab = 'sales' | 'products' | 'payments' | 'inventory';

export const ReportsView: React.FC = () => {
  const {
    orders,
    payments,
    expenses,
    ingredients,
    purchases,
    products,
    settings,
  } = usePos();

  const [preset, setPreset] = useState<RangePreset>('monthly');
  const [tab, setTab] = useState<ReportTab>('sales');
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));

  const sym = settings.currencySymbol || '₹';
  const now = new Date();

  const inRange = (d: Date) => {
    if (preset === 'today') return isSameDay(d, now);
    if (preset === 'weekly') {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return d >= start;
    }
    if (preset === 'monthly') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    const s = new Date(`${customStart}T00:00:00`);
    const e = new Date(`${customEnd}T23:59:59`);
    return d >= s && d <= e;
  };

  const rangeOrders = useMemo(
    () => orders.filter((o) => inRange(toDateObj(o.createdAt))),
    [orders, preset, customStart, customEnd]
  );

  const activeOrders = useMemo(
    () => rangeOrders.filter((o) => o.status !== 'CANCELLED'),
    [rangeOrders]
  );
  const cancelledOrders = useMemo(
    () => rangeOrders.filter((o) => o.status === 'CANCELLED'),
    [rangeOrders]
  );

  const rangePayments = useMemo(
    () =>
      payments.filter(
        (p) => p.status === 'COMPLETED' && inRange(toDateObj(p.createdAt))
      ),
    [payments, preset, customStart, customEnd]
  );

  const rangeExpenses = useMemo(
    () =>
      expenses.filter((e) => {
        const d = new Date(`${e.expenseDate}T12:00:00`);
        return inRange(d);
      }),
    [expenses, preset, customStart, customEnd]
  );

  const rangePurchases = useMemo(
    () =>
      purchases.filter((p) => {
        const d = new Date(`${p.purchaseDate}T12:00:00`);
        return inRange(d);
      }),
    [purchases, preset, customStart, customEnd]
  );

  const summary = useMemo(() => {
    const grossSales = activeOrders.reduce((s, o) => s + o.grandTotal, 0);
    const totalTax = activeOrders.reduce((s, o) => s + o.taxAmount, 0);
    const totalDiscounts = activeOrders.reduce(
      (s, o) => s + o.itemDiscountTotal + o.cartDiscountAmount,
      0
    );
    const totalExpenses = rangeExpenses.reduce((s, e) => s + e.amount, 0);
    const totalPurchases = rangePurchases.reduce((s, p) => s + p.totalAmount, 0);
    const estGrossProfit = grossSales - totalTax - totalExpenses - totalPurchases;
    const cancelledValue = cancelledOrders.reduce((s, o) => s + o.grandTotal, 0);

    return {
      grossSales,
      totalTax,
      totalDiscounts,
      totalExpenses,
      totalPurchases,
      estGrossProfit,
      cancelledValue,
    };
  }, [activeOrders, cancelledOrders, rangeExpenses, rangePurchases]);

  // Product & Category breakdown
  const productSales = useMemo(() => {
    const prodCategoryLookup = new Map(products.map((p) => [p.name, p.categoryName]));
    const prodPriceLookup = new Map(products.map((p) => [p.name, p.basePrice]));
    const map = new Map<string, { name: string; category: string; qty: number; estRevenue: number }>();

    for (const o of activeOrders) {
      if (!o.itemsPreview) continue;
      for (const part of o.itemsPreview.split(',').map((s) => s.trim())) {
        const m = part.match(/^(\d+)x\s+(.+)$/);
        if (m) {
          const qty = Number(m[1]) || 1;
          const name = m[2].trim();
          const prev = map.get(name) || {
            name,
            category: prodCategoryLookup.get(name) || 'Menu',
            qty: 0,
            estRevenue: 0,
          };
          prev.qty += qty;
          prev.estRevenue += qty * (prodPriceLookup.get(name) || 0);
          map.set(name, prev);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  }, [activeOrders, products]);

  const categorySales = useMemo(() => {
    const map = new Map<string, { category: string; qty: number; revenue: number }>();
    for (const ps of productSales) {
      const prev = map.get(ps.category) || { category: ps.category, qty: 0, revenue: 0 };
      prev.qty += ps.qty;
      prev.revenue += ps.estRevenue;
      map.set(ps.category, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [productSales]);

  const paymentBreakdown = useMemo(() => {
    const methods = ['CASH', 'UPI', 'CARD', 'ONLINE'] as const;
    return methods.map((m) => ({
      method: m,
      count: rangePayments.filter((p) => p.method === m).length,
      total: rangePayments
        .filter((p) => p.method === m)
        .reduce((s, p) => s + p.amount, 0),
    }));
  }, [rangePayments]);

  const inventoryValuation = useMemo(
    () =>
      ingredients.reduce((s, i) => s + i.currentStock * i.costPerUnit, 0),
    [ingredients]
  );

  const exportCsv = () => {
    const rows: string[][] = [
      ['Shawarma Cafe Report', preset.toUpperCase()],
      ['Gross Sales', String(summary.grossSales.toFixed(2))],
      ['Tax Collected', String(summary.totalTax.toFixed(2))],
      ['Discounts', String(summary.totalDiscounts.toFixed(2))],
      ['Expenses', String(summary.totalExpenses.toFixed(2))],
      ['Purchases', String(summary.totalPurchases.toFixed(2))],
      ['Estimated Gross Profit', String(summary.estGrossProfit.toFixed(2))],
      [],
      ['Order #', 'Date', 'Type', 'Status', 'Payment', 'Subtotal', 'Tax', 'Total'],
      ...rangeOrders.map((o) => [
        o.orderNumber,
        toDateObj(o.createdAt).toISOString(),
        o.orderType,
        o.status,
        o.paymentMethodsSummary,
        String(o.subtotal),
        String(o.taxAmount),
        String(o.grandTotal),
      ]),
    ];

    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shawarma-cafe-report-${preset}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">
            Financial Reports &amp; Analytics
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Sales, tax, discounts, expenses, inventory valuation, and profit estimation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg text-xs">
            {(
              [
                { id: 'today', label: 'Daily' },
                { id: 'weekly', label: 'Weekly' },
                { id: 'monthly', label: 'Monthly' },
                { id: 'custom', label: 'Custom' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`px-3 py-1.5 rounded-md font-semibold cursor-pointer ${
                  preset === p.id
                    ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                    : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="min-h-[34px] px-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900"
              />
              <span>to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="min-h-[34px] px-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900"
              />
            </div>
          )}

          <button
            type="button"
            onClick={exportCsv}
            className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs font-semibold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-semibold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / PDF
          </button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4">
          <p className="text-xs text-stone-500">Gross Sales</p>
          <p className="text-xl font-bold font-mono-num mt-1">
            {formatCurrency(summary.grossSales, sym)}
          </p>
        </div>
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4">
          <p className="text-xs text-stone-500">Tax Collected</p>
          <p className="text-xl font-bold font-mono-num mt-1">
            {formatCurrency(summary.totalTax, sym)}
          </p>
        </div>
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4">
          <p className="text-xs text-stone-500">Discounts Given</p>
          <p className="text-xl font-bold font-mono-num mt-1">
            {formatCurrency(summary.totalDiscounts, sym)}
          </p>
        </div>
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4">
          <p className="text-xs text-stone-500">Expenses &amp; Stock</p>
          <p className="text-xl font-bold font-mono-num mt-1">
            {formatCurrency(summary.totalExpenses + summary.totalPurchases, sym)}
          </p>
        </div>
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4">
          <p className="text-xs text-stone-500">Est. Gross Profit</p>
          <p
            className={`text-xl font-bold font-mono-num mt-1 ${
              summary.estGrossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {formatCurrency(summary.estGrossProfit, sym)}
          </p>
        </div>
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4">
          <p className="text-xs text-stone-500">Cancelled ({cancelledOrders.length})</p>
          <p className="text-xl font-bold font-mono-num mt-1 text-red-600">
            {formatCurrency(summary.cancelledValue, sym)}
          </p>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="no-print flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg w-fit text-xs">
        {(
          [
            { id: 'sales', label: 'Category & Profit' },
            { id: 'products', label: 'Product-wise Sales' },
            { id: 'payments', label: 'Payments & Cancelled' },
            { id: 'inventory', label: 'Inventory Valuation' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-md font-semibold cursor-pointer ${
              tab === t.id
                ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                : 'text-stone-600 dark:text-stone-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'sales' && (
        <div className="grid lg:grid-cols-2 gap-6 text-xs">
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold">Category-wise Estimated Revenue</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categorySales}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,113,108,0.18)" />
                  <XAxis dataKey="category" tick={{ fontSize: 10 }} stroke="#78716c" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#78716c" />
                  <Tooltip />
                  <Bar dataKey="revenue" fill="#ea580c" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 font-semibold">
              Category Breakdown
            </div>
            <table className="w-full text-left">
              <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4 text-right">Units</th>
                  <th className="py-2.5 px-4 text-right">Est. Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {categorySales.map((c) => (
                  <tr key={c.category}>
                    <td className="py-2.5 px-4 font-semibold">{c.category}</td>
                    <td className="py-2.5 px-4 text-right font-mono-num">{c.qty}</td>
                    <td className="py-2.5 px-4 text-right font-mono-num font-bold">
                      {formatCurrency(c.revenue, sym)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'products' && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden text-xs">
          <table className="w-full text-left">
            <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
              <tr>
                <th className="py-3 px-4">Product</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-right">Qty Sold</th>
                <th className="py-3 px-4 text-right">Est. Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {productSales.map((p) => (
                <tr key={p.name}>
                  <td className="py-3 px-4 font-semibold">{p.name}</td>
                  <td className="py-3 px-4 text-stone-500">{p.category}</td>
                  <td className="py-3 px-4 text-right font-mono-num">{p.qty}</td>
                  <td className="py-3 px-4 text-right font-mono-num font-bold">
                    {formatCurrency(p.estRevenue, sym)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'payments' && (
        <div className="grid lg:grid-cols-2 gap-6 text-xs">
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 font-semibold">
              Payment Method Report
            </div>
            <table className="w-full text-left">
              <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="py-2.5 px-4">Method</th>
                  <th className="py-2.5 px-4 text-right">Transactions</th>
                  <th className="py-2.5 px-4 text-right">Collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {paymentBreakdown.map((pb) => (
                  <tr key={pb.method}>
                    <td className="py-2.5 px-4 font-semibold">{pb.method}</td>
                    <td className="py-2.5 px-4 text-right font-mono-num">{pb.count}</td>
                    <td className="py-2.5 px-4 text-right font-mono-num font-bold">
                      {formatCurrency(pb.total, sym)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 font-semibold">
              Cancelled Orders Report
            </div>
            <table className="w-full text-left">
              <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="py-2.5 px-4">Order #</th>
                  <th className="py-2.5 px-4">Reason</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {cancelledOrders.map((co) => (
                  <tr key={co.id}>
                    <td className="py-2.5 px-4 font-mono-num font-semibold">{co.orderNumber}</td>
                    <td className="py-2.5 px-4 text-red-600">{co.cancelReason || '—'}</td>
                    <td className="py-2.5 px-4 text-right font-mono-num">
                      {formatCurrency(co.grandTotal, sym)}
                    </td>
                  </tr>
                ))}
                {cancelledOrders.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-stone-500">
                      No cancelled orders in selected period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'inventory' && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden text-xs">
          <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 flex justify-between font-semibold">
            <span>Stock Valuation Report</span>
            <span className="font-mono-num">
              Total Stock Value: {formatCurrency(inventoryValuation, sym)}
            </span>
          </div>
          <table className="w-full text-left">
            <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
              <tr>
                <th className="py-2.5 px-4">Ingredient</th>
                <th className="py-2.5 px-4 text-right">Stock</th>
                <th className="py-2.5 px-4 text-right">Unit Cost</th>
                <th className="py-2.5 px-4 text-right">Valuation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {ingredients.map((i) => (
                <tr key={i.id}>
                  <td className="py-2.5 px-4 font-semibold">{i.name}</td>
                  <td className="py-2.5 px-4 text-right font-mono-num">
                    {i.currentStock} {i.unit}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono-num">
                    {formatCurrency(i.costPerUnit, sym)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono-num font-bold">
                    {formatCurrency(i.currentStock * i.costPerUnit, sym)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
