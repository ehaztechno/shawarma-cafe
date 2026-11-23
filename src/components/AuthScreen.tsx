import React from 'react';
import { AlertTriangle, Clock, LogOut, ShieldCheck, UtensilsCrossed } from 'lucide-react';
import firebaseConfig from '../../firebase-applet-config.json';
import { usePos } from '../context/PosContext';
import { PRODUCT_IMAGE_PRESETS } from '../lib/seedData';

export const AuthScreen: React.FC = () => {
  const {
    firebaseUser,
    profile,
    authLoading,
    signingIn,
    authError,
    signInWithGoogle,
    signInWithGoogleRedirect,
    logout,
  } = usePos();

  const isTopLevelWindow = typeof window !== 'undefined' && window.self === window.top;
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const showOAuthSetupDetails =
    Boolean(authError) &&
    /unauthorized-domain|redirect_uri_mismatch|auth\/internal-error|domain/i.test(authError || '');

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
                Staff Approval Pending
              </h1>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {profile.email}
              </p>
            </div>
          </div>

          <p className="text-sm text-stone-600 dark:text-stone-300 leading-relaxed">
            Your account has been registered, but a Super Admin or Manager must activate your staff role (Cashier, Kitchen Staff, or Manager) before accessing Shawarma Cafe POS.
          </p>

          <button
            type="button"
            onClick={logout}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out &amp; Switch Account
          </button>
        </div>
      </div>
    );
  }

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

          <div className="space-y-2 pt-2 border-t border-stone-200 dark:border-stone-800">
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              Staff Terminal Sign In
            </h2>
            <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
              Sign in with your authorized Google staff account to open the billing counter, kitchen display, or management console.
            </p>
          </div>

          {authError && (
            <div className="p-3.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-800 dark:text-red-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5 leading-relaxed min-w-0">
                <p className="font-semibold">Unable to complete Google Sign-In</p>
                <p>{authError}</p>
                {showOAuthSetupDetails && (
                  <div className="pt-1.5 border-t border-red-200 dark:border-red-800/70 space-y-1 text-[11px] font-mono break-all">
                    <p>Project: {firebaseConfig.projectId}</p>
                    <p>OAuth Client: {firebaseConfig.oAuthClientId}</p>
                    {currentOrigin && <p>Origin: {currentOrigin}</p>}
                    <p>Redirect URI: https://{firebaseConfig.authDomain}/__/auth/handler</p>
                    {currentOrigin && (
                      <p>Proxy URI: {currentOrigin}/__/auth/handler</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            <button
              type="button"
              disabled={signingIn}
              onClick={signInWithGoogle}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-3 px-5 py-3 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white font-semibold text-sm transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              {signingIn ? 'Opening Google Sign-In...' : 'Sign In with Google'}
            </button>

            {isTopLevelWindow && (
              <button
                type="button"
                disabled={signingIn}
                onClick={signInWithGoogleRedirect}
                className="w-full min-h-[38px] inline-flex items-center justify-center px-4 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-60 transition-colors cursor-pointer"
              >
                Popup blocked? Use Redirect Sign-In
              </button>
            )}
          </div>

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

