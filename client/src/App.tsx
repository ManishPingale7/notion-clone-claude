import React, { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './store';
import { AppShell } from './shell/AppShell';
import { AuthPage } from './pages/AuthPage';
import { PublicPage } from './pages/PublicPage';
import { Loading, Toasts, ConfirmHost } from './components/ui';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const me = useApp((s) => s.me);
  const loaded = useApp((s) => s.loaded);
  const location = useLocation();
  if (!loaded) return <Loading />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />;
  return children;
}

function GuestOnly({ children }: { children: React.ReactElement }) {
  const me = useApp((s) => s.me);
  const loaded = useApp((s) => s.loaded);
  if (!loaded) return <Loading />;
  if (me) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const loadMe = useApp((s) => s.loadMe);
  useEffect(() => {
    loadMe();
    const onExpired = () => useApp.getState().set({ me: null });
    window.addEventListener('auth:expired', onExpired);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => {
      if (useApp.getState().theme === 'system') useApp.getState().setTheme('system');
    };
    mq.addEventListener('change', onScheme);
    return () => {
      window.removeEventListener('auth:expired', onExpired);
      mq.removeEventListener('change', onScheme);
    };
  }, [loadMe]);

  return (
    <>
      <Routes>
        <Route path="/login" element={<GuestOnly><AuthPage mode="login" /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><AuthPage mode="signup" /></GuestOnly>} />
        <Route path="/share/:pageId" element={<PublicPage />} />
        <Route path="/p/:pageId" element={<RequireAuth><AppShell /></RequireAuth>} />
        <Route path="/" element={<RequireAuth><AppShell /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
      <ConfirmHost />
    </>
  );
}
