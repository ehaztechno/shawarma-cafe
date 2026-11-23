import React, { useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Ban, CreditCard, Eye, Printer, RotateCcw, Search, X } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { getLocalOfflineOrder } from '../lib/offlineDb';
import { formatCurrency, formatTimestamp, hasPermission, toDateObj } from '../lib/permissions';
import { refundOrderPayments } from '../lib/posService';
import {
  cancelOrderOfflineAware,
  isLikelyNetworkError,
  isOfflineOrderId,
  recordPaymentOfflineAware,
} from '../lib/syncEngine';
import { Order, OrderItem, OrderType, PaymentMethod, SplitPaymentEntry } from '../types/pos';
import { ReceiptModal } from './ReceiptModal';

export const OrdersHistoryView: React.FC = () => {
  const {
    orders,
    payments,
    recipeItems,
    settings,
    activeRole,
    firebaseUser,
    profile,
    activeStaffUids,
    notify,
    refreshOfflineState,
  } = usePos();

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | OrderType>('ALL');
  const [payFilter, setPayFilter] = useState<'ALL' | PaymentMethod | 'PENDING'>('ALL');

  const [inspectOrder, setInspectOrder] = useState<Order | null>(null);
  const [inspectItems, setInspectItems] = useState<OrderItem[]>([]);
  const [printOrder, setPrintOrder] = useState<Order | null>(null);

  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [payTarget, setPayTarget] = useState<Order | null>(null);
  const [paySplit, setPaySplit] = useState<SplitPaymentEntry[]>([
    { method: 'CASH', amount: 0, referenceNumber: '' },
  ]);

  const sym = settings.currencySymbol || '₹';
  const canReprint = hasPermission(activeRole, 'receipt_reprint');
  const canCancel = hasPermission(activeRole, 'orders_cancel');
  const canRefund = hasPermission(activeRole, 'orders_refund');

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (typeFilter !== 'ALL' && o.orderType !== typeFilter) return false;
      if (payFilter === 'PENDING' && o.paymentStatus !== 'PENDING' && o.paymentStatus !== 'PARTIAL') {
        return false;
      }
      if (
        payFilter !== 'ALL' &&
        payFilter !== 'PENDING' &&
        !o.paymentMethodsSummary.includes(payFilter)
      ) {
        return false;
      }
      if (dateFilter) {
        const d = toDateObj(o.createdAt);
        const isoDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate()
        ).padStart(2, '0')}`;
        if (isoDay !== dateFilter) return false;
      }
      if (q) {
        const hay = `${o.orderNumber} ${o.customerName} ${o.customerPhone} ${o.itemsPreview}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, search, dateFilter, typeFilter, payFilter]);

  const openDetails = async (order: Order) => {
    setInspectOrder(order);
    if (isOfflineOrderId(order.id)) {
      const localRec = await getLocalOfflineOrder(order.id);
      setInspectItems(localRec ? localRec.items : []);
      return;
    }
    try {
      const snap = await getDocs(
        query(collection(db, 'orders', order.id, 'items'), where('orderId', '==', order.id))
      );
      setInspectItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderItem)));
    } catch (err) {
      if (isLikelyNetworkError(err)) {
        setInspectItems([]);
        return;
      }
      handleFirestoreError(err, OperationType.LIST, `orders/${order.id}/items`);
    }
  };

  const handleCancelOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget || !firebaseUser) return;
    try {
      const res = await cancelOrderOfflineAware({
        order: cancelTarget,
        reason: cancelReason,
        actorUid: firebaseUser.uid,
        actorEmail: firebaseUser.email || '',
        actorRole: activeRole,
        staffUids: activeStaffUids,
      });
      if (res.queuedOffline) {
        await refreshOfflineState();
        notify(`${cancelTarget.orderNumber} cancellation queued offline.`, 'info');
      } else {
        notify(`${cancelTarget.orderNumber} cancelled and logged.`, 'info');
      }
      setCancelTarget(null);
      setCancelReason('');
    } catch (err: any) {
      notify(err?.message || 'Unable to cancel order.', 'error');
    }
  };

  const handleSettleBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget || !firebaseUser || !profile) return;
    try {
      const res = await recordPaymentOfflineAware({
        order: payTarget,
        payments: paySplit,
        actorUid: firebaseUser.uid,
        actorName: profile.displayName,
        actorEmail: profile.email,
        actorRole: activeRole,
        staffUids: activeStaffUids,
        autoDeductInventory: settings.autoDeductInventory,
        recipeItems,
      });
      if (res.queuedOffline) {
        await refreshOfflineState();
        notify(`Payment for ${payTarget.orderNumber} saved offline — will sync automatically.`, 'info');
      } else {
        notify(`Payment recorded for ${payTarget.orderNumber}`, 'success');
      }
      setPayTarget(null);
    } catch (err: any) {
      notify(err?.message || 'Payment failed.', 'error');
    }
  };

  const handleRefund = async (order: Order) => {
    if (!firebaseUser) return;
    const orderPaymentIds = payments
      .filter((p) => p.orderId === order.id && p.status === 'COMPLETED')
      .map((p) => p.id);
    try {
      await refundOrderPayments({
        order,
        paymentIds: orderPaymentIds,
        reason: 'Manager/Admin approved refund',
        actorUid: firebaseUser.uid,
        actorEmail: firebaseUser.email || '',
        actorRole: activeRole,
        staffUids: activeStaffUids,
      });
      notify(`Refund recorded for ${order.orderNumber}`, 'info');
      setInspectOrder(null);
    } catch (err: any) {
      notify(err?.message || 'Refund failed.', 'error');
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">
            Order History &amp; Bills
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Immutable financial ledger · {filteredOrders.length} orders shown
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order #, customer, phone..."
            className="w-full min-h-[38px] pl-9 pr-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
          />
        </div>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as any)}
          className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
        >
          <option value="ALL">All Order Types</option>
          <option value="DINE_IN">Dine In</option>
          <option value="TAKEAWAY">Takeaway</option>
          <option value="DELIVERY">Delivery</option>
        </select>
        <select
          value={payFilter}
          onChange={(e) => setPayFilter(e.target.value as any)}
          className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
        >
          <option value="ALL">All Payment Methods</option>
          <option value="CASH">Cash</option>
          <option value="UPI">UPI</option>
          <option value="CARD">Card</option>
          <option value="ONLINE">Online</option>
          <option value="PENDING">Pending / Partial</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
              <tr>
                <th className="py-3 px-4 font-medium">Order #</th>
                <th className="py-3 px-4 font-medium">Date &amp; Time</th>
                <th className="py-3 px-4 font-medium">Type / Customer</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Payment</th>
                <th className="py-3 px-4 font-medium text-right">Total</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {filteredOrders.map((order) => {
                const balance = Math.max(0, Number((order.grandTotal - order.paidAmount).toFixed(2)));
                return (
                  <tr
                    key={order.id}
                    className="hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono-num font-bold text-stone-900 dark:text-stone-100">
                      {order.orderNumber}
                    </td>
                    <td className="py-3 px-4 text-stone-600 dark:text-stone-400">
                      {formatTimestamp(order.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-medium text-stone-900 dark:text-stone-100">
                        {order.orderType.replace('_', ' ')}
                        {order.tableName ? ` · ${order.tableName}` : ''}
                      </span>
                      <div className="text-[11px] text-stone-500">
                        {order.customerName}
                        {order.customerPhone ? ` (${order.customerPhone})` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-semibold">
                      <span
                        className={
                          order.status === 'CANCELLED'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-stone-800 dark:text-stone-200'
                        }
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-semibold ${
                          order.paymentStatus === 'PAID'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : order.paymentStatus === 'REFUNDED'
                              ? 'text-stone-500'
                              : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {order.paymentStatus}
                      </span>
                      <span className="text-stone-500 ml-1">
                        ({order.paymentMethodsSummary})
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-bold text-stone-900 dark:text-stone-100">
                      {formatCurrency(order.grandTotal, sym)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openDetails(order)}
                          className="p-1.5 rounded-lg text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {balance > 0 && order.status !== 'CANCELLED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setPayTarget(order);
                              setPaySplit([{ method: 'CASH', amount: balance, referenceNumber: '' }]);
                            }}
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 cursor-pointer"
                            title="Record Payment"
                          >
                            <CreditCard className="w-4 h-4" />
                          </button>
                        )}
                        {canReprint && (
                          <button
                            type="button"
                            onClick={() => setPrintOrder(order)}
                            className="p-1.5 rounded-lg text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30 cursor-pointer"
                            title="Reprint Receipt"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                        )}
                        {canCancel && order.status !== 'CANCELLED' && order.status !== 'COMPLETED' && (
                          <button
                            type="button"
                            onClick={() => setCancelTarget(order)}
                            className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                            title="Cancel Order"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-stone-500">
                    No matching orders found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspect Order Details Modal */}
      {inspectOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl max-w-xl w-full max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base font-mono-num">
                  Order {inspectOrder.orderNumber}
                </h3>
                <p className="text-xs text-stone-500">
                  {formatTimestamp(inspectOrder.createdAt)} · Cashier: {inspectOrder.createdByName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectOrder(null)}
                className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-stone-50 dark:bg-stone-800/50">
                <div>
                  <span className="text-stone-500">Type:</span>{' '}
                  <span className="font-semibold">{inspectOrder.orderType}</span>
                </div>
                <div>
                  <span className="text-stone-500">Status:</span>{' '}
                  <span className="font-semibold">{inspectOrder.status}</span>
                </div>
                <div>
                  <span className="text-stone-500">Guest:</span>{' '}
                  <span className="font-semibold">{inspectOrder.customerName}</span>
                </div>
                <div>
                  <span className="text-stone-500">Payment:</span>{' '}
                  <span className="font-semibold">
                    {inspectOrder.paymentStatus} ({formatCurrency(inspectOrder.paidAmount, sym)})
                  </span>
                </div>
              </div>

              {inspectOrder.cancelReason && (
                <div className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                  Cancellation / Refund Note: {inspectOrder.cancelReason}
                </div>
              )}

              <div className="divide-y divide-stone-100 dark:divide-stone-800 border-y border-stone-200 dark:border-stone-800">
                {inspectItems.map((it) => (
                  <div key={it.id} className="py-2.5 flex justify-between gap-3">
                    <div>
                      <p className="font-semibold text-stone-900 dark:text-stone-100">
                        {it.quantity} x {it.productName}
                        {it.variantName ? ` (${it.variantName})` : ''}
                      </p>
                      {it.addonsSummary && <p className="text-stone-500">+ {it.addonsSummary}</p>}
                      {it.specialInstructions && (
                        <p className="text-orange-600">Note: {it.specialInstructions}</p>
                      )}
                    </div>
                    <span className="font-mono-num font-semibold">
                      {formatCurrency(it.lineTotal, sym)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-1 text-right font-mono-num">
                <p>Subtotal: {formatCurrency(inspectOrder.subtotal, sym)}</p>
                <p>Tax: {formatCurrency(inspectOrder.taxAmount, sym)}</p>
                <p className="text-base font-bold pt-1">
                  Grand Total: {formatCurrency(inspectOrder.grandTotal, sym)}
                </p>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-stone-200 dark:border-stone-800 flex flex-wrap justify-between gap-2">
              {canRefund &&
                inspectOrder.paymentStatus === 'PAID' && (
                  <button
                    type="button"
                    onClick={() => handleRefund(inspectOrder)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-300 text-red-600 text-xs font-semibold hover:bg-red-50 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Record Refund
                  </button>
                )}
              <div className="flex gap-2 ml-auto">
                {canReprint && (
                  <button
                    type="button"
                    onClick={() => setPrintOrder(inspectOrder)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Reprint Bill
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Order Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleCancelOrder}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl max-w-md w-full p-5 space-y-4"
          >
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">
              Cancel Order {cancelTarget.orderNumber}
            </h3>
            <p className="text-xs text-stone-500">
              Financial records are preserved in the audit ledger. Please enter a mandatory reason for cancelling this order.
            </p>
            <input
              type="text"
              required
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g., Customer changed mind / Wrong item entered"
              className="w-full min-h-[40px] px-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="px-4 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-semibold"
              >
                Back
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer"
              >
                Confirm Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Settle Pending Payment Modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSettleBalance}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl max-w-md w-full p-5 space-y-4"
          >
            <h3 className="text-base font-bold">
              Settle Balance — {payTarget.orderNumber}
            </h3>
            <p className="text-xs text-stone-500">
              Balance Due:{' '}
              <span className="font-mono-num font-bold text-stone-900 dark:text-stone-100">
                {formatCurrency(Math.max(0, payTarget.grandTotal - payTarget.paidAmount), sym)}
              </span>
            </p>
            {paySplit.map((entry, idx) => (
              <div key={idx} className="grid grid-cols-2 gap-2">
                <select
                  value={entry.method}
                  onChange={(e) =>
                    setPaySplit((prev) =>
                      prev.map((p, i) =>
                        i === idx ? { ...p, method: e.target.value as PaymentMethod } : p
                      )
                    )
                  }
                  className="min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                >
                  <option value="CASH">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="CARD">Card</option>
                  <option value="ONLINE">Online</option>
                </select>
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={entry.amount || ''}
                  onChange={(e) =>
                    setPaySplit((prev) =>
                      prev.map((p, i) =>
                        i === idx ? { ...p, amount: Number(e.target.value) || 0 } : p
                      )
                    )
                  }
                  className="min-h-[38px] px-3 py-1.5 text-xs font-mono-num text-right rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                />
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="px-4 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
              >
                Record Payment
              </button>
            </div>
          </form>
        </div>
      )}

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
