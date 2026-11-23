import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Edit2, Plus, Trash2, X } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { formatCurrency } from '../lib/permissions';
import { removeDocument, saveProductAndVariants } from '../lib/posService';
import { PRODUCT_IMAGE_PRESETS } from '../lib/seedData';
import { Product } from '../types/pos';

type MenuTab = 'products' | 'categories' | 'addons';

export const MenuManagementView: React.FC = () => {
  const {
    categories,
    products,
    variants,
    addonGroups,
    addons,
    settings,
    firebaseUser,
    notify,
  } = usePos();

  const [tab, setTab] = useState<MenuTab>('products');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);

  // Product Form state
  const [pName, setPName] = useState('');
  const [pCategoryId, setPCategoryId] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pPrice, setPPrice] = useState(140);
  const [pTax, setPTax] = useState(5);
  const [pVeg, setPVeg] = useState(false);
  const [pAvail, setPAvail] = useState(true);
  const [pImage, setPImage] = useState(PRODUCT_IMAGE_PRESETS.chickenShawarma);
  const [pFrom, setPFrom] = useState('00:00');
  const [pTo, setPTo] = useState('23:59');
  const [pAddonGroups, setPAddonGroups] = useState<string[]>([]);
  const [pVariants, setPVariants] = useState<
    { id?: string; name: string; price: number; isDefault: boolean }[]
  >([]);

  // Category Form state
  const [catName, setCatName] = useState('');
  const [catOrder, setCatOrder] = useState(10);
  const [catFrom, setCatFrom] = useState('00:00');
  const [catTo, setCatTo] = useState('23:59');

  // Addon Group & Addon Form state
  const [grpName, setGrpName] = useState('');
  const [grpMax, setGrpMax] = useState(4);
  const [addonGroupId, setAddonGroupId] = useState('');
  const [addonName, setAddonName] = useState('');
  const [addonPrice, setAddonPrice] = useState(30);

  const sym = settings.currencySymbol || '₹';

  const openNewProduct = () => {
    setEditingProduct(null);
    setPName('');
    setPCategoryId(categories[0]?.id || '');
    setPDesc('');
    setPPrice(140);
    setPTax(settings.taxRate || 5);
    setPVeg(false);
    setPAvail(true);
    setPImage(PRODUCT_IMAGE_PRESETS.chickenShawarma);
    setPFrom('00:00');
    setPTo('23:59');
    setPAddonGroups([]);
    setPVariants([]);
    setShowProductForm(true);
  };

  const openEditProduct = (prod: Product) => {
    setEditingProduct(prod);
    setPName(prod.name);
    setPCategoryId(prod.categoryId);
    setPDesc(prod.description);
    setPPrice(prod.basePrice);
    setPTax(prod.taxRate);
    setPVeg(prod.isVeg);
    setPAvail(prod.isAvailable);
    setPImage(prod.imageUrl || PRODUCT_IMAGE_PRESETS.chickenShawarma);
    setPFrom(prod.availableFrom || '00:00');
    setPTo(prod.availableTo || '23:59');
    setPAddonGroups(prod.addonGroupIds || []);
    setPVariants(
      variants
        .filter((v) => v.productId === prod.id)
        .map((v) => ({ id: v.id, name: v.name, price: v.price, isDefault: v.isDefault }))
    );
    setShowProductForm(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !pName.trim() || !pCategoryId) return;
    const cat = categories.find((c) => c.id === pCategoryId);
    const existingVarIds = editingProduct
      ? variants.filter((v) => v.productId === editingProduct.id).map((v) => v.id)
      : [];

    try {
      await saveProductAndVariants({
        productId: editingProduct?.id,
        categoryId: pCategoryId,
        categoryName: cat?.name || 'Uncategorized',
        name: pName,
        description: pDesc,
        basePrice: Number(pPrice) || 0,
        imageUrl: pImage,
        isAvailable: pAvail,
        isVeg: pVeg,
        taxRate: Number(pTax) || 0,
        availableFrom: pFrom,
        availableTo: pTo,
        addonGroupIds: pAddonGroups,
        variants: pVariants.filter((v) => v.name.trim()),
        existingVariantIds: existingVarIds,
        uid: firebaseUser.uid,
      });
      notify(editingProduct ? 'Product updated.' : 'Product created.', 'success');
      setShowProductForm(false);
    } catch (err: any) {
      notify(err?.message || 'Failed to save product.', 'error');
    }
  };

  const toggleProductAvailability = async (prod: Product) => {
    try {
      await updateDoc(doc(db, 'products', prod.id), {
        isAvailable: !prod.isAvailable,
        updatedAt: serverTimestamp(),
      });
      notify(`${prod.name} marked ${!prod.isAvailable ? 'available' : 'unavailable'}.`, 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `products/${prod.id}`);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !catName.trim()) return;
    const id = `cat_${Date.now()}`;
    try {
      await setDoc(doc(db, 'categories', id), {
        name: catName.trim(),
        sortOrder: Number(catOrder) || 1,
        isActive: true,
        availableFrom: catFrom,
        availableTo: catTo,
        createdByUid: firebaseUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setCatName('');
      notify('Category created.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `categories/${id}`);
    }
  };

  const handleAddAddonGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !grpName.trim()) return;
    const id = `grp_${Date.now()}`;
    try {
      await setDoc(doc(db, 'addon_groups', id), {
        name: grpName.trim(),
        isRequired: false,
        maxSelect: Math.max(1, grpMax),
        createdByUid: firebaseUser.uid,
        createdAt: serverTimestamp(),
      });
      setGrpName('');
      notify('Add-on group created.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `addon_groups/${id}`);
    }
  };

  const handleAddAddon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !addonName.trim() || !(addonGroupId || addonGroups[0]?.id)) return;
    const id = `add_${Date.now()}`;
    try {
      await setDoc(doc(db, 'addons', id), {
        groupId: addonGroupId || addonGroups[0].id,
        name: addonName.trim(),
        price: Math.max(0, Number(addonPrice) || 0),
        isAvailable: true,
        createdByUid: firebaseUser.uid,
        createdAt: serverTimestamp(),
      });
      setAddonName('');
      notify('Add-on created.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `addons/${id}`);
    }
  };

  const presetOptions = useMemo(
    () => [
      { label: 'Classic Chicken Shawarma', url: PRODUCT_IMAGE_PRESETS.chickenShawarma },
      { label: 'Special Cheese Shawarma', url: PRODUCT_IMAGE_PRESETS.specialShawarma },
      { label: 'Veg Falafel Shawarma', url: PRODUCT_IMAGE_PRESETS.vegShawarma },
      { label: 'Burger & Roll', url: PRODUCT_IMAGE_PRESETS.burgerRoll },
      { label: 'Fries & Cooler', url: PRODUCT_IMAGE_PRESETS.friesBeverage },
    ],
    []
  );

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">
            Menu, Variants &amp; Add-ons
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {products.length} products · {categories.length} categories · {addons.length} add-on options
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg">
            {(
              [
                { id: 'products', label: 'Products' },
                { id: 'categories', label: 'Categories' },
                { id: 'addons', label: 'Add-ons' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  tab === t.id
                    ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                    : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'products' && (
            <button
              type="button"
              onClick={openNewProduct}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </button>
          )}
        </div>
      </div>

      {/* PRODUCTS TAB */}
      {tab === 'products' && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="py-3 px-4 font-medium">Product</th>
                  <th className="py-3 px-4 font-medium">Category</th>
                  <th className="py-3 px-4 font-medium">Variants</th>
                  <th className="py-3 px-4 font-medium">Timings</th>
                  <th className="py-3 px-4 font-medium text-right">Base Price</th>
                  <th className="py-3 px-4 font-medium text-center">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {products.map((prod) => {
                  const pVars = variants.filter((v) => v.productId === prod.id);
                  return (
                    <tr
                      key={prod.id}
                      className="hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={prod.imageUrl}
                            alt={prod.name}
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-lg object-cover bg-stone-200 shrink-0"
                          />
                          <div>
                            <p className="font-semibold text-stone-900 dark:text-stone-100">
                              {prod.name}
                            </p>
                            <p className="text-[11px] text-stone-500">
                              {prod.isVeg ? 'Veg' : 'Non-Veg'} · Tax {prod.taxRate}%
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-stone-700 dark:text-stone-300">
                        {prod.categoryName}
                      </td>
                      <td className="py-3 px-4 text-stone-500">
                        {pVars.length === 0
                          ? 'Standard'
                          : pVars.map((v) => `${v.name} (${formatCurrency(v.price, sym)})`).join(', ')}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-stone-500">
                        {prod.availableFrom}–{prod.availableTo}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num font-bold text-stone-900 dark:text-stone-100">
                        {formatCurrency(prod.basePrice, sym)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => toggleProductAvailability(prod)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                            prod.isAvailable
                              ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                              : 'bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-400'
                          }`}
                        >
                          {prod.isAvailable ? 'Available' : 'Disabled'}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditProduct(prod)}
                            className="p-1.5 rounded-lg text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeDocument('products', prod.id)}
                            className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CATEGORIES TAB */}
      {tab === 'categories' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleAddCategory}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-4 h-fit"
          >
            <h3 className="text-base font-semibold">Add Category</h3>
            <div>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                Category Name *
              </label>
              <input
                type="text"
                required
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="e.g., Shawarma Platters"
                className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                  Sort
                </label>
                <input
                  type="number"
                  value={catOrder}
                  onChange={(e) => setCatOrder(Number(e.target.value) || 1)}
                  className="w-full min-h-[38px] px-2.5 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                  From
                </label>
                <input
                  type="time"
                  value={catFrom}
                  onChange={(e) => setCatFrom(e.target.value)}
                  className="w-full min-h-[38px] px-2 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                  To
                </label>
                <input
                  type="time"
                  value={catTo}
                  onChange={(e) => setCatTo(e.target.value)}
                  className="w-full min-h-[38px] px-2 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full min-h-[40px] rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 cursor-pointer"
            >
              Create Category
            </button>
          </form>

          <div className="lg:col-span-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="py-3 px-4 font-medium">Order</th>
                  <th className="py-3 px-4 font-medium">Name</th>
                  <th className="py-3 px-4 font-medium">Available Timings</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {categories.map((cat) => (
                  <tr key={cat.id}>
                    <td className="py-3 px-4 font-mono-num">{cat.sortOrder}</td>
                    <td className="py-3 px-4 font-semibold">{cat.name}</td>
                    <td className="py-3 px-4 font-mono-num text-stone-500">
                      {cat.availableFrom}–{cat.availableTo}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await updateDoc(doc(db, 'categories', cat.id), {
                              isActive: !cat.isActive,
                              updatedAt: serverTimestamp(),
                            });
                            notify(
                              `${cat.name} ${!cat.isActive ? 'enabled' : 'disabled'}.`,
                              'info'
                            );
                          } catch (err) {
                            handleFirestoreError(err, OperationType.UPDATE, `categories/${cat.id}`);
                          }
                        }}
                        className="text-xs font-semibold text-orange-600 hover:underline cursor-pointer"
                      >
                        {cat.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDocument('categories', cat.id)}
                        className="text-red-600 hover:underline cursor-pointer"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ADD-ONS TAB */}
      {tab === 'addons' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="space-y-5">
            <form
              onSubmit={handleAddAddonGroup}
              className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-3"
            >
              <h3 className="text-sm font-semibold">New Add-on Group</h3>
              <input
                type="text"
                required
                value={grpName}
                onChange={(e) => setGrpName(e.target.value)}
                placeholder="e.g., Extra Dips"
                className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
              <input
                type="number"
                min={1}
                max={10}
                value={grpMax}
                onChange={(e) => setGrpMax(Number(e.target.value) || 2)}
                placeholder="Max selections"
                className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
              <button
                type="submit"
                className="w-full min-h-[38px] rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold cursor-pointer"
              >
                Add Group
              </button>
            </form>

            <form
              onSubmit={handleAddAddon}
              className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-3"
            >
              <h3 className="text-sm font-semibold">New Add-on Option</h3>
              <select
                value={addonGroupId || addonGroups[0]?.id || ''}
                onChange={(e) => setAddonGroupId(e.target.value)}
                className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              >
                {addonGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                value={addonName}
                onChange={(e) => setAddonName(e.target.value)}
                placeholder="e.g., Extra Roasted Garlic"
                className="w-full min-h-[38px] px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
              <input
                type="number"
                min={0}
                value={addonPrice}
                onChange={(e) => setAddonPrice(Number(e.target.value) || 0)}
                placeholder="Extra charge (₹)"
                className="w-full min-h-[38px] px-3 py-1.5 text-xs font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
              />
              <button
                type="submit"
                className="w-full min-h-[38px] rounded-lg bg-orange-600 text-white text-xs font-semibold cursor-pointer"
              >
                Add Option
              </button>
            </form>
          </div>

          <div className="lg:col-span-2 space-y-4">
            {addonGroups.map((g) => {
              const items = addons.filter((a) => a.groupId === g.id);
              return (
                <div
                  key={g.id}
                  className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm">{g.name}</h4>
                    <button
                      type="button"
                      onClick={() => removeDocument('addon_groups', g.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Delete Group
                    </button>
                  </div>
                  <div className="divide-y divide-stone-100 dark:divide-stone-800 text-xs">
                    {items.map((a) => (
                      <div key={a.id} className="py-2 flex items-center justify-between">
                        <span className="font-medium">{a.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-mono-num font-semibold">
                            {formatCurrency(a.price, sym)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeDocument('addons', a.id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Product Modal */}
      {showProductForm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveProduct}
            className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
              <h3 className="text-base font-bold">
                {editingProduct ? 'Edit Product' : 'Create Product'}
              </h3>
              <button
                type="button"
                onClick={() => setShowProductForm(false)}
                className="p-1.5 rounded-lg text-stone-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Product Name *</label>
                  <input
                    type="text"
                    required
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Category *</label>
                  <select
                    required
                    value={pCategoryId}
                    onChange={(e) => setPCategoryId(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium mb-1">Description</label>
                <input
                  type="text"
                  value={pDesc}
                  onChange={(e) => setPDesc(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-medium mb-1">Base Price ({sym}) *</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={pPrice}
                    onChange={(e) => setPPrice(Number(e.target.value) || 0)}
                    className="w-full min-h-[38px] px-3 py-1.5 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Tax %</label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step="0.1"
                    value={pTax}
                    onChange={(e) => setPTax(Number(e.target.value) || 0)}
                    className="w-full min-h-[38px] px-3 py-1.5 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Available From</label>
                  <input
                    type="time"
                    value={pFrom}
                    onChange={(e) => setPFrom(e.target.value)}
                    className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Available To</label>
                  <input
                    type="time"
                    value={pTo}
                    onChange={(e) => setPTo(e.target.value)}
                    className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Preset Photo</label>
                  <select
                    value={pImage}
                    onChange={(e) => setPImage(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                  >
                    {presetOptions.map((o) => (
                      <option key={o.url} value={o.url}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Or Custom Image URL</label>
                  <input
                    type="text"
                    value={pImage}
                    onChange={(e) => setPImage(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                  />
                </div>
              </div>

              <div className="flex items-center gap-6">
                <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pVeg}
                    onChange={(e) => setPVeg(e.target.checked)}
                  />
                  Vegetarian Item
                </label>
                <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pAvail}
                    onChange={(e) => setPAvail(e.target.checked)}
                  />
                  Available on POS
                </label>
              </div>

              {/* Variants */}
              <div className="space-y-2 pt-2 border-t border-stone-200 dark:border-stone-800">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Variants (e.g., Regular / Large)</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPVariants((prev) => [
                        ...prev,
                        { name: 'Large', price: pPrice + 50, isDefault: prev.length === 0 },
                      ])
                    }
                    className="text-orange-600 font-semibold hover:underline cursor-pointer"
                  >
                    + Add Variant
                  </button>
                </div>
                {pVariants.map((v, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      type="text"
                      value={v.name}
                      onChange={(e) =>
                        setPVariants((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, name: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Variant Name"
                      className="col-span-5 min-h-[34px] px-2.5 rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                    />
                    <input
                      type="number"
                      min={0}
                      value={v.price}
                      onChange={(e) =>
                        setPVariants((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, price: Number(e.target.value) || 0 } : item
                          )
                        )
                      }
                      className="col-span-4 min-h-[34px] px-2.5 font-mono-num rounded border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
                    />
                    <label className="col-span-2 inline-flex items-center gap-1 text-[11px]">
                      <input
                        type="radio"
                        name="defVar"
                        checked={v.isDefault}
                        onChange={() =>
                          setPVariants((prev) =>
                            prev.map((item, i) => ({ ...item, isDefault: i === idx }))
                          )
                        }
                      />
                      Default
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setPVariants((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="col-span-1 text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add-on Groups Link */}
              <div className="space-y-2 pt-2 border-t border-stone-200 dark:border-stone-800">
                <span className="font-semibold block">Enabled Add-on Groups</span>
                <div className="flex flex-wrap gap-3">
                  {addonGroups.map((g) => (
                    <label key={g.id} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pAddonGroups.includes(g.id)}
                        onChange={(e) =>
                          setPAddonGroups((prev) =>
                            e.target.checked
                              ? [...prev, g.id]
                              : prev.filter((id) => id !== g.id)
                          )
                        }
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowProductForm(false)}
                className="px-4 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold cursor-pointer"
              >
                Save Product
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
