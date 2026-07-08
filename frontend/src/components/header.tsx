/**
 * header.tsx
 *
 * The top bar: brand, which Jira site and user we are acting as (so a
 * multi-tenant user is never unsure whose Jira they are filing into), a link to
 * API keys, and logout.
 */
import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { logout } from "../store/auth-slice.ts";
import { useAppDispatch, useAppSelector } from "../store/hooks.ts";

export const Header = (): ReactNode => {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);

  return (
    <header className="header">
      <Link className="header__brand" to="/">
        IdentityHub
      </Link>
      {user && (
        <div className="header__context">
          <span className="header__site">{user.siteName}</span>
          <span className="header__user">{user.email}</span>
        </div>
      )}
      <nav className="header__nav">
        <Link to="/settings/api-keys">API keys</Link>
        <button
          className="button"
          onClick={() => {
            void dispatch(logout());
          }}
          type="button"
        >
          Log out
        </button>
      </nav>
    </header>
  );
};
