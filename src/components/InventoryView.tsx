import React, { useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { formatCurrency, formatTimestamp } from '../lib/permissions';
import { saveRecipeWithItems } from '../lib/posService';
import { adjustStockOfflineAware, recordPurchaseOfflineAware } from '../lib/syncEngine';
import { Ingredient, IngredientUnit, StockMovementType } from '../types/pos';

type InvTab = 'stock' | 'recipes' | 'purchases' | 'suppliers' | 'movements';

export const InventoryView: React.FC = () => {
  const {
    ingredients,
    products,
    recipes,
    recipeItems,
    suppliers,
    purchases,
    stockMovements,
    settings,
    firebaseUser,
    activeRole,
    activeStaffUids,
    notify,
    refreshOfflineState,
  } = usePos();

  const [tab, setTab] = useState<InvTab>('stock');
  const sym = settings.currencySymbol || '₹';

  // New Ingredient form
  const [ingName, setIngName] = useState('');
  const [ingUnit, setIngUnit] = useState<IngredientUnit>('gram');
  const [ingStock, setIngStock] = useState(1000);
  const [ingMin, setIngMin] = useState(200);
  const [ingCost, setIngCost] = useState(0.25);

  // Stock Adjustment / Wastage modal
  const [adjTarget, setAdjTarget] = useState<Ingredient | null>(null);
  const [adjType, setAdjType] = useState<StockMovementType>('WASTAGE');
  const [adjQty, setAdjQty] = useState(0);
  const [adjNotes, setAdjNotes] = useState('');

  // Recipe editor state
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || '');
  const [editRecipeItems, setEditRecipeItems] = useState<
    { id?: string; ingredientId: string; ingredientName: string; unit: IngredientUnit; quantityRequired: number }[]
  >([]);
  const [recipeLoadedFor, setRecipeLoadedFor] = useState('');

  // Purchase form
  const [purSupplierId, setPurSupplierId] = useState('');
  const [purInvoice, setPurInvoice] = useState('');
  const [purDate, setPurDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [purItems, setPurItems] = useState<
    { ingredientId: string; ingredientName: string; unit: IngredientUnit; quantity: number; unitCost: number }[]
  >([]);

  // Supplier form
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supAddress, setSupAddress] = useState('');

  const handleAddIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !ingName.trim()) return;
    const id = `ing_${Date.now()}`;
    try {
      await setDoc(doc(db, 'ingredients', id), {
        name: ingName.trim(),
        unit: ingUnit,
        currentStock: Math.max(0, ingStock),
        minStockAlert: Math.max(0, ingMin),
        costPerUnit: Math.max(0, ingCost),
        supplierId: suppliers[0]?.id || '',
        supplierName: suppliers[0]?.name || '',
        createdByUid: firebaseUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setIngName('');
      notify('Ingredient added to inventory.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `ingredients/${id}`);
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjTarget || !firebaseUser || adjQty === 0) return;
    const delta = adjType === 'WASTAGE' ? -Math.abs(adjQty) : adjQty;
    try {
      const res = await adjustStockOfflineAware({
        ingredient: adjTarget,
        type: adjType,
        quantityDelta: delta,
        notes: adjNotes,
        actorUid: firebaseUser.uid,
        actorEmail: firebaseUser.email || '',
        actorRole: activeRole,
        staffUids: activeStaffUids,
      });
      if (res.queuedOffline) {
        await refreshOfflineState();
        notify(`Stock adjustment for ${adjTarget.name} queued offline.`, 'info');
      } else {
        notify(`Stock updated for ${adjTarget.name}.`, 'success');
      }
      setAdjTarget(null);
      setAdjQty(0);
      setAdjNotes('');
    } catch (err: any) {
      notify(err?.message || 'Stock adjustment failed.', 'error');
    }
  };

  const loadRecipeForProduct = (pid: string) => {
    setSelectedProductId(pid);
    setRecipeLoadedFor(pid);
    const items = recipeItems
      .filter((r) => r.productId === pid)
      .map((r) => ({
        id: r.id,
        ingredientId: r.ingredientId,
        ingredientName: r.ingredientName,
        unit: r.unit,
        quantityRequired: r.quantityRequired,
      }));
    setEditRecipeItems(items);
  };

  const handleSaveRecipe = async () => {
    if (!firebaseUser || !selectedProductId) return;
    const prod = products.find((p) => p.id === selectedProductId);
    if (!prod) return;
    const existingRec = recipes.find((r) => r.productId === selectedProductId);
    const existingItemIds = recipeItems
      .filter((r) => r.productId === selectedProductId)
      .map((r) => r.id);
    try {
      await saveRecipeWithItems({
        recipeId: existingRec?.id,
        productId: prod.id,
        productName: prod.name,
        yieldQty: 1,
        notes: 'POS standard recipe',
        items: editRecipeItems.filter((i) => i.quantityRequired > 0),
        existingItemIds,
        uid: firebaseUser.uid,
      });
      notify(`Recipe saved for ${prod.name}.`, 'success');
    } catch (err: any) {
      notify(err?.message || 'Unable to save recipe.', 'error');
    }
  };

  const handleRecordPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || purItems.length === 0) return;
    const sup = suppliers.find((s) => s.id === (purSupplierId || suppliers[0]?.id));
    if (!sup) {
      notify('Add a supplier first.', 'error');
      return;
    }
    try {
      const res = await recordPurchaseOfflineAware({
        supplierId: sup.id,
        supplierName: sup.name,
        invoiceNumber: purInvoice,
        paymentStatus: 'PAID',
        purchaseDate: purDate,
        notes: 'Recorded from Inventory Console',
        items: purItems,
        actorUid: firebaseUser.uid,
        actorEmail: firebaseUser.email || '',
        actorRole: activeRole,
        staffUids: activeStaffUids,
      });
      setPurItems([]);
      setPurInvoice('');
      if (res.queuedOffline) {
        await refreshOfflineState();
        notify('Purchase queued offline — stock will sync automatically.', 'info');
      } else {
        notify('Stock purchase recorded and inventory replenished.', 'success');
      }
    } catch (err: any) {
      notify(err?.message || 'Purchase failed.', 'error');
    }
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !supName.trim()) return;
    const id = `sup_${Date.now()}`;
    try {
      await setDoc(doc(db, 'suppliers', id), {
        name: supName.trim(),
        contactPerson: supContact.trim(),
        phone: supPhone.trim(),
        email: '',
        address: supAddress.trim(),
        createdByUid: firebaseUser.uid,
        createdAt: serverTimestamp(),
      });
      setSupName('');
      setSupContact('');
      setSupPhone('');
      setSupAddress('');
      notify('Supplier saved.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `suppliers/${id}`);
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">
            Inventory, Recipes &amp; Purchases
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Automatic recipe-based ingredient deduction on paid orders
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg overflow-x-auto">
          {(
            [
              { id: 'stock', label: 'Ingredients' },
              { id: 'recipes', label: 'Recipes' },
              { id: 'purchases', label: 'Purchases' },
              { id: 'suppliers', label: 'Suppliers' },
              { id: 'movements', label: 'Stock Logs' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                if (t.id === 'recipes' && !recipeLoadedFor && products[0]) {
                  loadRecipeForProduct(products[0].id);
                }
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap cursor-pointer ${
                tab === t.id
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                  : 'text-stone-600 dark:text-stone-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* INGREDIENTS TAB */}
      {tab === 'stock' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleAddIngredient}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-3 h-fit text-xs"
          >
            <h3 className="text-sm font-semibold">Add Raw Ingredient</h3>
            <input
              type="text"
              required
              value={ingName}
              onChange={(e) => setIngName(e.target.value)}
              placeholder="Ingredient Name (e.g., Tahini Paste)"
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={ingUnit}
                onChange={(e) => setIngUnit(e.target.value as IngredientUnit)}
                className="min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              >
                <option value="gram">gram</option>
                <option value="kg">kg</option>
                <option value="ml">ml</option>
                <option value="litre">litre</option>
                <option value="pieces">pieces</option>
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                value={ingStock}
                onChange={(e) => setIngStock(Number(e.target.value) || 0)}
                placeholder="Opening Stock"
                className="min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={0}
                step="0.01"
                value={ingMin}
                onChange={(e) => setIngMin(Number(e.target.value) || 0)}
                placeholder="Min Alert Qty"
                className="min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={ingCost}
                onChange={(e) => setIngCost(Number(e.target.value) || 0)}
                placeholder="Cost / unit"
                className="min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
            </div>
            <button
              type="submit"
              className="w-full min-h-[40px] rounded-lg bg-orange-600 text-white font-semibold hover:bg-orange-700 cursor-pointer"
            >
              Add Ingredient
            </button>
          </form>

          <div className="lg:col-span-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                  <tr>
                    <th className="py-3 px-4 font-medium">Ingredient</th>
                    <th className="py-3 px-4 font-medium text-right">Current Stock</th>
                    <th className="py-3 px-4 font-medium text-right">Alert At</th>
                    <th className="py-3 px-4 font-medium text-right">Unit Cost</th>
                    <th className="py-3 px-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {ingredients.map((ing) => {
                    const isLow = ing.currentStock <= ing.minStockAlert;
                    return (
                      <tr key={ing.id}>
                        <td className="py-3 px-4 font-semibold flex items-center gap-2">
                          {isLow && <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />}
                          <span>{ing.name}</span>
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono-num font-bold ${
                            isLow ? 'text-red-600' : 'text-stone-900 dark:text-stone-100'
                          }`}
                        >
                          {ing.currentStock} {ing.unit}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num text-stone-500">
                          {ing.minStockAlert} {ing.unit}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num text-stone-500">
                          {formatCurrency(ing.costPerUnit, sym)}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setAdjTarget(ing);
                              setAdjType('WASTAGE');
                              setAdjQty(0);
                            }}
                            className="text-orange-600 font-semibold hover:underline cursor-pointer"
                          >
                            Adjust / Wastage
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* RECIPES TAB */}
      {tab === 'recipes' && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="font-semibold">Menu Product:</label>
              <select
                value={selectedProductId}
                onChange={(e) => loadRecipeForProduct(e.target.value)}
                className="min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 font-medium"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!ingredients[0]) return;
                setEditRecipeItems((prev) => [
                  ...prev,
                  {
                    ingredientId: ingredients[0].id,
                    ingredientName: ingredients[0].name,
                    unit: ingredients[0].unit,
                    quantityRequired: 50,
                  },
                ]);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add Ingredient Row
            </button>
          </div>

          <div className="space-y-2">
            {editRecipeItems.map((row, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <select
                  value={row.ingredientId}
                  onChange={(e) => {
                    const ing = ingredients.find((i) => i.id === e.target.value);
                    if (!ing) return;
                    setEditRecipeItems((prev) =>
                      prev.map((item, i) =>
                        i === idx
                          ? {
                              ...item,
                              ingredientId: ing.id,
                              ingredientName: ing.name,
                              unit: ing.unit,
                            }
                          : item
                      )
                    );
                  }}
                  className="col-span-6 min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                >
                  {ingredients.map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name} ({ing.unit})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={row.quantityRequired}
                  onChange={(e) =>
                    setEditRecipeItems((prev) =>
                      prev.map((item, i) =>
                        i === idx
                          ? { ...item, quantityRequired: Number(e.target.value) || 0 }
                          : item
                      )
                    )
                  }
                  className="col-span-3 min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-right"
                />
                <span className="col-span-2 text-stone-500">{row.unit}</span>
                <button
                  type="button"
                  onClick={() =>
                    setEditRecipeItems((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="col-span-1 text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={handleSaveRecipe}
              className="px-5 py-2 rounded-lg bg-orange-600 text-white font-semibold hover:bg-orange-700 cursor-pointer"
            >
              Save Recipe Mapping
            </button>
          </div>
        </div>
      )}

      {/* PURCHASES TAB */}
      {tab === 'purchases' && (
        <div className="grid lg:grid-cols-2 gap-6 text-xs">
          <form
            onSubmit={handleRecordPurchase}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold">Record Stock Purchase</h3>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={purSupplierId || suppliers[0]?.id || ''}
                onChange={(e) => setPurSupplierId(e.target.value)}
                className="min-h-[38px] px-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={purInvoice}
                onChange={(e) => setPurInvoice(e.target.value)}
                placeholder="Invoice #"
                className="min-h-[38px] px-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
              <input
                type="date"
                value={purDate}
                onChange={(e) => setPurDate(e.target.value)}
                className="min-h-[38px] px-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                if (!ingredients[0]) return;
                setPurItems((prev) => [
                  ...prev,
                  {
                    ingredientId: ingredients[0].id,
                    ingredientName: ingredients[0].name,
                    unit: ingredients[0].unit,
                    quantity: 1000,
                    unitCost: ingredients[0].costPerUnit,
                  },
                ]);
              }}
              className="text-orange-600 font-semibold hover:underline cursor-pointer"
            >
              + Add Purchase Line Item
            </button>

            <div className="space-y-2">
              {purItems.map((pi, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select
                    value={pi.ingredientId}
                    onChange={(e) => {
                      const ing = ingredients.find((i) => i.id === e.target.value);
                      if (!ing) return;
                      setPurItems((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? {
                                ...row,
                                ingredientId: ing.id,
                                ingredientName: ing.name,
                                unit: ing.unit,
                                unitCost: ing.costPerUnit,
                              }
                            : row
                        )
                      );
                    }}
                    className="col-span-5 min-h-[36px] px-2 rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                  >
                    {ingredients.map((ing) => (
                      <option key={ing.id} value={ing.id}>
                        {ing.name} ({ing.unit})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={pi.quantity}
                    onChange={(e) =>
                      setPurItems((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, quantity: Number(e.target.value) || 0 } : row
                        )
                      )
                    }
                    placeholder="Qty"
                    className="col-span-3 min-h-[36px] px-2 font-mono-num rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-right"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={pi.unitCost}
                    onChange={(e) =>
                      setPurItems((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, unitCost: Number(e.target.value) || 0 } : row
                        )
                      )
                    }
                    placeholder="Cost"
                    className="col-span-3 min-h-[36px] px-2 font-mono-num rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-right"
                  />
                  <button
                    type="button"
                    onClick={() => setPurItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="col-span-1 text-red-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="submit"
              disabled={purItems.length === 0}
              className="w-full min-h-[40px] rounded-lg bg-orange-600 text-white font-semibold disabled:opacity-45 cursor-pointer"
            >
              Complete Purchase &amp; Add Stock
            </button>
          </form>

          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 font-semibold">
              Purchase History
            </div>
            <table className="w-full text-left">
              <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4">Supplier</th>
                  <th className="py-2.5 px-4">Invoice</th>
                  <th className="py-2.5 px-4 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 px-4 font-mono-num">{p.purchaseDate}</td>
                    <td className="py-2.5 px-4 font-medium">{p.supplierName}</td>
                    <td className="py-2.5 px-4 font-mono-num">{p.invoiceNumber}</td>
                    <td className="py-2.5 px-4 text-right font-mono-num font-bold">
                      {formatCurrency(p.totalAmount, sym)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUPPLIERS TAB */}
      {tab === 'suppliers' && (
        <div className="grid lg:grid-cols-3 gap-6 text-xs">
          <form
            onSubmit={handleAddSupplier}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-3 h-fit"
          >
            <h3 className="text-sm font-semibold">Add Supplier</h3>
            <input
              type="text"
              required
              value={supName}
              onChange={(e) => setSupName(e.target.value)}
              placeholder="Vendor / Business Name *"
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
            <input
              type="text"
              value={supContact}
              onChange={(e) => setSupContact(e.target.value)}
              placeholder="Contact Person"
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
            <input
              type="tel"
              value={supPhone}
              onChange={(e) => setSupPhone(e.target.value)}
              placeholder="Phone Number"
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
            <input
              type="text"
              value={supAddress}
              onChange={(e) => setSupAddress(e.target.value)}
              placeholder="Address"
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
            <button
              type="submit"
              className="w-full min-h-[38px] rounded-lg bg-orange-600 text-white font-semibold cursor-pointer"
            >
              Save Supplier
            </button>
          </form>

          <div className="lg:col-span-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="py-3 px-4">Supplier</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className="py-3 px-4 font-semibold">{s.name}</td>
                    <td className="py-3 px-4">
                      {s.contactPerson} · {s.phone}
                    </td>
                    <td className="py-3 px-4 text-stone-500">{s.address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STOCK MOVEMENTS LOG */}
      {tab === 'movements' && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Ingredient</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4 text-right">Change</th>
                  <th className="py-3 px-4 text-right">Balance</th>
                  <th className="py-3 px-4">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {stockMovements.slice(0, 60).map((m) => (
                  <tr key={m.id}>
                    <td className="py-2.5 px-4 text-stone-500">
                      {formatTimestamp(m.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">{m.ingredientName}</td>
                    <td className="py-2.5 px-4">{m.type}</td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono-num font-bold ${
                        m.quantityDelta < 0 ? 'text-red-600' : 'text-emerald-600'
                      }`}
                    >
                      {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta} {m.unit}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num">
                      {m.newStock} {m.unit}
                    </td>
                    <td className="py-2.5 px-4 text-stone-500">{m.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Wastage / Stock Adjustment Modal */}
      {adjTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleAdjustStock}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl max-w-md w-full p-5 space-y-4 text-xs"
          >
            <h3 className="text-base font-bold">
              Stock Adjustment — {adjTarget.name}
            </h3>
            <p className="text-stone-500">
              Current Stock:{' '}
              <span className="font-mono-num font-bold text-stone-900 dark:text-stone-100">
                {adjTarget.currentStock} {adjTarget.unit}
              </span>
            </p>
            <select
              value={adjType}
              onChange={(e) => setAdjType(e.target.value as StockMovementType)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            >
              <option value="WASTAGE">Record Wastage (Deduct)</option>
              <option value="ADJUSTMENT">Manual Stock Adjustment (+/-)</option>
              <option value="RETURN">Return to Stock (+)</option>
            </select>
            <input
              type="number"
              step="0.01"
              required
              value={adjQty || ''}
              onChange={(e) => setAdjQty(Number(e.target.value) || 0)}
              placeholder={`Quantity in ${adjTarget.unit}`}
              className="w-full min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
            <input
              type="text"
              value={adjNotes}
              onChange={(e) => setAdjNotes(e.target.value)}
              placeholder="Reason (e.g., Spoilage, End-of-day audit)"
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdjTarget(null)}
                className="px-4 py-2 rounded-lg border border-stone-200 dark:border-stone-700 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-orange-600 text-white font-semibold cursor-pointer"
              >
                Apply Change
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
