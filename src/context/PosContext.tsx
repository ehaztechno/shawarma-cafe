import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { auth, db, googleAuthProvider, handleFirestoreError, OperationType } from '../lib/firebase';
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
  BOOTSTRAP_ADMIN_EMAIL,
  canAccessSection,
  getDefaultSectionForRole,
  hasPermission,
} from '../lib/permissions';
import { seedShawarmaCafeData } from '../lib/seedData';
import { flushSyncQueue, isLikelyNetworkError } from '../lib/syncEngine';
import {
  Addon,
  AddonGroup,
  AppSection,
  AuditLog,
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

interface PosContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  activeRole: StaffRole;
  authLoading: boolean;
  dataLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  activeSection: AppSection;
  setActiveSection: (s: AppSection) => void;
  isDark: boolean;
  toggleTheme: () => void;
  toasts: ToastMessage[];
  notify: (text: string, type?: 'success' | 'error' | 'info') => void;
  dismissToast: (id: string) => void;

  // Live Firestore Data
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

export const PosProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
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

  // Firestore Collections
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
  const [staffInvites, setStaffInvites] = useState<StaffInvite[]>([]);
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

  // Auth listener & User Profile Bootstrap
  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      setFirebaseUser(user);

      if (!user) {
        setProfile(null);
        setAuthLoading(false);
        return;
      }

      setAuthLoading(true);
      const userDocRef = doc(db, 'users', user.uid);

      // Hydrate immediately from IndexedDB catalog snapshot so offline/slow boot is instant
      const cachedSnap = await loadCatalogSnapshot(user.uid);
      if (cachedSnap) {
        setSettings(cachedSnap.settings);
        setCategories(cachedSnap.categories);
        setProducts(cachedSnap.products);
        setVariants(cachedSnap.variants);
        setAddonGroups(cachedSnap.addonGroups);
        setAddons(cachedSnap.addons);
        setTables(cachedSnap.tables);
        setOrders(cachedSnap.orders);
        setPayments(cachedSnap.payments);
        setCustomers(cachedSnap.customers);
        setIngredients(cachedSnap.ingredients);
        setRecipes(cachedSnap.recipes);
        setRecipeItems(cachedSnap.recipeItems);
        setStockMovements(cachedSnap.stockMovements);
        setSuppliers(cachedSnap.suppliers);
        setPurchases(cachedSnap.purchases);
        setExpenseCategories(cachedSnap.expenseCategories);
        setExpenses(cachedSnap.expenses);
        setLastCachedAtIso(cachedSnap.lastCachedAtIso);
        if (cachedSnap.profile && !navigator.onLine) {
          setProfile(cachedSnap.profile);
          setActiveSectionState((prev) =>
            canAccessSection(cachedSnap.profile!.role, prev)
              ? prev
              : getDefaultSectionForRole(cachedSnap.profile!.role)
          );
          setAuthLoading(false);
        }
      }

      try {
        const snap = await getDoc(userDocRef);
        const normalizedEmail = (user.email || '').toLowerCase();
        const isBootstrapOwner = normalizedEmail === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();

        if (!snap.exists()) {
          let assignedRole: StaffRole = isBootstrapOwner ? 'SUPER_ADMIN' : 'PENDING';
          let activeFlag = isBootstrapOwner;

          if (!isBootstrapOwner && normalizedEmail) {
            try {
              const inviteSnap = await getDoc(doc(db, 'staff_invites', normalizedEmail));
              if (inviteSnap.exists() && inviteSnap.data().isActive === true) {
                assignedRole = inviteSnap.data().role;
                activeFlag = true;
              }
            } catch {
              // No invite doc
            }
          }

          await setDoc(userDocRef, {
            uid: user.uid,
            email: normalizedEmail,
            displayName: user.displayName || normalizedEmail.split('@')[0] || 'Staff Member',
            role: assignedRole,
            isActive: activeFlag,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        if (isBootstrapOwner && navigator.onLine) {
          await seedShawarmaCafeData(user.uid);
        }

        unsubProfile = onSnapshot(
          userDocRef,
          (docSnap) => {
            if (docSnap.exists()) {
              const data = { id: docSnap.id, ...docSnap.data() } as UserProfile;
              setProfile(data);
              setActiveSectionState((prev) =>
                canAccessSection(data.role, prev) ? prev : getDefaultSectionForRole(data.role)
              );
            }
            setAuthLoading(false);
          },
          (err) => {
            if (isLikelyNetworkError(err) && cachedSnap?.profile) {
              setAuthLoading(false);
              return;
            }
            handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
          }
        );
      } catch (err) {
        if (isLikelyNetworkError(err) && cachedSnap?.profile) {
          setProfile(cachedSnap.profile);
          setActiveSectionState((prev) =>
            canAccessSection(cachedSnap.profile!.role, prev)
              ? prev
              : getDefaultSectionForRole(cachedSnap.profile!.role)
          );
          setAuthLoading(false);
          return;
        }
        setAuthLoading(false);
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const activeRole: StaffRole = profile?.isActive ? profile.role : 'PENDING';

  // Real-time Firestore Subscriptions based on authenticated staff role
  useEffect(() => {
    if (!firebaseUser || !profile || !profile.isActive || activeRole === 'PENDING') {
      return;
    }

    setDataLoading(true);
    const unsubs: (() => void)[] = [];

    const subscribe = <T,>(
      path: string,
      q: any,
      setter: React.Dispatch<React.SetStateAction<T[]>>
    ) => {
      const u = onSnapshot(
        q,
        (snap: any) => {
          setter(snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as T)));
        },
        (err: any) => {
          handleFirestoreError(err, OperationType.LIST, path);
        }
      );
      unsubs.push(u);
    };

    // Settings doc
    unsubs.push(
      onSnapshot(
        doc(db, 'restaurant_settings', 'default'),
        (snap) => {
          if (snap.exists()) {
            setSettings({ id: snap.id, ...snap.data() } as RestaurantSettings);
          }
          setDataLoading(false);
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'restaurant_settings/default')
      )
    );

    // Core operational collections readable by all active staff
    subscribe('categories', query(collection(db, 'categories'), orderBy('sortOrder', 'asc')), setCategories);
    subscribe('products', collection(db, 'products'), setProducts);
    subscribe('product_variants', collection(db, 'product_variants'), setVariants);
    subscribe('addon_groups', collection(db, 'addon_groups'), setAddonGroups);
    subscribe('addons', collection(db, 'addons'), setAddons);
    subscribe('tables', query(collection(db, 'tables'), orderBy('tableNumber', 'asc')), setTables);
    subscribe('orders', query(collection(db, 'orders'), orderBy('createdAt', 'desc')), setOrders);
    subscribe('ingredients', query(collection(db, 'ingredients'), orderBy('name', 'asc')), setIngredients);
    subscribe('recipes', collection(db, 'recipes'), setRecipes);
    subscribe('recipe_items', collection(db, 'recipe_items'), setRecipeItems);

    if (hasPermission(activeRole, 'pos_billing') || hasPermission(activeRole, 'orders_view')) {
      subscribe('payments', query(collection(db, 'payments'), orderBy('createdAt', 'desc')), setPayments);
      subscribe('customers', query(collection(db, 'customers'), orderBy('totalSpent', 'desc')), setCustomers);
      subscribe('stock_movements', query(collection(db, 'stock_movements'), orderBy('createdAt', 'desc')), setStockMovements);
    }

    if (hasPermission(activeRole, 'inventory_manage') || hasPermission(activeRole, 'expenses_manage')) {
      subscribe('suppliers', collection(db, 'suppliers'), setSuppliers);
      subscribe('purchases', query(collection(db, 'purchases'), orderBy('createdAt', 'desc')), setPurchases);
      subscribe('expense_categories', collection(db, 'expense_categories'), setExpenseCategories);
      subscribe('expenses', query(collection(db, 'expenses'), orderBy('createdAt', 'desc')), setExpenses);
    }

    if (hasPermission(activeRole, 'staff_manage')) {
      subscribe('staff_invites', collection(db, 'staff_invites'), setStaffInvites);
      subscribe('audit_logs', query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc')), setAuditLogs);
    }

    if (activeRole === 'SUPER_ADMIN') {
      subscribe('users', collection(db, 'users'), setStaffUsers);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseUser, profile, activeRole]);

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
          notify(
            `Synced ${res.syncedCount} offline ${res.syncedCount === 1 ? 'record' : 'records'} to Firebase.`,
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
    [notify, refreshOfflineState]
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

  const signInWithGoogle = useCallback(async () => {
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: any) {
      notify(err?.message || 'Google Sign-In failed.', 'error');
    }
  }, [notify]);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

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
    const seeded = await seedShawarmaCafeData(firebaseUser.uid);
    if (seeded) {
      notify('Shawarma Cafe starter menu and inventory initialized.', 'success');
    } else {
      notify('Menu and settings already exist in database.', 'info');
    }
  }, [firebaseUser, notify]);

  const activeStaffUids = useMemo(() => {
    const ids = staffUsers.filter((u) => u.isActive).map((u) => u.uid);
    if (firebaseUser && !ids.includes(firebaseUser.uid)) {
      ids.push(firebaseUser.uid);
    }
    return ids.slice(0, 20);
  }, [staffUsers, firebaseUser]);

  // Merge offline-created provisional orders with live/cached Firestore orders
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
    dataLoading,
    signInWithGoogle,
    logout,
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

export function usePos() {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error('usePos must be used within PosProvider');
  return ctx;
}
