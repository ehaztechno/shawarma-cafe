import React, { useState } from 'react';
import {
  BarChart3,
  ChefHat,
  ClipboardList,
  CloudOff,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Receipt,
  RefreshCw,
  Settings,
  Shield,
  ShoppingBag,
  Sun,
  Users,
  UtensilsCrossed,
  Wallet,
  Wifi,
  X,
} from 'lucide-react';
import { usePos } from '../context/PosContext';
import { canAccessSection, ROLE_LABELS } from '../lib/permissions';
import { AppSection } from '../types/pos';
import { PWAInstallButton } from './PWAInstallButton';
import { SyncStatusModal } from './SyncStatusModal';

interface NavItem {
  id: AppSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'pos', label: 'POS Billing', icon: ShoppingBag },
  { id: 'kot', label: 'Kitchen KOT', icon: ChefHat },
  { id: 'tables', label: 'Tables', icon: UtensilsCrossed },
  { id: 'orders', label: 'Orders & Bills', icon: Receipt },
  { id: 'menu', label: 'Menu & Add-ons', icon: ClipboardList },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'expenses', label: 'Expenses', icon: Wallet },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'staff', label: 'Staff & Roles', icon: Shield },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const Sidebar: React.FC<{
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}> = ({ mobileOpen, setMobileOpen }) => {
  const {
    activeSection,
    setActiveSection,
    activeRole,
    profile,
    settings,
    orders,
    ingredients,
    isDark,
    toggleTheme,
    logout,
  } = usePos();

  const activeKotCount = orders.filter((o) =>
    ['NEW', 'PREPARING'].includes(o.status)
  ).length;
  const lowStockCount = ingredients.filter(
    (i) => i.currentStock <= i.minStockAlert
  ).length;

  const visibleItems = NAV_ITEMS.filter((item) => canAccessSection(activeRole, item.id));

  const renderLinks = () => (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const active = activeSection === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setActiveSection(item.id);
              setMobileOpen(false);
            }}
            className={`w-full min-h-[40px] flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              active
                ? 'bg-orange-600 text-white'
                : 'text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800/80'
            }`}
          >
            <span className="flex items-center gap-2.5 truncate">
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </span>
            {item.id === 'kot' && activeKotCount > 0 && (
              <span
                className={`text-xs font-mono-num font-semibold ${
                  active ? 'text-orange-100' : 'text-orange-600 dark:text-orange-400'
                }`}
              >
                {activeKotCount}
              </span>
            )}
            {item.id === 'inventory' && lowStockCount > 0 && (
              <span
                className={`text-xs font-mono-num font-semibold ${
                  active ? 'text-orange-100' : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {lowStockCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-60 xl:w-64 shrink-0 flex-col bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800 h-screen sticky top-0">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-600 text-white flex items-center justify-center shrink-0">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="font-display font-bold text-base text-stone-900 dark:text-stone-100 truncate">
              {settings.restaurantName}
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
              {ROLE_LABELS[activeRole]}
            </p>
          </div>
        </div>

        {renderLinks()}

        <div className="p-3 border-t border-stone-200 dark:border-stone-800 space-y-2">
          <div className="px-2 py-1">
            <p className="text-xs font-medium text-stone-900 dark:text-stone-100 truncate">
              {profile?.displayName}
            </p>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
              {profile?.email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {isDark ? 'Light' : 'Dark'}
            </button>
            <button
              type="button"
              onClick={logout}
              className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800 flex flex-col h-full">
            <div className="px-4 py-3.5 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
              <span className="font-display font-bold text-base text-stone-900 dark:text-stone-100">
                {settings.restaurantName}
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderLinks()}
            <div className="p-3 border-t border-stone-200 dark:border-stone-800 flex items-center gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-medium"
              >
                {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                {isDark ? 'Light Mode' : 'Dark Mode'}
              </button>
              <button
                type="button"
                onClick={logout}
                className="min-h-[40px] px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-medium text-red-600"
              >
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
};

export const TopHeader: React.FC<{
  onOpenMenu: () => void;
}> = ({ onOpenMenu }) => {
  const {
    activeSection,
    setActiveSection,
    activeRole,
    settings,
    isDark,
    toggleTheme,
    isOnline,
    isSyncing,
    syncQueue,
  } = usePos();
  const [showSyncModal, setShowSyncModal] = useState(false);
  const currentTitle = NAV_ITEMS.find((n) => n.id === activeSection)?.label || 'POS';
  const failedCount = syncQueue.filter((q) => q.status === 'FAILED').length;

  return (
    <>
      <header className="no-print sticky top-0 z-30 bg-white/95 dark:bg-stone-900/95 backdrop-blur border-b border-stone-200 dark:border-stone-800 px-4 lg:px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation menu"
            className="lg:hidden p-2 -ml-2 rounded-lg text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="font-display font-bold text-base sm:text-lg text-stone-900 dark:text-stone-100 truncate">
            {currentTitle}
          </h1>
          <span className="hidden sm:inline text-xs text-stone-400 dark:text-stone-500">·</span>
          <span className="hidden sm:inline text-xs text-stone-500 dark:text-stone-400 truncate">
            {settings.restaurantName} ({settings.openingHours})
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowSyncModal(true)}
            title="Inspect offline storage & Firebase sync queue"
            className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              !isOnline
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                : failedCount > 0
                  ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                  : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700'
            }`}
          >
            {isSyncing ? (
              <RefreshCw className="w-3.5 h-3.5 text-orange-600 animate-spin" />
            ) : isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <CloudOff className="w-3.5 h-3.5 text-amber-600" />
            )}
            <span>
              {isSyncing
                ? 'Syncing'
                : !isOnline
                  ? 'Offline'
                  : syncQueue.length > 0
                    ? 'Pending Sync'
                    : 'Online'}
            </span>
            {syncQueue.length > 0 && (
              <span className="font-mono-num text-[11px] font-bold">
                ({syncQueue.length})
              </span>
            )}
          </button>

          <PWAInstallButton />

          {canAccessSection(activeRole, 'pos') && activeSection !== 'pos' && (
            <button
              type="button"
              onClick={() => setActiveSection('pos')}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              New Bill
            </button>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="lg:hidden p-2 rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {showSyncModal && <SyncStatusModal onClose={() => setShowSyncModal(false)} />}
    </>
  );
};
