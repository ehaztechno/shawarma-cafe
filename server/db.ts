import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

let dbInstance: Database.Database | null = null;

function resolveDbPath(): string {
  if (process.env.SQLITE_DB_PATH && process.env.SQLITE_DB_PATH.trim()) {
    return path.resolve(process.env.SQLITE_DB_PATH.trim());
  }
  if (process.env.VERCEL) {
    return '/tmp/shawarma-pos.db';
  }
  return path.resolve(process.cwd(), 'data', 'shawarma-pos.db');
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      displayName TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pos_records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (collection, id)
    );

    CREATE INDEX IF NOT EXISTS idx_pos_records_collection
      ON pos_records (collection);

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      data TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_order_items_orderId
      ON order_items (orderId);

    CREATE TABLE IF NOT EXISTS order_item_addons (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      orderItemId TEXT NOT NULL,
      data TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_order_item_addons_orderId
      ON order_item_addons (orderId);
  `);

  dbInstance = db;
  return db;
}

export function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function putRecord(
  db: Database.Database,
  collection: string,
  id: string,
  data: Record<string, any>
): void {
  const now = Date.now();
  const payload = { ...data, id };
  db.prepare(
    `INSERT INTO pos_records (collection, id, data, updatedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(collection, id) DO UPDATE SET
       data = excluded.data,
       updatedAt = excluded.updatedAt`
  ).run(collection, id, JSON.stringify(payload), now);
}

export function getRecord<T = Record<string, any>>(
  db: Database.Database,
  collection: string,
  id: string
): T | null {
  const row = db
    .prepare('SELECT data FROM pos_records WHERE collection = ? AND id = ?')
    .get(collection, id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as T;
}

export function listRecords<T = Record<string, any>>(
  db: Database.Database,
  collection: string
): T[] {
  const rows = db
    .prepare('SELECT data FROM pos_records WHERE collection = ? ORDER BY updatedAt DESC')
    .all(collection) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as T);
}

export function deleteRecord(db: Database.Database, collection: string, id: string): void {
  db.prepare('DELETE FROM pos_records WHERE collection = ? AND id = ?').run(collection, id);
}

const IMAGE_PRESETS = {
  chickenShawarma: '/src/assets/images/chicken_shawarma_classic_1795401707942.jpg',
  specialShawarma: '/src/assets/images/special_cheese_shawarma_1795401707673.jpg',
  vegShawarma: '/src/assets/images/veg_falafel_shawarma_1795401707734.jpg',
  burgerRoll: '/src/assets/images/crispy_burger_roll_1795401708028.jpg',
  friesBeverage: '/src/assets/images/fries_mint_cooler_1795401707501.jpg',
};

export function seedDefaultPosDataIfEmpty(db: Database.Database, actorUid: string): boolean {
  const existing = getRecord(db, 'restaurant_settings', 'default');
  if (existing) {
    return false;
  }

  const nowIso = new Date().toISOString();

  const tx = db.transaction(() => {
    if (getRecord(db, 'restaurant_settings', 'default')) return;

    putRecord(db, 'restaurant_settings', 'default', {
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
      logoUrl: IMAGE_PRESETS.chickenShawarma,
      updatedAt: nowIso,
    });

    const categories = [
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
    for (const c of categories) {
      putRecord(db, 'categories', c.id, {
        ...c,
        isActive: true,
        availableFrom: '00:00',
        availableTo: '23:59',
        createdByUid: actorUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    const addonGroups = [
      { id: 'grp_toppings', name: 'Extra Toppings & Protein', isRequired: false, maxSelect: 4 },
      { id: 'grp_sauces', name: 'Sauces & Spice Level', isRequired: false, maxSelect: 3 },
      { id: 'grp_exclusions', name: 'Preparation Preferences', isRequired: false, maxSelect: 4 },
    ];
    for (const g of addonGroups) {
      putRecord(db, 'addon_groups', g.id, {
        ...g,
        createdByUid: actorUid,
        createdAt: nowIso,
      });
    }

    const addons = [
      { id: 'add_extra_chicken', groupId: 'grp_toppings', name: 'Extra Chicken', price: 45 },
      { id: 'add_extra_cheese', groupId: 'grp_toppings', name: 'Extra Cheese', price: 30 },
      { id: 'add_jalapenos', groupId: 'grp_toppings', name: 'Jalapenos', price: 20 },
      { id: 'add_extra_garlic', groupId: 'grp_sauces', name: 'Extra Garlic Sauce', price: 20 },
      { id: 'add_spicy_harissa', groupId: 'grp_sauces', name: 'Spicy Harissa Sauce', price: 20 },
      { id: 'add_tahini', groupId: 'grp_sauces', name: 'Creamy Tahini Drizzle', price: 25 },
      { id: 'add_no_onion', groupId: 'grp_exclusions', name: 'No Onion', price: 0 },
      { id: 'add_no_garlic', groupId: 'grp_exclusions', name: 'No Garlic', price: 0 },
      { id: 'add_less_spicy', groupId: 'grp_exclusions', name: 'Less Spicy', price: 0 },
      { id: 'add_extra_spicy', groupId: 'grp_exclusions', name: 'Extra Spicy', price: 0 },
    ];
    for (const a of addons) {
      putRecord(db, 'addons', a.id, {
        ...a,
        isAvailable: true,
        createdByUid: actorUid,
        createdAt: nowIso,
      });
    }

    const tables = [
      { id: 'tbl_1', tableNumber: 'T1', name: 'Table 1', capacity: 2, zone: 'Window Side' },
      { id: 'tbl_2', tableNumber: 'T2', name: 'Table 2', capacity: 4, zone: 'Main Hall' },
      { id: 'tbl_3', tableNumber: 'T3', name: 'Table 3', capacity: 4, zone: 'Main Hall' },
      { id: 'tbl_4', tableNumber: 'T4', name: 'Table 4', capacity: 6, zone: 'Family Booth' },
      { id: 'tbl_5', tableNumber: 'T5', name: 'Table 5', capacity: 4, zone: 'Patio' },
      { id: 'tbl_6', tableNumber: 'T6', name: 'Table 6', capacity: 2, zone: 'Counter Express' },
    ];
    for (const t of tables) {
      putRecord(db, 'tables', t.id, {
        ...t,
        status: 'AVAILABLE',
        currentOrderId: '',
        currentOrderNumber: '',
        createdByUid: actorUid,
        updatedAt: nowIso,
      });
    }

    putRecord(db, 'suppliers', 'sup_fresh_poultry', {
      name: 'Al-Barakah Fresh Poultry & Meats',
      contactPerson: 'Imran Khan',
      phone: '+91 98801 44556',
      email: 'orders@albarakahpoultry.in',
      address: 'Russell Market Wholesale Yard, Bengaluru',
      createdByUid: actorUid,
      createdAt: nowIso,
    });

    putRecord(db, 'suppliers', 'sup_bakery_dairy', {
      name: 'Levant Bakery & Dairy Supply',
      contactPerson: 'Farhan Siddiqui',
      phone: '+91 98452 77889',
      email: 'dispatch@levantbakery.in',
      address: 'Indiranagar 100ft Road, Bengaluru',
      createdByUid: actorUid,
      createdAt: nowIso,
    });

    const expenseCategories = [
      { id: 'expcat_ingredients', name: 'Raw Ingredients', description: 'Daily poultry, bread, vegetables, and spices' },
      { id: 'expcat_staff', name: 'Staff Wages', description: 'Chef, cashier, and helper salaries & overtime' },
      { id: 'expcat_utilities', name: 'Electricity & Gas', description: 'Rotisserie LPG cylinders and kitchen power' },
      { id: 'expcat_rent', name: 'Rent & Maintenance', description: 'Shop lease and kitchen equipment servicing' },
      { id: 'expcat_packaging', name: 'Packaging & Hygiene', description: 'Foil wraps, takeaway boxes, napkins, gloves' },
    ];
    for (const ec of expenseCategories) {
      putRecord(db, 'expense_categories', ec.id, {
        ...ec,
        createdByUid: actorUid,
        createdAt: nowIso,
      });
    }

    const ingredients = [
      { id: 'ing_chicken', name: 'Marinated Shawarma Chicken', unit: 'gram', currentStock: 18500, minStockAlert: 4000, costPerUnit: 0.34, supplierId: 'sup_fresh_poultry', supplierName: 'Al-Barakah Fresh Poultry & Meats' },
      { id: 'ing_khubus', name: 'Khubus Pita Bread', unit: 'pieces', currentStock: 160, minStockAlert: 40, costPerUnit: 12, supplierId: 'sup_bakery_dairy', supplierName: 'Levant Bakery & Dairy Supply' },
      { id: 'ing_rumali', name: 'Rumali Flatbread', unit: 'pieces', currentStock: 95, minStockAlert: 25, costPerUnit: 15, supplierId: 'sup_bakery_dairy', supplierName: 'Levant Bakery & Dairy Supply' },
      { id: 'ing_garlic_toum', name: 'Garlic Toum Sauce', unit: 'ml', currentStock: 6200, minStockAlert: 1200, costPerUnit: 0.18, supplierId: 'sup_bakery_dairy', supplierName: 'Levant Bakery & Dairy Supply' },
      { id: 'ing_cheese', name: 'Cheddar & Mozzarella Blend', unit: 'gram', currentStock: 5400, minStockAlert: 1000, costPerUnit: 0.55, supplierId: 'sup_bakery_dairy', supplierName: 'Levant Bakery & Dairy Supply' },
      { id: 'ing_fries', name: 'Crispy Coated Potato Fries', unit: 'gram', currentStock: 12000, minStockAlert: 2500, costPerUnit: 0.16, supplierId: 'sup_bakery_dairy', supplierName: 'Levant Bakery & Dairy Supply' },
      { id: 'ing_falafel', name: 'Herb Chickpea Falafel Mix', unit: 'gram', currentStock: 6800, minStockAlert: 1500, costPerUnit: 0.22, supplierId: 'sup_bakery_dairy', supplierName: 'Levant Bakery & Dairy Supply' },
      { id: 'ing_pickles', name: 'Pickled Turnips & Jalapenos', unit: 'gram', currentStock: 4200, minStockAlert: 800, costPerUnit: 0.2, supplierId: 'sup_bakery_dairy', supplierName: 'Levant Bakery & Dairy Supply' },
      { id: 'ing_burger_bun', name: 'Brioche Burger Buns', unit: 'pieces', currentStock: 64, minStockAlert: 20, costPerUnit: 18, supplierId: 'sup_bakery_dairy', supplierName: 'Levant Bakery & Dairy Supply' },
      { id: 'ing_mint_syrup', name: 'Fresh Mint Lime Concentrate', unit: 'ml', currentStock: 4800, minStockAlert: 1000, costPerUnit: 0.24, supplierId: 'sup_bakery_dairy', supplierName: 'Levant Bakery & Dairy Supply' },
    ];
    for (const ing of ingredients) {
      putRecord(db, 'ingredients', ing.id, {
        ...ing,
        createdByUid: actorUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    const products = [
      {
        id: 'prod_classic_chicken',
        categoryId: 'cat_chicken_shawarma',
        categoryName: 'Chicken Shawarma',
        name: 'Classic Chicken Shawarma',
        description: 'Char-roasted chicken strips, crispy fries, pickles, and signature garlic toum wrapped in warm khubus.',
        basePrice: 130,
        imageUrl: IMAGE_PRESETS.chickenShawarma,
        isAvailable: true,
        isVeg: false,
        taxRate: 5,
        addonGroupIds: ['grp_toppings', 'grp_sauces', 'grp_exclusions'],
        variants: [
          { id: 'var_cc_reg', name: 'Regular Khubus', price: 130, isDefault: true },
          { id: 'var_cc_jumbo', name: 'Jumbo Rumali', price: 180, isDefault: false },
          { id: 'var_cc_plate', name: 'Open Plate', price: 220, isDefault: false },
        ],
        recipe: [
          { ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', quantityRequired: 130 },
          { ingredientId: 'ing_khubus', ingredientName: 'Khubus Pita Bread', unit: 'pieces', quantityRequired: 1 },
          { ingredientId: 'ing_garlic_toum', ingredientName: 'Garlic Toum Sauce', unit: 'ml', quantityRequired: 30 },
          { ingredientId: 'ing_pickles', ingredientName: 'Pickled Turnips & Jalapenos', unit: 'gram', quantityRequired: 20 },
        ],
      },
      {
        id: 'prod_rumali_chicken',
        categoryId: 'cat_chicken_shawarma',
        categoryName: 'Chicken Shawarma',
        name: 'Whole Meat Rumali Shawarma',
        description: 'Pure double-portion roasted chicken without fries inside thin toasted rumali roti.',
        basePrice: 170,
        imageUrl: IMAGE_PRESETS.chickenShawarma,
        isAvailable: true,
        isVeg: false,
        taxRate: 5,
        addonGroupIds: ['grp_toppings', 'grp_sauces', 'grp_exclusions'],
        variants: [
          { id: 'var_rc_std', name: 'Whole Meat', price: 170, isDefault: true },
          { id: 'var_rc_xl', name: 'Double Meat XL', price: 230, isDefault: false },
        ],
        recipe: [
          { ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', quantityRequired: 180 },
          { ingredientId: 'ing_rumali', ingredientName: 'Rumali Flatbread', unit: 'pieces', quantityRequired: 1 },
          { ingredientId: 'ing_garlic_toum', ingredientName: 'Garlic Toum Sauce', unit: 'ml', quantityRequired: 35 },
        ],
      },
      {
        id: 'prod_cheese_melt',
        categoryId: 'cat_special_shawarma',
        categoryName: 'Special Shawarma',
        name: 'Special Cheese Melt Shawarma',
        description: 'Loaded roasted chicken smothered in melted cheddar-mozzarella, harissa mayo, and toasted garlic bread wrap.',
        basePrice: 190,
        imageUrl: IMAGE_PRESETS.specialShawarma,
        isAvailable: true,
        isVeg: false,
        taxRate: 5,
        addonGroupIds: ['grp_toppings', 'grp_sauces', 'grp_exclusions'],
        variants: [
          { id: 'var_cm_reg', name: 'Regular', price: 190, isDefault: true },
          { id: 'var_cm_jumbo', name: 'Jumbo', price: 245, isDefault: false },
        ],
        recipe: [
          { ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', quantityRequired: 150 },
          { ingredientId: 'ing_khubus', ingredientName: 'Khubus Pita Bread', unit: 'pieces', quantityRequired: 1 },
          { ingredientId: 'ing_cheese', ingredientName: 'Cheddar & Mozzarella Blend', unit: 'gram', quantityRequired: 45 },
          { ingredientId: 'ing_garlic_toum', ingredientName: 'Garlic Toum Sauce', unit: 'ml', quantityRequired: 30 },
        ],
      },
      {
        id: 'prod_peri_peri_special',
        categoryId: 'cat_special_shawarma',
        categoryName: 'Special Shawarma',
        name: 'Fiery Peri-Peri Grill Shawarma',
        description: 'Smoky peri-peri spiced rotisserie chicken, jalapeno relish, fries, and spicy garlic dip.',
        basePrice: 180,
        imageUrl: IMAGE_PRESETS.specialShawarma,
        isAvailable: true,
        isVeg: false,
        taxRate: 5,
        addonGroupIds: ['grp_toppings', 'grp_sauces', 'grp_exclusions'],
        variants: [],
        recipe: [
          { ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', quantityRequired: 145 },
          { ingredientId: 'ing_rumali', ingredientName: 'Rumali Flatbread', unit: 'pieces', quantityRequired: 1 },
          { ingredientId: 'ing_pickles', ingredientName: 'Pickled Turnips & Jalapenos', unit: 'gram', quantityRequired: 25 },
        ],
      },
      {
        id: 'prod_falafel_veg',
        categoryId: 'cat_veg_shawarma',
        categoryName: 'Veg Shawarma',
        name: 'Crispy Falafel Hummus Shawarma',
        description: 'Fresh herb chickpea falafel patties, creamy tahini, pickled turnips, and lettuce in warm pita.',
        basePrice: 120,
        imageUrl: IMAGE_PRESETS.vegShawarma,
        isAvailable: true,
        isVeg: true,
        taxRate: 5,
        addonGroupIds: ['grp_toppings', 'grp_sauces', 'grp_exclusions'],
        variants: [
          { id: 'var_fv_reg', name: 'Regular Wrap', price: 120, isDefault: true },
          { id: 'var_fv_plate', name: 'Falafel Platter', price: 190, isDefault: false },
        ],
        recipe: [
          { ingredientId: 'ing_falafel', ingredientName: 'Herb Chickpea Falafel Mix', unit: 'gram', quantityRequired: 120 },
          { ingredientId: 'ing_khubus', ingredientName: 'Khubus Pita Bread', unit: 'pieces', quantityRequired: 1 },
          { ingredientId: 'ing_pickles', ingredientName: 'Pickled Turnips & Jalapenos', unit: 'gram', quantityRequired: 25 },
        ],
      },
      {
        id: 'prod_paneer_tikka_veg',
        categoryId: 'cat_veg_shawarma',
        categoryName: 'Veg Shawarma',
        name: 'Smoked Paneer Shawarma',
        description: 'Charred cottage cheese cubes tossed in Lebanese spices, mint garlic sauce, and crisp salad.',
        basePrice: 150,
        imageUrl: IMAGE_PRESETS.vegShawarma,
        isAvailable: true,
        isVeg: true,
        taxRate: 5,
        addonGroupIds: ['grp_toppings', 'grp_sauces', 'grp_exclusions'],
        variants: [],
        recipe: [
          { ingredientId: 'ing_khubus', ingredientName: 'Khubus Pita Bread', unit: 'pieces', quantityRequired: 1 },
          { ingredientId: 'ing_garlic_toum', ingredientName: 'Garlic Toum Sauce', unit: 'ml', quantityRequired: 30 },
        ],
      },
      {
        id: 'prod_crispy_burger',
        categoryId: 'cat_burgers',
        categoryName: 'Burgers',
        name: 'Shawarma Crunch Chicken Burger',
        description: 'Toasted brioche bun packed with rotisserie chicken, melted cheddar, garlic aioli, and crunchy slaw.',
        basePrice: 155,
        imageUrl: IMAGE_PRESETS.burgerRoll,
        isAvailable: true,
        isVeg: false,
        taxRate: 5,
        addonGroupIds: ['grp_toppings', 'grp_sauces', 'grp_exclusions'],
        variants: [
          { id: 'var_cb_single', name: 'Single Patty', price: 155, isDefault: true },
          { id: 'var_cb_double', name: 'Double Stacked', price: 215, isDefault: false },
        ],
        recipe: [
          { ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', quantityRequired: 120 },
          { ingredientId: 'ing_burger_bun', ingredientName: 'Brioche Burger Buns', unit: 'pieces', quantityRequired: 1 },
          { ingredientId: 'ing_cheese', ingredientName: 'Cheddar & Mozzarella Blend', unit: 'gram', quantityRequired: 25 },
        ],
      },
      {
        id: 'prod_kathi_roll',
        categoryId: 'cat_rolls',
        categoryName: 'Rolls',
        name: 'Roasted Chicken Tikka Roll',
        description: 'Flaky paratha roll filled with smoky chicken, pickled onions, and green chutney mayo.',
        basePrice: 145,
        imageUrl: IMAGE_PRESETS.burgerRoll,
        isAvailable: true,
        isVeg: false,
        taxRate: 5,
        addonGroupIds: ['grp_toppings', 'grp_sauces', 'grp_exclusions'],
        variants: [],
        recipe: [
          { ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', quantityRequired: 110 },
          { ingredientId: 'ing_rumali', ingredientName: 'Rumali Flatbread', unit: 'pieces', quantityRequired: 1 },
        ],
      },
      {
        id: 'prod_loaded_fries',
        categoryId: 'cat_fries',
        categoryName: 'French Fries',
        name: 'Chicken & Cheese Loaded Fries',
        description: 'Golden crisp fries topped with chopped shawarma chicken, melted cheese sauce, and garlic toum.',
        basePrice: 165,
        imageUrl: IMAGE_PRESETS.friesBeverage,
        isAvailable: true,
        isVeg: false,
        taxRate: 5,
        addonGroupIds: ['grp_sauces', 'grp_exclusions'],
        variants: [
          { id: 'var_lf_reg', name: 'Regular Box', price: 165, isDefault: true },
          { id: 'var_lf_share', name: 'Sharing Bucket', price: 235, isDefault: false },
        ],
        recipe: [
          { ingredientId: 'ing_fries', ingredientName: 'Crispy Coated Potato Fries', unit: 'gram', quantityRequired: 180 },
          { ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', quantityRequired: 70 },
          { ingredientId: 'ing_cheese', ingredientName: 'Cheddar & Mozzarella Blend', unit: 'gram', quantityRequired: 35 },
        ],
      },
      {
        id: 'prod_salted_fries',
        categoryId: 'cat_fries',
        categoryName: 'French Fries',
        name: 'Classic Salted French Fries',
        description: 'Crisp skin-on shoestring fries served with garlic dip.',
        basePrice: 95,
        imageUrl: IMAGE_PRESETS.friesBeverage,
        isAvailable: true,
        isVeg: true,
        taxRate: 5,
        addonGroupIds: ['grp_sauces'],
        variants: [
          { id: 'var_sf_med', name: 'Medium', price: 95, isDefault: true },
          { id: 'var_sf_lrg', name: 'Large', price: 130, isDefault: false },
        ],
        recipe: [
          { ingredientId: 'ing_fries', ingredientName: 'Crispy Coated Potato Fries', unit: 'gram', quantityRequired: 160 },
        ],
      },
      {
        id: 'prod_mint_cooler',
        categoryId: 'cat_beverages',
        categoryName: 'Beverages',
        name: 'Fresh Mint Lime Cooler',
        description: 'Chilled sparkling Mediterranean lemon-mint refresher.',
        basePrice: 80,
        imageUrl: IMAGE_PRESETS.friesBeverage,
        isAvailable: true,
        isVeg: true,
        taxRate: 5,
        addonGroupIds: [],
        variants: [],
        recipe: [
          { ingredientId: 'ing_mint_syrup', ingredientName: 'Fresh Mint Lime Concentrate', unit: 'ml', quantityRequired: 60 },
        ],
      },
      {
        id: 'prod_cafe_combo',
        categoryId: 'cat_combos',
        categoryName: 'Combos',
        name: 'Shawarma Cafe Meal Combo',
        description: 'Classic Chicken Shawarma + Classic Salted Fries + Fresh Mint Lime Cooler.',
        basePrice: 265,
        imageUrl: IMAGE_PRESETS.chickenShawarma,
        isAvailable: true,
        isVeg: false,
        taxRate: 5,
        addonGroupIds: ['grp_toppings', 'grp_sauces', 'grp_exclusions'],
        variants: [
          { id: 'var_combo_std', name: 'Classic Combo', price: 265, isDefault: true },
          { id: 'var_combo_cheese', name: 'Special Cheese Combo', price: 315, isDefault: false },
        ],
        recipe: [
          { ingredientId: 'ing_chicken', ingredientName: 'Marinated Shawarma Chicken', unit: 'gram', quantityRequired: 130 },
          { ingredientId: 'ing_khubus', ingredientName: 'Khubus Pita Bread', unit: 'pieces', quantityRequired: 1 },
          { ingredientId: 'ing_fries', ingredientName: 'Crispy Coated Potato Fries', unit: 'gram', quantityRequired: 140 },
          { ingredientId: 'ing_mint_syrup', ingredientName: 'Fresh Mint Lime Concentrate', unit: 'ml', quantityRequired: 60 },
        ],
      },
      {
        id: 'prod_garlic_tub',
        categoryId: 'cat_addons',
        categoryName: 'Extra Add-ons',
        name: 'Garlic Toum Dip Tub',
        description: '50ml whipped Lebanese garlic dip.',
        basePrice: 30,
        imageUrl: IMAGE_PRESETS.friesBeverage,
        isAvailable: true,
        isVeg: true,
        taxRate: 5,
        addonGroupIds: [],
        variants: [],
        recipe: [
          { ingredientId: 'ing_garlic_toum', ingredientName: 'Garlic Toum Sauce', unit: 'ml', quantityRequired: 50 },
        ],
      },
    ];

    for (const p of products) {
      putRecord(db, 'products', p.id, {
        categoryId: p.categoryId,
        categoryName: p.categoryName,
        name: p.name,
        description: p.description,
        basePrice: p.basePrice,
        imageUrl: p.imageUrl,
        isAvailable: p.isAvailable,
        isVeg: p.isVeg,
        taxRate: p.taxRate,
        availableFrom: '00:00',
        availableTo: '23:59',
        addonGroupIds: p.addonGroupIds,
        createdByUid: actorUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      for (const v of p.variants) {
        putRecord(db, 'product_variants', v.id, {
          productId: p.id,
          name: v.name,
          price: v.price,
          isDefault: v.isDefault,
          createdByUid: actorUid,
          createdAt: nowIso,
        });
      }

      if (p.recipe.length > 0) {
        const recipeId = `rec_${p.id}`;
        putRecord(db, 'recipes', recipeId, {
          productId: p.id,
          productName: p.name,
          yieldQty: 1,
          notes: 'Standard kitchen portioning',
          createdByUid: actorUid,
          updatedAt: nowIso,
        });

        p.recipe.forEach((ri, idx) => {
          putRecord(db, 'recipe_items', `ri_${p.id}_${idx}`, {
            recipeId,
            productId: p.id,
            ingredientId: ri.ingredientId,
            ingredientName: ri.ingredientName,
            unit: ri.unit,
            quantityRequired: ri.quantityRequired,
            createdByUid: actorUid,
          });
        });
      }
    }
  });

  tx();
  return true;
}
