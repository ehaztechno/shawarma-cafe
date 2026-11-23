import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  deleteLocalOfflineOrder,
  enqueueSyncOperation,
  getAllSyncQueueItems,
  getIdMapping,
  getLocalOfflineOrder,
  getNextOfflineSequence,
  removeSyncQueueItem,
  saveIdMapping,
  saveLocalOfflineOrder,
  SyncQueueItem,
  updateSyncQueueItem,
} from './offlineDb';
import {
  cancelOrderWithReason,
  CreateOrderInput,
  createOrderTransaction,
  recordOrderPayments,
  recordPurchase,
  recordStockAdjustment,
  saveExpenseEntry,
  updateOrderStatus,
} from './posService';
import {
  ExpensePaymentMethod,
  Ingredient,
  IngredientUnit,
  Order,
  OrderItem,
  OrderStatus,
  PaymentStatus,
  RecipeItem,
  RestaurantTable,
  SplitPaymentEntry,
  StockMovementType,
  TableStatus,
} from '../types/pos';

export function isOfflineOrderId(id: string): boolean {
  return id.startsWith('offline_ord_');
}

export function isLikelyNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // Never swallow explicit Firestore security rule denials
  if (msg.includes('missing or insufficient permissions') || msg.includes('permission-denied')) {
    return false;
  }
  return (
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('deadline-exceeded') ||
    msg.includes('aborted') ||
    msg.includes('timeout')
  );
}

// Compute offline order record & items locally using the exact same pricing math
function buildLocalProvisionalOrder(input: CreateOrderInput): {
  tempOrderId: string;
  provisionalOrderNumber: string;
  order: Order;
  items: OrderItem[];
} {
  const productMap = new Map(input.catalogProducts.map((p) => [p.id, p]));
  const variantMap = new Map(input.catalogVariants.map((v) => [v.id, v]));
  const addonMap = new Map(input.catalogAddons.map((a) => [a.id, a]));

  const tempOrderId = `offline_ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const prefix = input.settings.orderPrefix || 'SC';
  const seqNum = getNextOfflineSequence();
  const provisionalOrderNumber = `${prefix}-OFF-${seqNum}`;
  const now = new Date();

  let subtotal = 0;
  let itemDiscountTotal = 0;

  const items: OrderItem[] = input.cartItems.map((item, index) => {
    const product = productMap.get(item.productId);
    const variant = item.variantId ? variantMap.get(item.variantId) : undefined;
    const verifiedUnitPrice = variant ? variant.price : product ? product.basePrice : item.unitPrice;
    const verifiedAddons = item.addons.map((a) => {
      const catAddon = addonMap.get(a.addonId);
      return {
        addonId: a.addonId,
        addonName: catAddon ? catAddon.name : a.addonName,
        price: catAddon ? catAddon.price : a.price,
      };
    });
    const addonsTotal = verifiedAddons.reduce((sum, a) => sum + a.price, 0);
    const qty = Math.max(1, Math.min(500, Math.round(item.quantity)));
    const discount = Math.max(
      0,
      Math.min(item.itemDiscountAmount, (verifiedUnitPrice + addonsTotal) * qty)
    );
    const lineTotal = Number(Math.max(0, (verifiedUnitPrice + addonsTotal) * qty - discount).toFixed(2));

    subtotal += (verifiedUnitPrice + addonsTotal) * qty;
    itemDiscountTotal += discount;

    return {
      id: `offline_oi_${Date.now()}_${index}`,
      orderId: tempOrderId,
      productId: item.productId,
      productName: product ? product.name : item.productName,
      categoryId: product ? product.categoryId : item.categoryId,
      categoryName: product ? product.categoryName : item.categoryName,
      variantId: item.variantId || '',
      variantName: item.variantName || '',
      unitPrice: verifiedUnitPrice,
      quantity: qty,
      itemDiscountAmount: discount,
      addonsSummary: verifiedAddons.map((a) => a.addonName).join(', '),
      addonsTotal,
      specialInstructions: item.specialInstructions.trim(),
      lineTotal,
      createdByUid: input.actorUid,
      createdAt: now,
    };
  });

  const afterItemDiscount = Math.max(0, subtotal - itemDiscountTotal);
  const clampedCartDiscountPct = Math.max(0, Math.min(100, input.cartDiscountPercent));
  const cartDiscountAmount = Number(((afterItemDiscount * clampedCartDiscountPct) / 100).toFixed(2));
  const taxableBase = Math.max(0, afterItemDiscount - cartDiscountAmount);
  const taxRate = Math.max(0, input.settings.taxRate);
  const serviceRate = input.orderType === 'DINE_IN' ? Math.max(0, input.settings.serviceChargeRate) : 0;
  const taxAmount = Number(((taxableBase * taxRate) / 100).toFixed(2));
  const serviceChargeAmount = Number(((taxableBase * serviceRate) / 100).toFixed(2));
  const deliveryCharge = input.orderType === 'DELIVERY' ? Math.max(0, input.deliveryCharge) : 0;
  const grandTotal = Number(
    (taxableBase + taxAmount + serviceChargeAmount + deliveryCharge).toFixed(2)
  );

  const validPayments = input.payLater
    ? []
    : input.payments.filter((p) => Number.isFinite(p.amount) && p.amount > 0);
  const paidAmount = Number(validPayments.reduce((s, p) => s + p.amount, 0).toFixed(2));

  let paymentStatus: PaymentStatus = 'PENDING';
  if (paidAmount >= grandTotal && grandTotal > 0) {
    paymentStatus = 'PAID';
  } else if (paidAmount > 0 && paidAmount < grandTotal) {
    paymentStatus = 'PARTIAL';
  } else if (grandTotal === 0 && !input.payLater) {
    paymentStatus = 'PAID';
  }

  const paymentMethodsSummary =
    validPayments.length > 0
      ? Array.from(new Set(validPayments.map((p) => p.method))).join(' + ')
      : 'PENDING';

  const order: Order = {
    id: tempOrderId,
    orderNumber: provisionalOrderNumber,
    orderType: input.orderType,
    status: 'NEW',
    paymentStatus,
    tableId: input.table ? input.table.id : '',
    tableName: input.table ? input.table.name : '',
    customerId: input.customerId || '',
    customerName:
      input.customerName.trim() || (input.orderType === 'DINE_IN' ? 'Dine-In Guest' : 'Walk-In Guest'),
    customerPhone: input.customerPhone.trim(),
    deliveryAddress: input.deliveryAddress.trim(),
    deliveryCharge,
    subtotal: Number(subtotal.toFixed(2)),
    itemDiscountTotal: Number(itemDiscountTotal.toFixed(2)),
    cartDiscountPercent: clampedCartDiscountPct,
    cartDiscountAmount,
    taxRate,
    taxAmount,
    serviceChargeAmount,
    grandTotal,
    paidAmount,
    paymentMethodsSummary,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    itemsPreview: items.map((i) => `${i.quantity}x ${i.productName}`).join(', ').slice(0, 390),
    notes: input.notes.trim(),
    cancelReason: '',
    inventoryDeducted: false,
    createdByUid: input.actorUid,
    createdByName: input.actorName,
    staffUids: Array.from(new Set([input.actorUid, ...input.staffUids])).slice(0, 20),
    createdAt: now,
    updatedAt: now,
  };

  return { tempOrderId, provisionalOrderNumber, order, items };
}

export async function submitOrderOfflineAware(input: CreateOrderInput): Promise<{
  orderId: string;
  orderNumber: string;
  queuedOffline: boolean;
  offlineOrder?: Order;
}> {
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      const res = await createOrderTransaction(input);
      return { ...res, queuedOffline: false };
    } catch (err) {
      if (!isLikelyNetworkError(err)) {
        throw err;
      }
      // Intermittent connection drop -> fall through to IndexedDB queueing
    }
  }

  const { tempOrderId, provisionalOrderNumber, order, items } = buildLocalProvisionalOrder(input);
  await saveLocalOfflineOrder({
    id: tempOrderId,
    order,
    items,
    updatedAtMs: Date.now(),
  });

  await enqueueSyncOperation({
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'CREATE_ORDER',
    summary: `Order ${provisionalOrderNumber} (${input.orderType}) · ${input.settings.currencySymbol}${order.grandTotal}`,
    payload: {
      tempOrderId,
      provisionalOrderNumber,
      input,
    },
  });

  return {
    orderId: tempOrderId,
    orderNumber: provisionalOrderNumber,
    queuedOffline: true,
    offlineOrder: order,
  };
}

export async function recordPaymentOfflineAware(params: {
  order: Order;
  payments: SplitPaymentEntry[];
  actorUid: string;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
  autoDeductInventory: boolean;
  recipeItems: RecipeItem[];
}): Promise<{ queuedOffline: boolean }> {
  const isOfflineTarget = isOfflineOrderId(params.order.id);
  if (!isOfflineTarget && typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await recordOrderPayments(params);
      return { queuedOffline: false };
    } catch (err) {
      if (!isLikelyNetworkError(err)) throw err;
    }
  }

  const validPayments = params.payments.filter((p) => p.amount > 0);
  const addedPaid = validPayments.reduce((s, p) => s + p.amount, 0);

  if (isOfflineTarget) {
    const existing = await getLocalOfflineOrder(params.order.id);
    if (existing) {
      const newPaid = Number((existing.order.paidAmount + addedPaid).toFixed(2));
      const newPayStatus: PaymentStatus =
        newPaid >= existing.order.grandTotal ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'PENDING';
      const prevMethods =
        existing.order.paymentMethodsSummary && existing.order.paymentMethodsSummary !== 'PENDING'
          ? existing.order.paymentMethodsSummary.split(' + ')
          : [];
      const combinedMethods = Array.from(
        new Set([...prevMethods, ...validPayments.map((p) => p.method)])
      ).join(' + ');

      existing.order = {
        ...existing.order,
        paidAmount: newPaid,
        paymentStatus: newPayStatus,
        paymentMethodsSummary: combinedMethods,
        updatedAt: new Date(),
      };
      existing.updatedAtMs = Date.now();
      await saveLocalOfflineOrder(existing);
    }
  }

  await enqueueSyncOperation({
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'RECORD_PAYMENT',
    summary: `Payment ${addedPaid} for ${params.order.orderNumber}`,
    payload: {
      orderId: params.order.id,
      orderSnapshot: params.order,
      payments: params.payments,
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      staffUids: params.staffUids,
      autoDeductInventory: params.autoDeductInventory,
      recipeItems: params.recipeItems,
    },
  });

  return { queuedOffline: true };
}

export async function updateOrderStatusOfflineAware(params: {
  order: Order;
  nextStatus: OrderStatus;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}): Promise<{ queuedOffline: boolean }> {
  const isOfflineTarget = isOfflineOrderId(params.order.id);
  if (!isOfflineTarget && typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await updateOrderStatus(params);
      return { queuedOffline: false };
    } catch (err) {
      if (!isLikelyNetworkError(err)) throw err;
    }
  }

  if (isOfflineTarget) {
    const existing = await getLocalOfflineOrder(params.order.id);
    if (existing) {
      existing.order = {
        ...existing.order,
        status: params.nextStatus,
        updatedAt: new Date(),
      };
      existing.updatedAtMs = Date.now();
      await saveLocalOfflineOrder(existing);
    }
  }

  await enqueueSyncOperation({
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'UPDATE_ORDER_STATUS',
    summary: `KOT ${params.order.orderNumber} -> ${params.nextStatus}`,
    payload: {
      orderId: params.order.id,
      orderSnapshot: params.order,
      nextStatus: params.nextStatus,
      actorUid: params.actorUid,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      staffUids: params.staffUids,
    },
  });

  return { queuedOffline: true };
}

export async function cancelOrderOfflineAware(params: {
  order: Order;
  reason: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}): Promise<{ queuedOffline: boolean }> {
  const isOfflineTarget = isOfflineOrderId(params.order.id);
  if (!isOfflineTarget && typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await cancelOrderWithReason(params);
      return { queuedOffline: false };
    } catch (err) {
      if (!isLikelyNetworkError(err)) throw err;
    }
  }

  if (isOfflineTarget) {
    const existing = await getLocalOfflineOrder(params.order.id);
    if (existing) {
      existing.order = {
        ...existing.order,
        status: 'CANCELLED',
        cancelReason: params.reason.trim(),
        updatedAt: new Date(),
      };
      existing.updatedAtMs = Date.now();
      await saveLocalOfflineOrder(existing);
    }
  }

  await enqueueSyncOperation({
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'CANCEL_ORDER',
    summary: `Cancel ${params.order.orderNumber}: ${params.reason.trim()}`,
    payload: {
      orderId: params.order.id,
      orderSnapshot: params.order,
      reason: params.reason.trim(),
      actorUid: params.actorUid,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      staffUids: params.staffUids,
    },
  });

  return { queuedOffline: true };
}

export async function adjustStockOfflineAware(params: {
  ingredient: Ingredient;
  type: StockMovementType;
  quantityDelta: number;
  notes: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}): Promise<{ queuedOffline: boolean }> {
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await recordStockAdjustment(params);
      return { queuedOffline: false };
    } catch (err) {
      if (!isLikelyNetworkError(err)) throw err;
    }
  }

  await enqueueSyncOperation({
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'STOCK_ADJUSTMENT',
    summary: `Stock ${params.type}: ${params.ingredient.name} (${params.quantityDelta > 0 ? '+' : ''}${params.quantityDelta} ${params.ingredient.unit})`,
    payload: params,
  });

  return { queuedOffline: true };
}

export async function recordPurchaseOfflineAware(params: {
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  paymentStatus: 'PAID' | 'PENDING';
  purchaseDate: string;
  notes: string;
  items: {
    ingredientId: string;
    ingredientName: string;
    unit: IngredientUnit;
    quantity: number;
    unitCost: number;
  }[];
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}): Promise<{ queuedOffline: boolean }> {
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await recordPurchase(params);
      return { queuedOffline: false };
    } catch (err) {
      if (!isLikelyNetworkError(err)) throw err;
    }
  }

  await enqueueSyncOperation({
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'RECORD_PURCHASE',
    summary: `Purchase ${params.invoiceNumber || 'Stock'} (${params.supplierName})`,
    payload: params,
  });

  return { queuedOffline: true };
}

export async function saveExpenseOfflineAware(params: {
  categoryId: string;
  categoryName: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  expenseDate: string;
  notes: string;
  actorUid: string;
  actorName: string;
  staffUids: string[];
}): Promise<{ queuedOffline: boolean }> {
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await saveExpenseEntry(params);
      return { queuedOffline: false };
    } catch (err) {
      if (!isLikelyNetworkError(err)) throw err;
    }
  }

  await enqueueSyncOperation({
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'SAVE_EXPENSE',
    summary: `Expense ${params.categoryName} (${params.amount})`,
    payload: params,
  });

  return { queuedOffline: true };
}

export async function setTableStatusOfflineAware(params: {
  table: RestaurantTable;
  status: TableStatus;
}): Promise<{ queuedOffline: boolean }> {
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await updateDoc(doc(db, 'tables', params.table.id), {
        status: params.status,
        currentOrderId: params.status === 'AVAILABLE' ? '' : params.table.currentOrderId,
        currentOrderNumber: params.status === 'AVAILABLE' ? '' : params.table.currentOrderNumber,
        updatedAt: serverTimestamp(),
      });
      return { queuedOffline: false };
    } catch (err) {
      if (!isLikelyNetworkError(err)) {
        handleFirestoreError(err, OperationType.UPDATE, `tables/${params.table.id}`);
      }
    }
  }

  await enqueueSyncOperation({
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'TABLE_STATUS',
    summary: `${params.table.name} -> ${params.status}`,
    payload: {
      tableId: params.table.id,
      status: params.status,
      currentOrderId: params.status === 'AVAILABLE' ? '' : params.table.currentOrderId,
      currentOrderNumber: params.status === 'AVAILABLE' ? '' : params.table.currentOrderNumber,
    },
  });

  return { queuedOffline: true };
}

// --- Synchronization Runner ---

let syncInFlight = false;

async function resolveRealOrder(
  orderId: string,
  fallbackOrder: Order
): Promise<{ resolvedId: string; orderForCall: Order }> {
  if (!isOfflineOrderId(orderId)) {
    return { resolvedId: orderId, orderForCall: fallbackOrder };
  }
  const mapping = await getIdMapping(orderId);
  if (!mapping) {
    throw new Error(`Parent offline order ${fallbackOrder.orderNumber} is not yet synced.`);
  }
  return {
    resolvedId: mapping.realOrderId,
    orderForCall: {
      ...fallbackOrder,
      id: mapping.realOrderId,
      orderNumber: mapping.realOrderNumber,
    },
  };
}

async function replayQueueItem(item: SyncQueueItem): Promise<void> {
  const p = item.payload;

  switch (item.type) {
    case 'CREATE_ORDER': {
      const res = await createOrderTransaction(p.input as CreateOrderInput);
      await saveIdMapping({
        tempId: p.tempOrderId,
        realOrderId: res.orderId,
        realOrderNumber: res.orderNumber,
        syncedAtIso: new Date().toISOString(),
      });
      await deleteLocalOfflineOrder(p.tempOrderId);
      return;
    }

    case 'RECORD_PAYMENT': {
      const { orderForCall } = await resolveRealOrder(p.orderId, p.orderSnapshot);
      await recordOrderPayments({
        order: orderForCall,
        payments: p.payments,
        actorUid: p.actorUid,
        actorName: p.actorName,
        actorEmail: p.actorEmail,
        actorRole: p.actorRole,
        staffUids: p.staffUids,
        autoDeductInventory: p.autoDeductInventory,
        recipeItems: p.recipeItems,
      });
      return;
    }

    case 'UPDATE_ORDER_STATUS': {
      const { orderForCall } = await resolveRealOrder(p.orderId, p.orderSnapshot);
      await updateOrderStatus({
        order: orderForCall,
        nextStatus: p.nextStatus,
        actorUid: p.actorUid,
        actorEmail: p.actorEmail,
        actorRole: p.actorRole,
        staffUids: p.staffUids,
      });
      return;
    }

    case 'CANCEL_ORDER': {
      const { orderForCall } = await resolveRealOrder(p.orderId, p.orderSnapshot);
      await cancelOrderWithReason({
        order: orderForCall,
        reason: p.reason,
        actorUid: p.actorUid,
        actorEmail: p.actorEmail,
        actorRole: p.actorRole,
        staffUids: p.staffUids,
      });
      return;
    }

    case 'STOCK_ADJUSTMENT': {
      await recordStockAdjustment(p as any);
      return;
    }

    case 'RECORD_PURCHASE': {
      await recordPurchase(p as any);
      return;
    }

    case 'SAVE_EXPENSE': {
      await saveExpenseEntry(p as any);
      return;
    }

    case 'TABLE_STATUS': {
      await updateDoc(doc(db, 'tables', p.tableId), {
        status: p.status,
        currentOrderId: p.currentOrderId,
        currentOrderNumber: p.currentOrderNumber,
        updatedAt: serverTimestamp(),
      });
      return;
    }
  }
}

export async function flushSyncQueue(options?: {
  includeFailed?: boolean;
  onProgress?: () => void;
}): Promise<{ syncedCount: number; failedCount: number; remainingCount: number }> {
  if (syncInFlight) {
    const items = await getAllSyncQueueItems();
    return { syncedCount: 0, failedCount: 0, remainingCount: items.length };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const items = await getAllSyncQueueItems();
    return { syncedCount: 0, failedCount: 0, remainingCount: items.length };
  }

  syncInFlight = true;
  let syncedCount = 0;
  let failedCount = 0;

  try {
    const items = await getAllSyncQueueItems();
    for (const item of items) {
      if (item.status === 'FAILED' && !options?.includeFailed) {
        continue;
      }

      try {
        await updateSyncQueueItem({ ...item, status: 'SYNCING', attempts: item.attempts + 1 });
        options?.onProgress?.();

        await replayQueueItem(item);
        await removeSyncQueueItem(item.id);
        syncedCount += 1;
        options?.onProgress?.();
      } catch (err: any) {
        if (isLikelyNetworkError(err)) {
          // Connection dropped again mid-sync; revert to PENDING and stop loop cleanly
          await updateSyncQueueItem({
            ...item,
            status: 'PENDING',
            lastError: 'Waiting for internet connection...',
          });
          options?.onProgress?.();
          break;
        }
        failedCount += 1;
        await updateSyncQueueItem({
          ...item,
          status: 'FAILED',
          lastError: err?.message || String(err),
        });
        options?.onProgress?.();
      }
    }

    const remaining = await getAllSyncQueueItems();
    return { syncedCount, failedCount, remainingCount: remaining.length };
  } finally {
    syncInFlight = false;
  }
}
