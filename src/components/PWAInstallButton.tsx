import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-xs font-semibold text-stone-800 dark:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5 text-orange-600" />
        <span className="hidden sm:inline">Install POS App</span>
        <span className="sm:hidden">Install</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-xs font-semibold text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Smartphone className="w-3.5 h-3.5 text-orange-600" />
          Install on iOS
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 p-5 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">
                  Install Shawarma Cafe POS
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 text-stone-400 hover:text-stone-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-stone-600 dark:text-stone-300 leading-relaxed">
                1. Tap the <strong>Share</strong> button in the Safari toolbar.
                <br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.
                <br />
                3. Launch from your Home Screen for fullscreen offline POS billing.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[38px] rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
