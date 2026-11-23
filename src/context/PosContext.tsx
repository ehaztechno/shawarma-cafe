import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { apiFetch, getApiAuthToken, setApiAuthToken } from '../lib/apiClient';
import {
  getAllLocalOfflineOrders,
  getAllSyncQueueItems,
  loadCatalogSnapshot,
  LocalOfflineOrderRecord,
  removeSyncQueueItem,
  saveCatalogSnapshot,
  SyncQueueItem,
} from '../lib/offlineDb';
import {
  canAccessSection,
  getDefaultSectionForRole,
} from '../lib/permissions';
import { flushSyncQueue } from '../lib/syncEngine';
import {
  Addon,
  AddonGroup,
  AppSection,
  AuditLog,
  AuthSessionUser,
  CartAddonSelection,
  CartItem,
  Category,
  Customer,
  Expense,
  ExpenseCategory,
  Ingredient,
  Order,
  OrderType,
  Payment,
  Product,
  ProductVariant,
  Purchase,
  Recipe,
  RecipeItem,
  RestaurantSettings,
  RestaurantTable,
  StaffInvite,
  StaffRole,
  StockMovement,
  Supplier,
  UserProfile,
} from '../types/pos';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
}

const DEFAULT_SETTINGS: RestaurantSettings = {
  id: 'default',
  restaurantName: 'Shawarma Cafe',
  address: '14 Spice Market Lane, Koramangala, Bengaluru 560034',
  phone: '+91 98450 11223',
  gstin: '29AABCS1429B1ZN',
  currency: 'INR',
  currencySymbol: '₹',
  taxRate: 5,
  serviceChargeRate: 0,
  defaultDeliveryCharge: 30,
  receiptFooter: 'Freshly Roasted Every Hour. Thank you for dining at Shawarma Cafe!',
  printerWidth: '80mm',
  orderPrefix: 'SC',
  nextOrderNumber: 1001,
  openingHours: '11:00 AM - 11:30 PM',
  autoDeductInventory: true,
  logoUrl: '/src/assets/images/chicken_shawarma_classic_1795401707942.jpg',
  updatedAt: null,
};

interface PosStatePayload {
  settings: RestaurantSettings | null;
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
  staffUsers: UserProfile[];
  auditLogs: AuditLog[];
}

interface PosContextValue {
  firebaseUser: AuthSessionUser | null;
  profile: UserProfile | null;
  activeRole: StaffRole;
  authLoading: boolean;
  signingIn: boolean;
  authError: string | null;
  needsSetup: boolean;
  envAdminConfigured: boolean;
  clearAuthError: () => void;
  dataLoading: boolean;
  loginWithPassword: (username: string, password: string) => Promise<void>;
  bootstrapAdmin: (params: {
    username: string;
    displayName: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshPosState: () => Promise<void>;
  activeSection: AppSection;
  setActiveSection: (s: AppSection) => void;
  isDark: boolean;
  toggleTheme: () => void;
  toasts: ToastMessage[];
  notify: (text: string, type?: 'success' | 'error' | 'info') => void;
  dismissToast: (id: string) => void;

  // Live Workspace Data
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
  staffUsers: UserProfile[];
  staffInvites: StaffInvite[];
  auditLogs: AuditLog[];
  activeStaffUids: string[];

  // Cart State (persisted offline-safe)
  cart: CartItem[];
  orderType: OrderType;
  setOrderType: (t: OrderType) => void;
  selectedTableId: string;
  setSelectedTableId: (id: string) => void;
  cartCustomerName: string;
  setCartCustomerName: (v: string) => void;
  cartCustomerPhone: string;
  setCartCustomerPhone: (v: string) => void;
  cartCustomerId: string;
  setCartCustomerId: (v: string) => void;
  cartDeliveryAddress: string;
  setCartDeliveryAddress: (v: string) => void;
  cartDiscountPercent: number;
  setCartDiscountPercent: (v: number) => void;
  cartNotes: string;
  setCartNotes: (v: string) => void;
  addToCart: (params: {
    product: Product;
    variant: ProductVariant | null;
    addons: CartAddonSelection[];
    specialInstructions: string;
    quantity?: number;
  }) => void;
  updateCartQty: (cartKey: string, delta: number) => void;
  updateCartItemDiscount: (cartKey: string, discountAmount: number) => void;
  removeFromCart: (cartKey: string) => void;
  clearCart: () => void;
  loadTableForOrder: (table: RestaurantTable) => void;
  reseedMenu: () => Promise<void>;

  // Offline / PWA & IndexedDB Sync State
  isOnline: boolean;
  swReady: boolean;
  isSyncing: boolean;
  syncQueue: SyncQueueItem[];
  lastSyncedAtIso: string;
  lastCachedAtIso: string;
  refreshOfflineState: () => Promise<void>;
  triggerSync: (includeFailed?: boolean) => Promise<void>;
  discardSyncQueueItem: (id: string) => Promise<void>;
}

const PosContext = createContext<PosContextValue | null>(null);

function toSessionUser(profile: UserProfile): AuthSessionUser {
  const uname = profile.username || profile.email || 'staff';
  return {
    uid: profile.uid,
    username: uname,
    email: uname,
    displayName: profile.displayName,
    role: profile.role,
  };
}

export const PosProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<AuthSessionUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [envAdminConfigured, setEnvAdminConfigured] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  const [activeSection, setActiveSectionState] = useState<AppSection>('pos');
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sc_pos_theme') === 'dark';
    } catch {
      return false;
    }
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Workspace Collections
  const [settings, setSettings] = useState<RestaurantSettings>(DEFAULT_SETTINGS);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [addonGroups, setAddonGroups] = useState<AddonGroup[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeItems, setRecipeItems] = useState<RecipeItem[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [staffUsers, setStaffUsers] = useState<UserProfile[]>([]);
  const [staffInvites] = useState<StaffInvite[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Offline & Sync State
  const isOnline = useOnlineStatus();
  const [swReady, setSwReady] = useState<boolean>(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      return Boolean(navigator.serviceWorker.controller);
    }
    return false;
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [localOfflineOrders, setLocalOfflineOrders] = useState<LocalOfflineOrderRecord[]>([]);
  const [lastSyncedAtIso, setLastSyncedAtIso] = useState('');
  const [lastCachedAtIso, setLastCachedAtIso] = useState('');
  const prevOnlineRef = useRef<boolean>(isOnline);

  // Resilient POS Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('DINE_IN');
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [cartCustomerName, setCartCustomerName] = useState('');
  const [cartCustomerPhone, setCartCustomerPhone] = useState('');
  const [cartCustomerId, setCartCustomerId] = useState('');
  const [cartDeliveryAddress, setCartDeliveryAddress] = useState('');
  const [cartDiscountPercent, setCartDiscountPercent] = useState(0);
  const [cartNotes, setCartNotes] = useState('');

  // Theme sync
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem('sc_pos_theme', isDark ? 'dark' : 'light');
    } catch {
      // Ignore storage failure
    }
  }, [isDark]);

  const toggleTheme = useCallback(() => setIsDark((prev) => !prev), []);

  const notify = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshOfflineState = useCallback(async () => {
    const [q, localOrds] = await Promise.all([
      getAllSyncQueueItems(),
      getAllLocalOfflineOrders(),
    ]);
    setSyncQueue(q);
    setLocalOfflineOrders(localOrds);
  }, []);

  // Track Service Worker readiness & initial IndexedDB queue load
  useEffect(() => {
    void refreshOfflineState();

    const handleSwReady = () => {
      setSwReady(true);
      notify('App shell cached for offline POS operation.', 'info');
    };
    const handleSwUpdate = () => {
      notify('Updated POS version ready and cached.', 'info');
    };

    window.addEventListener('sc-sw-ready', handleSwReady);
    window.addEventListener('sc-sw-update', handleSwUpdate);

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(() => setSwReady(true))
        .catch(() => {});
    }

    return () => {
      window.removeEventListener('sc-sw-ready', handleSwReady);
      window.removeEventListener('sc-sw-update', handleSwUpdate);
    };
  }, [notify, refreshOfflineState]);

  // Check initial auth/bootstrap status
  const checkAuthStatus = useCallback(async () => {
    setAuthLoading(true);
    try {
      const status = await apiFetch<{ needsSetup: boolean; envAdminConfigured: boolean }>(
        '/api/auth/status'
      );
      setNeedsSetup(Boolean(status.needsSetup));
      setEnvAdminConfigured(Boolean(status.envAdminConfigured));
    } catch {
      // Offline or unreachable at boot: keep login form ready
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkAuthStatus();
  }, [checkAuthStatus]);

  // Load persisted cart on user change
  useEffect(() => {
    if (!firebaseUser) return;
    try {
      const saved = localStorage.getItem(`sc_cart_${firebaseUser.uid}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.cart)) setCart(parsed.cart);
        if (parsed.orderType) setOrderType(parsed.orderType);
        if (typeof parsed.selectedTableId === 'string') setSelectedTableId(parsed.selectedTableId);
        if (typeof parsed.cartCustomerName === 'string') setCartCustomerName(parsed.cartCustomerName);
        if (typeof parsed.cartCustomerPhone === 'string') setCartCustomerPhone(parsed.cartCustomerPhone);
        if (typeof parsed.cartDeliveryAddress === 'string') setCartDeliveryAddress(parsed.cartDeliveryAddress);
        if (typeof parsed.cartDiscountPercent === 'number') setCartDiscountPercent(parsed.cartDiscountPercent);
        if (typeof parsed.cartNotes === 'string') setCartNotes(parsed.cartNotes);
      }
    } catch {
      // Ignore corrupt backup
    }
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser) return;
    try {
      localStorage.setItem(
        `sc_cart_${firebaseUser.uid}`,
        JSON.stringify({
          cart,
          orderType,
          selectedTableId,
          cartCustomerName,
          cartCustomerPhone,
          cartDeliveryAddress,
          cartDiscountPercent,
          cartNotes,
        })
      );
    } catch {
      // Ignore storage quota
    }
  }, [
    firebaseUser,
    cart,
    orderType,
    selectedTableId,
    cartCustomerName,
    cartCustomerPhone,
    cartDeliveryAddress,
    cartDiscountPercent,
    cartNotes,
  ]);

  const applyPosState = useCallback((data: PosStatePayload) => {
    if (data.settings) setSettings(data.settings);
    setCategories(data.categories || []);
    setProducts(data.products || []);
    setVariants(data.variants || []);
    setAddonGroups(data.addonGroups || []);
    setAddons(data.addons || []);
    setTables(data.tables || []);
    setOrders(data.orders || []);
    setPayments(data.payments || []);
    setCustomers(data.customers || []);
    setIngredients(data.ingredients || []);
    setRecipes(data.recipes || []);
    setRecipeItems(data.recipeItems || []);
    setStockMovements(data.stockMovements || []);
    setSuppliers(data.suppliers || []);
    setPurchases(data.purchases || []);
    setExpenseCategories(data.expenseCategories || []);
    setExpenses(data.expenses || []);
    setStaffUsers(data.staffUsers || []);
    setAuditLogs(data.auditLogs || []);
  }, []);

  const refreshPosState = useCallback(async () => {
    if (!getApiAuthToken()) return;
    try {
      const data = await apiFetch<PosStatePayload>('/api/pos/state');
      applyPosState(data);
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        setApiAuthToken(null);
        setFirebaseUser(null);
        setProfile(null);
        setAuthError(err.message || 'Session expired. Please sign in again.');
      }
    }
  }, [applyPosState]);

  const hydrateAfterAuth = useCallback(
    async (userProfile: UserProfile) => {
      const sessionUser = toSessionUser(userProfile);
      setProfile(userProfile);
      setFirebaseUser(sessionUser);
      setActiveSectionState((prev) =>
        canAccessSection(userProfile.role, prev)
          ? prev
          : getDefaultSectionForRole(userProfile.role)
      );

      // Hydrate cached snapshot immediately, then fetch fresh state from API
      const cached = await loadCatalogSnapshot(userProfile.uid);
      if (cached) {
        setSettings(cached.settings);
        setCategories(cached.categories);
        setProducts(cached.products);
        setVariants(cached.variants);
        setAddonGroups(cached.addonGroups);
        setAddons(cached.addons);
        setTables(cached.tables);
        setOrders(cached.orders);
        setPayments(cached.payments);
        setCustomers(cached.customers);
        setIngredients(cached.ingredients);
        setRecipes(cached.recipes);
        setRecipeItems(cached.recipeItems);
        setStockMovements(cached.stockMovements);
        setSuppliers(cached.suppliers);
        setPurchases(cached.purchases);
        setExpenseCategories(cached.expenseCategories);
        setExpenses(cached.expenses);
        setLastCachedAtIso(cached.lastCachedAtIso);
      }

      setDataLoading(true);
      try {
        await refreshPosState();
      } finally {
        setDataLoading(false);
      }
    },
    [refreshPosState]
  );

  const activeRole: StaffRole = profile?.isActive ? profile.role : 'PENDING';

  // Keep POS state synchronized across terminals and after mutations
  useEffect(() => {
    if (!firebaseUser || !profile || !profile.isActive || activeRole === 'PENDING') {
      return;
    }

    const handleMutated = () => {
      void refreshPosState();
    };
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void refreshPosState();
      }
    };

    window.addEventListener('sc-pos-mutated', handleMutated);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void refreshPosState();
      }
    }, 4000);

    return () => {
      window.removeEventListener('sc-pos-mutated', handleMutated);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.clearInterval(interval);
    };
  }, [firebaseUser, profile, activeRole, refreshPosState]);

  // Persist live catalog & operational snapshot to IndexedDB whenever data updates
  useEffect(() => {
    if (!firebaseUser || !profile || !profile.isActive || activeRole === 'PENDING') {
      return;
    }
    if (categories.length === 0 && products.length === 0 && tables.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      const nowIso = new Date().toISOString();
      void saveCatalogSnapshot({
        key: `pos_snapshot_${firebaseUser.uid}`,
        uid: firebaseUser.uid,
        profile,
        settings,
        categories,
        products,
        variants,
        addonGroups,
        addons,
        tables,
        orders,
        payments,
        customers,
        ingredients,
        recipes,
        recipeItems,
        stockMovements,
        suppliers,
        purchases,
        expenseCategories,
        expenses,
        lastCachedAtIso: nowIso,
      }).then(() => setLastCachedAtIso(nowIso));
    }, 800);

    return () => window.clearTimeout(timer);
  }, [
    firebaseUser,
    profile,
    activeRole,
    settings,
    categories,
    products,
    variants,
    addonGroups,
    addons,
    tables,
    orders,
    payments,
    customers,
    ingredients,
    recipes,
    recipeItems,
    stockMovements,
    suppliers,
    purchases,
    expenseCategories,
    expenses,
  ]);

  const triggerSync = useCallback(
    async (includeFailed = false) => {
      if (!navigator.onLine) {
        notify('Still offline. Queued items will sync automatically once connected.', 'info');
        return;
      }
      setIsSyncing(true);
      try {
        const res = await flushSyncQueue({
          includeFailed,
          onProgress: () => {
            void refreshOfflineState();
          },
        });
        await refreshOfflineState();
        if (res.syncedCount > 0) {
          setLastSyncedAtIso(new Date().toISOString());
          await refreshPosState();
          notify(
            `Synced ${res.syncedCount} offline ${res.syncedCount === 1 ? 'record' : 'records'}.`,
            'success'
          );
        }
        if (res.failedCount > 0) {
          notify(
            `${res.failedCount} queued operation(s) encountered errors. Inspect Sync Status.`,
            'error'
          );
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [notify, refreshOfflineState, refreshPosState]
  );

  const discardSyncQueueItem = useCallback(
    async (id: string) => {
      await removeSyncQueueItem(id);
      await refreshOfflineState();
      notify('Removed failed queue entry.', 'info');
    },
    [notify, refreshOfflineState]
  );

  // Automatically flush IndexedDB sync queue on reconnect or startup with pending items
  useEffect(() => {
    const cameOnline = !prevOnlineRef.current && isOnline;
    prevOnlineRef.current = isOnline;

    if (!isOnline || !firebaseUser || !profile?.isActive || activeRole === 'PENDING') {
      return;
    }

    const hasPending = syncQueue.some((item) => item.status === 'PENDING');
    if (cameOnline && syncQueue.length > 0) {
      void triggerSync(true);
    } else if (hasPending && !isSyncing) {
      void triggerSync(false);
    }
  }, [isOnline, firebaseUser, profile, activeRole, syncQueue, isSyncing, triggerSync]);

  const setActiveSection = useCallback(
    (s: AppSection) => {
      if (canAccessSection(activeRole, s)) {
        setActiveSectionState(s);
      } else {
        notify('Your role does not have permission to open that module.', 'error');
      }
    },
    [activeRole, notify]
  );

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const loginWithPassword = useCallback(
    async (username: string, password: string) => {
      setSigningIn(true);
      setAuthError(null);
      try {
        const res = await apiFetch<{ token: string; profile: UserProfile }>(
          '/api/auth/login',
          {
            method: 'POST',
            body: JSON.stringify({ username, password }),
          }
        );
        setApiAuthToken(res.token);
        await hydrateAfterAuth(res.profile);
      } catch (err: any) {
        const msg = err?.message || 'Unable to sign in. Check your username and password.';
        setAuthError(msg);
        notify(msg, 'error');
      } finally {
        setSigningIn(false);
      }
    },
    [hydrateAfterAuth, notify]
  );

  const bootstrapAdmin = useCallback(
    async (params: { username: string; displayName: string; password: string }) => {
      setSigningIn(true);
      setAuthError(null);
      try {
        const res = await apiFetch<{ token: string; profile: UserProfile }>(
          '/api/auth/bootstrap',
          {
            method: 'POST',
            body: JSON.stringify(params),
          }
        );
        setApiAuthToken(res.token);
        setNeedsSetup(false);
        await hydrateAfterAuth(res.profile);
        notify('Store Admin account created and starter menu loaded.', 'success');
      } catch (err: any) {
        const msg = err?.message || 'Unable to create initial admin account.';
        setAuthError(msg);
        notify(msg, 'error');
      } finally {
        setSigningIn(false);
      }
    },
    [hydrateAfterAuth, notify]
  );

  const logout = useCallback(async () => {
    setApiAuthToken(null);
    setAuthError(null);
    setFirebaseUser(null);
    setProfile(null);
    setOrders([]);
    setPayments([]);
    setCustomers([]);
    setStaffUsers([]);
    setAuditLogs([]);
    await checkAuthStatus();
  }, [checkAuthStatus]);

  const addToCart = useCallback(
    ({
      product,
      variant,
      addons: selectedAddons,
      specialInstructions,
      quantity = 1,
    }: {
      product: Product;
      variant: ProductVariant | null;
      addons: CartAddonSelection[];
      specialInstructions: string;
      quantity?: number;
    }) => {
      const addonKey = selectedAddons
        .map((a) => a.addonId)
        .sort()
        .join(',');
      const noteKey = specialInstructions.trim().toLowerCase();
      const cartKey = `${product.id}__${variant?.id || 'base'}__${addonKey}__${noteKey}`;
      const unitPrice = variant ? variant.price : product.basePrice;

      setCart((prev) => {
        const existingIdx = prev.findIndex((i) => i.cartKey === cartKey);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            quantity: updated[existingIdx].quantity + quantity,
          };
          return updated;
        }
        return [
          ...prev,
          {
            cartKey,
            productId: product.id,
            productName: product.name,
            categoryId: product.categoryId,
            categoryName: product.categoryName,
            variantId: variant?.id || '',
            variantName: variant?.name || '',
            unitPrice,
            quantity,
            itemDiscountAmount: 0,
            addons: selectedAddons,
            specialInstructions: specialInstructions.trim(),
          },
        ];
      });
    },
    []
  );

  const updateCartQty = useCallback((cartKey: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.cartKey === cartKey
            ? { ...item, quantity: item.quantity + delta }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  }, []);

  const updateCartItemDiscount = useCallback((cartKey: string, discountAmount: number) => {
    setCart((prev) =>
      prev.map((item) =>
        item.cartKey === cartKey
          ? { ...item, itemDiscountAmount: Math.max(0, discountAmount) }
          : item
      )
    );
  }, []);

  const removeFromCart = useCallback((cartKey: string) => {
    setCart((prev) => prev.filter((i) => i.cartKey !== cartKey));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setSelectedTableId('');
    setCartCustomerName('');
    setCartCustomerPhone('');
    setCartCustomerId('');
    setCartDeliveryAddress('');
    setCartDiscountPercent(0);
    setCartNotes('');
  }, []);

  const loadTableForOrder = useCallback((table: RestaurantTable) => {
    setOrderType('DINE_IN');
    setSelectedTableId(table.id);
    setActiveSectionState('pos');
  }, []);

  const reseedMenu = useCallback(async () => {
    if (!firebaseUser) return;
    const res = await apiFetch<{ seeded: boolean }>('/api/pos/reseed', { method: 'POST' });
    await refreshPosState();
    if (res.seeded) {
      notify('Shawarma Cafe starter menu and inventory initialized.', 'success');
    } else {
      notify('Menu and settings already exist in database.', 'info');
    }
  }, [firebaseUser, notify, refreshPosState]);

  const activeStaffUids = useMemo(() => {
    const ids = staffUsers.filter((u) => u.isActive).map((u) => u.uid);
    if (firebaseUser && !ids.includes(firebaseUser.uid)) {
      ids.push(firebaseUser.uid);
    }
    return ids.slice(0, 20);
  }, [staffUsers, firebaseUser]);

  // Merge offline-created provisional orders with live/cached orders
  const mergedOrders = useMemo(() => {
    if (localOfflineOrders.length === 0) return orders;
    const offlineList = localOfflineOrders.map((r) => r.order);
    const seen = new Set(offlineList.map((o) => o.id));
    return [...offlineList, ...orders.filter((o) => !seen.has(o.id))];
  }, [localOfflineOrders, orders]);

  // Reflect pending offline table occupancy / status overrides in real time
  const mergedTables = useMemo(() => {
    const tableOverrides = new Map<string, Partial<RestaurantTable>>();
    for (const rec of localOfflineOrders) {
      if (
        rec.order.tableId &&
        rec.order.status !== 'CANCELLED' &&
        rec.order.status !== 'COMPLETED'
      ) {
        tableOverrides.set(rec.order.tableId, {
          status: 'OCCUPIED',
          currentOrderId: rec.order.id,
          currentOrderNumber: rec.order.orderNumber,
        });
      }
    }
    for (const q of syncQueue) {
      if (q.type === 'TABLE_STATUS' && q.payload?.tableId) {
        tableOverrides.set(q.payload.tableId, {
          status: q.payload.status,
          currentOrderId: q.payload.currentOrderId,
          currentOrderNumber: q.payload.currentOrderNumber,
        });
      }
    }
    if (tableOverrides.size === 0) return tables;
    return tables.map((t) => {
      const ov = tableOverrides.get(t.id);
      return ov ? { ...t, ...ov } : t;
    });
  }, [tables, localOfflineOrders, syncQueue]);

  const value: PosContextValue = {
    firebaseUser,
    profile,
    activeRole,
    authLoading,
    signingIn,
    authError,
    needsSetup,
    envAdminConfigured,
    clearAuthError,
    dataLoading,
    loginWithPassword,
    bootstrapAdmin,
    logout,
    refreshPosState,
    activeSection,
    setActiveSection,
    isDark,
    toggleTheme,
    toasts,
    notify,
    dismissToast,
    settings,
    categories,
    products,
    variants,
    addonGroups,
    addons,
    tables: mergedTables,
    orders: mergedOrders,
    payments,
    customers,
    ingredients,
    recipes,
    recipeItems,
    stockMovements,
    suppliers,
    purchases,
    expenseCategories,
    expenses,
    staffUsers,
    staffInvites,
    auditLogs,
    activeStaffUids,
    cart,
    orderType,
    setOrderType,
    selectedTableId,
    setSelectedTableId,
    cartCustomerName,
    setCartCustomerName,
    cartCustomerPhone,
    setCartCustomerPhone,
    cartCustomerId,
    setCartCustomerId,
    cartDeliveryAddress,
    setCartDeliveryAddress,
    cartDiscountPercent,
    setCartDiscountPercent,
    cartNotes,
    setCartNotes,
    addToCart,
    updateCartQty,
    updateCartItemDiscount,
    removeFromCart,
    clearCart,
    loadTableForOrder,
    reseedMenu,
    isOnline,
    swReady,
    isSyncing,
    syncQueue,
    lastSyncedAtIso,
    lastCachedAtIso,
    refreshOfflineState,
    triggerSync,
    discardSyncQueueItem,
  };

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
};

export function usePos(): PosContextValue {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error('usePos must be used inside PosProvider');
  return ctx;
}
