import { apiFetch } from './apiClient';
import {
  CartItem,
  ExpensePaymentMethod,
  Ingredient,
  IngredientUnit,
  Order,
  OrderItem,
  OrderStatus,
  OrderType,
  Product,
  ProductVariant,
  RecipeItem,
  RestaurantSettings,
  RestaurantTable,
  SplitPaymentEntry,
  StaffRole,
  StockMovementType,
  UserProfile,
} from '../types/pos';

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

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
  const res = await apiFetch<{ items: OrderItem[] }>(
    `/api/pos/orders/${encodeURIComponent(orderId)}/items`
  );
  return res.items || [];
}

export async function createOrderTransaction(input: CreateOrderInput): Promise<{
  orderId: string;
  orderNumber: string;
}> {
  return apiFetch<{ orderId: string; orderNumber: string }>('/api/pos/orders', {
    method: 'POST',
    body: JSON.stringify({
      orderType: input.orderType,
      table: input.table,
      customerId: input.customerId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      deliveryAddress: input.deliveryAddress,
      deliveryCharge: input.deliveryCharge,
      cartItems: input.cartItems,
      cartDiscountPercent: input.cartDiscountPercent,
      notes: input.notes,
      payments: input.payments,
      payLater: input.payLater,
    }),
  });
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
  return apiFetch(`/api/pos/orders/${encodeURIComponent(params.order.id)}/payments`, {
    method: 'POST',
    body: JSON.stringify({ payments: params.payments }),
  });
}

export async function updateOrderStatus(params: {
  order: Order;
  nextStatus: OrderStatus;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}) {
  return apiFetch(`/api/pos/orders/${encodeURIComponent(params.order.id)}/status`, {
    method: 'POST',
    body: JSON.stringify({ nextStatus: params.nextStatus }),
  });
}

export async function cancelOrderWithReason(params: {
  order: Order;
  reason: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}) {
  return apiFetch(`/api/pos/orders/${encodeURIComponent(params.order.id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: params.reason }),
  });
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
  return apiFetch(`/api/pos/orders/${encodeURIComponent(params.order.id)}/refund`, {
    method: 'POST',
    body: JSON.stringify({ paymentIds: params.paymentIds, reason: params.reason }),
  });
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
  return apiFetch('/api/pos/stock/adjust', {
    method: 'POST',
    body: JSON.stringify({
      ingredientId: params.ingredient.id,
      type: params.type,
      quantityDelta: params.quantityDelta,
      notes: params.notes,
    }),
  });
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
  return apiFetch('/api/pos/purchases', {
    method: 'POST',
    body: JSON.stringify({
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      invoiceNumber: params.invoiceNumber,
      paymentStatus: params.paymentStatus,
      purchaseDate: params.purchaseDate,
      notes: params.notes,
      items: params.items,
    }),
  });
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
  const res = await apiFetch<{ productId: string }>('/api/pos/products', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return res.productId;
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
  return apiFetch('/api/pos/recipes', {
    method: 'POST',
    body: JSON.stringify(params),
  });
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
  return apiFetch('/api/pos/expenses', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function saveRestaurantSettings(params: {
  settings: Omit<RestaurantSettings, 'id' | 'updatedAt'>;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
}) {
  return apiFetch('/api/pos/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: params.settings }),
  });
}

export async function upsertCatalogDocument(
  collectionName: string,
  id: string,
  data: Record<string, any>
) {
  return apiFetch(
    `/api/pos/docs/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    }
  );
}

export async function removeDocument(collectionName: string, id: string) {
  return apiFetch(
    `/api/pos/docs/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    }
  );
}

// --- Staff Account Management ---

export async function createStaffAccount(params: {
  username: string;
  displayName: string;
  password: string;
  role: Exclude<StaffRole, 'PENDING'>;
}): Promise<UserProfile> {
  const res = await apiFetch<{ staff: UserProfile }>('/api/staff', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return res.staff;
}

export async function updateUserRole(params: {
  uid: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
}): Promise<UserProfile> {
  const res = await apiFetch<{ staff: UserProfile }>(
    `/api/staff/${encodeURIComponent(params.uid)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: params.displayName,
        role: params.role,
        isActive: params.isActive,
      }),
    }
  );
  return res.staff;
}

export async function resetStaffPassword(params: { uid: string; password: string }) {
  return apiFetch(`/api/staff/${encodeURIComponent(params.uid)}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password: params.password }),
  });
}

export async function deleteStaffAccount(uid: string) {
  return apiFetch(`/api/staff/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
  });
}
