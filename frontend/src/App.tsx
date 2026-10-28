import React, { lazy, Suspense, useEffect } from 'react';
import { AppProvider, useApp } from './contexts/AppContext';
import { RouterProvider, useRouter } from './router';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { JuttlerLogo } from './components/common/JuttlerLogo';
import { CheckCircle2, AlertTriangle, Info, Loader2 } from 'lucide-react';

const UserShell = lazy(() =>
  import('./components/workspace/UserShell').then(({ UserShell: component }) => ({
    default: component,
  }))
);

const LoadingScreen: React.FC = () => {
  const { theme } = useApp();
  const isDark = theme === 'dark';

  return (
    <div
      className={`flex h-screen items-center justify-center transition-colors ${
        isDark ? 'bg-black text-white' : 'bg-white text-black'
      }`}
    >
      <div className="flex flex-col items-center space-y-3">
        <div
          className={`p-3 rounded-2xl border ${
            isDark ? 'bg-[#16181c] border-[#2f3336] text-white' : 'bg-[#f7f9f9] border-[#eff3f4] text-black'
          }`}
        >
          <JuttlerLogo className="h-8 w-8" />
        </div>
        <Loader2 className="h-4 w-4 animate-spin text-purple-500" aria-hidden="true" />
        <p role="status" className={`text-xs font-mono font-bold tracking-widest ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
          CHECKING YOUR SESSION...
        </p>
      </div>
    </div>
  );
};

const ToastHost: React.FC = () => {
  const { notification, theme } = useApp();

  if (!notification) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center space-x-2.5 rounded-full px-4 py-2 text-xs font-semibold shadow-2xl transition-all bg-[#16181c] border border-[#2f3336] text-white">
      {notification.type === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
      {notification.type === 'warning' && <AlertTriangle className="h-4 w-4 text-amber-400" />}
      {notification.type === 'info' && <Info className="h-4 w-4 text-cyan-400 text-xs" />}
      <span>{notification.message}</span>
    </div>
  );
};

const Root: React.FC = () => {
  const { isAuthenticated, isLoading, currentUser } = useApp();
  const { path, navigate } = useRouter();

  useEffect(() => {
    // Do not redirect until the stored session has been checked; otherwise a
    // hard refresh of /workspace/... bounces through /login and loses the route.
    if (isLoading) return;

    if (!isAuthenticated) {
      if (path !== '/login' && path !== '/register') {
        const intended = path === '/' ? '/workspace' : path;
        navigate(`/login?next=${encodeURIComponent(intended)}`);
      }
      return;
    }

    if (path === '/' || path === '/login' || path === '/register') {
      const requested = new URLSearchParams(window.location.search).get('next');
      const safeNext =
        requested && (requested === '/workspace' || requested.startsWith('/workspace/'))
          ? requested
          : '/workspace';
      navigate(safeNext);
    }
  }, [isAuthenticated, isLoading, path, navigate]);

  let content: React.ReactNode;

  if (isLoading) {
    content = <LoadingScreen />;
  } else if (!isAuthenticated) {
    content = path === '/register' ? <RegisterPage /> : <LoginPage />;
  } else if (!currentUser) {
    content = <LoadingScreen />;
  } else if (path.startsWith('/workspace')) {
    content = (
      <Suspense fallback={<LoadingScreen />}>
        <UserShell />
      </Suspense>
    );
  } else {
    // Role/route mismatch while the redirect effect runs
    content = <LoadingScreen />;
  }

  return (
    <>
      {content}
      <ToastHost />
    </>
  );
};

export default function App() {
  return (
    <RouterProvider>
      <AppProvider>
        <Root />
      </AppProvider>
    </RouterProvider>
  );
}