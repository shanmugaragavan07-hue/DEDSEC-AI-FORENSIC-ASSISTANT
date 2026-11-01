/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { AuthScreen } from './components/AuthScreen.tsx';
import { CreativeStudioWorkspace } from './components/CreativeStudioWorkspace.tsx';
import { ToastMessage, ToastViewport } from './components/LiquidGlassUI.tsx';
import { MarketingSite } from './components/MarketingSite.tsx';
import { api, getStoredToken, setStoredToken } from './lib/api.ts';
import { auth, firebaseSignOut } from './lib/firebase.ts';
import { StyleReference, SubscriptionPlan, UserAccount } from './types.ts';

type SurfaceRoute = 'auth' | 'studio' | 'marketing';

export default function App() {
  const [route, setRoute] = useState<SurfaceRoute>(() =>
    window.location.hash === '#marketing' ? 'marketing' : 'auth'
  );
  const [booting, setBooting] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [styles, setStyles] = useState<StyleReference[]>([]);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback(
    (type: 'success' | 'error' | 'info', title: string, detail?: string) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, title, detail }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4800);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const pub = await api.getPublicConfig();
        if (!mounted) return;
        setPlans(pub.plans);
        setStyles(pub.styles);
        setSmtpConfigured(pub.capabilities.smtpConfigured);

        const existingToken = getStoredToken();
        if (existingToken) {
          try {
            const me = await api.getMe();
            if (!mounted) return;
            setCurrentUser(me.user);
            setSmtpConfigured(me.smtpConfigured);
            if (window.location.hash !== '#marketing') {
              setRoute('studio');
            }
          } catch {
            setStoredToken(null);
          }
        }
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        if (mounted) setBooting(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore network errors during logout cleanup
    }
    try {
      if (auth.currentUser) {
        await firebaseSignOut(auth);
      }
    } catch {
      // Ignore Firebase signout error
    }
    setStoredToken(null);
    setCurrentUser(null);
    window.location.hash = '';
    setRoute('auth');
    notify('info', 'Signed Out', 'Your DEDSEC studio session has been closed.');
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-[#08090D] text-[#F5F5F7] flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-sm font-semibold tracking-tight">DEDSEC</p>
          <p className="text-xs text-[#989BA6]">Initializing studio environment...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {route === 'marketing' && (
        <MarketingSite
          plans={plans}
          currentUser={currentUser}
          onGetStarted={() => {
            window.location.hash = '';
            setRoute(currentUser ? 'studio' : 'auth');
          }}
          onOpenStudio={() => {
            window.location.hash = '';
            setRoute(currentUser ? 'studio' : 'auth');
          }}
        />
      )}

      {route === 'auth' && !currentUser && (
        <AuthScreen
          smtpConfigured={smtpConfigured}
          onAuthenticated={(user) => {
            setCurrentUser(user);
            window.location.hash = '';
            setRoute('studio');
          }}
          onOpenMarketingSite={() => {
            window.location.hash = 'marketing';
            setRoute('marketing');
          }}
          notify={notify}
        />
      )}

      {(route === 'studio' || (route === 'auth' && currentUser)) && currentUser && (
        <CreativeStudioWorkspace
          user={currentUser}
          smtpConfigured={smtpConfigured}
          styles={styles}
          onUserUpdated={setCurrentUser}
          onLogout={handleLogout}
          onOpenMarketingSite={() => {
            window.location.hash = 'marketing';
            setRoute('marketing');
          }}
          notify={notify}
        />
      )}

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
