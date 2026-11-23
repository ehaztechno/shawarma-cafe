import { AppSection, StaffRole } from '../types/pos';

export const BOOTSTRAP_ADMIN_EMAIL = 'ehaztechno@gmail.com';

export const ROLE_LABELS: Record<StaffRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
  KITCHEN_STAFF: 'Kitchen Staff',
  PENDING: 'Pending Approval',
};

export const ROLE_PERMISSIONS: Record<StaffRole, string[]> = {
  SUPER_ADMIN: [
    'view_dashboard',
    'pos_billing',
    'kot_view',
    'kot_update',
    'tables_manage',
    'orders_view',
    'orders_cancel',
    'orders_refund',
    'receipt_reprint',
    'menu_manage',
    'inventory_manage',
    'customers_manage',
    'expenses_manage',
    'reports_view',
    'staff_manage',
    'settings_manage',
  ],
  MANAGER: [
    'view_dashboard',
    'pos_billing',
    'kot_view',
    'kot_update',
    'tables_manage',
    'orders_view',
    'orders_cancel',
    'orders_refund',
    'receipt_reprint',
    'menu_manage',
    'inventory_manage',
    'customers_manage',
    'expenses_manage',
    'reports_view',
    'staff_manage',
  ],
  CASHIER: [
    'pos_billing',
    'kot_view',
    'tables_manage',
    'orders_view',
    'receipt_reprint',
    'customers_manage',
  ],
  KITCHEN_STAFF: ['kot_view', 'kot_update'],
  PENDING: [],
};

export const SECTION_PERMISSIONS: Record<AppSection, string> = {
  dashboard: 'view_dashboard',
  pos: 'pos_billing',
  kot: 'kot_view',
  tables: 'tables_manage',
  orders: 'orders_view',
  menu: 'menu_manage',
  inventory: 'inventory_manage',
  customers: 'customers_manage',
  expenses: 'expenses_manage',
  reports: 'reports_view',
  staff: 'staff_manage',
  settings: 'settings_manage',
};

export function hasPermission(role: StaffRole | undefined | null, permission: string): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAccessSection(role: StaffRole | undefined | null, section: AppSection): boolean {
  return hasPermission(role, SECTION_PERMISSIONS[section]);
}

export function getDefaultSectionForRole(role: StaffRole): AppSection {
  if (role === 'KITCHEN_STAFF') return 'kot';
  if (role === 'CASHIER') return 'pos';
  return 'dashboard';
}

export function formatCurrency(amount: number, symbol = '₹'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${symbol}${safe.toLocaleString('en-IN', {
    minimumFractionDigits: safe % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatTimestamp(ts: any): string {
  if (!ts) return '—';
  const d = typeof ts?.toDate === 'function' ? ts.toDate() : ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function toDateObj(ts: any): Date {
  if (!ts) return new Date(0);
  if (typeof ts?.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
