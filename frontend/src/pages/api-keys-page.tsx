/**
 * api-keys-page.tsx
 *
 * Manage machine credentials: create a key (shown once) and revoke existing
 * ones. Loads the key list on mount.
 */
import { type ReactNode, useEffect } from "react";
import { ApiKeyList } from "../components/api-key-list.tsx";
import { CreateApiKeyDialog } from "../components/create-api-key-dialog.tsx";
import { Header } from "../components/header.tsx";
import { useAppDispatch } from "../store/hooks.ts";
import { loadApiKeys } from "../store/api-keys-slice.ts";

export const ApiKeysPage = (): ReactNode => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    void dispatch(loadApiKeys());
  }, [dispatch]);

  return (
    <div className="page">
      <Header />
      <main className="api-keys">
        <section className="card">
          <h2 className="card__title">Create an API key</h2>
          <CreateApiKeyDialog />
        </section>
        <section className="card">
          <h2 className="card__title">Your API keys</h2>
          <ApiKeyList />
        </section>
      </main>
    </div>
  );
};
