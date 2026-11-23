import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ArrowUpRight, ChefHat, Printer, ShoppingBag } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { formatCurrency, formatTimestamp, isSameDay, toDateObj } from '../lib/permissions';
import { Order } from '../types/pos';
import { ReceiptModal } from './ReceiptModal';

type ChartPeriod = 'daily' | 'weekly' | 'monthly';

export const DashboardView: React.FC = () => {
  const { orders, payments, ingredients, settings, setActiveSection } = usePos();
  const [period, setPeriod] = useState<ChartPeriod>('daily');
  const [printOrder, setPrintOrder] = useState<Order | null>(null);

  const sym = settings.currencySymbol || '₹';
  const now = new Date();

  const metrics = useMemo(() => {
    const todayOrders = orders.filter((o) => isSameDay(toDateObj(o.createdAt), now));
    const activeToday = todayOrders.filter((o) => o.status !== 'CANCELLED');
    const cancelledToday = todayOrders.filter((o) => o.status === 'CANCELLED');

    const totalSalesToday = activeToday.reduce((s, o) => s + (o.grandTotal || 0), 0);
    const totalOrdersToday = activeToday.length;
    const avgOrderValue = totalOrdersToday > 0 ? totalSalesToday / totalOrdersToday : 0;

    const pendingAmount = activeToday
      .filter((o) => o.paymentStatus === 'PENDING' || o.paymentStatus === 'PARTIAL')
      .reduce((s, o) => s + Math.max(0, o.grandTotal - o.paidAmount), 0);

    const todayPayments = payments.filter(
      (p) => p.status === 'COMPLETED' && isSameDay(toDateObj(p.createdAt), now)
    );
    const cashSales = todayPayments
      .filter((p) => p.method === 'CASH')
      .reduce((s, p) => s + p.amount, 0);
    const upiSales = todayPayments
      .filter((p) => p.method === 'UPI')
      .reduce((s, p) => s + p.amount, 0);
    const cardSales = todayPayments
      .filter((p) => p.method === 'CARD')
      .reduce((s, p) => s + p.amount, 0);

    return {
      totalSalesToday,
      totalOrdersToday,
      avgOrderValue,
      cashSales,
      upiSales,
      cardSales,
      pendingAmount,
      cancelledCount: cancelledToday.length,
    };
  }, [orders, payments, now]);

  const chartData = useMemo(() => {
    const validOrders = orders.filter((o) => o.status !== 'CANCELLED');

    if (period === 'daily') {
      // Last 12 hours or 24-hour buckets for today
      const buckets: { label: string; sales: number; orders: number }[] = [];
      for (let h = 9; h <= 23; h++) {
        const label = `${h > 12 ? h - 12 : h}${h >= 12 ? 'PM' : 'AM'}`;
        const matching = validOrders.filter((o) => {
          const d = toDateObj(o.createdAt);
          return isSameDay(d, now) && d.getHours() === h;
        });
        buckets.push({
          label,
          sales: Number(matching.reduce((s, o) => s + o.grandTotal, 0).toFixed(2)),
          orders: matching.length,
        });
      }
      return buckets;
    }

    if (period === 'weekly') {
      const buckets: { label: string; sales: number; orders: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const day = new Date(now);
        day.setDate(now.getDate() - i);
        const matching = validOrders.filter((o) => isSameDay(toDateObj(o.createdAt), day));
        buckets.push({
          label: day.toLocaleDateString('en-IN', { weekday: 'short' }),
          sales: Number(matching.reduce((s, o) => s + o.grandTotal, 0).toFixed(2)),
          orders: matching.length,
        });
      }
      return buckets;
    }

    // Monthly: last 6 months
    const buckets: { label: string; sales: number; orders: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const matching = validOrders.filter((o) => {
        const d = toDateObj(o.createdAt);
        return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth();
      });
      buckets.push({
        label: m.toLocaleDateString('en-IN', { month: 'short' }),
        sales: Number(matching.reduce((s, o) => s + o.grandTotal, 0).toFixed(2)),
        orders: matching.length,
      });
    }
    return buckets;
  }, [orders, period, now]);

  const bestSelling = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) {
      if (o.status === 'CANCELLED' || !o.itemsPreview) continue;
      const parts = o.itemsPreview.split(',').map((s) => s.trim());
      for (const part of parts) {
        const match = part.match(/^(\d+)x\s+(.+)$/);
        if (match) {
          const qty = Number(match[1]) || 1;
          const name = match[2].trim();
          counts.set(name, (counts.get(name) ?? 0) + qty);
        }
      }
    }
    return Array.from(counts.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);
  }, [orders]);

  const lowStockIngredients = useMemo(
    () =>
      ingredients
        .filter((i) => i.currentStock <= i.minStockAlert)
        .sort((a, b) => a.currentStock - b.currentStock)
        .slice(0, 6),
    [ingredients]
  );

  const recentOrders = useMemo(() => orders.slice(0, 8), [orders]);

  const kpis = [
    { label: "Today's Total Sales", value: formatCurrency(metrics.totalSalesToday, sym), sub: 'Net billed today' },
    { label: 'Total Orders', value: String(metrics.totalOrdersToday), sub: 'Completed & active' },
    { label: 'Average Order Value', value: formatCurrency(metrics.avgOrderValue, sym), sub: 'Per ticket average' },
    { label: 'Cash Sales', value: formatCurrency(metrics.cashSales, sym), sub: 'Drawer collection' },
    { label: 'UPI Sales', value: formatCurrency(metrics.upiSales, sym), sub: 'Instant QR / UPI' },
    { label: 'Card Sales', value: formatCurrency(metrics.cardSales, sym), sub: 'Debit & credit' },
    { label: 'Pending Payments', value: formatCurrency(metrics.pendingAmount, sym), sub: 'Unsettled tables/tabs' },
    { label: 'Cancelled Orders', value: String(metrics.cancelledCount), sub: 'Voided today' },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Quick Operations Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">
            Store Performance Overview
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Live metrics synced from {settings.restaurantName} POS &amp; Kitchen Display
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSection('kot')}
            className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs font-semibold text-stone-800 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <ChefHat className="w-4 h-4 text-orange-600" />
            Open Kitchen Display
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('pos')}
            className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <ShoppingBag className="w-4 h-4" />
            Open POS Counter
          </button>
        </div>
      </div>

      {/* 8 KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4 space-y-1"
          >
            <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
              {k.label}
            </p>
            <p className="text-2xl font-bold font-mono-num text-stone-900 dark:text-stone-100">
              {k.value}
            </p>
            <p className="text-[11px] text-stone-400 dark:text-stone-500">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Sales Chart + Best Sellers */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                Revenue Trend
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Computed from completed and active orders
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg">
              {(['daily', 'weekly', 'monthly'] as ChartPeriod[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors cursor-pointer ${
                    period === p
                      ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {period === 'daily' ? (
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,113,108,0.18)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#78716c" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#78716c" />
                  <Tooltip
                    formatter={(val: any) => [formatCurrency(Number(val), sym), 'Sales']}
                    contentStyle={{
                      backgroundColor: '#1c1917',
                      border: '1px solid #292524',
                      borderRadius: '8px',
                      color: '#f5f5f4',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    stroke="#ea580c"
                    strokeWidth={2}
                    fill="#ea580c"
                    fillOpacity={0.14}
                  />
                </AreaChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,113,108,0.18)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#78716c" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#78716c" />
                  <Tooltip
                    formatter={(val: any) => [formatCurrency(Number(val), sym), 'Sales']}
                    contentStyle={{
                      backgroundColor: '#1c1917',
                      border: '1px solid #292524',
                      borderRadius: '8px',
                      color: '#f5f5f4',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="sales" fill="#ea580c" radius={[6, 6, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        {/* Best-Selling Products & Low-Stock Alerts */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                Best-Selling Items
              </h3>
              <button
                type="button"
                onClick={() => setActiveSection('reports')}
                className="text-xs font-medium text-orange-600 dark:text-orange-400 inline-flex items-center gap-1 hover:underline cursor-pointer"
              >
                Full Report <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {bestSelling.length === 0 ? (
              <p className="text-xs text-stone-500 dark:text-stone-400 py-4">
                Place your first POS order to see top-selling shawarmas and combos.
              </p>
            ) : (
              <div className="divide-y divide-stone-100 dark:divide-stone-800">
                {bestSelling.map((item, idx) => (
                  <div
                    key={item.name}
                    className="py-2.5 flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-stone-800 dark:text-stone-200 truncate">
                      <span className="font-mono-num text-xs text-stone-400 mr-2">
                        0{idx + 1}.
                      </span>
                      {item.name}
                    </span>
                    <span className="font-mono-num font-semibold text-stone-900 dark:text-stone-100 shrink-0">
                      {item.qty} sold
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Low-Stock Ingredients
              </h3>
              <button
                type="button"
                onClick={() => setActiveSection('inventory')}
                className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline cursor-pointer"
              >
                Restock
              </button>
            </div>
            {lowStockIngredients.length === 0 ? (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 py-2">
                All ingredient levels are healthy above alert thresholds.
              </p>
            ) : (
              <div className="divide-y divide-stone-100 dark:divide-stone-800">
                {lowStockIngredients.map((ing) => (
                  <div
                    key={ing.id}
                    className="py-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="font-medium text-stone-800 dark:text-stone-200 truncate">
                      {ing.name}
                    </span>
                    <span className="font-mono-num font-semibold text-red-600 dark:text-red-400 shrink-0">
                      {ing.currentStock} {ing.unit}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
          <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            Recent Transactions
          </h3>
          <button
            type="button"
            onClick={() => setActiveSection('orders')}
            className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline cursor-pointer"
          >
            View All Orders
          </button>
        </div>
        {recentOrders.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm text-stone-500 dark:text-stone-400">
              No orders recorded yet today.
            </p>
            <button
              type="button"
              onClick={() => setActiveSection('pos')}
              className="px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 transition-colors cursor-pointer"
            >
              Create First Order
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="py-3 px-4 font-medium">Order #</th>
                  <th className="py-3 px-4 font-medium">Type &amp; Guest</th>
                  <th className="py-3 px-4 font-medium">Items</th>
                  <th className="py-3 px-4 font-medium">KOT Status</th>
                  <th className="py-3 px-4 font-medium">Payment</th>
                  <th className="py-3 px-4 font-medium text-right">Total</th>
                  <th className="py-3 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {recentOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono-num font-semibold text-stone-900 dark:text-stone-100">
                      {order.orderNumber}
                      <div className="text-[11px] font-normal text-stone-400">
                        {formatTimestamp(order.createdAt)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-stone-700 dark:text-stone-300">
                      {order.orderType.replace('_', ' ')}
                      {order.tableName ? ` · ${order.tableName}` : ''}
                      <div className="text-[11px] text-stone-400">{order.customerName}</div>
                    </td>
                    <td className="py-3 px-4 text-stone-600 dark:text-stone-400 max-w-xs truncate">
                      {order.itemsPreview}
                    </td>
                    <td className="py-3 px-4 font-medium">
                      <span
                        className={
                          order.status === 'CANCELLED'
                            ? 'text-red-600 dark:text-red-400'
                            : order.status === 'READY' || order.status === 'COMPLETED'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                        }
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-stone-600 dark:text-stone-300">
                      {order.paymentStatus} · {order.paymentMethodsSummary}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-semibold text-stone-900 dark:text-stone-100">
                      {formatCurrency(order.grandTotal, sym)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setPrintOrder(order)}
                        className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 hover:underline font-medium cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {printOrder && (
        <ReceiptModal
          order={printOrder}
          settings={settings}
          mode="RECEIPT"
          onClose={() => setPrintOrder(null)}
        />
      )}
    </div>
  );
};
