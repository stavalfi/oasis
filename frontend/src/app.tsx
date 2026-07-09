/**
 * app.tsx
 *
 * Top-level routing and the auth gate. On startup it checks the session; while
 * checking it shows a lightweight loading state, then routes to the login page
 * or the authenticated app.
 */
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ApiKeysPage } from "./pages/api-keys-page.tsx";
import { DashboardPage } from "./pages/dashboard-page.tsx";
import { LoginPage } from "./pages/login-page.tsx";
import { loadCurrentUser } from "./store/auth-slice.ts";
import { useAppDispatch, useAppSelector } from "./store/hooks.ts";

export const App = (): ReactNode => {
  const dispatch = useAppDispatch();
  const status = useAppSelector((state) => state.auth.status);

  useEffect(() => {
    void dispatch(loadCurrentUser());
  }, [dispatch]);

  if (status === "checking") {
    return <div className="app-loading">Loading…</div>;
  }

  const requireAuth = (page: ReactNode): ReactNode =>
    status === "loggedIn" ? page : <Navigate replace to="/login" />;

  return (
    <Routes>
      <Route element={<LoginPage />} path="/login" />
      <Route element={requireAuth(<DashboardPage />)} path="/" />
      <Route element={requireAuth(<ApiKeysPage />)} path="/settings/api-keys" />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
};
