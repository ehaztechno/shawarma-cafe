import express from 'express';
import {
  type AuthenticatedRequest,
  type DbUserRow,
  getEnvAdminConfig,
  hashPassword,
  isValidUsername,
  normalizeUsername,
  requireAuth,
  requireRoles,
  signSessionToken,
  type StaffRole,
  timingSafeEqualString,
  toPublicProfile,
  verifyPassword,
} from './auth.ts';
import {
  deleteRecord,
  genId,
  getDb,
  getRecord,
  listRecords,
  putRecord,
  seedDefaultPosDataIfEmpty,
} from './db.ts';

const ALLOWED_COLLECTIONS = new Set([
  'categories',
  'products',
  'product_variants',
  'addon_groups',
  'addons',
  'tables',
  'customers',
  'ingredients',
  'suppliers',
  'expense_categories',
]);

const MANAGER_WRITE_COLLECTIONS = new Set([
  'categories',
  'products',
  'product_variants',
  'addon_groups',
  'addons',
  'ingredients',
  'suppliers',
  'expense_categories',
]);

function isValidId(id: string): boolean {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

function getAllStaffUids(db: ReturnType<typeof getDb>, fallbackUid: string): string[] {
  const rows = db.prepare('SELECT uid FROM users WHERE isActive = 1').all() as { uid: string }[];
  const set = new Set(rows.map((r) => r.uid));
  set.add(fallbackUid);
  return Array.from(set).slice(0, 20);
}

function appendAuditLog(
  db: ReturnType<typeof getDb>,
  params: {
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    actorUid: string;
    actorUsername: string;
    actorRole: string;
  }
) {
  putRecord(db, 'audit_logs', genId('log'), {
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    summary: params.summary,
    actorUid: params.actorUid,
    actorEmail: params.actorUsername,
    actorRole: params.actorRole,
    staffUids: getAllStaffUids(db, params.actorUid),
    createdAt: new Date().toISOString(),
  });
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // --- Authentication Routes ---

  app.get('/api/auth/status', (_req, res) => {
    const db = getDb();
    const envAdmin = getEnvAdminConfig();
    const adminRow = db
      .prepare("SELECT uid FROM users WHERE role = 'SUPER_ADMIN' AND isActive = 1 LIMIT 1")
      .get() as { uid: string } | undefined;

    res.json({
      needsSetup: !envAdmin && !adminRow,
      envAdminConfigured: Boolean(envAdmin),
    });
  });

  app.post('/api/auth/bootstrap', (req, res) => {
    const db = getDb();
    const envAdmin = getEnvAdminConfig();
    if (envAdmin) {
      res.status(403).json({
        error: 'Admin credentials are managed by server environment configuration.',
      });
      return;
    }

    const username = normalizeUsername(String(req.body?.username || ''));
    const displayName = String(req.body?.displayName || '').trim() || username;
    const password = String(req.body?.password || '');

    if (!isValidUsername(username)) {
      res.status(400).json({
        error: 'Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.',
      });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
      return;
    }

    const existingAdmin = db
      .prepare("SELECT uid FROM users WHERE role = 'SUPER_ADMIN' AND isActive = 1 LIMIT 1")
      .get();
    if (existingAdmin) {
      res.status(403).json({ error: 'Admin account has already been set up. Please sign in.' });
      return;
    }

    const uid = genId('usr');
    const now = Date.now();
    const passwordHash = hashPassword(password);

    try {
      const claimTx = db.transaction(() => {
        const recheck = db
          .prepare("SELECT uid FROM users WHERE role = 'SUPER_ADMIN' AND isActive = 1 LIMIT 1")
          .get();
        if (recheck) {
          throw new Error('ALREADY_CLAIMED');
        }
        db.prepare(
          `INSERT INTO users (uid, username, displayName, passwordHash, role, isActive, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 'SUPER_ADMIN', 1, ?, ?)`
        ).run(uid, username, displayName.slice(0, 80), passwordHash, now, now);
      });
      claimTx();
    } catch (err: any) {
      if (err?.message === 'ALREADY_CLAIMED') {
        res.status(403).json({ error: 'Admin account has already been set up. Please sign in.' });
        return;
      }
      if (String(err?.message || '').includes('UNIQUE')) {
        res.status(409).json({ error: 'That username is already taken.' });
        return;
      }
      res.status(500).json({ error: 'Unable to complete initial setup.' });
      return;
    }

    seedDefaultPosDataIfEmpty(db, uid);
    const createdRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as DbUserRow;
    const profile = toPublicProfile(createdRow);
    const token = signSessionToken({
      uid: createdRow.uid,
      username: createdRow.username,
      displayName: createdRow.displayName,
      role: createdRow.role,
      isActive: true,
    });

    res.status(201).json({ token, profile });
  });

  app.post('/api/auth/login', (req, res) => {
    const db = getDb();
    const username = normalizeUsername(String(req.body?.username || ''));
    const password = String(req.body?.password || '');

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    // 1. Env-configured admin override always takes precedence for the admin username
    const envAdmin = getEnvAdminConfig();
    if (envAdmin && username === envAdmin.username) {
      if (!timingSafeEqualString(password, envAdmin.password)) {
        res.status(401).json({ error: 'Invalid username or password.' });
        return;
      }

      const now = Date.now();
      const existingEnvRow = db
        .prepare('SELECT * FROM users WHERE uid = ? OR username = ?')
        .get('usr_env_admin', envAdmin.username) as DbUserRow | undefined;

      let activeUid = existingEnvRow?.uid || 'usr_env_admin';
      if (!existingEnvRow) {
        db.prepare(
          `INSERT INTO users (uid, username, displayName, passwordHash, role, isActive, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 'SUPER_ADMIN', 1, ?, ?)`
        ).run(activeUid, envAdmin.username, 'Store Admin', hashPassword(envAdmin.password), now, now);
      } else if (existingEnvRow.role !== 'SUPER_ADMIN' || existingEnvRow.isActive !== 1) {
        db.prepare(
          `UPDATE users SET role = 'SUPER_ADMIN', isActive = 1, updatedAt = ? WHERE uid = ?`
        ).run(now, activeUid);
      }

      seedDefaultPosDataIfEmpty(db, activeUid);
      const finalRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(activeUid) as DbUserRow;
      const profile = toPublicProfile(finalRow);
      const token = signSessionToken({
        uid: finalRow.uid,
        username: finalRow.username,
        displayName: finalRow.displayName,
        role: 'SUPER_ADMIN',
        isActive: true,
      });
      res.json({ token, profile });
      return;
    }

    // 2. Standard database user lookup
    const userRow = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as DbUserRow | undefined;

    if (!userRow || !verifyPassword(password, userRow.passwordHash)) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    if (userRow.isActive !== 1 || userRow.role === 'PENDING') {
      res.status(403).json({
        error: 'This staff account is suspended or awaiting manager activation.',
      });
      return;
    }

    seedDefaultPosDataIfEmpty(db, userRow.uid);

    const profile = toPublicProfile(userRow);
    const token = signSessionToken({
      uid: userRow.uid,
      username: userRow.username,
      displayName: userRow.displayName,
      role: userRow.role,
      isActive: true,
    });
    res.json({ token, profile });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE uid = ?').get(req.user!.uid) as DbUserRow | undefined;
    const profile = row
      ? toPublicProfile(row)
      : {
          id: req.user!.uid,
          uid: req.user!.uid,
          username: req.user!.username,
          email: req.user!.username,
          displayName: req.user!.displayName,
          role: req.user!.role,
          isActive: req.user!.isActive,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
    res.json({ profile });
  });

  // --- Staff & Role Management ---

  app.post(
    '/api/staff',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const username = normalizeUsername(String(req.body?.username || ''));
      const displayName = String(req.body?.displayName || '').trim();
      const password = String(req.body?.password || '');
      const role = String(req.body?.role || 'CASHIER') as StaffRole;

      if (!isValidUsername(username)) {
        res.status(400).json({
          error: 'Username must be 3–32 characters (letters, numbers, ., _, -).',
        });
        return;
      }
      if (!displayName || displayName.length > 80) {
        res.status(400).json({ error: 'Staff display name is required.' });
        return;
      }
      if (password.length < 4 || password.length > 128) {
        res.status(400).json({ error: 'Password must be at least 4 characters.' });
        return;
      }
      if (!['SUPER_ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN_STAFF'].includes(role)) {
        res.status(400).json({ error: 'Invalid staff role.' });
        return;
      }
      if (role === 'SUPER_ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
        res.status(403).json({ error: 'Only a Super Admin can assign the Super Admin role.' });
        return;
      }

      const existing = db.prepare('SELECT uid FROM users WHERE username = ?').get(username);
      if (existing) {
        res.status(409).json({ error: `Username "${username}" already exists.` });
        return;
      }

      const uid = genId('usr');
      const now = Date.now();
      const hash = hashPassword(password);
      db.prepare(
        `INSERT INTO users (uid, username, displayName, passwordHash, role, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(uid, username, displayName, hash, role, now, now);

      appendAuditLog(db, {
        action: 'STAFF_CREATED',
        entityType: 'user',
        entityId: uid,
        summary: `Created ${role} account "${username}" (${displayName})`,
        actorUid: req.user!.uid,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
      });

      const created = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as DbUserRow;
      res.status(201).json({ staff: toPublicProfile(created) });
    }
  );

  app.patch(
    '/api/staff/:uid',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const targetUid = String(req.params.uid || '');
      if (!isValidId(targetUid)) {
        res.status(400).json({ error: 'Invalid staff ID.' });
        return;
      }
      if (targetUid === req.user!.uid) {
        res.status(400).json({ error: 'Cannot modify your own active session role/status.' });
        return;
      }

      const target = db.prepare('SELECT * FROM users WHERE uid = ?').get(targetUid) as DbUserRow | undefined;
      if (!target) {
        res.status(404).json({ error: 'Staff account not found.' });
        return;
      }

      const nextRole = (req.body?.role ?? target.role) as StaffRole;
      const nextActive = typeof req.body?.isActive === 'boolean' ? (req.body.isActive ? 1 : 0) : target.isActive;
      const nextDisplayName =
        typeof req.body?.displayName === 'string' && req.body.displayName.trim()
          ? req.body.displayName.trim().slice(0, 80)
          : target.displayName;

      if (!['SUPER_ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN_STAFF', 'PENDING'].includes(nextRole)) {
        res.status(400).json({ error: 'Invalid staff role.' });
        return;
      }

      if (
        req.user!.role !== 'SUPER_ADMIN' &&
        (target.role === 'SUPER_ADMIN' || nextRole === 'SUPER_ADMIN')
      ) {
        res.status(403).json({ error: 'Only a Super Admin can manage Super Admin accounts.' });
        return;
      }

      const now = Date.now();
      db.prepare(
        `UPDATE users SET displayName = ?, role = ?, isActive = ?, updatedAt = ? WHERE uid = ?`
      ).run(nextDisplayName, nextRole, nextActive, now, targetUid);

      appendAuditLog(db, {
        action: 'STAFF_UPDATED',
        entityType: 'user',
        entityId: targetUid,
        summary: `Updated "${target.username}" -> role ${nextRole}, active=${nextActive === 1}`,
        actorUid: req.user!.uid,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
      });

      const updated = db.prepare('SELECT * FROM users WHERE uid = ?').get(targetUid) as DbUserRow;
      res.json({ staff: toPublicProfile(updated) });
    }
  );

  app.post(
    '/api/staff/:uid/reset-password',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const targetUid = String(req.params.uid || '');
      const password = String(req.body?.password || '');

      if (!isValidId(targetUid)) {
        res.status(400).json({ error: 'Invalid staff ID.' });
        return;
      }
      if (password.length < 4 || password.length > 128) {
        res.status(400).json({ error: 'New password must be at least 4 characters.' });
        return;
      }

      const target = db.prepare('SELECT * FROM users WHERE uid = ?').get(targetUid) as DbUserRow | undefined;
      if (!target) {
        res.status(404).json({ error: 'Staff account not found.' });
        return;
      }
      if (req.user!.role !== 'SUPER_ADMIN' && target.role === 'SUPER_ADMIN') {
        res.status(403).json({ error: 'Only a Super Admin can reset a Super Admin password.' });
        return;
      }

      db.prepare('UPDATE users SET passwordHash = ?, updatedAt = ? WHERE uid = ?').run(
        hashPassword(password),
        Date.now(),
        targetUid
      );

      appendAuditLog(db, {
        action: 'STAFF_PASSWORD_RESET',
        entityType: 'user',
        entityId: targetUid,
        summary: `Reset password for "${target.username}"`,
        actorUid: req.user!.uid,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
      });

      res.json({ ok: true });
    }
  );

  app.delete(
    '/api/staff/:uid',
    requireAuth,
    requireRoles('SUPER_ADMIN'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const targetUid = String(req.params.uid || '');
      if (!isValidId(targetUid) || targetUid === req.user!.uid) {
        res.status(400).json({ error: 'Cannot delete this account.' });
        return;
      }
      const target = db.prepare('SELECT * FROM users WHERE uid = ?').get(targetUid) as DbUserRow | undefined;
      if (!target) {
        res.status(404).json({ error: 'Staff account not found.' });
        return;
      }
      db.prepare('DELETE FROM users WHERE uid = ?').run(targetUid);
      appendAuditLog(db, {
        action: 'STAFF_DELETED',
        entityType: 'user',
        entityId: targetUid,
        summary: `Removed staff account "${target.username}"`,
        actorUid: req.user!.uid,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
      });
      res.json({ ok: true });
    }
  );

  // --- Full Workspace State Snapshot ---

  app.get('/api/pos/state', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    seedDefaultPosDataIfEmpty(db, req.user!.uid);

    const role = req.user!.role;
    const isManagerOrAdmin = role === 'SUPER_ADMIN' || role === 'MANAGER';
    const isCashierOrAbove = isManagerOrAdmin || role === 'CASHIER';

    const settings = getRecord(db, 'restaurant_settings', 'default');
    const categories = listRecords(db, 'categories').sort(
      (a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    );
    const products = listRecords(db, 'products').sort((a: any, b: any) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    );
    const variants = listRecords(db, 'product_variants');
    const addonGroups = listRecords(db, 'addon_groups');
    const addons = listRecords(db, 'addons');
    const tables = listRecords(db, 'tables').sort((a: any, b: any) =>
      String(a.tableNumber || '').localeCompare(String(b.tableNumber || ''), undefined, {
        numeric: true,
      })
    );
    const orders = listRecords(db, 'orders').sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const ingredients = listRecords(db, 'ingredients').sort((a: any, b: any) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    );
    const recipes = listRecords(db, 'recipes');
    const recipeItems = listRecords(db, 'recipe_items');
    const stockMovements = listRecords(db, 'stock_movements').sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const payments = isCashierOrAbove
      ? listRecords(db, 'payments').sort(
          (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      : [];
    const customers = isCashierOrAbove
      ? listRecords(db, 'customers').sort((a: any, b: any) =>
          String(a.name || '').localeCompare(String(b.name || ''))
        )
      : [];

    const suppliers = isManagerOrAdmin ? listRecords(db, 'suppliers') : [];
    const purchases = isManagerOrAdmin
      ? listRecords(db, 'purchases').sort(
          (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      : [];
    const expenseCategories = isManagerOrAdmin ? listRecords(db, 'expense_categories') : [];
    const expenses = isManagerOrAdmin
      ? listRecords(db, 'expenses').sort(
          (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      : [];
    const auditLogs = isManagerOrAdmin
      ? listRecords(db, 'audit_logs').sort(
          (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      : [];
    const staffUsers = isManagerOrAdmin
      ? (db.prepare('SELECT * FROM users ORDER BY createdAt ASC').all() as DbUserRow[]).map(
          toPublicProfile
        )
      : [];

    res.json({
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
      staffUsers,
      auditLogs,
    });
  });

  // --- Orders & KOT ---

  app.get('/api/pos/orders/:orderId/items', requireAuth, (req: AuthenticatedRequest, res) => {
    const orderId = String(req.params.orderId || '');
    if (!isValidId(orderId)) {
      res.status(400).json({ error: 'Invalid order ID.' });
      return;
    }
    const db = getDb();
    const rows = db
      .prepare('SELECT data FROM order_items WHERE orderId = ? ORDER BY createdAt ASC')
      .all(orderId) as { data: string }[];
    res.json({ items: rows.map((r) => JSON.parse(r.data)) });
  });

  app.post(
    '/api/pos/orders',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER', 'CASHIER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const body = req.body || {};
      const cartItems = Array.isArray(body.cartItems) ? body.cartItems : [];
      if (cartItems.length === 0) {
        res.status(400).json({ error: 'Cannot place an order with an empty cart.' });
        return;
      }

      const orderType = body.orderType;
      if (!['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(orderType)) {
        res.status(400).json({ error: 'Invalid order type.' });
        return;
      }

      const settings = getRecord<any>(db, 'restaurant_settings', 'default') || {
        taxRate: 5,
        serviceChargeRate: 0,
        orderPrefix: 'SC',
        nextOrderNumber: 1001,
        autoDeductInventory: true,
        currencySymbol: '₹',
      };

      const catalogProducts = listRecords<any>(db, 'products');
      const catalogVariants = listRecords<any>(db, 'product_variants');
      const catalogAddons = listRecords<any>(db, 'addons');
      const recipeItems = listRecords<any>(db, 'recipe_items');

      const productMap = new Map(catalogProducts.map((p) => [p.id, p]));
      const variantMap = new Map(catalogVariants.map((v) => [v.id, v]));
      const addonMap = new Map(catalogAddons.map((a) => [a.id, a]));

      let subtotal = 0;
      let itemDiscountTotal = 0;

      const computedItems = cartItems.map((item: any) => {
        const product = productMap.get(item.productId);
        const variant = item.variantId ? variantMap.get(item.variantId) : undefined;
        const verifiedUnitPrice = variant
          ? Number(variant.price)
          : product
            ? Number(product.basePrice)
            : Number(item.unitPrice) || 0;

        const rawAddons = Array.isArray(item.addons) ? item.addons : [];
        const verifiedAddons = rawAddons.map((a: any) => {
          const catAddon = addonMap.get(a.addonId);
          return {
            addonId: String(a.addonId || ''),
            addonName: catAddon ? catAddon.name : String(a.addonName || ''),
            price: catAddon ? Number(catAddon.price) : Number(a.price) || 0,
          };
        });
        const addonsTotal = verifiedAddons.reduce((sum: number, a: any) => sum + a.price, 0);
        const qty = Math.max(1, Math.min(500, Math.round(Number(item.quantity) || 1)));
        const maxItemTotal = (verifiedUnitPrice + addonsTotal) * qty;
        const discount = Math.max(0, Math.min(Number(item.itemDiscountAmount) || 0, maxItemTotal));
        const lineTotal = Math.max(0, maxItemTotal - discount);

        subtotal += maxItemTotal;
        itemDiscountTotal += discount;

        return {
          productId: String(item.productId || ''),
          productName: product ? product.name : String(item.productName || 'Item'),
          categoryId: product ? product.categoryId : String(item.categoryId || ''),
          categoryName: product ? product.categoryName : String(item.categoryName || ''),
          variantId: String(item.variantId || ''),
          variantName: String(item.variantName || ''),
          unitPrice: verifiedUnitPrice,
          quantity: qty,
          itemDiscountAmount: discount,
          addons: verifiedAddons,
          addonsTotal,
          addonsSummary: verifiedAddons.map((a: any) => a.addonName).join(', '),
          specialInstructions: String(item.specialInstructions || '').trim(),
          lineTotal,
        };
      });

      const afterItemDiscount = Math.max(0, subtotal - itemDiscountTotal);
      const cartDiscountPct = Math.max(0, Math.min(100, Number(body.cartDiscountPercent) || 0));
      const cartDiscountAmount = Number(((afterItemDiscount * cartDiscountPct) / 100).toFixed(2));
      const taxableBase = Math.max(0, afterItemDiscount - cartDiscountAmount);
      const taxRate = Math.max(0, Number(settings.taxRate) || 0);
      const serviceRate =
        orderType === 'DINE_IN' ? Math.max(0, Number(settings.serviceChargeRate) || 0) : 0;
      const taxAmount = Number(((taxableBase * taxRate) / 100).toFixed(2));
      const serviceChargeAmount = Number(((taxableBase * serviceRate) / 100).toFixed(2));
      const deliveryCharge =
        orderType === 'DELIVERY' ? Math.max(0, Number(body.deliveryCharge) || 0) : 0;
      const grandTotal = Number(
        (taxableBase + taxAmount + serviceChargeAmount + deliveryCharge).toFixed(2)
      );

      const payLater = Boolean(body.payLater);
      const rawPayments = Array.isArray(body.payments) ? body.payments : [];
      const validPayments = payLater
        ? []
        : rawPayments.filter(
            (p: any) =>
              Number.isFinite(Number(p.amount)) &&
              Number(p.amount) > 0 &&
              ['CASH', 'UPI', 'CARD', 'ONLINE'].includes(p.method)
          );
      const paidAmount = Number(
        validPayments.reduce((s: number, p: any) => s + Number(p.amount), 0).toFixed(2)
      );

      let paymentStatus: 'PENDING' | 'PARTIAL' | 'PAID' = 'PENDING';
      if (paidAmount >= grandTotal && grandTotal > 0) {
        paymentStatus = 'PAID';
      } else if (paidAmount > 0 && paidAmount < grandTotal) {
        paymentStatus = 'PARTIAL';
      } else if (grandTotal === 0 && !payLater) {
        paymentStatus = 'PAID';
      }

      const paymentMethodsSummary =
        validPayments.length > 0
          ? Array.from(new Set(validPayments.map((p: any) => p.method))).join(' + ')
          : 'PENDING';

      const shouldDeductInventory =
        Boolean(settings.autoDeductInventory) && paymentStatus === 'PAID';

      const ingredientDeductions = new Map<string, number>();
      if (shouldDeductInventory) {
        for (const item of computedItems) {
          for (const r of recipeItems.filter((ri) => ri.productId === item.productId)) {
            ingredientDeductions.set(
              r.ingredientId,
              (ingredientDeductions.get(r.ingredientId) ?? 0) +
                Number(r.quantityRequired) * item.quantity
            );
          }
        }
      }

      const orderId = genId('ord');
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const staffUids = getAllStaffUids(db, req.user!.uid);
      const itemsPreview = computedItems
        .map((i: any) => `${i.quantity}x ${i.productName}`)
        .join(', ')
        .slice(0, 390);
      const totalQty = computedItems.reduce((s: number, i: any) => s + i.quantity, 0);

      const customerPhone = String(body.customerPhone || '').trim();
      const customerName = String(body.customerName || '').trim();
      const deliveryAddress = String(body.deliveryAddress || '').trim();
      let resolvedCustomerId = String(body.customerId || '').trim();

      if (!resolvedCustomerId && customerPhone.length >= 5) {
        const allCustomers = listRecords<any>(db, 'customers');
        const found = allCustomers.find((c) => c.phone === customerPhone);
        if (found) resolvedCustomerId = found.id;
      }
      const shouldWriteCustomer = customerPhone.length >= 5;
      if (shouldWriteCustomer && !resolvedCustomerId) {
        resolvedCustomerId = genId('cust');
      }

      let generatedOrderNumber = '';

      const tx = db.transaction(() => {
        const liveSettings = getRecord<any>(db, 'restaurant_settings', 'default') || settings;
        const nextNum = Number(liveSettings.nextOrderNumber) || 1001;
        const prefix = liveSettings.orderPrefix || 'SC';
        generatedOrderNumber = `${prefix}-${nextNum}`;

        putRecord(db, 'restaurant_settings', 'default', {
          ...liveSettings,
          nextOrderNumber: nextNum + 1,
          updatedAt: nowIso,
        });

        const tableInput = body.table && typeof body.table === 'object' ? body.table : null;
        putRecord(db, 'orders', orderId, {
          orderNumber: generatedOrderNumber,
          orderType,
          status: 'NEW',
          paymentStatus,
          tableId: tableInput?.id || '',
          tableName: tableInput?.name || '',
          customerId: resolvedCustomerId || '',
          customerName: customerName || (orderType === 'DINE_IN' ? 'Dine-In Guest' : 'Walk-In Guest'),
          customerPhone,
          deliveryAddress,
          deliveryCharge,
          subtotal: Number(subtotal.toFixed(2)),
          itemDiscountTotal: Number(itemDiscountTotal.toFixed(2)),
          cartDiscountPercent: cartDiscountPct,
          cartDiscountAmount,
          taxRate,
          taxAmount,
          serviceChargeAmount,
          grandTotal,
          paidAmount,
          paymentMethodsSummary,
          itemCount: totalQty,
          itemsPreview,
          notes: String(body.notes || '').trim(),
          cancelReason: '',
          inventoryDeducted: shouldDeductInventory,
          createdByUid: req.user!.uid,
          createdByName: req.user!.displayName,
          staffUids,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        for (const item of computedItems) {
          const itemId = genId('oi');
          const itemRecord = {
            id: itemId,
            orderId,
            productId: item.productId,
            productName: item.productName,
            categoryId: item.categoryId,
            categoryName: item.categoryName,
            variantId: item.variantId,
            variantName: item.variantName,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            itemDiscountAmount: item.itemDiscountAmount,
            addonsSummary: item.addonsSummary,
            addonsTotal: item.addonsTotal,
            specialInstructions: item.specialInstructions,
            lineTotal: Number(item.lineTotal.toFixed(2)),
            createdByUid: req.user!.uid,
            createdAt: nowIso,
          };
          db.prepare(
            `INSERT INTO order_items (id, orderId, data, createdAt) VALUES (?, ?, ?, ?)`
          ).run(itemId, orderId, JSON.stringify(itemRecord), nowMs);

          for (const addon of item.addons) {
            const addonEntryId = genId('oia');
            const addonRecord = {
              id: addonEntryId,
              orderId,
              orderItemId: itemId,
              addonId: addon.addonId,
              addonName: addon.addonName,
              price: addon.price,
              createdByUid: req.user!.uid,
              createdAt: nowIso,
            };
            db.prepare(
              `INSERT INTO order_item_addons (id, orderId, orderItemId, data, createdAt) VALUES (?, ?, ?, ?, ?)`
            ).run(addonEntryId, orderId, itemId, JSON.stringify(addonRecord), nowMs);
          }
        }

        for (const p of validPayments) {
          putRecord(db, 'payments', genId('pay'), {
            orderId,
            orderNumber: generatedOrderNumber,
            method: p.method,
            amount: Number(Number(p.amount).toFixed(2)),
            referenceNumber: String(p.referenceNumber || '').trim(),
            status: 'COMPLETED',
            receivedByUid: req.user!.uid,
            receivedByName: req.user!.displayName,
            staffUids,
            createdAt: nowIso,
          });
        }

        if (orderType === 'DINE_IN' && tableInput?.id) {
          const existingTable = getRecord<any>(db, 'tables', tableInput.id);
          if (existingTable) {
            putRecord(db, 'tables', tableInput.id, {
              ...existingTable,
              status: 'OCCUPIED',
              currentOrderId: orderId,
              currentOrderNumber: generatedOrderNumber,
              updatedAt: nowIso,
            });
          }
        }

        if (shouldWriteCustomer && resolvedCustomerId) {
          const existingCustomer = getRecord<any>(db, 'customers', resolvedCustomerId);
          if (existingCustomer) {
            putRecord(db, 'customers', resolvedCustomerId, {
              ...existingCustomer,
              name: customerName || existingCustomer.name,
              address: deliveryAddress || existingCustomer.address,
              totalOrders: (existingCustomer.totalOrders || 0) + 1,
              totalSpent: Number(((existingCustomer.totalSpent || 0) + grandTotal).toFixed(2)),
              lastOrderAt: nowIso,
              staffUids,
              updatedAt: nowIso,
            });
          } else {
            putRecord(db, 'customers', resolvedCustomerId, {
              name: customerName || 'Guest Customer',
              phone: customerPhone,
              address: deliveryAddress,
              totalOrders: 1,
              totalSpent: grandTotal,
              lastOrderAt: nowIso,
              createdByUid: req.user!.uid,
              staffUids,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          }
        }

        for (const [ingId, deductQty] of ingredientDeductions.entries()) {
          const ing = getRecord<any>(db, 'ingredients', ingId);
          if (!ing) continue;
          const prev = Number(ing.currentStock) || 0;
          const nextStock = Number(Math.max(0, prev - deductQty).toFixed(2));
          putRecord(db, 'ingredients', ingId, {
            ...ing,
            currentStock: nextStock,
            updatedAt: nowIso,
          });
          putRecord(db, 'stock_movements', genId('sm'), {
            ingredientId: ingId,
            ingredientName: ing.name,
            type: 'ORDER_DEDUCTION',
            quantityDelta: Number((nextStock - prev).toFixed(2)),
            previousStock: prev,
            newStock: nextStock,
            unit: ing.unit,
            referenceId: generatedOrderNumber,
            notes: `Auto deduction for order ${generatedOrderNumber}`,
            createdByUid: req.user!.uid,
            staffUids,
            createdAt: nowIso,
          });
        }

        appendAuditLog(db, {
          action: 'ORDER_CREATED',
          entityType: 'order',
          entityId: orderId,
          summary: `Order ${generatedOrderNumber} (${orderType}) placed for ${settings.currencySymbol || '₹'}${grandTotal} [${paymentStatus}]`,
          actorUid: req.user!.uid,
          actorUsername: req.user!.username,
          actorRole: req.user!.role,
        });
      });

      tx();
      res.status(201).json({ orderId, orderNumber: generatedOrderNumber });
    }
  );

  app.post(
    '/api/pos/orders/:orderId/payments',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER', 'CASHIER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const orderId = String(req.params.orderId || '');
      if (!isValidId(orderId)) {
        res.status(400).json({ error: 'Invalid order ID.' });
        return;
      }

      const rawPayments = Array.isArray(req.body?.payments) ? req.body.payments : [];
      const validPayments = rawPayments.filter(
        (p: any) =>
          Number.isFinite(Number(p.amount)) &&
          Number(p.amount) > 0 &&
          ['CASH', 'UPI', 'CARD', 'ONLINE'].includes(p.method)
      );
      if (validPayments.length === 0) {
        res.status(400).json({ error: 'Enter a valid payment amount.' });
        return;
      }

      const addedPaid = validPayments.reduce((s: number, p: any) => s + Number(p.amount), 0);
      const nowIso = new Date().toISOString();
      const staffUids = getAllStaffUids(db, req.user!.uid);
      const settings = getRecord<any>(db, 'restaurant_settings', 'default');
      const autoDeduct = Boolean(settings?.autoDeductInventory ?? true);
      const recipeItems = listRecords<any>(db, 'recipe_items');

      try {
        const tx = db.transaction(() => {
          const current = getRecord<any>(db, 'orders', orderId);
          if (!current) throw new Error('NOT_FOUND');
          if (current.status === 'CANCELLED') throw new Error('CANCELLED');

          const newPaid = Number(((current.paidAmount || 0) + addedPaid).toFixed(2));
          const newPayStatus: 'PENDING' | 'PARTIAL' | 'PAID' =
            newPaid >= current.grandTotal ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'PENDING';

          const prevMethods =
            current.paymentMethodsSummary && current.paymentMethodsSummary !== 'PENDING'
              ? String(current.paymentMethodsSummary).split(' + ')
              : [];
          const combinedMethods = Array.from(
            new Set([...prevMethods, ...validPayments.map((p: any) => p.method)])
          ).join(' + ');

          const shouldDeduct = autoDeduct && !current.inventoryDeducted && newPayStatus === 'PAID';
          if (shouldDeduct) {
            const itemRows = db
              .prepare('SELECT data FROM order_items WHERE orderId = ?')
              .all(orderId) as { data: string }[];
            const deductions = new Map<string, number>();
            for (const row of itemRows) {
              const oi = JSON.parse(row.data);
              for (const r of recipeItems.filter((ri) => ri.productId === oi.productId)) {
                deductions.set(
                  r.ingredientId,
                  (deductions.get(r.ingredientId) ?? 0) + Number(r.quantityRequired) * oi.quantity
                );
              }
            }
            for (const [ingId, deductQty] of deductions.entries()) {
              const ing = getRecord<any>(db, 'ingredients', ingId);
              if (!ing) continue;
              const prev = Number(ing.currentStock) || 0;
              const nextStock = Number(Math.max(0, prev - deductQty).toFixed(2));
              putRecord(db, 'ingredients', ingId, {
                ...ing,
                currentStock: nextStock,
                updatedAt: nowIso,
              });
              putRecord(db, 'stock_movements', genId('sm'), {
                ingredientId: ingId,
                ingredientName: ing.name,
                type: 'ORDER_DEDUCTION',
                quantityDelta: Number((nextStock - prev).toFixed(2)),
                previousStock: prev,
                newStock: nextStock,
                unit: ing.unit,
                referenceId: current.orderNumber,
                notes: `Auto deduction on bill settlement (${current.orderNumber})`,
                createdByUid: req.user!.uid,
                staffUids,
                createdAt: nowIso,
              });
            }
          }

          putRecord(db, 'orders', orderId, {
            ...current,
            paidAmount: newPaid,
            paymentStatus: newPayStatus,
            paymentMethodsSummary: combinedMethods,
            inventoryDeducted: Boolean(current.inventoryDeducted) || shouldDeduct,
            updatedAt: nowIso,
          });

          for (const p of validPayments) {
            putRecord(db, 'payments', genId('pay'), {
              orderId,
              orderNumber: current.orderNumber,
              method: p.method,
              amount: Number(Number(p.amount).toFixed(2)),
              referenceNumber: String(p.referenceNumber || '').trim(),
              status: 'COMPLETED',
              receivedByUid: req.user!.uid,
              receivedByName: req.user!.displayName,
              staffUids,
              createdAt: nowIso,
            });
          }

          appendAuditLog(db, {
            action: 'PAYMENT_RECORDED',
            entityType: 'order',
            entityId: orderId,
            summary: `Recorded payment of ${addedPaid} for ${current.orderNumber} (${combinedMethods})`,
            actorUid: req.user!.uid,
            actorUsername: req.user!.username,
            actorRole: req.user!.role,
          });
        });

        tx();
        res.json({ ok: true });
      } catch (err: any) {
        if (err?.message === 'NOT_FOUND') {
          res.status(404).json({ error: 'Order not found.' });
          return;
        }
        if (err?.message === 'CANCELLED') {
          res.status(400).json({ error: 'Cannot pay for a cancelled order.' });
          return;
        }
        res.status(500).json({ error: 'Unable to record payment.' });
      }
    }
  );

  app.post('/api/pos/orders/:orderId/status', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const orderId = String(req.params.orderId || '');
    const nextStatus = String(req.body?.nextStatus || '');
    if (!isValidId(orderId)) {
      res.status(400).json({ error: 'Invalid order ID.' });
      return;
    }
    if (!['NEW', 'PREPARING', 'READY', 'SERVED', 'COMPLETED'].includes(nextStatus)) {
      res.status(400).json({ error: 'Invalid order status.' });
      return;
    }
    if (
      req.user!.role === 'KITCHEN_STAFF' &&
      !['PREPARING', 'READY', 'SERVED', 'COMPLETED'].includes(nextStatus)
    ) {
      res.status(403).json({ error: 'Kitchen staff cannot revert to that status.' });
      return;
    }

    const current = getRecord<any>(db, 'orders', orderId);
    if (!current) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const tx = db.transaction(() => {
      putRecord(db, 'orders', orderId, {
        ...current,
        status: nextStatus,
        updatedAt: nowIso,
      });

      if (nextStatus === 'COMPLETED' && current.orderType === 'DINE_IN' && current.tableId) {
        const tbl = getRecord<any>(db, 'tables', current.tableId);
        if (tbl) {
          putRecord(db, 'tables', current.tableId, {
            ...tbl,
            status: 'AVAILABLE',
            currentOrderId: '',
            currentOrderNumber: '',
            updatedAt: nowIso,
          });
        }
      }

      appendAuditLog(db, {
        action: 'ORDER_STATUS_UPDATED',
        entityType: 'order',
        entityId: orderId,
        summary: `${current.orderNumber} moved to ${nextStatus}`,
        actorUid: req.user!.uid,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
      });
    });

    tx();
    res.json({ ok: true });
  });

  app.post(
    '/api/pos/orders/:orderId/cancel',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const orderId = String(req.params.orderId || '');
      const reason = String(req.body?.reason || '').trim();
      if (!isValidId(orderId) || !reason) {
        res.status(400).json({ error: 'Cancellation reason is required.' });
        return;
      }

      const current = getRecord<any>(db, 'orders', orderId);
      if (!current) {
        res.status(404).json({ error: 'Order not found.' });
        return;
      }

      const nowIso = new Date().toISOString();
      const tx = db.transaction(() => {
        putRecord(db, 'orders', orderId, {
          ...current,
          status: 'CANCELLED',
          cancelReason: reason.slice(0, 240),
          updatedAt: nowIso,
        });

        if (current.orderType === 'DINE_IN' && current.tableId) {
          const tbl = getRecord<any>(db, 'tables', current.tableId);
          if (tbl) {
            putRecord(db, 'tables', current.tableId, {
              ...tbl,
              status: 'AVAILABLE',
              currentOrderId: '',
              currentOrderNumber: '',
              updatedAt: nowIso,
            });
          }
        }

        appendAuditLog(db, {
          action: 'ORDER_CANCELLED',
          entityType: 'order',
          entityId: orderId,
          summary: `${current.orderNumber} cancelled: ${reason}`,
          actorUid: req.user!.uid,
          actorUsername: req.user!.username,
          actorRole: req.user!.role,
        });
      });

      tx();
      res.json({ ok: true });
    }
  );

  app.post(
    '/api/pos/orders/:orderId/refund',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const orderId = String(req.params.orderId || '');
      const reason = String(req.body?.reason || '').trim();
      const paymentIds = Array.isArray(req.body?.paymentIds) ? req.body.paymentIds : [];
      if (!isValidId(orderId)) {
        res.status(400).json({ error: 'Invalid order ID.' });
        return;
      }

      const current = getRecord<any>(db, 'orders', orderId);
      if (!current) {
        res.status(404).json({ error: 'Order not found.' });
        return;
      }

      const nowIso = new Date().toISOString();
      const tx = db.transaction(() => {
        putRecord(db, 'orders', orderId, {
          ...current,
          paymentStatus: 'REFUNDED',
          cancelReason: reason || current.cancelReason || '',
          updatedAt: nowIso,
        });

        for (const pid of paymentIds) {
          const pay = getRecord<any>(db, 'payments', String(pid));
          if (pay) {
            putRecord(db, 'payments', String(pid), {
              ...pay,
              status: 'REFUNDED',
            });
          }
        }

        appendAuditLog(db, {
          action: 'PAYMENT_REFUNDED',
          entityType: 'order',
          entityId: orderId,
          summary: `Refund recorded for ${current.orderNumber}: ${reason || 'Manager refund'}`,
          actorUid: req.user!.uid,
          actorUsername: req.user!.username,
          actorRole: req.user!.role,
        });
      });

      tx();
      res.json({ ok: true });
    }
  );

  // --- Menu, Recipes, Stock, Purchases, Expenses, Settings ---

  app.post(
    '/api/pos/products',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const body = req.body || {};
      const productId = body.productId && isValidId(body.productId) ? body.productId : genId('prod');
      const nowIso = new Date().toISOString();
      const existing = getRecord<any>(db, 'products', productId);

      const tx = db.transaction(() => {
        putRecord(db, 'products', productId, {
          categoryId: String(body.categoryId || ''),
          categoryName: String(body.categoryName || 'Uncategorized'),
          name: String(body.name || '').trim(),
          description: String(body.description || '').trim(),
          basePrice: Number(body.basePrice) || 0,
          imageUrl: String(body.imageUrl || '').trim(),
          isAvailable: body.isAvailable !== false,
          isVeg: Boolean(body.isVeg),
          taxRate: Number(body.taxRate) || 0,
          availableFrom: String(body.availableFrom || '00:00'),
          availableTo: String(body.availableTo || '23:59'),
          addonGroupIds: Array.isArray(body.addonGroupIds) ? body.addonGroupIds.slice(0, 10) : [],
          createdByUid: existing?.createdByUid || req.user!.uid,
          createdAt: existing?.createdAt || nowIso,
          updatedAt: nowIso,
        });

        const vars = Array.isArray(body.variants) ? body.variants : [];
        const existingVarIds = Array.isArray(body.existingVariantIds) ? body.existingVariantIds : [];
        const kept = new Set(vars.map((v: any) => v.id).filter(Boolean));
        for (const oldId of existingVarIds) {
          if (!kept.has(oldId)) {
            deleteRecord(db, 'product_variants', String(oldId));
          }
        }
        for (const v of vars) {
          const vid = v.id && isValidId(v.id) ? v.id : genId('var');
          const oldVar = getRecord<any>(db, 'product_variants', vid);
          putRecord(db, 'product_variants', vid, {
            productId,
            name: String(v.name || '').trim(),
            price: Number(v.price) || 0,
            isDefault: Boolean(v.isDefault),
            createdByUid: oldVar?.createdByUid || req.user!.uid,
            createdAt: oldVar?.createdAt || nowIso,
          });
        }
      });

      tx();
      res.json({ productId });
    }
  );

  app.post(
    '/api/pos/recipes',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const body = req.body || {};
      const productId = String(body.productId || '');
      if (!isValidId(productId)) {
        res.status(400).json({ error: 'Invalid product ID.' });
        return;
      }
      const recipeId = body.recipeId && isValidId(body.recipeId) ? body.recipeId : `rec_${productId}`;
      const nowIso = new Date().toISOString();
      const existing = getRecord<any>(db, 'recipes', recipeId);

      const tx = db.transaction(() => {
        putRecord(db, 'recipes', recipeId, {
          productId,
          productName: String(body.productName || ''),
          yieldQty: Number(body.yieldQty) || 1,
          notes: String(body.notes || '').trim(),
          createdByUid: existing?.createdByUid || req.user!.uid,
          updatedAt: nowIso,
        });

        const items = Array.isArray(body.items) ? body.items : [];
        const existingItemIds = Array.isArray(body.existingItemIds) ? body.existingItemIds : [];
        const kept = new Set(items.map((i: any) => i.id).filter(Boolean));
        for (const oldId of existingItemIds) {
          if (!kept.has(oldId)) {
            deleteRecord(db, 'recipe_items', String(oldId));
          }
        }
        for (const item of items) {
          const rid = item.id && isValidId(item.id) ? item.id : genId('ri');
          putRecord(db, 'recipe_items', rid, {
            recipeId,
            productId,
            ingredientId: String(item.ingredientId || ''),
            ingredientName: String(item.ingredientName || ''),
            unit: item.unit,
            quantityRequired: Number(item.quantityRequired) || 0,
            createdByUid: req.user!.uid,
          });
        }
      });

      tx();
      res.json({ recipeId });
    }
  );

  app.post(
    '/api/pos/stock/adjust',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const ingredientId = String(req.body?.ingredientId || '');
      const type = String(req.body?.type || 'ADJUSTMENT');
      const quantityDelta = Number(req.body?.quantityDelta) || 0;
      const notes = String(req.body?.notes || '').trim();

      if (!isValidId(ingredientId) || quantityDelta === 0) {
        res.status(400).json({ error: 'Valid ingredient and non-zero quantity are required.' });
        return;
      }

      const ing = getRecord<any>(db, 'ingredients', ingredientId);
      if (!ing) {
        res.status(404).json({ error: 'Ingredient not found.' });
        return;
      }

      const nowIso = new Date().toISOString();
      const staffUids = getAllStaffUids(db, req.user!.uid);
      const prev = Number(ing.currentStock) || 0;
      const nextStock = Number(Math.max(0, prev + quantityDelta).toFixed(2));

      const tx = db.transaction(() => {
        putRecord(db, 'ingredients', ingredientId, {
          ...ing,
          currentStock: nextStock,
          updatedAt: nowIso,
        });
        putRecord(db, 'stock_movements', genId('sm'), {
          ingredientId,
          ingredientName: ing.name,
          type,
          quantityDelta: Number((nextStock - prev).toFixed(2)),
          previousStock: prev,
          newStock: nextStock,
          unit: ing.unit,
          referenceId: '',
          notes: notes || `${type} entry`,
          createdByUid: req.user!.uid,
          staffUids,
          createdAt: nowIso,
        });
        appendAuditLog(db, {
          action: `STOCK_${type}`,
          entityType: 'ingredient',
          entityId: ingredientId,
          summary: `${ing.name}: ${prev} -> ${nextStock} ${ing.unit} (${notes || type})`,
          actorUid: req.user!.uid,
          actorUsername: req.user!.username,
          actorRole: req.user!.role,
        });
      });

      tx();
      res.json({ ok: true });
    }
  );

  app.post(
    '/api/pos/purchases',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) {
        res.status(400).json({ error: 'Add at least one ingredient to purchase.' });
        return;
      }

      const purchaseId = genId('pur');
      const totalAmount = Number(
        items.reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unitCost), 0).toFixed(2)
      );
      const nowIso = new Date().toISOString();
      const staffUids = getAllStaffUids(db, req.user!.uid);
      const invoiceNumber = String(body.invoiceNumber || '').trim() || purchaseId.slice(-6).toUpperCase();

      const tx = db.transaction(() => {
        putRecord(db, 'purchases', purchaseId, {
          supplierId: String(body.supplierId || ''),
          supplierName: String(body.supplierName || ''),
          invoiceNumber,
          totalAmount,
          paymentStatus: body.paymentStatus === 'PENDING' ? 'PENDING' : 'PAID',
          notes: String(body.notes || '').trim(),
          purchaseDate: String(body.purchaseDate || nowIso.slice(0, 10)),
          createdByUid: req.user!.uid,
          staffUids,
          createdAt: nowIso,
        });

        for (const item of items) {
          const qty = Number(item.quantity) || 0;
          const unitCost = Number(item.unitCost) || 0;
          putRecord(db, 'purchase_items', genId('pi'), {
            purchaseId,
            ingredientId: String(item.ingredientId || ''),
            ingredientName: String(item.ingredientName || ''),
            quantity: qty,
            unit: item.unit,
            unitCost,
            totalCost: Number((qty * unitCost).toFixed(2)),
            createdByUid: req.user!.uid,
          });

          const ing = getRecord<any>(db, 'ingredients', String(item.ingredientId || ''));
          if (ing) {
            const prev = Number(ing.currentStock) || 0;
            const nextStock = Number((prev + qty).toFixed(2));
            putRecord(db, 'ingredients', ing.id, {
              ...ing,
              currentStock: nextStock,
              costPerUnit: unitCost > 0 ? unitCost : ing.costPerUnit,
              updatedAt: nowIso,
            });
            putRecord(db, 'stock_movements', genId('sm'), {
              ingredientId: ing.id,
              ingredientName: ing.name,
              type: 'PURCHASE',
              quantityDelta: qty,
              previousStock: prev,
              newStock: nextStock,
              unit: ing.unit,
              referenceId: invoiceNumber,
              notes: `Purchase from ${String(body.supplierName || '')}`,
              createdByUid: req.user!.uid,
              staffUids,
              createdAt: nowIso,
            });
          }
        }

        appendAuditLog(db, {
          action: 'PURCHASE_RECORDED',
          entityType: 'purchase',
          entityId: purchaseId,
          summary: `Stock purchase ${invoiceNumber} from ${String(body.supplierName || '')} (${totalAmount})`,
          actorUid: req.user!.uid,
          actorUsername: req.user!.username,
          actorRole: req.user!.role,
        });
      });

      tx();
      res.status(201).json({ purchaseId });
    }
  );

  app.post(
    '/api/pos/expenses',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const body = req.body || {};
      const amount = Number(body.amount) || 0;
      if (amount <= 0) {
        res.status(400).json({ error: 'Expense amount must be greater than zero.' });
        return;
      }

      const id = genId('exp');
      const nowIso = new Date().toISOString();
      putRecord(db, 'expenses', id, {
        categoryId: String(body.categoryId || ''),
        categoryName: String(body.categoryName || ''),
        amount,
        paymentMethod: body.paymentMethod || 'CASH',
        expenseDate: String(body.expenseDate || nowIso.slice(0, 10)),
        notes: String(body.notes || '').trim(),
        recordedByUid: req.user!.uid,
        recordedByName: req.user!.displayName,
        staffUids: getAllStaffUids(db, req.user!.uid),
        createdAt: nowIso,
      });
      res.status(201).json({ id });
    }
  );

  app.put(
    '/api/pos/settings',
    requireAuth,
    requireRoles('SUPER_ADMIN'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const existing = getRecord<any>(db, 'restaurant_settings', 'default') || {};
      const next = {
        ...existing,
        ...(req.body?.settings || {}),
        updatedAt: new Date().toISOString(),
      };
      const tx = db.transaction(() => {
        putRecord(db, 'restaurant_settings', 'default', next);
        appendAuditLog(db, {
          action: 'SETTINGS_UPDATED',
          entityType: 'restaurant_settings',
          entityId: 'default',
          summary: `Updated restaurant settings (${next.restaurantName}, Tax ${next.taxRate}%)`,
          actorUid: req.user!.uid,
          actorUsername: req.user!.username,
          actorRole: req.user!.role,
        });
      });
      tx();
      res.json({ settings: next });
    }
  );

  app.post(
    '/api/pos/reseed',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'MANAGER'),
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const seeded = seedDefaultPosDataIfEmpty(db, req.user!.uid);
      res.json({ seeded });
    }
  );

  // Generic authenticated CRUD for catalog/tables/customers
  app.put('/api/pos/docs/:collection/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const collection = String(req.params.collection || '');
    const id = String(req.params.id || '');
    if (!ALLOWED_COLLECTIONS.has(collection) || !isValidId(id)) {
      res.status(400).json({ error: 'Invalid collection or document ID.' });
      return;
    }

    const role = req.user!.role;
    const isManagerOrAdmin = role === 'SUPER_ADMIN' || role === 'MANAGER';
    const isCashierOrAbove = isManagerOrAdmin || role === 'CASHIER';

    if (MANAGER_WRITE_COLLECTIONS.has(collection) && !isManagerOrAdmin) {
      res.status(403).json({ error: 'Only Managers or Super Admins can modify this catalog data.' });
      return;
    }
    if ((collection === 'tables' || collection === 'customers') && !isCashierOrAbove) {
      res.status(403).json({ error: 'Insufficient permissions.' });
      return;
    }

    const db = getDb();
    const existing = getRecord<any>(db, collection, id);
    const nowIso = new Date().toISOString();
    const payload = {
      ...(existing || {}),
      ...(req.body || {}),
      id,
      createdByUid: existing?.createdByUid || req.user!.uid,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    putRecord(db, collection, id, payload);
    res.json({ doc: payload });
  });

  app.delete('/api/pos/docs/:collection/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const collection = String(req.params.collection || '');
    const id = String(req.params.id || '');
    if (
      ![...ALLOWED_COLLECTIONS, 'expenses'].includes(collection) ||
      !isValidId(id)
    ) {
      res.status(400).json({ error: 'Invalid collection or document ID.' });
      return;
    }

    const role = req.user!.role;
    const isManagerOrAdmin = role === 'SUPER_ADMIN' || role === 'MANAGER';
    if (!isManagerOrAdmin) {
      res.status(403).json({ error: 'Only Managers or Super Admins can delete records.' });
      return;
    }
    if ((collection === 'customers' || collection === 'expenses') && role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only Super Admins can delete customer or expense records.' });
      return;
    }

    const db = getDb();
    deleteRecord(db, collection, id);
    res.json({ ok: true });
  });

  return app;
}
