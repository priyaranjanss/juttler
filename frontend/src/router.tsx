import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface RouterValue {
  path: string;
  navigate: (to: string) => void;
}

const RouterContext = createContext<RouterValue | undefined>(undefined);

function readPath(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname || '/';
}

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [path, setPath] = useState<string>(readPath);

  useEffect(() => {
    const onPopState = () => setPath(readPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string) => {
    const target = to.startsWith('/') ? to : `/${to}`;
    // Route state is the pathname only; query strings (e.g. ?next=...) belong to
    // the URL, not to the router. Keeping them out prevents redirect loops.
    const targetPath = target.split('?')[0].split('#')[0] || '/';
    const current = `${readPath()}${window.location.search}`;
    if (current !== target) {
      window.history.pushState({}, '', target);
    }
    setPath(targetPath);
  }, []);

  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>;
};

export const useRouter = (): RouterValue => {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return ctx;
};
