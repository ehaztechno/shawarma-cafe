import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { CheckCircle2, ChefHat, Clock, Printer } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { getLocalOfflineOrder } from '../lib/offlineDb';
import { hasPermission, toDateObj } from '../lib/permissions';
import { isOfflineOrderId, updateOrderStatusOfflineAware } from '../lib/syncEngine';
import { Order, OrderItem, OrderStatus } from '../types/pos';
import { ReceiptModal } from './ReceiptModal';

const KotOrderCard: React.FC<{
  order: Order;
  canUpdate: boolean;
  onAdvance: (order: Order, nextStatus: OrderStatus) => void;
  onPrintKot: (order: Order) => void;
}> = ({ order, canUpdate, onAdvance, onPrintKot }) => {
  const [items, setItems] = useState<OrderItem[]>([]);

  useEffect(() => {
    if (isOfflineOrderId(order.id)) {
      let active = true;
      getLocalOfflineOrder(order.id).then((rec) => {
        if (active && rec) {
          setItems(rec.items);
        }
      });
      return () => {
        active = false;
      };
    }

    const unsub = onSnapshot(
      query(collection(db, 'orders', order.id, 'items'), where('orderId', '==', order.id)),
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderItem)));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `orders/${order.id}/items`);
      }
    );
    return () => unsub();
  }, [order.id, order.updatedAt]);

  const created = toDateObj(order.createdAt);
  const minsAgo = Math.max(0, Math.floor((Date.now() - created.getTime()) / 60000));

  const statusAction = (): { label: string; next: OrderStatus } | null => {
    if (order.status === 'NEW') return { label: 'Start Preparing', next: 'PREPARING' };
    if (order.status === 'PREPARING') return { label: 'Mark Ready', next: 'READY' };
    if (order.status === 'READY') return { label: 'Mark Served', next: 'SERVED' };
    if (order.status === 'SERVED') return { label: 'Complete Ticket', next: 'COMPLETED' };
    return null;
  };

  const nextAct = statusAction();

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 flex items-start justify-between gap-2 bg-stone-50 dark:bg-stone-800/40">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono-num font-bold text-base text-stone-900 dark:text-stone-100">
              {order.orderNumber}
            </span>
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
              · {order.orderType.replace('_', ' ')}
              {order.tableName ? ` · ${order.tableName}` : ''}
            </span>
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            <span className="font-mono-num">{minsAgo}m ago</span>
            <span aria-hidden="true">·</span>
            <span
              className={`font-semibold ${
                order.status === 'NEW'
                  ? 'text-orange-600 dark:text-orange-400'
                  : order.status === 'PREPARING'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {order.status}
            </span>
            {isOfflineOrderId(order.id) && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  Offline Queue
                </span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onPrintKot(order)}
          title="Print Thermal KOT"
          className="p-2 rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
        >
          <Printer className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 flex-1 space-y-2.5">
        {items.length === 0 ? (
          <p className="text-xs text-stone-500">{order.itemsPreview}</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="pb-2 border-b last:border-b-0 border-stone-100 dark:border-stone-800 space-y-0.5"
            >
              <div className="flex items-start justify-between gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
                <span>
                  <span className="font-mono-num text-orange-600 dark:text-orange-400 mr-1.5">
                    {item.quantity}x
                  </span>
                  {item.productName}
                  {item.variantName ? ` (${item.variantName})` : ''}
                </span>
              </div>
              {item.addonsSummary && (
                <p className="text-xs text-stone-600 dark:text-stone-400 pl-5">
                  + {item.addonsSummary}
                </p>
              )}
              {item.specialInstructions && (
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 pl-5">
                  Note: {item.specialInstructions}
                </p>
              )}
            </div>
          ))
        )}

        {order.notes && (
          <p className="text-xs font-medium text-orange-700 dark:text-orange-300 pt-1">
            Order Note: {order.notes}
          </p>
        )}
      </div>

      {canUpdate && nextAct && (
        <div className="p-3 border-t border-stone-200 dark:border-stone-800">
          <button
            type="button"
            onClick={() => onAdvance(order, nextAct.next)}
            className={`w-full min-h-[42px] px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors cursor-pointer ${
              order.status === 'NEW'
                ? 'bg-orange-600 hover:bg-orange-700'
                : order.status === 'PREPARING'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-stone-800 hover:bg-stone-900 dark:bg-stone-700 dark:hover:bg-stone-600'
            }`}
          >
            {nextAct.label}
          </button>
        </div>
      )}
    </div>
  );
};

export const KitchenDisplayView: React.FC = () => {
  const {
    orders,
    settings,
    activeRole,
    firebaseUser,
    activeStaffUids,
    notify,
    refreshOfflineState,
  } = usePos();
  const [filterStatus, setFilterStatus] = useState<'ACTIVE' | OrderStatus>('ACTIVE');
  const [kotPrintOrder, setKotPrintOrder] = useState<Order | null>(null);

  const canUpdate = hasPermission(activeRole, 'kot_update') || hasPermission(activeRole, 'pos_billing');

  const visibleOrders = useMemo(() => {
    const sorted = [...orders].sort(
      (a, b) => toDateObj(a.createdAt).getTime() - toDateObj(b.createdAt).getTime()
    );
    if (filterStatus === 'ACTIVE') {
      return sorted.filter((o) => ['NEW', 'PREPARING', 'READY', 'SERVED'].includes(o.status));
    }
    return sorted.filter((o) => o.status === filterStatus);
  }, [orders, filterStatus]);

  const counts = useMemo(() => {
    return {
      NEW: orders.filter((o) => o.status === 'NEW').length,
      PREPARING: orders.filter((o) => o.status === 'PREPARING').length,
      READY: orders.filter((o) => o.status === 'READY').length,
      SERVED: orders.filter((o) => o.status === 'SERVED').length,
    };
  }, [orders]);

  const handleAdvance = async (order: Order, nextStatus: OrderStatus) => {
    if (!firebaseUser) return;
    try {
      const res = await updateOrderStatusOfflineAware({
        order,
        nextStatus,
        actorUid: firebaseUser.uid,
        actorEmail: firebaseUser.email || '',
        actorRole: activeRole,
        staffUids: activeStaffUids,
      });
      if (res.queuedOffline) {
        await refreshOfflineState();
        notify(`${order.orderNumber} marked ${nextStatus} (queued offline)`, 'info');
      } else {
        notify(`${order.orderNumber} marked ${nextStatus}`, 'success');
      }
    } catch (err: any) {
      notify(err?.message || 'Unable to update KOT status', 'error');
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
            <ChefHat className="w-5 h-5 text-orange-600" />
            Live Kitchen Order Tickets (KOT)
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            New: {counts.NEW} · Preparing: {counts.PREPARING} · Ready: {counts.READY} · Served: {counts.SERVED}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg overflow-x-auto">
          {(
            [
              { id: 'ACTIVE', label: 'All Active' },
              { id: 'NEW', label: 'New' },
              { id: 'PREPARING', label: 'Preparing' },
              { id: 'READY', label: 'Ready' },
              { id: 'SERVED', label: 'Served' },
              { id: 'COMPLETED', label: 'Completed' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterStatus(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                filterStatus === tab.id
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {visibleOrders.length === 0 ? (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-12 text-center space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">
            Kitchen queue is clear
          </p>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            New POS orders automatically appear here in real time.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visibleOrders.map((order) => (
            <KotOrderCard
              key={order.id}
              order={order}
              canUpdate={canUpdate}
              onAdvance={handleAdvance}
              onPrintKot={(o) => setKotPrintOrder(o)}
            />
          ))}
        </div>
      )}

      {kotPrintOrder && (
        <ReceiptModal
          order={kotPrintOrder}
          settings={settings}
          mode="KOT"
          onClose={() => setKotPrintOrder(null)}
        />
      )}
    </div>
  );
};
