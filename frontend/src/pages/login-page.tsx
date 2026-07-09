/**
 * login-page.tsx
 *
 * The unauthenticated landing page: a single "Connect Jira" button that starts
 * the OAuth flow. Surfaces a calm message if a previous attempt failed.
 */
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { goToLogin } from "../client.ts";

export const LoginPage = (): ReactNode => {
  const [searchParams] = useSearchParams();
  const hasOauthError = searchParams.get("error") === "oauth";

  return (
    <main className="login">
      <div className="login__card">
        <span aria-hidden="true" className="login__logo">
          IH
        </span>
        <h1 className="login__title">IdentityHub</h1>
        <p className="login__tagline">
          Report non-human-identity findings straight to your Jira project.
        </p>
        {hasOauthError && (
          <p className="banner banner--error">
            We couldn&apos;t complete the Jira login. Please try again.
          </p>
        )}
        <button className="button button--primary button--block" onClick={goToLogin} type="button">
          Connect Jira
        </button>
      </div>
    </main>
  );
};
