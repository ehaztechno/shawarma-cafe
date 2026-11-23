import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { ROLE_PERMISSIONS } from './permissions';

export const PRODUCT_IMAGE_PRESETS = {
  chickenShawarma: '/src/assets/images/chicken_shawarma_classic_1795401707942.jpg',
  specialShawarma: '/src/assets/images/special_cheese_shawarma_1795401707673.jpg',
  vegShawarma: '/src/assets/images/veg_falafel_shawarma_1795401707734.jpg',
  burgerRoll: '/src/assets/images/crispy_burger_roll_1795401708028.jpg',
  friesBeverage: '/src/assets/images/fries_mint_cooler_1795401707501.jpg',
};

export async function seedShawarmaCafeData(uid: string): Promise<boolean> {
  const settingsRef = doc(db, 'restaurant_settings', 'default');
  try {
    const existingSettings = await getDoc(settingsRef);
    if (existingSettings.exists()) {
      return false;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'restaurant_settings/default');
  }

  // Batch 1: Settings, Roles, Categories, Addon Groups, Suppliers, Expense Categories, Tables
  try {
    const batch1 = writeBatch(db);

    batch1.set(settingsRef, {
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
      logoUrl: PRODUCT_IMAGE_PRESETS.chickenShawarma,
      updatedAt: serverTimestamp(),
    });

    const roleEntries = [
      {
        id: 'role_super_admin',
        code: 'SUPER_ADMIN',
        label: 'Super Admin',
        description: 'Complete system access across billing, inventory, staff, reports, and settings.',
        permissions: ROLE_PERMISSIONS.SUPER_ADMIN,
      },
      {
        id: 'role_manager',
        code: 'MANAGER',
        label: 'Manager',
        description: 'Manage daily operations, menu catalog, stock purchases, expenses, and reports.',
        permissions: ROLE_PERMISSIONS.MANAGER,
      },
      {
        id: 'role_cashier',
        code: 'CASHIER',
        label: 'Cashier',
        description: 'Create POS bills, assign tables, accept payments, and reprint permitted receipts.',
        permissions: ROLE_PERMISSIONS.CASHIER,
      },
      {
        id: 'role_kitchen',
        code: 'KITCHEN_STAFF',
        label: 'Kitchen Staff',
        description: 'View incoming Kitchen Order Tickets (KOT) and update preparation status.',
        permissions: ROLE_PERMISSIONS.KITCHEN_STAFF,
      },
    ];
    for (const r of roleEntries) {
      batch1.set(doc(db, 'roles', r.id), {
        code: r.code,
        label: r.label,
        description: r.description,
        permissions: r.permissions,
        updatedAt: serverTimestamp(),
      });
    }

    const categoriesData = [
      { id: 'cat_chicken_shawarma', name: 'Chicken Shawarma', sortOrder: 1 },
      { id: 'cat_special_shawarma', name: 'Special Shawarma', sortOrder: 2 },
      { id: 'cat_veg_shawarma', name: 'Veg Shawarma', sortOrder: 3 },
      { id: 'cat_burgers', name: 'Burgers', sortOrder: 4 },
      { id: 'cat_rolls', name: 'Rolls', sortOrder: 5 },
      { id: 'cat_fries', name: 'French Fries', sortOrder: 6 },
      { id: 'cat_beverages', name: 'Beverages', sortOrder: 7 },
      { id: 'cat_combos', name: 'Combos', sortOrder: 8 },
      { id: 'cat_addons', name: 'Extra Add-ons', sortOrder: 9 },
    ];
    for (const c of categoriesData) {
      batch1.set(doc(db, 'categories', c.id), {
        name: c.name,
        sortOrder: c.sortOrder,
        isActive: true,
        availableFrom: '00:00',
        availableTo: '23:59',
        createdByUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const addonGroups = [
      { id: 'grp_toppings', name: 'Extra Toppings & Protein', isRequired: false, maxSelect: 4 },
      { id: 'grp_sauces', name: 'Sauces & Spice Level', isRequired: false, maxSelect: 3 },
      { id: 'grp_exclusions', name: 'Preparation Preferences', isRequired: false, maxSelect: 4 },
    ];
    for (const g of addonGroups) {
      batch1.set(doc(db, 'addon_groups', g.id), {
        name: g.name,
        isRequired: g.isRequired,
        maxSelect: g.maxSelect,
        createdByUid: uid,
        createdAt: serverTimestamp(),
      });
    }

    const addons = [
      { id: 'add_extra_cheese', groupId: 'grp_toppings', name: 'Extra Cheese', price: 30 },
      { id: 'add_extra_chicken', groupId: 'grp_toppings', name: 'Extra Chicken', price: 50 },
      { id: 'add_extra_sauce', groupId: 'grp_sauces', name: 'Extra Garlic Sauce', price: 20 },
      { id: 'add_harissa', groupId: 'grp_sauces', name: 'Spicy Harissa Drizzle', price: 15 },
      { id: 'add_no_onion', groupId: 'grp_exclusions', name: 'Remove Onion', price: 0 },
      { id: 'add_no_mayo', groupId: 'grp_exclusions', name: 'Remove Mayonnaise', price: 0 },
    ];
    for (const a of addons) {
      batch1.set(doc(db, 'addons', a.id), {
        groupId: a.groupId,
        name: a.name,
        price: a.price,
        isAvailable: true,
        createdByUid: uid,
        createdAt: serverTimestamp(),
      });
    }

    const suppliers = [
      {
        id: 'sup_fresh_poultry',
        name: 'Al-Noor Fresh Poultry',
        contactPerson: 'Imran Khan',
        phone: '+91 98801 44510',
        email: 'orders@alnoorpoultry.in',
        address: 'Shivajinagar Market, Bengaluru',
      },
      {
        id: 'sup_bakery_dairy',
        name: 'Levantine Bakery & Dairy',
        contactPerson: 'Suresh Shetty',
        phone: '+91 99002 33219',
        email: 'supply@levantinebakery.in',
        address: 'Indiranagar 100ft Rd, Bengaluru',
      },
    ];
    for (const s of suppliers) {
      batch1.set(doc(db, 'suppliers', s.id), {
        name: s.name,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        address: s.address,
        createdByUid: uid,
        createdAt: serverTimestamp(),
      });
    }

    const expCats = [
      { id: 'exp_rent', name: 'Rent', description: 'Monthly cafe lease & maintenance' },
      { id: 'exp_electricity', name: 'Electricity', description: 'Power, grill gas & utilities' },
      { id: 'exp_salary', name: 'Staff Salary', description: 'Monthly wages & shift allowances' },
      { id: 'exp_raw', name: 'Raw Materials', description: 'Ad-hoc market vegetable & spice runs' },
      { id: 'exp_delivery', name: 'Delivery Expenses', description: 'Rider fuel & packaging pouches' },
      { id: 'exp_maintenance', name: 'Maintenance', description: 'Rotisserie & kitchen equipment upkeep' },
      { id: 'exp_misc', name: 'Miscellaneous', description: 'Other cafe operating costs' },
    ];
    for (const ec of expCats) {
      batch1.set(doc(db, 'expense_categories', ec.id), {
        name: ec.name,
        description: ec.description,
        createdByUid: uid,
        createdAt: serverTimestamp(),
      });
    }

    const tablesData = [
      { id: 'tbl_1', tableNumber: 'T1', name: 'Table 01', capacity: 2, zone: 'Main Hall' },
      { id: 'tbl_2', tableNumber: 'T2', name: 'Table 02', capacity: 2, zone: 'Main Hall' },
      { id: 'tbl_3', tableNumber: 'T3', name: 'Table 03', capacity: 4, zone: 'Main Hall' },
      { id: 'tbl_4', tableNumber: 'T4', name: 'Table 04', capacity: 4, zone: 'Main Hall' },
      { id: 'tbl_5', tableNumber: 'T5', name: 'Table 05', capacity: 6, zone: 'Family Booth' },
      { id: 'tbl_6', tableNumber: 'T6', name: 'Table 06', capacity: 6, zone: 'Family Booth' },
      { id: 'tbl_7', tableNumber: 'P1', name: 'Patio 01', capacity: 4, zone: 'Outdoor Patio' },
      { id: 'tbl_8', tableNumber: 'P2', name: 'Patio 02', capacity: 4, zone: 'Outdoor Patio' },
    ];
    for (const t of tablesData) {
      batch1.set(doc(db, 'tables', t.id), {
        tableNumber: t.tableNumber,
        name: t.name,
        capacity: t.capacity,
        zone: t.zone,
        status: 'AVAILABLE',
        currentOrderId: '',
        currentOrderNumber: '',
        createdByUid: uid,
        updatedAt: serverTimestamp(),
      });
    }

    await batch1.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'seed_batch_1');
  }

  // Batch 2: Products (needs categories to exist first!), Variants, Ingredients, Recipes & Recipe Items
  try {
    const batch2 = writeBatch(db);

    const shawarmaGroups = ['grp_toppings', 'grp_sauces', 'grp_exclusions'];
    const snackGroups = ['grp_sauces', 'grp_exclusions'];

    const productsData = [
      {
        id: 'prod_classic_chicken',
        categoryId: 'cat_chicken_shawarma',
        categoryName: 'Chicken Shawarma',
        name: 'Classic Chicken Shawarma',
        description: 'Charcoal-roasted marinated chicken, creamy garlic toum, pickled turnips in warm pita.',
        basePrice: 140,
        imageUrl: PRODUCT_IMAGE_PRESETS.chickenShawarma,
        isVeg: false,
        addonGroupIds: shawarmaGroups,
        variants: [
          { id: 'var_classic_reg', name: 'Regular', price: 140, isDefault: true },
          { id: 'var_classic_lrg', name: 'Large', price: 190, isDefault: false },
        ],
      },
      {
        id: 'prod_rumali_chicken',
        categoryId: 'cat_chicken_shawarma',
        categoryName: 'Chicken Shawarma',
        name: 'Rumali Chicken Shawarma',
        description: 'Thin hand-stretched rumali wrap packed with roasted chicken & house mayo.',
        basePrice: 150,
        imageUrl: PRODUCT_IMAGE_PRESETS.chickenShawarma,
        isVeg: false,
        addonGroupIds: shawarmaGroups,
        variants: [
          { id: 'var_rumali_reg', name: 'Regular', price: 150, isDefault: true },
          { id: 'var_rumali_lrg', name: 'Large', price: 210, isDefault: false },
        ],
      },
      {
        id: 'prod_peri_peri_shawarma',
        categoryId: 'cat_special_shawarma',
        categoryName: 'Special Shawarma',
        name: 'Peri-Peri Cheese Shawarma',
        description: 'Smoky roasted chicken tossed in peri-peri glaze with melted cheddar & jalapenos.',
        basePrice: 180,
        imageUrl: PRODUCT_IMAGE_PRESETS.specialShawarma,
        isVeg: false,
        addonGroupIds: shawarmaGroups,
        variants: [
          { id: 'var_peri_reg', name: 'Regular', price: 180, isDefault: true },
          { id: 'var_peri_lrg', name: 'Large', price: 240, isDefault: false },
        ],
      },
      {
        id: 'prod_whole_meat',
        categoryId: 'cat_special_shawarma',
        categoryName: 'Special Shawarma',
        name: 'Whole Meat Arabic Shawarma',
        description: 'Double roasted chicken without filler veggies, served with garlic toum.',
        basePrice: 210,
        imageUrl: PRODUCT_IMAGE_PRESETS.specialShawarma,
        isVeg: false,
        addonGroupIds: shawarmaGroups,
        variants: [
          { id: 'var_whole_reg', name: 'Regular', price: 210, isDefault: true },
          { id: 'var_whole_lrg', name: 'Large', price: 270, isDefault: false },
        ],
      },
      {
        id: 'prod_falafel_shawarma',
        categoryId: 'cat_veg_shawarma',
        categoryName: 'Veg Shawarma',
        name: 'Crispy Falafel Shawarma',
        description: 'Herb-crusted chickpea falafel, purple cabbage, tomato & tahini sauce.',
        basePrice: 120,
        imageUrl: PRODUCT_IMAGE_PRESETS.vegShawarma,
        isVeg: true,
        addonGroupIds: shawarmaGroups,
        variants: [
          { id: 'var_falafel_reg', name: 'Regular', price: 120, isDefault: true },
          { id: 'var_falafel_lrg', name: 'Large', price: 165, isDefault: false },
        ],
      },
      {
        id: 'prod_paneer_tikka_shawarma',
        categoryId: 'cat_veg_shawarma',
        categoryName: 'Veg Shawarma',
        name: 'Smoked Paneer Shawarma',
        description: 'Char-grilled spiced paneer cubes, crunchy slaw & mint garlic dressing.',
        basePrice: 150,
        imageUrl: PRODUCT_IMAGE_PRESETS.vegShawarma,
        isVeg: true,
        addonGroupIds: shawarmaGroups,
        variants: [
          { id: 'var_paneer_reg', name: 'Regular', price: 150, isDefault: true },
          { id: 'var_paneer_lrg', name: 'Large', price: 200, isDefault: false },
        ],
      },
      {
        id: 'prod_zinger_burger',
        categoryId: 'cat_burgers',
        categoryName: 'Burgers',
        name: 'Crispy Chicken Zinger Burger',
        description: 'Golden fried chicken breast, cheddar slice, crisp iceberg & spicy burger sauce.',
        basePrice: 160,
        imageUrl: PRODUCT_IMAGE_PRESETS.burgerRoll,
        isVeg: false,
        addonGroupIds: snackGroups,
        variants: [],
      },
      {
        id: 'prod_falafel_burger',
        categoryId: 'cat_burgers',
        categoryName: 'Burgers',
        name: 'Mediterranean Falafel Burger',
        description: 'Crunchy herb falafel patty with tahini mayo & pickled cucumbers.',
        basePrice: 130,
        imageUrl: PRODUCT_IMAGE_PRESETS.burgerRoll,
        isVeg: true,
        addonGroupIds: snackGroups,
        variants: [],
      },
      {
        id: 'prod_chicken_kathi_roll',
        categoryId: 'cat_rolls',
        categoryName: 'Rolls',
        name: 'Roasted Chicken Tikka Roll',
        description: 'Flaky paratha roll stuffed with roasted chicken, onions & mint mayo.',
        basePrice: 145,
        imageUrl: PRODUCT_IMAGE_PRESETS.burgerRoll,
        isVeg: false,
        addonGroupIds: snackGroups,
        variants: [],
      },
      {
        id: 'prod_classic_fries',
        categoryId: 'cat_fries',
        categoryName: 'French Fries',
        name: 'Salted Classic Fries',
        description: 'Crispy golden skin-on fries tossed in sea salt.',
        basePrice: 90,
        imageUrl: PRODUCT_IMAGE_PRESETS.friesBeverage,
        isVeg: true,
        addonGroupIds: snackGroups,
        variants: [
          { id: 'var_fries_reg', name: 'Regular', price: 90, isDefault: true },
          { id: 'var_fries_lrg', name: 'Large', price: 130, isDefault: false },
        ],
      },
      {
        id: 'prod_peri_fries',
        categoryId: 'cat_fries',
        categoryName: 'French Fries',
        name: 'Peri-Peri Loaded Fries',
        description: 'Crispy fries dusted in spicy peri-peri blend with garlic dip.',
        basePrice: 120,
        imageUrl: PRODUCT_IMAGE_PRESETS.friesBeverage,
        isVeg: true,
        addonGroupIds: snackGroups,
        variants: [],
      },
      {
        id: 'prod_mint_cooler',
        categoryId: 'cat_beverages',
        categoryName: 'Beverages',
        name: 'Fresh Mint Lime Cooler',
        description: 'Crushed fresh mint, sparkling soda, lime juice & ice.',
        basePrice: 80,
        imageUrl: PRODUCT_IMAGE_PRESETS.friesBeverage,
        isVeg: true,
        addonGroupIds: [],
        variants: [],
      },
      {
        id: 'prod_iced_cola',
        categoryId: 'cat_beverages',
        categoryName: 'Beverages',
        name: 'Chilled Craft Cola (350ml)',
        description: 'Ice-cold fountain cola with a hint of fresh lemon.',
        basePrice: 60,
        imageUrl: PRODUCT_IMAGE_PRESETS.friesBeverage,
        isVeg: true,
        addonGroupIds: [],
        variants: [],
      },
      {
        id: 'prod_shawarma_combo',
        categoryId: 'cat_combos',
        categoryName: 'Combos',
        name: 'Classic Shawarma Meal Combo',
        description: '1 Classic Chicken Shawarma + Regular Fries + Fresh Mint Cooler.',
        basePrice: 270,
        imageUrl: PRODUCT_IMAGE_PRESETS.chickenShawarma,
        isVeg: false,
        addonGroupIds: shawarmaGroups,
        variants: [],
      },
      {
        id: 'prod_garlic_dip_cup',
        categoryId: 'cat_addons',
        categoryName: 'Extra Add-ons',
        name: 'Garlic Toum Dip Cup',
        description: 'House whipped Lebanese garlic emulsion cup (60ml).',
        basePrice: 30,
        imageUrl: PRODUCT_IMAGE_PRESETS.chickenShawarma,
        isVeg: true,
        addonGroupIds: [],
        variants: [],
      },
    ];

    for (const p of productsData) {
      batch2.set(doc(db, 'products', p.id), {
        categoryId: p.categoryId,
        categoryName: p.categoryName,
        name: p.name,
        description: p.description,
        basePrice: p.basePrice,
        imageUrl: p.imageUrl,
        isAvailable: true,
        isVeg: p.isVeg,
        taxRate: 5,
        availableFrom: '00:00',
        availableTo: '23:59',
        addonGroupIds: p.addonGroupIds,
        createdByUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (const v of p.variants) {
        batch2.set(doc(db, 'product_variants', v.id), {
          productId: p.id,
          name: v.name,
          price: v.price,
          isDefault: v.isDefault,
          createdByUid: uid,
          createdAt: serverTimestamp(),
        });
      }
    }

    const ingredientsData = [
      { id: 'ing_chicken', name: 'Marinated Shawarma Chicken', unit: 'gram', currentStock: 15000, minStockAlert: 3000, costPerUnit: 0.32, supplierId: 'sup_fresh_poultry', supplierName: 'Al-Noor Fresh Poultry' },
      { id: 'ing_pita_bread', name: 'Pita & Rumali Bread', unit: 'pieces', currentStock: 180, minStockAlert: 40, costPerUnit: 12, supplierId: 'sup_bakery_dairy', supplierName: 'Levantine Bakery & Dairy' },
      { id: 'ing_mayo', name: 'Garlic Toum / Mayonnaise', unit: 'ml', currentStock: 6000, minStockAlert: 1000, costPerUnit: 0.18, supplierId: 'sup_bakery_dairy', supplierName: 'Levantine Bakery & Dairy' },
      { id: 'ing_vegetables', name: 'Fresh Pickled Vegetables & Slaw', unit: 'gram', currentStock: 8000, minStockAlert: 1500, costPerUnit: 0.08, supplierId: 'sup_bakery_dairy', supplierName: 'Levantine Bakery & Dairy' },
      { id: 'ing_cheese', name: 'Cheddar Cheese Slices & Blend', unit: 'gram', currentStock: 4000, minStockAlert: 800, costPerUnit: 0.55, supplierId: 'sup_bakery_dairy', supplierName: 'Levantine Bakery & Dairy' },
      { id: 'ing_falafel', name: 'Herb Falafel Mix', unit: 'gram', currentStock: 5000, minStockAlert: 1000, costPerUnit: 0.22, supplierId: 'sup_bakery_dairy', supplierName: 'Levantine Bakery & Dairy' },
      { id: 'ing_paneer', name: 'Fresh Malai Paneer', unit: 'gram', currentStock: 4500, minStockAlert: 900, costPerUnit: 0.42, supplierId: 'sup_bakery_dairy', supplierName: 'Levantine Bakery & Dairy' },
      { id: 'ing_fries', name: 'Frozen Shoestring Fries', unit: 'gram', currentStock: 10000, minStockAlert: 2000, costPerUnit: 0.16, supplierId: 'sup_bakery_dairy', supplierName: 'Levantine Bakery & Dairy' },
      { id: 'ing_burger_bun', name: 'Toasted Brioche Burger Buns', unit: 'pieces', currentStock: 90, minStockAlert: 20, costPerUnit: 15, supplierId: 'sup_bakery_dairy', supplierName: 'Levantine Bakery & Dairy' },
      { id: 'ing_mint_mix', name: 'Mint & Lime Syrup Base', unit: 'ml', currentStock: 4000, minStockAlert: 800, costPerUnit: 0.14, supplierId: 'sup_bakery_dairy', supplierName: 'Levantine Bakery & Dairy' },
    ];

    for (const ing of ingredientsData) {
      batch2.set(doc(db, 'ingredients', ing.id), {
        name: ing.name,
        unit: ing.unit,
        currentStock: ing.currentStock,
        minStockAlert: ing.minStockAlert,
        costPerUnit: ing.costPerUnit,
        supplierId: ing.supplierId,
        supplierName: ing.supplierName,
        createdByUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const recipesData = [
      {
        id: 'rec_classic_chicken',
        productId: 'prod_classic_chicken',
        productName: 'Classic Chicken Shawarma',
        items: [
          { id: 'ri_cc_1', ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', qty: 150 },
          { id: 'ri_cc_2', ingredientId: 'ing_pita_bread', ingredientName: 'Pita & Rumali Bread', unit: 'pieces', qty: 1 },
          { id: 'ri_cc_3', ingredientId: 'ing_mayo', ingredientName: 'Garlic Toum / Mayonnaise', unit: 'ml', qty: 20 },
          { id: 'ri_cc_4', ingredientId: 'ing_vegetables', ingredientName: 'Fresh Pickled Vegetables & Slaw', unit: 'gram', qty: 30 },
        ],
      },
      {
        id: 'rec_rumali_chicken',
        productId: 'prod_rumali_chicken',
        productName: 'Rumali Chicken Shawarma',
        items: [
          { id: 'ri_rc_1', ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', qty: 150 },
          { id: 'ri_rc_2', ingredientId: 'ing_pita_bread', ingredientName: 'Pita & Rumali Bread', unit: 'pieces', qty: 1 },
          { id: 'ri_rc_3', ingredientId: 'ing_mayo', ingredientName: 'Garlic Toum / Mayonnaise', unit: 'ml', qty: 20 },
          { id: 'ri_rc_4', ingredientId: 'ing_vegetables', ingredientName: 'Fresh Pickled Vegetables & Slaw', unit: 'gram', qty: 30 },
        ],
      },
      {
        id: 'rec_peri_peri_shawarma',
        productId: 'prod_peri_peri_shawarma',
        productName: 'Peri-Peri Cheese Shawarma',
        items: [
          { id: 'ri_pp_1', ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', qty: 160 },
          { id: 'ri_pp_2', ingredientId: 'ing_pita_bread', ingredientName: 'Pita & Rumali Bread', unit: 'pieces', qty: 1 },
          { id: 'ri_pp_3', ingredientId: 'ing_cheese', ingredientName: 'Cheddar Cheese Slices & Blend', unit: 'gram', qty: 35 },
          { id: 'ri_pp_4', ingredientId: 'ing_mayo', ingredientName: 'Garlic Toum / Mayonnaise', unit: 'ml', qty: 25 },
        ],
      },
      {
        id: 'rec_falafel_shawarma',
        productId: 'prod_falafel_shawarma',
        productName: 'Crispy Falafel Shawarma',
        items: [
          { id: 'ri_fs_1', ingredientId: 'ing_falafel', ingredientName: 'Herb Falafel Mix', unit: 'gram', qty: 120 },
          { id: 'ri_fs_2', ingredientId: 'ing_pita_bread', ingredientName: 'Pita & Rumali Bread', unit: 'pieces', qty: 1 },
          { id: 'ri_fs_3', ingredientId: 'ing_vegetables', ingredientName: 'Fresh Pickled Vegetables & Slaw', unit: 'gram', qty: 40 },
        ],
      },
      {
        id: 'rec_classic_fries',
        productId: 'prod_classic_fries',
        productName: 'Salted Classic Fries',
        items: [
          { id: 'ri_fr_1', ingredientId: 'ing_fries', ingredientName: 'Frozen Shoestring Fries', unit: 'gram', qty: 150 },
        ],
      },
      {
        id: 'rec_shawarma_combo',
        productId: 'prod_shawarma_combo',
        productName: 'Classic Shawarma Meal Combo',
        items: [
          { id: 'ri_cb_1', ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', qty: 150 },
          { id: 'ri_cb_2', ingredientId: 'ing_pita_bread', ingredientName: 'Pita & Rumali Bread', unit: 'pieces', qty: 1 },
          { id: 'ri_cb_3', ingredientId: 'ing_mayo', ingredientName: 'Garlic Toum / Mayonnaise', unit: 'ml', qty: 20 },
          { id: 'ri_cb_4', ingredientId: 'ing_fries', ingredientName: 'Frozen Shoestring Fries', unit: 'gram', qty: 120 },
          { id: 'ri_cb_5', ingredientId: 'ing_mint_mix', ingredientName: 'Mint & Lime Syrup Base', unit: 'ml', qty: 40 },
        ],
      },
    ];

    for (const rec of recipesData) {
      batch2.set(doc(db, 'recipes', rec.id), {
        productId: rec.productId,
        productName: rec.productName,
        yieldQty: 1,
        notes: 'Standard single-portion recipe',
        createdByUid: uid,
        updatedAt: serverTimestamp(),
      });
      for (const item of rec.items) {
        batch2.set(doc(db, 'recipe_items', item.id), {
          recipeId: rec.id,
          productId: rec.productId,
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          unit: item.unit,
          quantityRequired: item.qty,
          createdByUid: uid,
        });
      }
    }

    await batch2.commit();
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'seed_batch_2');
  }
}
