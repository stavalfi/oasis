/**
 * create-api-key-dialog.tsx
 *
 * Create an API key from a human label. The raw key is shown exactly once with
 * a copy button and an explicit "you will not see this again" warning.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { clearNewlyCreatedKey, createApiKey } from "../store/api-keys-slice.ts";
import { useAppDispatch, useAppSelector } from "../store/hooks.ts";

export const CreateApiKeyDialog = (): ReactNode => {
  const dispatch = useAppDispatch();
  const { creating, error, newlyCreatedKey } = useAppSelector((state) => state.apiKeys);
  const [name, setName] = useState("");

  const submit = (): void => {
    const trimmedName = name.trim();
    if (trimmedName.length > 0) {
      void dispatch(createApiKey(trimmedName));
      setName("");
    }
  };

  return (
    <div className="create-key">
      {newlyCreatedKey !== undefined && (
        <div className="banner banner--success">
          <p>Copy your key now — you will not be able to see it again.</p>
          <code className="create-key__value">{newlyCreatedKey}</code>
          <div className="create-key__actions">
            <button
              className="button"
              onClick={() => {
                void globalThis.navigator.clipboard.writeText(newlyCreatedKey);
              }}
              type="button"
            >
              Copy
            </button>
            <button
              className="button"
              onClick={() => dispatch(clearNewlyCreatedKey())}
              type="button"
            >
              Done
            </button>
          </div>
        </div>
      )}
      <div className="field field--inline">
        <input
          className="field__input"
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. prod-scanner"
          value={name}
        />
        <button
          className="button button--primary"
          disabled={creating || name.trim().length === 0}
          onClick={submit}
          type="button"
        >
          {creating ? "Creating…" : "Create key"}
        </button>
      </div>
      {error !== undefined && <p className="banner banner--error">{error}</p>}
    </div>
  );
};
