import React, { useMemo, useState } from 'react';
import {
  Check,
  CreditCard,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  UserSearch,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { usePos } from '../context/PosContext';
import { formatCurrency } from '../lib/permissions';
import { submitOrderOfflineAware } from '../lib/syncEngine';
import {
  CartAddonSelection,
  Order,
  OrderType,
  PaymentMethod,
  Product,
  ProductVariant,
  SplitPaymentEntry,
} from '../types/pos';
import { ReceiptModal } from './ReceiptModal';

export const PosBillingView: React.FC = () => {
  const {
    categories,
    products,
    variants,
    addonGroups,
    addons,
    tables,
    customers,
    orders,
    recipeItems,
    settings,
    firebaseUser,
    profile,
    activeRole,
    activeStaffUids,
    notify,
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
    refreshOfflineState,
  } = usePos();

  const [activeCategoryId, setActiveCategoryId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [vegOnly, setVegOnly] = useState(false);

  // Customization Modal state
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [customInstructions, setCustomInstructions] = useState('');

  // Payment Modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SplitPaymentEntry[]>([
    { method: 'CASH', amount: 0, referenceNumber: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  // Post-order receipt print modal
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);

  const sym = settings.currencySymbol || '₹';

  const activeCategories = useMemo(
    () => categories.filter((c) => c.isActive),
    [categories]
  );

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCategoryId !== 'ALL' && p.categoryId !== activeCategoryId) return false;
      if (vegOnly && !p.isVeg) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.categoryName.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [products, activeCategoryId, vegOnly, searchQuery]);

  // Cart Financial Math (UI preview; verified authoritatively inside Firestore transaction)
  const totals = useMemo(() => {
    let subtotal = 0;
    let itemDiscountTotal = 0;
    for (const item of cart) {
      const addonsSum = item.addons.reduce((s, a) => s + a.price, 0);
      subtotal += (item.unitPrice + addonsSum) * item.quantity;
      itemDiscountTotal += item.itemDiscountAmount;
    }
    const afterItemDisc = Math.max(0, subtotal - itemDiscountTotal);
    const cartDiscountAmount = Number(
      ((afterItemDisc * Math.max(0, Math.min(100, cartDiscountPercent))) / 100).toFixed(2)
    );
    const taxable = Math.max(0, afterItemDisc - cartDiscountAmount);
    const taxAmount = Number(((taxable * settings.taxRate) / 100).toFixed(2));
    const serviceChargeAmount =
      orderType === 'DINE_IN'
        ? Number(((taxable * settings.serviceChargeRate) / 100).toFixed(2))
        : 0;
    const deliveryCharge =
      orderType === 'DELIVERY' ? settings.defaultDeliveryCharge : 0;
    const grandTotal = Number(
      (taxable + taxAmount + serviceChargeAmount + deliveryCharge).toFixed(2)
    );

    return {
      subtotal,
      itemDiscountTotal,
      cartDiscountAmount,
      taxAmount,
      serviceChargeAmount,
      deliveryCharge,
      grandTotal,
    };
  }, [cart, cartDiscountPercent, settings, orderType]);

  const openCustomizeModal = (product: Product) => {
    const prodVariants = variants.filter((v) => v.productId === product.id);
    const defaultVar =
      prodVariants.find((v) => v.isDefault) || prodVariants[0] || null;
    setCustomizingProduct(product);
    setSelectedVariant(defaultVar);
    setSelectedAddonIds([]);
    setCustomInstructions('');
  };

  const handleQuickProductTap = (product: Product) => {
    if (!product.isAvailable) {
      notify(`${product.name} is currently marked unavailable.`, 'error');
      return;
    }
    const prodVariants = variants.filter((v) => v.productId === product.id);
    if (prodVariants.length > 0 || product.addonGroupIds.length > 0) {
      openCustomizeModal(product);
    } else {
      addToCart({
        product,
        variant: null,
        addons: [],
        specialInstructions: '',
      });
    }
  };

  const confirmCustomAdd = () => {
    if (!customizingProduct) return;
    const chosenAddons: CartAddonSelection[] = selectedAddonIds
      .map((id) => addons.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map((a) => ({ addonId: a.id, addonName: a.name, price: a.price }));

    addToCart({
      product: customizingProduct,
      variant: selectedVariant,
      addons: chosenAddons,
      specialInstructions: customInstructions,
    });
    setCustomizingProduct(null);
  };

  const lookupCustomerByPhone = (phoneVal: string) => {
    setCartCustomerPhone(phoneVal);
    const cleaned = phoneVal.trim();
    if (cleaned.length >= 5) {
      const match = customers.find((c) => c.phone === cleaned);
      if (match) {
        setCartCustomerId(match.id);
        setCartCustomerName(match.name);
        if (match.address) setCartDeliveryAddress(match.address);
        notify(`Loaded returning customer: ${match.name}`, 'info');
      } else {
        setCartCustomerId('');
      }
    }
  };

  const openPaymentModal = () => {
    if (cart.length === 0) {
      notify('Add at least one item to the cart.', 'error');
      return;
    }
    if (orderType === 'DINE_IN' && !selectedTableId) {
      notify('Please select a Dine-In table.', 'error');
      return;
    }
    if (orderType === 'DELIVERY' && (!cartCustomerPhone.trim() || !cartDeliveryAddress.trim())) {
      notify('Enter customer phone and delivery address for Delivery orders.', 'error');
      return;
    }
    setSplitPayments([{ method: 'CASH', amount: totals.grandTotal, referenceNumber: '' }]);
    setShowPaymentModal(true);
  };

  const submitOrder = async (payLater: boolean) => {
    if (!firebaseUser || !profile) return;
    if (cart.length === 0) return;
    if (orderType === 'DINE_IN' && !selectedTableId) {
      notify('Select a Dine-In table before sending to kitchen.', 'error');
      return;
    }
    if (orderType === 'DELIVERY' && (!cartCustomerPhone.trim() || !cartDeliveryAddress.trim())) {
      notify('Enter customer phone and delivery address for Delivery orders.', 'error');
      return;
    }

    const totalTendered = splitPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    if (!payLater && totalTendered <= 0 && totals.grandTotal > 0) {
      notify('Enter a valid payment amount.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const chosenTable = tables.find((t) => t.id === selectedTableId) || null;
      const result = await submitOrderOfflineAware({
        orderType,
        table: chosenTable,
        customerId: cartCustomerId,
        customerName: cartCustomerName,
        customerPhone: cartCustomerPhone,
        deliveryAddress: cartDeliveryAddress,
        deliveryCharge: totals.deliveryCharge,
        cartItems: cart,
        cartDiscountPercent,
        notes: cartNotes,
        payments: payLater ? [] : splitPayments,
        payLater,
        actorUid: firebaseUser.uid,
        actorName: profile.displayName,
        actorEmail: profile.email,
        actorRole: activeRole,
        staffUids: activeStaffUids,
        catalogProducts: products,
        catalogVariants: variants,
        catalogAddons: addons,
        recipeItems,
        settings,
      });

      const snapshotOrder: Order = result.offlineOrder || {
        id: result.orderId,
        orderNumber: result.orderNumber,
        orderType,
        status: 'NEW',
        paymentStatus: payLater
          ? 'PENDING'
          : totalTendered >= totals.grandTotal
            ? 'PAID'
            : 'PARTIAL',
        tableId: chosenTable?.id || '',
        tableName: chosenTable?.name || '',
        customerId: cartCustomerId,
        customerName: cartCustomerName || (orderType === 'DINE_IN' ? 'Dine-In Guest' : 'Walk-In Guest'),
        customerPhone: cartCustomerPhone,
        deliveryAddress: cartDeliveryAddress,
        deliveryCharge: totals.deliveryCharge,
        subtotal: totals.subtotal,
        itemDiscountTotal: totals.itemDiscountTotal,
        cartDiscountPercent,
        cartDiscountAmount: totals.cartDiscountAmount,
        taxRate: settings.taxRate,
        taxAmount: totals.taxAmount,
        serviceChargeAmount: totals.serviceChargeAmount,
        grandTotal: totals.grandTotal,
        paidAmount: payLater ? 0 : totalTendered,
        paymentMethodsSummary: payLater
          ? 'PENDING'
          : Array.from(new Set(splitPayments.filter((p) => p.amount > 0).map((p) => p.method))).join(' + '),
        itemCount: cart.reduce((s, i) => s + i.quantity, 0),
        itemsPreview: cart.map((i) => `${i.quantity}x ${i.productName}`).join(', '),
        notes: cartNotes,
        cancelReason: '',
        inventoryDeducted: !payLater && settings.autoDeductInventory,
        createdByUid: firebaseUser.uid,
        createdByName: profile.displayName,
        staffUids: activeStaffUids,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (result.queuedOffline) {
        await refreshOfflineState();
        notify(
          `Saved offline (${result.orderNumber}) — will sync automatically when online.`,
          'info'
        );
      } else {
        notify(`Order ${result.orderNumber} sent to Kitchen Display!`, 'success');
      }
      setShowPaymentModal(false);
      clearCart();

      const freshOrder = orders.find((o) => o.id === result.orderId);
      setCompletedOrder(result.offlineOrder || freshOrder || snapshotOrder);
    } catch (err: any) {
      notify(err?.message || 'Failed to save order. Your cart is safely preserved.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const splitSum = splitPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col lg:flex-row overflow-hidden">
      {/* LEFT SECTION: Categories, Search, Product Grid */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-stone-50 dark:bg-stone-950">
        {/* Search & Veg Filter Bar */}
        <div className="p-3 sm:p-4 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chicken shawarma, falafel, fries, drinks..."
                className="w-full min-h-[42px] pl-9 pr-8 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setVegOnly((v) => !v)}
              className={`min-h-[42px] px-3.5 py-2 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                vegOnly
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300'
              }`}
            >
              Veg Only
            </button>
          </div>

          {/* Horizontal Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveCategoryId('ALL')}
              className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeCategoryId === 'ALL'
                  ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                  : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
              }`}
            >
              All Items
            </button>
            {activeCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategoryId(cat.id)}
                className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  activeCategoryId === cat.id
                    ? 'bg-orange-600 text-white'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Product Cards Grid */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          {filteredProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <ShoppingBag className="w-10 h-10 text-stone-300 dark:text-stone-700 mb-3" />
              <p className="text-sm font-medium text-stone-600 dark:text-stone-400">
                No menu products match your filter.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredProducts.map((prod) => {
                const prodVariants = variants.filter((v) => v.productId === prod.id);
                const hasCustom = prodVariants.length > 0 || prod.addonGroupIds.length > 0;
                return (
                  <div
                    key={prod.id}
                    className={`group bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden flex flex-col transition-all ${
                      prod.isAvailable
                        ? 'hover:border-orange-500 dark:hover:border-orange-500'
                        : 'opacity-55'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleQuickProductTap(prod)}
                      className="text-left flex-1 flex flex-col cursor-pointer"
                    >
                      <div className="relative aspect-[4/3] w-full bg-stone-200 dark:bg-stone-800 overflow-hidden">
                        {prod.imageUrl ? (
                          <img
                            src={prod.imageUrl}
                            alt={prod.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-stone-400">
                            <UtensilsCrossed className="w-8 h-8" />
                          </div>
                        )}
                        {!prod.isAvailable && (
                          <div className="absolute inset-0 bg-stone-950/65 flex items-center justify-center">
                            <span className="text-xs font-bold uppercase tracking-wider text-white">
                              Unavailable
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400 mb-0.5">
                            <span
                              className={
                                prod.isVeg
                                  ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                                  : 'font-semibold text-red-600 dark:text-red-400'
                              }
                            >
                              {prod.isVeg ? 'Veg' : 'Non-Veg'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{prod.categoryName}</span>
                          </div>
                          <h4 className="font-semibold text-sm text-stone-900 dark:text-stone-100 leading-snug line-clamp-2">
                            {prod.name}
                          </h4>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <span className="font-mono-num font-bold text-sm text-stone-900 dark:text-stone-100">
                            {formatCurrency(prod.basePrice, sym)}
                          </span>
                          {hasCustom && prod.isAvailable && (
                            <span className="text-[11px] text-orange-600 dark:text-orange-400 font-medium inline-flex items-center gap-1">
                              <SlidersHorizontal className="w-3 h-3" /> Options
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT SECTION: Active Cart, Order Type, Table/Customer, Checkout */}
      <div className="w-full lg:w-[410px] xl:w-[440px] shrink-0 bg-white dark:bg-stone-900 border-t lg:border-t-0 lg:border-l border-stone-200 dark:border-stone-800 flex flex-col h-[52vh] lg:h-full">
        {/* Order Type & Context */}
        <div className="p-3.5 border-b border-stone-200 dark:border-stone-800 space-y-2.5">
          <div className="grid grid-cols-3 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg">
            {(['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as OrderType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setOrderType(t)}
                className={`min-h-[36px] py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  orderType === t
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'text-stone-600 dark:text-stone-300 hover:text-stone-900'
                }`}
              >
                {t === 'DINE_IN' ? 'Dine In' : t === 'TAKEAWAY' ? 'Takeaway' : 'Delivery'}
              </button>
            ))}
          </div>

          {orderType === 'DINE_IN' && (
            <select
              value={selectedTableId}
              onChange={(e) => setSelectedTableId(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-xs font-medium text-stone-900 dark:text-stone-100"
            >
              <option value="">Select Table Number...</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tableNumber} — {t.name} ({t.capacity} seats) · {t.status}
                </option>
              ))}
            </select>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <UserSearch className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="tel"
                value={cartCustomerPhone}
                onChange={(e) => lookupCustomerByPhone(e.target.value)}
                placeholder={orderType === 'DELIVERY' ? 'Phone *' : 'Mobile (optional)'}
                className="w-full min-h-[36px] pl-8 pr-2.5 py-1 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
              />
            </div>
            <input
              type="text"
              value={cartCustomerName}
              onChange={(e) => setCartCustomerName(e.target.value)}
              placeholder="Customer Name"
              className="w-full min-h-[36px] px-2.5 py-1 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
            />
          </div>

          {orderType === 'DELIVERY' && (
            <input
              type="text"
              value={cartDeliveryAddress}
              onChange={(e) => setCartDeliveryAddress(e.target.value)}
              placeholder="Delivery Address *"
              className="w-full min-h-[36px] px-2.5 py-1 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
            />
          )}
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800 px-3.5">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-10">
              <ShoppingBag className="w-8 h-8 text-stone-300 dark:text-stone-700 mb-2" />
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                Tap any menu item on the left to start billing
              </p>
            </div>
          ) : (
            cart.map((item) => {
              const addonsUnit = item.addons.reduce((s, a) => s + a.price, 0);
              const lineTotal = Math.max(
                0,
                (item.unitPrice + addonsUnit) * item.quantity - item.itemDiscountAmount
              );
              return (
                <div key={item.cartKey} className="py-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 leading-tight">
                        {item.productName}
                        {item.variantName ? ` (${item.variantName})` : ''}
                      </p>
                      {item.addons.length > 0 && (
                        <p className="text-[11px] text-stone-500 dark:text-stone-400">
                          + {item.addons.map((a) => a.addonName).join(', ')}
                        </p>
                      )}
                      {item.specialInstructions && (
                        <p className="text-[11px] text-orange-600 dark:text-orange-400">
                          Note: {item.specialInstructions}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.cartKey)}
                      aria-label="Remove item"
                      className="p-1 text-stone-400 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateCartQty(item.cartKey, -1)}
                        className="w-8 h-8 rounded-lg border border-stone-200 dark:border-stone-700 flex items-center justify-center text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-8 text-center text-xs font-mono-num font-bold text-stone-900 dark:text-stone-100">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateCartQty(item.cartKey, 1)}
                        className="w-8 h-8 rounded-lg border border-stone-200 dark:border-stone-700 flex items-center justify-center text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={item.itemDiscountAmount || ''}
                        onChange={(e) =>
                          updateCartItemDiscount(item.cartKey, Number(e.target.value) || 0)
                        }
                        placeholder="Disc"
                        title="Item-wise discount"
                        className="w-16 px-2 py-1 text-[11px] font-mono-num rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-right"
                      />
                      <span className="font-mono-num font-bold text-sm text-stone-900 dark:text-stone-100 w-16 text-right">
                        {formatCurrency(lineTotal, sym)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Totals & Checkout Actions */}
        <div className="p-3.5 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/80 space-y-2.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={cartNotes}
              onChange={(e) => setCartNotes(e.target.value)}
              placeholder="Kitchen note / order instructions..."
              className="flex-1 min-h-[34px] px-2.5 py-1 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800"
            />
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[11px] text-stone-500">Disc%</span>
              <input
                type="number"
                min={0}
                max={100}
                value={cartDiscountPercent || ''}
                onChange={(e) => setCartDiscountPercent(Number(e.target.value) || 0)}
                className="w-14 min-h-[34px] px-2 py-1 text-xs font-mono-num text-right rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800"
              />
            </div>
          </div>

          <div className="space-y-1 text-xs text-stone-600 dark:text-stone-400">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-mono-num">{formatCurrency(totals.subtotal, sym)}</span>
            </div>
            {(totals.itemDiscountTotal > 0 || totals.cartDiscountAmount > 0) && (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <span>Discounts</span>
                <span className="font-mono-num">
                  -{formatCurrency(totals.itemDiscountTotal + totals.cartDiscountAmount, sym)}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Tax / GST ({settings.taxRate}%)</span>
              <span className="font-mono-num">{formatCurrency(totals.taxAmount, sym)}</span>
            </div>
            {totals.serviceChargeAmount > 0 && (
              <div className="flex justify-between">
                <span>Service Charge ({settings.serviceChargeRate}%)</span>
                <span className="font-mono-num">
                  {formatCurrency(totals.serviceChargeAmount, sym)}
                </span>
              </div>
            )}
            {totals.deliveryCharge > 0 && (
              <div className="flex justify-between">
                <span>Delivery Charge</span>
                <span className="font-mono-num">{formatCurrency(totals.deliveryCharge, sym)}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline pt-1.5 border-t border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100">
              <span className="font-semibold text-sm">Grand Total</span>
              <span className="font-mono-num font-bold text-xl">
                {formatCurrency(totals.grandTotal, sym)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              disabled={cart.length === 0 || submitting}
              onClick={() => submitOrder(true)}
              className="min-h-[44px] px-3 py-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-xs font-semibold text-stone-800 dark:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-700 disabled:opacity-45 transition-colors cursor-pointer"
            >
              Send KOT (Pay Later)
            </button>
            <button
              type="button"
              disabled={cart.length === 0 || submitting}
              onClick={openPaymentModal}
              className="min-h-[44px] px-3 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold disabled:opacity-45 transition-colors cursor-pointer"
            >
              Pay &amp; Print Bill
            </button>
          </div>
        </div>
      </div>

      {/* Product Customization Modal */}
      {customizingProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl max-w-lg w-full max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">
                  {customizingProduct.name}
                </h3>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Select portion size, add-ons, or preparation instructions
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustomizingProduct(null)}
                className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5">
              {/* Variants */}
              {variants.filter((v) => v.productId === customizingProduct.id).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Portion / Size
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {variants
                      .filter((v) => v.productId === customizingProduct.id)
                      .map((v) => {
                        const active = selectedVariant?.id === v.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setSelectedVariant(v)}
                            className={`min-h-[42px] px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                              active
                                ? 'border-orange-600 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300'
                                : 'border-stone-200 dark:border-stone-700 text-stone-800 dark:text-stone-200'
                            }`}
                          >
                            <span>{v.name}</span>
                            <span className="font-mono-num">{formatCurrency(v.price, sym)}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Add-on Groups */}
              {customizingProduct.addonGroupIds.map((gid) => {
                const group = addonGroups.find((g) => g.id === gid);
                const groupAddons = addons.filter((a) => a.groupId === gid && a.isAvailable);
                if (!group || groupAddons.length === 0) return null;

                return (
                  <div key={gid} className="space-y-2">
                    <p className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                      {group.name}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {groupAddons.map((addon) => {
                        const checked = selectedAddonIds.includes(addon.id);
                        return (
                          <button
                            key={addon.id}
                            type="button"
                            onClick={() =>
                              setSelectedAddonIds((prev) =>
                                prev.includes(addon.id)
                                  ? prev.filter((id) => id !== addon.id)
                                  : [...prev, addon.id]
                              )
                            }
                            className={`min-h-[40px] px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                              checked
                                ? 'border-orange-600 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 font-semibold'
                                : 'border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300'
                            }`}
                          >
                            <span className="truncate">{addon.name}</span>
                            <span className="font-mono-num shrink-0">
                              {addon.price > 0 ? `+${formatCurrency(addon.price, sym)}` : 'Free'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                  Special Kitchen Instructions
                </label>
                <input
                  type="text"
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="e.g., Less spicy, crisp pita, pack sauce separately..."
                  className="w-full min-h-[40px] px-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                />
              </div>
            </div>

            <div className="p-4 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCustomizingProduct(null)}
                className="min-h-[40px] px-4 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmCustomAdd}
                className="min-h-[40px] px-5 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                Add to Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment & Split Billing Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl max-w-lg w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-orange-600" />
                <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">
                  Settle Payment
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-4 rounded-xl bg-stone-50 dark:bg-stone-800/70 border border-stone-200 dark:border-stone-700 flex items-center justify-between">
                <span className="text-sm font-medium text-stone-600 dark:text-stone-300">
                  Bill Amount Payable
                </span>
                <span className="text-2xl font-bold font-mono-num text-stone-900 dark:text-stone-100">
                  {formatCurrency(totals.grandTotal, sym)}
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    Payment Methods (Supports Split Payment)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const rem = Math.max(0, Number((totals.grandTotal - splitSum).toFixed(2)));
                      setSplitPayments((prev) => [
                        ...prev,
                        { method: 'UPI', amount: rem, referenceNumber: '' },
                      ]);
                    }}
                    className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline cursor-pointer"
                  >
                    + Add Split Payment
                  </button>
                </div>

                {splitPayments.map((entry, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center"
                  >
                    <select
                      value={entry.method}
                      onChange={(e) => {
                        const val = e.target.value as PaymentMethod;
                        setSplitPayments((prev) =>
                          prev.map((p, i) => (i === idx ? { ...p, method: val } : p))
                        );
                      }}
                      className="col-span-4 min-h-[40px] px-2.5 py-2 text-xs font-medium rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                    >
                      <option value="CASH">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">Card</option>
                      <option value="ONLINE">Online</option>
                    </select>

                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={entry.amount || ''}
                      onChange={(e) => {
                        const amt = Number(e.target.value) || 0;
                        setSplitPayments((prev) =>
                          prev.map((p, i) => (i === idx ? { ...p, amount: amt } : p))
                        );
                      }}
                      placeholder="Amount"
                      className="col-span-4 min-h-[40px] px-3 py-2 text-xs font-mono-num font-semibold rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-right"
                    />

                    <input
                      type="text"
                      value={entry.referenceNumber}
                      onChange={(e) => {
                        const ref = e.target.value;
                        setSplitPayments((prev) =>
                          prev.map((p, i) => (i === idx ? { ...p, referenceNumber: ref } : p))
                        );
                      }}
                      placeholder="Ref / Txn ID"
                      className="col-span-3 min-h-[40px] px-2.5 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                    />

                    {splitPayments.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setSplitPayments((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="col-span-1 p-2 text-stone-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-between text-xs pt-2 border-t border-stone-200 dark:border-stone-800">
                <span className="text-stone-500">Total Entered</span>
                <span className="font-mono-num font-bold text-stone-900 dark:text-stone-100">
                  {formatCurrency(splitSum, sym)}
                  {splitSum > totals.grandTotal && (
                    <span className="text-emerald-600 ml-2">
                      (Change: {formatCurrency(splitSum - totals.grandTotal, sym)})
                    </span>
                  )}
                  {splitSum < totals.grandTotal && (
                    <span className="text-amber-600 ml-2">
                      (Balance: {formatCurrency(totals.grandTotal - splitSum, sym)})
                    </span>
                  )}
                </span>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="min-h-[42px] px-4 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-semibold"
              >
                Back
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => submitOrder(false)}
                className="min-h-[42px] px-6 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {submitting ? 'Processing...' : 'Complete Order & Print'}
              </button>
            </div>
          </div>
        </div>
      )}

      {completedOrder && (
        <ReceiptModal
          order={completedOrder}
          settings={settings}
          mode="RECEIPT"
          onClose={() => setCompletedOrder(null)}
        />
      )}
    </div>
  );
};
