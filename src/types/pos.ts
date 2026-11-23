export type StaffRole = 'SUPER_ADMIN' | 'MANAGER' | 'CASHIER' | 'KITCHEN_STAFF' | 'PENDING';

export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type OrderStatus = 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | 'COMPLETED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'REFUNDED';
export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'ONLINE';
export type ExpensePaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER';
export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'BILLING';
export type IngredientUnit = 'kg' | 'gram' | 'litre' | 'ml' | 'pieces';
export type StockMovementType = 'PURCHASE' | 'ORDER_DEDUCTION' | 'WASTAGE' | 'ADJUSTMENT' | 'RETURN';
export type PrinterWidth = '58mm' | '80mm' | 'A4';

export type AppSection =
  | 'dashboard'
  | 'pos'
  | 'kot'
  | 'tables'
  | 'orders'
  | 'menu'
  | 'inventory'
  | 'customers'
  | 'expenses'
  | 'reports'
  | 'staff'
  | 'settings';

export interface AuthSessionUser {
  uid: string;
  username: string;
  email: string;
  displayName: string;
  role: StaffRole;
}

export interface UserProfile {
  id: string;
  uid: string;
  username?: string;
  email: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface RoleDefinition {
  id: string;
  code: Exclude<StaffRole, 'PENDING'>;
  label: string;
  description: string;
  permissions: string[];
  updatedAt: any;
}

export interface StaffInvite {
  id: string; // email
  email: string;
  displayName: string;
  role: Exclude<StaffRole, 'PENDING'>;
  isActive: boolean;
  assignedByUid: string;
  createdAt: any;
  updatedAt: any;
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  availableFrom: string;
  availableTo: string;
  createdByUid: string;
  createdAt: any;
  updatedAt: any;
}

export interface Product {
  id: string;
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
  createdByUid: string;
  createdAt: any;
  updatedAt: any;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  price: number;
  isDefault: boolean;
  createdByUid: string;
  createdAt: any;
}

export interface AddonGroup {
  id: string;
  name: string;
  isRequired: boolean;
  maxSelect: number;
  createdByUid: string;
  createdAt: any;
}

export interface Addon {
  id: string;
  groupId: string;
  name: string;
  price: number;
  isAvailable: boolean;
  createdByUid: string;
  createdAt: any;
}

export interface RestaurantTable {
  id: string;
  tableNumber: string;
  name: string;
  capacity: number;
  zone: string;
  status: TableStatus;
  currentOrderId: string;
  currentOrderNumber: string;
  createdByUid: string;
  updatedAt: any;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: any;
  createdByUid: string;
  staffUids: string[];
  createdAt: any;
  updatedAt: any;
}

export interface Order {
  id: string;
  orderNumber: string;
  orderType: OrderType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  tableId: string;
  tableName: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryCharge: number;
  subtotal: number;
  itemDiscountTotal: number;
  cartDiscountPercent: number;
  cartDiscountAmount: number;
  taxRate: number;
  taxAmount: number;
  serviceChargeAmount: number;
  grandTotal: number;
  paidAmount: number;
  paymentMethodsSummary: string;
  itemCount: number;
  itemsPreview: string;
  notes: string;
  cancelReason: string;
  inventoryDeducted: boolean;
  createdByUid: string;
  createdByName: string;
  staffUids: string[];
  createdAt: any;
  updatedAt: any;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  variantId: string;
  variantName: string;
  unitPrice: number;
  quantity: number;
  itemDiscountAmount: number;
  addonsSummary: string;
  addonsTotal: number;
  specialInstructions: string;
  lineTotal: number;
  createdByUid: string;
  createdAt: any;
}

export interface OrderItemAddon {
  id: string;
  orderId: string;
  orderItemId: string;
  addonId: string;
  addonName: string;
  price: number;
  createdByUid: string;
  createdAt: any;
}

export interface Payment {
  id: string;
  orderId: string;
  orderNumber: string;
  method: PaymentMethod;
  amount: number;
  referenceNumber: string;
  status: 'COMPLETED' | 'REFUNDED';
  receivedByUid: string;
  receivedByName: string;
  staffUids: string[];
  createdAt: any;
}

export interface Ingredient {
  id: string;
  name: string;
  unit: IngredientUnit;
  currentStock: number;
  minStockAlert: number;
  costPerUnit: number;
  supplierId: string;
  supplierName: string;
  createdByUid: string;
  createdAt: any;
  updatedAt: any;
}

export interface Recipe {
  id: string;
  productId: string;
  productName: string;
  yieldQty: number;
  notes: string;
  createdByUid: string;
  updatedAt: any;
}

export interface RecipeItem {
  id: string;
  recipeId: string;
  productId: string;
  ingredientId: string;
  ingredientName: string;
  unit: IngredientUnit;
  quantityRequired: number;
  createdByUid: string;
}

export interface StockMovement {
  id: string;
  ingredientId: string;
  ingredientName: string;
  type: StockMovementType;
  quantityDelta: number;
  previousStock: number;
  newStock: number;
  unit: IngredientUnit;
  referenceId: string;
  notes: string;
  createdByUid: string;
  staffUids: string[];
  createdAt: any;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  createdByUid: string;
  createdAt: any;
}

export interface Purchase {
  id: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  totalAmount: number;
  paymentStatus: 'PAID' | 'PENDING';
  notes: string;
  purchaseDate: string;
  createdByUid: string;
  staffUids: string[];
  createdAt: any;
}

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: IngredientUnit;
  unitCost: number;
  totalCost: number;
  createdByUid: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description: string;
  createdByUid: string;
  createdAt: any;
}

export interface Expense {
  id: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  expenseDate: string;
  notes: string;
  recordedByUid: string;
  recordedByName: string;
  staffUids: string[];
  createdAt: any;
}

export interface RestaurantSettings {
  id: string;
  restaurantName: string;
  address: string;
  phone: string;
  gstin: string;
  currency: string;
  currencySymbol: string;
  taxRate: number;
  serviceChargeRate: number;
  defaultDeliveryCharge: number;
  receiptFooter: string;
  printerWidth: PrinterWidth;
  orderPrefix: string;
  nextOrderNumber: number;
  openingHours: string;
  autoDeductInventory: boolean;
  logoUrl: string;
  updatedAt: any;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  staffUids: string[];
  createdAt: any;
}

// Client-side POS Cart Structures
export interface CartAddonSelection {
  addonId: string;
  addonName: string;
  price: number;
}

export interface CartItem {
  cartKey: string;
  productId: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  variantId: string;
  variantName: string;
  unitPrice: number;
  quantity: number;
  itemDiscountAmount: number;
  addons: CartAddonSelection[];
  specialInstructions: string;
}

export interface SplitPaymentEntry {
  method: PaymentMethod;
  amount: number;
  referenceNumber: string;
}
