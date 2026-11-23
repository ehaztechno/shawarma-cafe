import React, { useState } from 'react';
import { X } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { CustomersView } from './components/CustomersView';
import { DashboardView } from './components/DashboardView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExpensesView } from './components/ExpensesView';
import { InventoryView } from './components/InventoryView';
import { KitchenDisplayView } from './components/KitchenDisplayView';
import { MenuManagementView } from './components/MenuManagementView';
import { OrdersHistoryView } from './components/OrdersHistoryView';
import { PosBillingView } from './components/PosBillingView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { Sidebar, TopHeader } from './components/Sidebar';
import { StaffRolesView } from './components/StaffRolesView';
import { TablesView } from './components/TablesView';
import { PosProvider, usePos } from './context/PosContext';

const PosWorkspace: React.FC = () => {
  const {
    firebaseUser,
    profile,
    activeRole,
    authLoading,
    activeSection,
    toasts,
    dismissToast,
  } = usePos();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (authLoading || !firebaseUser || !profile || !profile.isActive || activeRole === 'PENDING') {
    return <AuthScreen />;
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'dashboard':
        return <DashboardView />;
      case 'pos':
        return <PosBillingView />;
      case 'kot':
        return <KitchenDisplayView />;
      case 'tables':
        return <TablesView />;
      case 'orders':
        return <OrdersHistoryView />;
      case 'menu':
        return <MenuManagementView />;
      case 'inventory':
        return <InventoryView />;
      case 'customers':
        return <CustomersView />;
      case 'expenses':
        return <ExpensesView />;
      case 'reports':
        return <ReportsView />;
      case 'staff':
        return <StaffRolesView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <PosBillingView />;
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex">
      <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopHeader onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1 min-w-0">{renderSection()}</main>
      </div>

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="no-print fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full px-4 sm:px-0">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`px-4 py-3 rounded-xl border text-xs font-medium shadow-lg flex items-center justify-between gap-3 ${
                t.type === 'error'
                  ? 'bg-red-600 border-red-700 text-white'
                  : t.type === 'success'
                    ? 'bg-stone-900 dark:bg-stone-100 border-stone-800 dark:border-stone-200 text-white dark:text-stone-900'
                    : 'bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100'
              }`}
            >
              <span>{t.text}</span>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="opacity-70 hover:opacity-100 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <PosProvider>
        <PosWorkspace />
      </PosProvider>
    </ErrorBoundary>
  );
}
