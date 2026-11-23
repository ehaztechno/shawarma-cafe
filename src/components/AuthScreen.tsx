import React, { useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  User,
  UserPlus,
  UtensilsCrossed,
} from 'lucide-react';
import { usePos } from '../context/PosContext';
import { PRODUCT_IMAGE_PRESETS } from '../lib/seedData';

export const AuthScreen: React.FC = () => {
  const {
    firebaseUser,
    profile,
    authLoading,
    signingIn,
    authError,
    needsSetup,
    clearAuthError,
    loginWithPassword,
    bootstrapAdmin,
    logout,
  } = usePos();

  const [username, setUsername] = useState(needsSetup ? 'admin' : '');
  const [displayName, setDisplayName] = useState('Store Admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-orange-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-stone-600 dark:text-stone-400">
            Connecting to Shawarma Cafe POS...
          </p>
        </div>
      </div>
    );
  }

  if (firebaseUser && profile && (!profile.isActive || profile.role === 'PENDING')) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">
                Staff Account Suspended
              </h1>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                @{profile.username || profile.email}
              </p>
            </div>
          </div>

          <p className="text-sm text-stone-600 dark:text-stone-300 leading-relaxed">
            Your staff account is currently inactive. Ask a Super Admin or Manager to enable your access in Staff &amp; Roles.
          </p>

          <button
            type="button"
            onClick={logout}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign Out &amp; Switch Account
          </button>
        </div>
      </div>
    );
  }

  const displayedError = localError || authError;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearAuthError();

    const cleanUser = username.trim();
    if (!cleanUser) {
      setLocalError('Please enter your username.');
      return;
    }

    if (needsSetup) {
      if (password.length < 6) {
        setLocalError('Admin password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match.');
        return;
      }
      await bootstrapAdmin({
        username: cleanUser,
        displayName: displayName.trim() || 'Store Admin',
        password,
      });
      return;
    }

    if (!password) {
      setLocalError('Please enter your password.');
      return;
    }
    await loginWithPassword(cleanUser, password);
  };

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 grid lg:grid-cols-2">
      <div className="hidden lg:block relative overflow-hidden bg-stone-900">
        <img
          src={PRODUCT_IMAGE_PRESETS.chickenShawarma}
          alt="Shawarma Cafe signature wrap"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-85"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-950/35 to-transparent flex flex-col justify-end p-12 text-white">
          <p className="text-xs font-medium tracking-wider uppercase text-orange-300 mb-2">
            Restaurant Operations Platform
          </p>
          <h2 className="text-3xl font-bold tracking-tight max-w-md text-balance">
            Fast counter billing, live kitchen tickets, and recipe-linked stock control.
          </h2>
          <p className="text-sm text-stone-300 mt-3 max-w-md">
            Built for Shawarma Cafe cashiers, kitchen display stations, and store managers.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="max-w-md w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg bg-orange-600 text-white flex items-center justify-center shrink-0">
              <UtensilsCrossed className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                Shawarma Cafe
              </h1>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Point of Sale &amp; Restaurant Management
              </p>
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-stone-200 dark:border-stone-800">
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              {needsSetup ? 'Create Store Admin Account' : 'Staff Terminal Sign In'}
            </h2>
            <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
              {needsSetup
                ? 'First-time setup: choose your Admin username and password to initialize the Shawarma Cafe POS.'
                : 'Enter your staff username and password to open the billing counter, kitchen display, or management console.'}
            </p>
          </div>

          {displayedError && (
            <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-800 dark:text-red-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{displayedError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="pos-username"
                className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
              >
                Username
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="pos-username"
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin or cashier1"
                  className="w-full min-h-[44px] pl-9 pr-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            {needsSetup && (
              <div className="space-y-1.5">
                <label
                  htmlFor="pos-displayname"
                  className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
                >
                  Display Name
                </label>
                <input
                  id="pos-displayname"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Store Owner / Admin"
                  className="w-full min-h-[44px] px-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="pos-password"
                className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="pos-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={needsSetup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={needsSetup ? 'Minimum 6 characters' : 'Enter password'}
                  className="w-full min-h-[44px] pl-9 pr-10 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {needsSetup && (
              <div className="space-y-1.5">
                <label
                  htmlFor="pos-confirm-password"
                  className="block text-xs font-semibold text-stone-700 dark:text-stone-300"
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="pos-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter admin password"
                    className="w-full min-h-[44px] pl-9 pr-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={signingIn}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white font-semibold text-sm transition-colors cursor-pointer"
            >
              {needsSetup ? <UserPlus className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
              {signingIn
                ? needsSetup
                  ? 'Creating Admin Account...'
                  : 'Signing In...'
                : needsSetup
                  ? 'Create Admin & Launch POS'
                  : 'Sign In to POS'}
            </button>
          </form>

          <div className="pt-2 text-xs text-stone-500 dark:text-stone-400 flex items-center justify-between">
            <span>Role-Based Access Control</span>
            <span aria-hidden="true">·</span>
            <span>Real-Time KOT Sync</span>
            <span aria-hidden="true">·</span>
            <span>Thermal Print Ready</span>
          </div>
        </div>
      </div>
    </div>
  );
};
