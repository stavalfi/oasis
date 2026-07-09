/**
 * create-api-key-dialog.tsx
 *
 * Create an API key from a human label and a chosen lifetime (preset or custom
 * days). The raw key is shown exactly once with a copy button and an explicit
 * "you will not see this again" warning.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { clearNewlyCreatedKey, createApiKey } from "../store/api-keys-slice.ts";
import { useAppDispatch, useAppSelector } from "../store/hooks.ts";

const EXPIRY_PRESETS = [
  { days: 1, label: "1 day" },
  { days: 30, label: "30 days" },
  { days: 365, label: "12 months" },
];
const CUSTOM_CHOICE = "custom";
const DEFAULT_CHOICE = "30";

export const CreateApiKeyDialog = (): ReactNode => {
  const dispatch = useAppDispatch();
  const { creating, error, newlyCreatedKey } = useAppSelector((state) => state.apiKeys);
  const [name, setName] = useState("");
  const [expiryChoice, setExpiryChoice] = useState(DEFAULT_CHOICE);
  const [customDays, setCustomDays] = useState("90");

  const isCustom = expiryChoice === CUSTOM_CHOICE;
  const expiresInDays = Number.parseInt(isCustom ? customDays : expiryChoice, 10);
  const isExpiryValid = Number.isInteger(expiresInDays) && expiresInDays >= 1;
  const canSubmit = name.trim().length > 0 && isExpiryValid && !creating;

  const submit = (): void => {
    if (canSubmit) {
      void dispatch(createApiKey({ expiresInDays, name: name.trim() }));
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

      <label className="field">
        <span className="field__label">Name</span>
        <input
          className="field__input"
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. prod-scanner"
          value={name}
        />
      </label>

      <label className="field">
        <span className="field__label">Expires in</span>
        <select
          className="field__input"
          onChange={(event) => setExpiryChoice(event.target.value)}
          value={expiryChoice}
        >
          {EXPIRY_PRESETS.map((preset) => (
            <option key={preset.days} value={String(preset.days)}>
              {preset.label}
            </option>
          ))}
          <option value={CUSTOM_CHOICE}>Custom…</option>
        </select>
      </label>

      {isCustom && (
        <label className="field">
          <span className="field__label">Custom expiry (days)</span>
          <input
            className="field__input"
            min="1"
            onChange={(event) => setCustomDays(event.target.value)}
            type="number"
            value={customDays}
          />
        </label>
      )}

      <button
        className="button button--primary"
        disabled={!canSubmit}
        onClick={submit}
        type="button"
      >
        {creating ? "Creating…" : "Create key"}
      </button>

      {error !== undefined && <p className="banner banner--error">{error}</p>}
    </div>
  );
};
