import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  CartItem,
  Customer,
  ExpensePaymentMethod,
  Ingredient,
  IngredientUnit,
  Order,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductVariant,
  RecipeItem,
  RestaurantSettings,
  RestaurantTable,
  SplitPaymentEntry,
  StaffRole,
  StockMovementType,
  TableStatus,
} from '../types/pos';

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

export interface CreateOrderInput {
  orderType: OrderType;
  table: RestaurantTable | null;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryCharge: number;
  cartItems: CartItem[];
  cartDiscountPercent: number;
  notes: string;
  payments: SplitPaymentEntry[];
  payLater: boolean;
  actorUid: string;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
  catalogProducts: Product[];
  catalogVariants: ProductVariant[];
  catalogAddons: { id: string; name: string; price: number }[];
  recipeItems: RecipeItem[];
  settings: RestaurantSettings;
}

export async function createOrderTransaction(input: CreateOrderInput): Promise<{
  orderId: string;
  orderNumber: string;
}> {
  if (input.cartItems.length === 0) {
    throw new Error('Cannot place an order with an empty cart.');
  }

  const productMap = new Map(input.catalogProducts.map((p) => [p.id, p]));
  const variantMap = new Map(input.catalogVariants.map((v) => [v.id, v]));
  const addonMap = new Map(input.catalogAddons.map((a) => [a.id, a]));

  // Server-authoritative recalculation against catalog prices
  let subtotal = 0;
  let itemDiscountTotal = 0;
  const computedItems = input.cartItems.map((item) => {
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
    const discount = Math.max(0, Math.min(item.itemDiscountAmount, (verifiedUnitPrice + addonsTotal) * qty));
    const lineTotal = Math.max(0, (verifiedUnitPrice + addonsTotal) * qty - discount);

    subtotal += (verifiedUnitPrice + addonsTotal) * qty;
    itemDiscountTotal += discount;

    return {
      ...item,
      productName: product ? product.name : item.productName,
      categoryId: product ? product.categoryId : item.categoryId,
      categoryName: product ? product.categoryName : item.categoryName,
      unitPrice: verifiedUnitPrice,
      quantity: qty,
      itemDiscountAmount: discount,
      addons: verifiedAddons,
      addonsTotal,
      addonsSummary: verifiedAddons.map((a) => a.addonName).join(', '),
      lineTotal,
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
  const grandTotal = Number((taxableBase + taxAmount + serviceChargeAmount + deliveryCharge).toFixed(2));

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

  const shouldDeductInventory =
    input.settings.autoDeductInventory && paymentStatus === 'PAID';

  // Aggregate required ingredient deductions if deducting now
  const ingredientDeductions = new Map<string, number>();
  if (shouldDeductInventory) {
    for (const item of computedItems) {
      const productRecipes = input.recipeItems.filter((r) => r.productId === item.productId);
      for (const r of productRecipes) {
        const prev = ingredientDeductions.get(r.ingredientId) ?? 0;
        ingredientDeductions.set(r.ingredientId, prev + r.quantityRequired * item.quantity);
      }
    }
  }

  const orderId = genId('ord');
  const staffUids = Array.from(new Set([input.actorUid, ...input.staffUids])).slice(0, 20);
  const itemsPreview = computedItems
    .map((i) => `${i.quantity}x ${i.productName}`)
    .join(', ')
    .slice(0, 390);
  const totalQty = computedItems.reduce((s, i) => s + i.quantity, 0);

  // If customer phone provided and no customerId, see if customer already exists
  let resolvedCustomerId = input.customerId;
  if (!resolvedCustomerId && input.customerPhone.trim().length >= 5) {
    try {
      const q = query(
        collection(db, 'customers'),
        where('phone', '==', input.customerPhone.trim())
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        resolvedCustomerId = snap.docs[0].id;
      }
    } catch {
      // Fallback: create new customer ID inside transaction
    }
  }
  const shouldWriteCustomer = Boolean(input.customerPhone.trim().length >= 5);
  if (shouldWriteCustomer && !resolvedCustomerId) {
    resolvedCustomerId = genId('cust');
  }

  let generatedOrderNumber = '';

  try {
    await runTransaction(db, async (tx) => {
      // 1. Read settings doc for atomic sequential order number
      const settingsRef = doc(db, 'restaurant_settings', 'default');
      const settingsSnap = await tx.get(settingsRef);
      const currentSettings = settingsSnap.exists()
        ? (settingsSnap.data() as RestaurantSettings)
        : input.settings;
      const nextNum = currentSettings.nextOrderNumber || 1001;
      const prefix = currentSettings.orderPrefix || 'SC';
      generatedOrderNumber = `${prefix}-${nextNum}`;

      // 2. Read ingredients to deduct
      const ingredientSnapshots: { id: string; data: Ingredient; deduct: number }[] = [];
      for (const [ingId, deductQty] of ingredientDeductions.entries()) {
        const ingSnap = await tx.get(doc(db, 'ingredients', ingId));
        if (ingSnap.exists()) {
          ingredientSnapshots.push({
            id: ingId,
            data: ingSnap.data() as Ingredient,
            deduct: deductQty,
          });
        }
      }

      // 3. Read customer if updating
      let existingCustomer: Customer | null = null;
      if (shouldWriteCustomer && resolvedCustomerId) {
        const custSnap = await tx.get(doc(db, 'customers', resolvedCustomerId));
        if (custSnap.exists()) {
          existingCustomer = custSnap.data() as Customer;
        }
      }

      // 4. Read table if Dine-In
      let existingTable: RestaurantTable | null = null;
      if (input.orderType === 'DINE_IN' && input.table) {
        const tblSnap = await tx.get(doc(db, 'tables', input.table.id));
        if (tblSnap.exists()) {
          existingTable = tblSnap.data() as RestaurantTable;
        }
      }

      // --- WRITES ---
      tx.update(settingsRef, {
        nextOrderNumber: nextNum + 1,
        updatedAt: serverTimestamp(),
      });

      const orderRef = doc(db, 'orders', orderId);
      tx.set(orderRef, {
        orderNumber: generatedOrderNumber,
        orderType: input.orderType,
        status: 'NEW' as OrderStatus,
        paymentStatus,
        tableId: input.table ? input.table.id : '',
        tableName: input.table ? input.table.name : '',
        customerId: resolvedCustomerId || '',
        customerName: input.customerName.trim() || (input.orderType === 'DINE_IN' ? 'Dine-In Guest' : 'Walk-In Guest'),
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
        itemCount: totalQty,
        itemsPreview,
        notes: input.notes.trim(),
        cancelReason: '',
        inventoryDeducted: shouldDeductInventory,
        createdByUid: input.actorUid,
        createdByName: input.actorName,
        staffUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (const item of computedItems) {
        const itemId = genId('oi');
        tx.set(doc(db, 'orders', orderId, 'items', itemId), {
          orderId,
          productId: item.productId,
          productName: item.productName,
          categoryId: item.categoryId,
          categoryName: item.categoryName,
          variantId: item.variantId || '',
          variantName: item.variantName || '',
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          itemDiscountAmount: item.itemDiscountAmount,
          addonsSummary: item.addonsSummary,
          addonsTotal: item.addonsTotal,
          specialInstructions: item.specialInstructions.trim(),
          lineTotal: Number(item.lineTotal.toFixed(2)),
          createdByUid: input.actorUid,
          createdAt: serverTimestamp(),
        });

        for (const addon of item.addons) {
          const addonEntryId = genId('oia');
          tx.set(doc(db, 'orders', orderId, 'addons', addonEntryId), {
            orderId,
            orderItemId: itemId,
            addonId: addon.addonId,
            addonName: addon.addonName,
            price: addon.price,
            createdByUid: input.actorUid,
            createdAt: serverTimestamp(),
          });
        }
      }

      for (const p of validPayments) {
        const payId = genId('pay');
        tx.set(doc(db, 'payments', payId), {
          orderId,
          orderNumber: generatedOrderNumber,
          method: p.method,
          amount: Number(p.amount.toFixed(2)),
          referenceNumber: p.referenceNumber.trim(),
          status: 'COMPLETED',
          receivedByUid: input.actorUid,
          receivedByName: input.actorName,
          staffUids,
          createdAt: serverTimestamp(),
        });
      }

      if (input.orderType === 'DINE_IN' && input.table && existingTable) {
        tx.update(doc(db, 'tables', input.table.id), {
          status: paymentStatus === 'PAID' ? 'OCCUPIED' : 'OCCUPIED',
          currentOrderId: orderId,
          currentOrderNumber: generatedOrderNumber,
          updatedAt: serverTimestamp(),
        });
      }

      if (shouldWriteCustomer && resolvedCustomerId) {
        const custRef = doc(db, 'customers', resolvedCustomerId);
        if (existingCustomer) {
          tx.update(custRef, {
            name: input.customerName.trim() || existingCustomer.name,
            address: input.deliveryAddress.trim() || existingCustomer.address,
            totalOrders: existingCustomer.totalOrders + 1,
            totalSpent: Number((existingCustomer.totalSpent + grandTotal).toFixed(2)),
            lastOrderAt: serverTimestamp(),
            staffUids,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(custRef, {
            name: input.customerName.trim() || 'Guest Customer',
            phone: input.customerPhone.trim(),
            address: input.deliveryAddress.trim(),
            totalOrders: 1,
            totalSpent: grandTotal,
            lastOrderAt: serverTimestamp(),
            createdByUid: input.actorUid,
            staffUids,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      for (const ing of ingredientSnapshots) {
        const prev = ing.data.currentStock;
        const nextStock = Number(Math.max(0, prev - ing.deduct).toFixed(2));
        tx.update(doc(db, 'ingredients', ing.id), {
          currentStock: nextStock,
          updatedAt: serverTimestamp(),
        });
        tx.set(doc(db, 'stock_movements', genId('sm')), {
          ingredientId: ing.id,
          ingredientName: ing.data.name,
          type: 'ORDER_DEDUCTION',
          quantityDelta: Number((nextStock - prev).toFixed(2)),
          previousStock: prev,
          newStock: nextStock,
          unit: ing.data.unit,
          referenceId: generatedOrderNumber,
          notes: `Auto deduction for order ${generatedOrderNumber}`,
          createdByUid: input.actorUid,
          staffUids,
          createdAt: serverTimestamp(),
        });
      }

      tx.set(doc(db, 'audit_logs', genId('log')), {
        action: 'ORDER_CREATED',
        entityType: 'order',
        entityId: orderId,
        summary: `Order ${generatedOrderNumber} (${input.orderType}) placed for ${input.settings.currencySymbol}${grandTotal} [${paymentStatus}]`,
        actorUid: input.actorUid,
        actorEmail: input.actorEmail,
        actorRole: input.actorRole,
        staffUids,
        createdAt: serverTimestamp(),
      });
    });

    return { orderId, orderNumber: generatedOrderNumber };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
  }
}

export async function recordOrderPayments(params: {
  order: Order;
  payments: SplitPaymentEntry[];
  actorUid: string;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
  autoDeductInventory: boolean;
  recipeItems: RecipeItem[];
}) {
  const validPayments = params.payments.filter((p) => p.amount > 0);
  if (validPayments.length === 0) {
    throw new Error('Enter a valid payment amount.');
  }
  const addedPaid = validPayments.reduce((s, p) => s + p.amount, 0);

  // Fetch order items before transaction if inventory deduction may be needed
  let orderItems: { productId: string; quantity: number }[] = [];
  if (params.autoDeductInventory && !params.order.inventoryDeducted) {
    const itemsSnap = await getDocs(collection(db, 'orders', params.order.id, 'items'));
    orderItems = itemsSnap.docs.map((d) => ({
      productId: d.data().productId,
      quantity: d.data().quantity,
    }));
  }

  try {
    await runTransaction(db, async (tx) => {
      const orderRef = doc(db, 'orders', params.order.id);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) throw new Error('Order not found.');
      const current = orderSnap.data() as Order;
      if (current.status === 'CANCELLED') throw new Error('Cannot pay for a cancelled order.');

      const newPaid = Number((current.paidAmount + addedPaid).toFixed(2));
      const newPayStatus: PaymentStatus =
        newPaid >= current.grandTotal ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'PENDING';

      const prevMethods =
        current.paymentMethodsSummary && current.paymentMethodsSummary !== 'PENDING'
          ? current.paymentMethodsSummary.split(' + ')
          : [];
      const combinedMethods = Array.from(
        new Set([...prevMethods, ...validPayments.map((p) => p.method)])
      ).join(' + ');

      const shouldDeduct =
        params.autoDeductInventory && !current.inventoryDeducted && newPayStatus === 'PAID';

      const ingredientDeductions = new Map<string, number>();
      if (shouldDeduct) {
        for (const item of orderItems) {
          for (const r of params.recipeItems.filter((ri) => ri.productId === item.productId)) {
            ingredientDeductions.set(
              r.ingredientId,
              (ingredientDeductions.get(r.ingredientId) ?? 0) + r.quantityRequired * item.quantity
            );
          }
        }
      }

      const ingSnaps: { id: string; data: Ingredient; deduct: number }[] = [];
      for (const [ingId, deductQty] of ingredientDeductions.entries()) {
        const snap = await tx.get(doc(db, 'ingredients', ingId));
        if (snap.exists()) {
          ingSnaps.push({ id: ingId, data: snap.data() as Ingredient, deduct: deductQty });
        }
      }

      tx.update(orderRef, {
        paidAmount: newPaid,
        paymentStatus: newPayStatus,
        paymentMethodsSummary: combinedMethods,
        inventoryDeducted: current.inventoryDeducted || shouldDeduct,
        updatedAt: serverTimestamp(),
      });

      const staffUids = Array.from(new Set([params.actorUid, ...params.staffUids])).slice(0, 20);
      for (const p of validPayments) {
        tx.set(doc(db, 'payments', genId('pay')), {
          orderId: params.order.id,
          orderNumber: current.orderNumber,
          method: p.method,
          amount: Number(p.amount.toFixed(2)),
          referenceNumber: p.referenceNumber.trim(),
          status: 'COMPLETED',
          receivedByUid: params.actorUid,
          receivedByName: params.actorName,
          staffUids,
          createdAt: serverTimestamp(),
        });
      }

      for (const ing of ingSnaps) {
        const prev = ing.data.currentStock;
        const nextStock = Number(Math.max(0, prev - ing.deduct).toFixed(2));
        tx.update(doc(db, 'ingredients', ing.id), {
          currentStock: nextStock,
          updatedAt: serverTimestamp(),
        });
        tx.set(doc(db, 'stock_movements', genId('sm')), {
          ingredientId: ing.id,
          ingredientName: ing.data.name,
          type: 'ORDER_DEDUCTION',
          quantityDelta: Number((nextStock - prev).toFixed(2)),
          previousStock: prev,
          newStock: nextStock,
          unit: ing.data.unit,
          referenceId: current.orderNumber,
          notes: `Auto deduction on bill settlement (${current.orderNumber})`,
          createdByUid: params.actorUid,
          staffUids,
          createdAt: serverTimestamp(),
        });
      }

      tx.set(doc(db, 'audit_logs', genId('log')), {
        action: 'PAYMENT_RECORDED',
        entityType: 'order',
        entityId: params.order.id,
        summary: `Recorded payment of ${addedPaid} for ${current.orderNumber} (${combinedMethods})`,
        actorUid: params.actorUid,
        actorEmail: params.actorEmail,
        actorRole: params.actorRole,
        staffUids,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `orders/${params.order.id}`);
  }
}

export async function updateOrderStatus(params: {
  order: Order;
  nextStatus: OrderStatus;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', params.order.id), {
      status: params.nextStatus,
      updatedAt: serverTimestamp(),
    });

    if (
      params.nextStatus === 'COMPLETED' &&
      params.order.orderType === 'DINE_IN' &&
      params.order.tableId
    ) {
      batch.update(doc(db, 'tables', params.order.tableId), {
        status: 'AVAILABLE' as TableStatus,
        currentOrderId: '',
        currentOrderNumber: '',
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'audit_logs', genId('log')), {
      action: 'ORDER_STATUS_UPDATED',
      entityType: 'order',
      entityId: params.order.id,
      summary: `${params.order.orderNumber} moved to ${params.nextStatus}`,
      actorUid: params.actorUid,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      staffUids: Array.from(new Set([params.actorUid, ...params.staffUids])).slice(0, 20),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `orders/${params.order.id}`);
  }
}

export async function cancelOrderWithReason(params: {
  order: Order;
  reason: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}) {
  if (!params.reason.trim()) {
    throw new Error('Cancellation reason is required.');
  }
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', params.order.id), {
      status: 'CANCELLED' as OrderStatus,
      cancelReason: params.reason.trim(),
      updatedAt: serverTimestamp(),
    });

    if (params.order.orderType === 'DINE_IN' && params.order.tableId) {
      batch.update(doc(db, 'tables', params.order.tableId), {
        status: 'AVAILABLE' as TableStatus,
        currentOrderId: '',
        currentOrderNumber: '',
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'audit_logs', genId('log')), {
      action: 'ORDER_CANCELLED',
      entityType: 'order',
      entityId: params.order.id,
      summary: `${params.order.orderNumber} cancelled: ${params.reason.trim()}`,
      actorUid: params.actorUid,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      staffUids: Array.from(new Set([params.actorUid, ...params.staffUids])).slice(0, 20),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `orders/${params.order.id}`);
  }
}

export async function refundOrderPayments(params: {
  order: Order;
  paymentIds: string[];
  reason: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', params.order.id), {
      paymentStatus: 'REFUNDED' as PaymentStatus,
      cancelReason: params.reason.trim() || params.order.cancelReason,
      updatedAt: serverTimestamp(),
    });

    for (const pid of params.paymentIds) {
      batch.update(doc(db, 'payments', pid), {
        status: 'REFUNDED',
      });
    }

    batch.set(doc(db, 'audit_logs', genId('log')), {
      action: 'PAYMENT_REFUNDED',
      entityType: 'order',
      entityId: params.order.id,
      summary: `Refund recorded for ${params.order.orderNumber}: ${params.reason.trim()}`,
      actorUid: params.actorUid,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      staffUids: Array.from(new Set([params.actorUid, ...params.staffUids])).slice(0, 20),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `orders/${params.order.id}`);
  }
}

export async function recordStockAdjustment(params: {
  ingredient: Ingredient;
  type: StockMovementType;
  quantityDelta: number;
  notes: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}) {
  try {
    await runTransaction(db, async (tx) => {
      const ingRef = doc(db, 'ingredients', params.ingredient.id);
      const snap = await tx.get(ingRef);
      if (!snap.exists()) throw new Error('Ingredient not found.');
      const curr = snap.data() as Ingredient;
      const prev = curr.currentStock;
      const nextStock = Number(Math.max(0, prev + params.quantityDelta).toFixed(2));

      tx.update(ingRef, {
        currentStock: nextStock,
        updatedAt: serverTimestamp(),
      });

      const staffUids = Array.from(new Set([params.actorUid, ...params.staffUids])).slice(0, 20);
      tx.set(doc(db, 'stock_movements', genId('sm')), {
        ingredientId: params.ingredient.id,
        ingredientName: curr.name,
        type: params.type,
        quantityDelta: Number((nextStock - prev).toFixed(2)),
        previousStock: prev,
        newStock: nextStock,
        unit: curr.unit,
        referenceId: '',
        notes: params.notes.trim() || `${params.type} entry`,
        createdByUid: params.actorUid,
        staffUids,
        createdAt: serverTimestamp(),
      });

      tx.set(doc(db, 'audit_logs', genId('log')), {
        action: `STOCK_${params.type}`,
        entityType: 'ingredient',
        entityId: params.ingredient.id,
        summary: `${curr.name}: ${prev} -> ${nextStock} ${curr.unit} (${params.notes.trim() || params.type})`,
        actorUid: params.actorUid,
        actorEmail: params.actorEmail,
        actorRole: params.actorRole,
        staffUids,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `ingredients/${params.ingredient.id}`);
  }
}

export async function recordPurchase(params: {
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
}) {
  if (params.items.length === 0) throw new Error('Add at least one ingredient to purchase.');
  const purchaseId = genId('pur');
  const totalAmount = Number(
    params.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0).toFixed(2)
  );
  const staffUids = Array.from(new Set([params.actorUid, ...params.staffUids])).slice(0, 20);

  try {
    await runTransaction(db, async (tx) => {
      const ingMap: { id: string; data: Ingredient; addQty: number; unitCost: number }[] = [];
      for (const item of params.items) {
        const snap = await tx.get(doc(db, 'ingredients', item.ingredientId));
        if (snap.exists()) {
          ingMap.push({
            id: item.ingredientId,
            data: snap.data() as Ingredient,
            addQty: item.quantity,
            unitCost: item.unitCost,
          });
        }
      }

      tx.set(doc(db, 'purchases', purchaseId), {
        supplierId: params.supplierId,
        supplierName: params.supplierName,
        invoiceNumber: params.invoiceNumber.trim() || purchaseId.slice(-6).toUpperCase(),
        totalAmount,
        paymentStatus: params.paymentStatus,
        notes: params.notes.trim(),
        purchaseDate: params.purchaseDate,
        createdByUid: params.actorUid,
        staffUids,
        createdAt: serverTimestamp(),
      });

      for (const item of params.items) {
        tx.set(doc(db, 'purchase_items', genId('pi')), {
          purchaseId,
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          quantity: item.quantity,
          unit: item.unit,
          unitCost: item.unitCost,
          totalCost: Number((item.quantity * item.unitCost).toFixed(2)),
          createdByUid: params.actorUid,
        });
      }

      for (const ing of ingMap) {
        const prev = ing.data.currentStock;
        const nextStock = Number((prev + ing.addQty).toFixed(2));
        tx.update(doc(db, 'ingredients', ing.id), {
          currentStock: nextStock,
          costPerUnit: ing.unitCost > 0 ? ing.unitCost : ing.data.costPerUnit,
          updatedAt: serverTimestamp(),
        });
        tx.set(doc(db, 'stock_movements', genId('sm')), {
          ingredientId: ing.id,
          ingredientName: ing.data.name,
          type: 'PURCHASE',
          quantityDelta: ing.addQty,
          previousStock: prev,
          newStock: nextStock,
          unit: ing.data.unit,
          referenceId: params.invoiceNumber.trim() || purchaseId,
          notes: `Purchase from ${params.supplierName}`,
          createdByUid: params.actorUid,
          staffUids,
          createdAt: serverTimestamp(),
        });
      }

      tx.set(doc(db, 'audit_logs', genId('log')), {
        action: 'PURCHASE_RECORDED',
        entityType: 'purchase',
        entityId: purchaseId,
        summary: `Stock purchase ${params.invoiceNumber || purchaseId} from ${params.supplierName} (${totalAmount})`,
        actorUid: params.actorUid,
        actorEmail: params.actorEmail,
        actorRole: params.actorRole,
        staffUids,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `purchases/${purchaseId}`);
  }
}

export async function saveProductAndVariants(params: {
  productId?: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string;
  basePrice: number;
  imageUrl: string;
  isAvailable: boolean;
  isVeg: boolean;
  taxRate: number;
  availableFrom: string;
  availableTo: string;
  addonGroupIds: string[];
  variants: { id?: string; name: string; price: number; isDefault: boolean }[];
  existingVariantIds: string[];
  uid: string;
}) {
  const productId = params.productId || genId('prod');
  try {
    const batch = writeBatch(db);
    if (params.productId) {
      batch.update(doc(db, 'products', productId), {
        categoryId: params.categoryId,
        categoryName: params.categoryName,
        name: params.name.trim(),
        description: params.description.trim(),
        basePrice: params.basePrice,
        imageUrl: params.imageUrl.trim(),
        isAvailable: params.isAvailable,
        isVeg: params.isVeg,
        taxRate: params.taxRate,
        availableFrom: params.availableFrom || '00:00',
        availableTo: params.availableTo || '23:59',
        addonGroupIds: params.addonGroupIds.slice(0, 10),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(doc(db, 'products', productId), {
        categoryId: params.categoryId,
        categoryName: params.categoryName,
        name: params.name.trim(),
        description: params.description.trim(),
        basePrice: params.basePrice,
        imageUrl: params.imageUrl.trim(),
        isAvailable: params.isAvailable,
        isVeg: params.isVeg,
        taxRate: params.taxRate,
        availableFrom: params.availableFrom || '00:00',
        availableTo: params.availableTo || '23:59',
        addonGroupIds: params.addonGroupIds.slice(0, 10),
        createdByUid: params.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const keptIds = new Set(params.variants.map((v) => v.id).filter(Boolean));
    for (const oldId of params.existingVariantIds) {
      if (!keptIds.has(oldId)) {
        batch.delete(doc(db, 'product_variants', oldId));
      }
    }

    for (const v of params.variants) {
      const vid = v.id || genId('var');
      if (v.id) {
        batch.update(doc(db, 'product_variants', vid), {
          name: v.name.trim(),
          price: v.price,
          isDefault: v.isDefault,
        });
      } else {
        batch.set(doc(db, 'product_variants', vid), {
          productId,
          name: v.name.trim(),
          price: v.price,
          isDefault: v.isDefault,
          createdByUid: params.uid,
          createdAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
    return productId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `products/${productId}`);
  }
}

export async function saveRecipeWithItems(params: {
  recipeId?: string;
  productId: string;
  productName: string;
  yieldQty: number;
  notes: string;
  items: { id?: string; ingredientId: string; ingredientName: string; unit: IngredientUnit; quantityRequired: number }[];
  existingItemIds: string[];
  uid: string;
}) {
  const recipeId = params.recipeId || `rec_${params.productId}`;
  try {
    const batch = writeBatch(db);
    if (params.recipeId) {
      batch.update(doc(db, 'recipes', recipeId), {
        productName: params.productName,
        yieldQty: params.yieldQty || 1,
        notes: params.notes.trim(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(doc(db, 'recipes', recipeId), {
        productId: params.productId,
        productName: params.productName,
        yieldQty: params.yieldQty || 1,
        notes: params.notes.trim(),
        createdByUid: params.uid,
        updatedAt: serverTimestamp(),
      });
    }

    const kept = new Set(params.items.map((i) => i.id).filter(Boolean));
    for (const oldId of params.existingItemIds) {
      if (!kept.has(oldId)) {
        batch.delete(doc(db, 'recipe_items', oldId));
      }
    }

    for (const item of params.items) {
      const rid = item.id || genId('ri');
      if (item.id) {
        batch.update(doc(db, 'recipe_items', rid), {
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          unit: item.unit,
          quantityRequired: item.quantityRequired,
        });
      } else {
        batch.set(doc(db, 'recipe_items', rid), {
          recipeId,
          productId: params.productId,
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          unit: item.unit,
          quantityRequired: item.quantityRequired,
          createdByUid: params.uid,
        });
      }
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `recipes/${recipeId}`);
  }
}

export async function saveExpenseEntry(params: {
  categoryId: string;
  categoryName: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  expenseDate: string;
  notes: string;
  actorUid: string;
  actorName: string;
  staffUids: string[];
}) {
  const id = genId('exp');
  try {
    await setDoc(doc(db, 'expenses', id), {
      categoryId: params.categoryId,
      categoryName: params.categoryName,
      amount: params.amount,
      paymentMethod: params.paymentMethod,
      expenseDate: params.expenseDate,
      notes: params.notes.trim(),
      recordedByUid: params.actorUid,
      recordedByName: params.actorName,
      staffUids: Array.from(new Set([params.actorUid, ...params.staffUids])).slice(0, 20),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `expenses/${id}`);
  }
}

export async function saveRestaurantSettings(params: {
  settings: Omit<RestaurantSettings, 'id' | 'updatedAt'>;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}) {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'restaurant_settings', 'default'), {
      ...params.settings,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'audit_logs', genId('log')), {
      action: 'SETTINGS_UPDATED',
      entityType: 'restaurant_settings',
      entityId: 'default',
      summary: `Updated restaurant settings (${params.settings.restaurantName}, Tax ${params.settings.taxRate}%)`,
      actorUid: params.actorUid,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      staffUids: Array.from(new Set([params.actorUid, ...params.staffUids])).slice(0, 20),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'restaurant_settings/default');
  }
}

export async function upsertStaffInvite(params: {
  email: string;
  displayName: string;
  role: Exclude<StaffRole, 'PENDING'>;
  isActive: boolean;
  isNew: boolean;
  actorUid: string;
}) {
  const normalizedEmail = params.email.trim().toLowerCase();
  try {
    if (params.isNew) {
      await setDoc(doc(db, 'staff_invites', normalizedEmail), {
        email: normalizedEmail,
        displayName: params.displayName.trim(),
        role: params.role,
        isActive: params.isActive,
        assignedByUid: params.actorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'staff_invites', normalizedEmail), {
        displayName: params.displayName.trim(),
        role: params.role,
        isActive: params.isActive,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `staff_invites/${normalizedEmail}`);
  }
}

export async function updateUserRole(params: {
  uid: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
}) {
  try {
    await updateDoc(doc(db, 'users', params.uid), {
      displayName: params.displayName.trim(),
      role: params.role,
      isActive: params.isActive,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${params.uid}`);
  }
}

export async function removeDocument(collectionName: string, id: string) {
  try {
    await deleteDoc(doc(db, collectionName, id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${collectionName}/${id}`);
  }
}
