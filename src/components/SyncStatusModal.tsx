import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  Database,
  RefreshCw,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { usePos } from '../context/PosContext';
import { formatTimestamp } from '../lib/permissions';

export const SyncStatusModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const {
    isOnline,
    isSyncing,
    syncQueue,
    lastSyncedAtIso,
    lastCachedAtIso,
    swReady,
    triggerSync,
    discardSyncQueueItem,
  } = usePos();

  const pendingCount = syncQueue.filter((q) => q.status !== 'FAILED').length;
  const failedCount = syncQueue.filter((q) => q.status === 'FAILED').length;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl max-w-xl w-full max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {isOnline ? (
              <Wifi className="w-5 h-5 text-emerald-600" />
            ) : (
              <CloudOff className="w-5 h-5 text-amber-600" />
            )}
            <div>
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">
                Offline Storage &amp; Firebase Sync
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {isOnline ? 'Connected to Firebase' : 'Offline Mode · Queuing in IndexedDB'} ·{' '}
                {swReady ? 'Service Worker Active' : 'Caching App Shell'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sync inspector"
            className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700">
              <p className="text-stone-500">Queued Writes</p>
              <p className="text-lg font-bold font-mono-num mt-0.5 text-stone-900 dark:text-stone-100">
                {pendingCount}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700">
              <p className="text-stone-500">Sync Errors</p>
              <p
                className={`text-lg font-bold font-mono-num mt-0.5 ${
                  failedCount > 0 ? 'text-red-600' : 'text-stone-900 dark:text-stone-100'
                }`}
              >
                {failedCount}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700">
              <p className="text-stone-500">IndexedDB Cache</p>
              <p className="text-[11px] font-mono-num font-semibold mt-1 text-stone-800 dark:text-stone-200 truncate">
                {lastCachedAtIso ? formatTimestamp(lastCachedAtIso) : 'Warming...'}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-stone-400">
            <span className="inline-flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" />
              Last cloud sync: {lastSyncedAtIso ? formatTimestamp(lastSyncedAtIso) : 'Live'}
            </span>
            <button
              type="button"
              disabled={!isOnline || isSyncing || syncQueue.length === 0}
              onClick={() => triggerSync(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-semibold disabled:opacity-45 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync Queue Now'}
            </button>
          </div>

          {/* Queue Items List */}
          <div className="border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-stone-50 dark:bg-stone-800/50 border-b border-stone-200 dark:border-stone-800 font-semibold">
              Pending Synchronization Queue ({syncQueue.length})
            </div>
            {syncQueue.length === 0 ? (
              <div className="p-6 text-center space-y-1.5">
                <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
                <p className="font-semibold text-stone-800 dark:text-stone-200">
                  All POS records are synchronized with Firebase
                </p>
                <p className="text-stone-500">
                  Menu catalog, tables, recipes, and settings are cached locally in IndexedDB for instant offline billing.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-stone-100 dark:divide-stone-800 max-h-64 overflow-y-auto">
                {syncQueue.map((item) => (
                  <div key={item.id} className="p-3.5 flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-semibold text-stone-900 dark:text-stone-100 truncate">
                        {item.summary}
                      </p>
                      <p className="text-[11px] text-stone-500 font-mono-num">
                        {item.type} · {item.status} · {formatTimestamp(item.createdAtIso)}
                      </p>
                      {item.lastError && (
                        <p className="text-[11px] text-red-600 flex items-center gap-1 pt-0.5">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span>{item.lastError}</span>
                        </p>
                      )}
                    </div>
                    {item.status === 'FAILED' && (
                      <button
                        type="button"
                        onClick={() => discardSyncQueueItem(item.id)}
                        title="Discard failed entry"
                        className="p-1.5 text-stone-400 hover:text-red-600 shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
