import {
  Addon,
  AddonGroup,
  Category,
  Customer,
  Expense,
  ExpenseCategory,
  Ingredient,
  Order,
  OrderItem,
  Payment,
  Product,
  ProductVariant,
  Purchase,
  Recipe,
  RecipeItem,
  RestaurantSettings,
  RestaurantTable,
  StockMovement,
  Supplier,
  UserProfile,
} from '../types/pos';

const DB_NAME = 'sc_pos_offline_db';
const DB_VERSION = 1;

const STORE_SNAPSHOTS = 'catalog_snapshots';
const STORE_LOCAL_ORDERS = 'local_orders';
const STORE_SYNC_QUEUE = 'sync_queue';
const STORE_ID_MAPPINGS = 'id_mappings';

export type SyncOperationType =
  | 'CREATE_ORDER'
  | 'RECORD_PAYMENT'
  | 'UPDATE_ORDER_STATUS'
  | 'CANCEL_ORDER'
  | 'STOCK_ADJUSTMENT'
  | 'RECORD_PURCHASE'
  | 'SAVE_EXPENSE'
  | 'TABLE_STATUS';

export type SyncItemStatus = 'PENDING' | 'SYNCING' | 'FAILED';

export interface SyncQueueItem {
  id: string;
  seq: number;
  type: SyncOperationType;
  summary: string;
  payload: Record<string, any>;
  status: SyncItemStatus;
  attempts: number;
  lastError: string;
  createdAtIso: string;
}

export interface LocalOfflineOrderRecord {
  id: string; // e.g., offline_ord_...
  order: Order;
  items: OrderItem[];
  updatedAtMs: number;
}

export interface OfflineCatalogSnapshot {
  key: string; // 'active_pos_snapshot'
  uid: string;
  profile: UserProfile | null;
  settings: RestaurantSettings;
  categories: Category[];
  products: Product[];
  variants: ProductVariant[];
  addonGroups: AddonGroup[];
  addons: Addon[];
  tables: RestaurantTable[];
  orders: Order[];
  payments: Payment[];
  customers: Customer[];
  ingredients: Ingredient[];
  recipes: Recipe[];
  recipeItems: RecipeItem[];
  stockMovements: StockMovement[];
  suppliers: Supplier[];
  purchases: Purchase[];
  expenseCategories: ExpenseCategory[];
  expenses: Expense[];
  lastCachedAtIso: string;
}

export interface IdMappingRecord {
  tempId: string;
  realOrderId: string;
  realOrderNumber: string;
  syncedAtIso: string;
}

// Convert Firestore Timestamps & Dates into plain IndexedDB-safe values
function serializeForIdb(val: any): any {
  if (val === null || val === undefined) return val;
  if (val instanceof Date) {
    return { __idbDateMs: val.getTime() };
  }
  if (typeof val === 'object' && typeof val.toMillis === 'function') {
    return { __idbDateMs: val.toMillis() };
  }
  if (Array.isArray(val)) {
    return val.map(serializeForIdb);
  }
  if (typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = serializeForIdb(v);
    }
    return out;
  }
  return val;
}

function hydrateFromIdb(val: any): any {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map(hydrateFromIdb);
  }
  if (typeof val === 'object') {
    if (typeof val.__idbDateMs === 'number' && Object.keys(val).length === 1) {
      return new Date(val.__idbDateMs);
    }
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = hydrateFromIdb(v);
    }
    return out;
  }
  return val;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openOfflineDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable in this environment.'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_LOCAL_ORDERS)) {
        db.createObjectStore(STORE_LOCAL_ORDERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
        const store = db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: 'id' });
        store.createIndex('by_seq', 'seq', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ID_MAPPINGS)) {
        db.createObjectStore(STORE_ID_MAPPINGS, { keyPath: 'tempId' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error('Failed to open IndexedDB'));
    };
  });

  return dbPromise;
}

async function runTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = executor(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- Catalog Snapshot Cache ---

export async function saveCatalogSnapshot(snapshot: OfflineCatalogSnapshot): Promise<void> {
  try {
    const clean = serializeForIdb(snapshot);
    await runTx(STORE_SNAPSHOTS, 'readwrite', (store) => store.put(clean));
  } catch (err) {
    console.warn('IndexedDB snapshot write failed:', err);
  }
}

export async function loadCatalogSnapshot(uid: string): Promise<OfflineCatalogSnapshot | null> {
  try {
    const raw = await runTx<any>(STORE_SNAPSHOTS, 'readonly', (store) =>
      store.get(`pos_snapshot_${uid}`)
    );
    if (!raw) return null;
    return hydrateFromIdb(raw) as OfflineCatalogSnapshot;
  } catch {
    return null;
  }
}

// --- Local Provisional Orders (created offline) ---

export async function saveLocalOfflineOrder(record: LocalOfflineOrderRecord): Promise<void> {
  const clean = serializeForIdb(record);
  await runTx(STORE_LOCAL_ORDERS, 'readwrite', (store) => store.put(clean));
}

export async function getLocalOfflineOrder(id: string): Promise<LocalOfflineOrderRecord | null> {
  try {
    const raw = await runTx<any>(STORE_LOCAL_ORDERS, 'readonly', (store) => store.get(id));
    return raw ? (hydrateFromIdb(raw) as LocalOfflineOrderRecord) : null;
  } catch {
    return null;
  }
}

export async function getAllLocalOfflineOrders(): Promise<LocalOfflineOrderRecord[]> {
  try {
    const rawList = await runTx<any[]>(STORE_LOCAL_ORDERS, 'readonly', (store) => store.getAll());
    return (rawList || [])
      .map((r) => hydrateFromIdb(r) as LocalOfflineOrderRecord)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  } catch {
    return [];
  }
}

export async function deleteLocalOfflineOrder(id: string): Promise<void> {
  await runTx(STORE_LOCAL_ORDERS, 'readwrite', (store) => store.delete(id));
}

// --- FIFO Sync Queue ---

export async function enqueueSyncOperation(
  item: Omit<SyncQueueItem, 'seq' | 'status' | 'attempts' | 'lastError' | 'createdAtIso'>
): Promise<SyncQueueItem> {
  const entry: SyncQueueItem = {
    ...item,
    seq: Date.now() + Math.random() * 0.001,
    status: 'PENDING',
    attempts: 0,
    lastError: '',
    createdAtIso: new Date().toISOString(),
  };
  const clean = serializeForIdb(entry);
  await runTx(STORE_SYNC_QUEUE, 'readwrite', (store) => store.put(clean));
  return entry;
}

export async function getAllSyncQueueItems(): Promise<SyncQueueItem[]> {
  try {
    const raw = await runTx<any[]>(STORE_SYNC_QUEUE, 'readonly', (store) => store.getAll());
    return (raw || [])
      .map((item) => hydrateFromIdb(item) as SyncQueueItem)
      .sort((a, b) => a.seq - b.seq);
  } catch {
    return [];
  }
}

export async function updateSyncQueueItem(item: SyncQueueItem): Promise<void> {
  const clean = serializeForIdb(item);
  await runTx(STORE_SYNC_QUEUE, 'readwrite', (store) => store.put(clean));
}

export async function removeSyncQueueItem(id: string): Promise<void> {
  await runTx(STORE_SYNC_QUEUE, 'readwrite', (store) => store.delete(id));
}

// --- Temp -> Real Firestore Order ID Mapping ---

export async function saveIdMapping(mapping: IdMappingRecord): Promise<void> {
  await runTx(STORE_ID_MAPPINGS, 'readwrite', (store) => store.put(mapping));
}

export async function getIdMapping(tempId: string): Promise<IdMappingRecord | null> {
  try {
    const raw = await runTx<IdMappingRecord | undefined>(STORE_ID_MAPPINGS, 'readonly', (store) =>
      store.get(tempId)
    );
    return raw || null;
  } catch {
    return null;
  }
}

export function getNextOfflineSequence(): number {
  try {
    const key = 'sc_offline_order_seq';
    const curr = Number(localStorage.getItem(key) || '100');
    const next = curr + 1;
    localStorage.setItem(key, String(next));
    return next;
  } catch {
    return Math.floor((Date.now() % 100000) / 10);
  }
}
