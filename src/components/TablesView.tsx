import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Plus, Trash2, Users, UtensilsCrossed } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { hasPermission } from '../lib/permissions';
import { removeDocument } from '../lib/posService';
import { setTableStatusOfflineAware } from '../lib/syncEngine';
import { RestaurantTable, TableStatus } from '../types/pos';

export const TablesView: React.FC = () => {
  const {
    tables,
    orders,
    activeRole,
    firebaseUser,
    loadTableForOrder,
    setActiveSection,
    notify,
    refreshOfflineState,
  } = usePos();

  const [showAdd, setShowAdd] = useState(false);
  const [tableNumber, setTableNumber] = useState('');
  const [tableName, setTableName] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [zone, setZone] = useState('Main Hall');

  const canManageTables = hasPermission(activeRole, 'menu_manage');

  const zones = useMemo(() => {
    const map = new Map<string, RestaurantTable[]>();
    for (const t of tables) {
      const z = t.zone || 'Main Hall';
      const arr = map.get(z) || [];
      arr.push(t);
      map.set(z, arr);
    }
    return Array.from(map.entries());
  }, [tables]);

  const handleAddTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !tableNumber.trim()) return;
    const id = `tbl_${Date.now()}`;
    try {
      await setDoc(doc(db, 'tables', id), {
        tableNumber: tableNumber.trim(),
        name: tableName.trim() || `Table ${tableNumber.trim()}`,
        capacity: Math.max(1, capacity),
        zone: zone.trim() || 'Main Hall',
        status: 'AVAILABLE',
        currentOrderId: '',
        currentOrderNumber: '',
        createdByUid: firebaseUser.uid,
        updatedAt: serverTimestamp(),
      });
      setTableNumber('');
      setTableName('');
      setShowAdd(false);
      notify('Table added to floor plan.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `tables/${id}`);
    }
  };

  const setTableStatus = async (table: RestaurantTable, status: TableStatus) => {
    try {
      const res = await setTableStatusOfflineAware({ table, status });
      if (res.queuedOffline) {
        await refreshOfflineState();
        notify(`${table.name} marked ${status} (queued offline).`, 'info');
      } else {
        notify(`${table.name} marked ${status}.`, 'info');
      }
    } catch (err: any) {
      notify(err?.message || 'Unable to update table status.', 'error');
    }
  };

  const availableCount = tables.filter((t) => t.status === 'AVAILABLE').length;
  const occupiedCount = tables.filter((t) => t.status === 'OCCUPIED' || t.status === 'BILLING').length;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">
            Dine-In Floor Plan
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Available: {availableCount} · Occupied: {occupiedCount} · Total Tables: {tables.length}
          </p>
        </div>
        {canManageTables && (
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Table
          </button>
        )}
      </div>

      {showAdd && (
        <form
          onSubmit={handleAddTable}
          className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4 grid sm:grid-cols-5 gap-3 items-end"
        >
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
              Table No. *
            </label>
            <input
              type="text"
              required
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              placeholder="e.g., T9"
              className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="e.g., Window 09"
              className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
              Zone
            </label>
            <input
              type="text"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
              Seats
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value) || 2)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <button
            type="submit"
            className="min-h-[38px] px-4 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold cursor-pointer"
          >
            Save Table
          </button>
        </form>
      )}

      {zones.map(([zoneName, zoneTables]) => (
        <div key={zoneName} className="space-y-3">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
            {zoneName}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {zoneTables.map((table) => {
              const linkedOrder = table.currentOrderId
                ? orders.find((o) => o.id === table.currentOrderId)
                : undefined;
              const isOccupied = table.status === 'OCCUPIED' || table.status === 'BILLING';

              return (
                <div
                  key={table.id}
                  className={`bg-white dark:bg-stone-900 border rounded-xl p-4 space-y-3 ${
                    isOccupied
                      ? 'border-orange-400 dark:border-orange-700'
                      : table.status === 'RESERVED'
                        ? 'border-amber-400 dark:border-amber-700'
                        : 'border-stone-200 dark:border-stone-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <UtensilsCrossed className="w-4 h-4 text-orange-600" />
                        <span className="font-bold text-base text-stone-900 dark:text-stone-100">
                          {table.tableNumber}
                        </span>
                        <span className="text-xs text-stone-500">{table.name}</span>
                      </div>
                      <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        <span>{table.capacity} seats</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            isOccupied
                              ? 'text-orange-600 dark:text-orange-400'
                              : table.status === 'RESERVED'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {table.status}
                        </span>
                      </p>
                    </div>
                    {canManageTables && !isOccupied && (
                      <button
                        type="button"
                        onClick={() => removeDocument('tables', table.id)}
                        className="p-1.5 text-stone-400 hover:text-red-600"
                        title="Delete table"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {table.currentOrderNumber && (
                    <div className="text-xs bg-stone-50 dark:bg-stone-800/70 rounded-lg p-2.5 space-y-0.5">
                      <p className="font-mono-num font-semibold text-stone-900 dark:text-stone-100">
                        Active Bill: {table.currentOrderNumber}
                      </p>
                      {linkedOrder && (
                        <p className="text-[11px] text-stone-500 truncate">
                          {linkedOrder.status} · {linkedOrder.paymentStatus}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => loadTableForOrder(table)}
                      className="flex-1 min-h-[36px] px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      {isOccupied ? 'Add Items' : 'New Order'}
                    </button>
                    {isOccupied ? (
                      <button
                        type="button"
                        onClick={() => setActiveSection('orders')}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-medium cursor-pointer"
                      >
                        Settle
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setTableStatus(
                            table,
                            table.status === 'RESERVED' ? 'AVAILABLE' : 'RESERVED'
                          )
                        }
                        className="min-h-[36px] px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-medium cursor-pointer"
                      >
                        {table.status === 'RESERVED' ? 'Free' : 'Reserve'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
