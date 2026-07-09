/**
 * api-key-list.tsx
 *
 * The user's API keys with metadata. Revoke asks for confirmation (destructive)
 * and takes effect immediately.
 */
import type { ReactNode } from "react";
import { revokeApiKey } from "../store/api-keys-slice.ts";
import { useAppDispatch, useAppSelector } from "../store/hooks.ts";
import { formatDate } from "../util/dates.ts";

export const ApiKeyList = (): ReactNode => {
  const dispatch = useAppDispatch();
  const keys = useAppSelector((state) => state.apiKeys.list);
  const loading = useAppSelector((state) => state.apiKeys.loading);

  if (loading && keys.length === 0) {
    return <p className="muted">Loading API keys…</p>;
  }
  if (keys.length === 0) {
    return <p className="muted">No API keys yet. Create one above.</p>;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Created</th>
          <th scope="col">Last used</th>
          <th scope="col">Expires</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((apiKey) => (
          <tr key={apiKey.id}>
            <td>{apiKey.name}</td>
            <td>{formatDate(apiKey.createdAt)}</td>
            <td>{apiKey.lastUsedAt === undefined ? "Never" : formatDate(apiKey.lastUsedAt)}</td>
            <td>{formatDate(apiKey.expiresAt)}</td>
            <td>
              <button
                className="button button--danger"
                onClick={() => {
                  if (globalThis.confirm(`Revoke "${apiKey.name}"? This cannot be undone.`)) {
                    void dispatch(revokeApiKey(apiKey.id));
                  }
                }}
                type="button"
              >
                Revoke
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
