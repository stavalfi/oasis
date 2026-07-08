/**
 * create-finding-form.tsx
 *
 * The create-finding form, built from the selected project's field metadata: it
 * always shows Title and Description, then every required field and the curated
 * optional fields the project exposes. Values are validated live and the work
 * is saved to localStorage per project so a failed submit never loses input.
 */
import { type ReactNode, useEffect, useState } from "react";
import { createFinding } from "../store/tickets-slice.ts";
import { useAppDispatch, useAppSelector } from "../store/hooks.ts";

const TITLE_MAX_LENGTH = 255;
const DESCRIPTION_MAX_LENGTH = 32_767;

interface DraftState {
  title: string;
  description: string;
  fieldValues: Record<string, string>;
}

const emptyDraft: DraftState = { description: "", fieldValues: {}, title: "" };

const draftStorageKey = (projectKey: string): string => `draft:finding:${projectKey}`;

export const CreateFindingForm = (): ReactNode => {
  const dispatch = useAppDispatch();
  const projects = useAppSelector((state) => state.projects.list);
  const selectedProjectKey = useAppSelector((state) => state.projects.selectedProjectKey);
  const { creating, createError } = useAppSelector((state) => state.tickets);
  const project = projects.find((candidate) => candidate.key === selectedProjectKey);

  const [draft, setDraft] = useState<DraftState>(emptyDraft);

  // Restore the saved draft when the selected project changes.
  useEffect(() => {
    if (selectedProjectKey === undefined) {
      return;
    }
    const saved = globalThis.localStorage.getItem(draftStorageKey(selectedProjectKey));
    if (saved) {
      const parsed: DraftState = JSON.parse(saved);
      setDraft(parsed);
    } else {
      setDraft(emptyDraft);
    }
  }, [selectedProjectKey]);

  // Persist the draft as the user types.
  useEffect(() => {
    if (selectedProjectKey !== undefined) {
      globalThis.localStorage.setItem(draftStorageKey(selectedProjectKey), JSON.stringify(draft));
    }
  }, [draft, selectedProjectKey]);

  if (project === undefined) {
    return <p className="muted">Select a project to start a finding.</p>;
  }

  const trimmedTitle = draft.title.trim();
  const isTitleTooLong = draft.title.length > TITLE_MAX_LENGTH;
  const isDescriptionTooLong = draft.description.length > DESCRIPTION_MAX_LENGTH;
  const hasMissingRequired = project.fields.some(
    (field) => field.required && (draft.fieldValues[field.fieldId] ?? "").trim().length === 0,
  );
  const canSubmit =
    trimmedTitle.length > 0 &&
    !isTitleTooLong &&
    !isDescriptionTooLong &&
    !hasMissingRequired &&
    !creating;

  const setFieldValue = ({ fieldId, value }: { fieldId: string; value: string }): void => {
    setDraft((current) => ({
      ...current,
      fieldValues: { ...current.fieldValues, [fieldId]: value },
    }));
  };

  const submit = async (): Promise<void> => {
    const fields: Record<string, unknown> = {};
    for (const field of project.fields) {
      const value = (draft.fieldValues[field.fieldId] ?? "").trim();
      if (value.length > 0) {
        fields[field.fieldId] =
          field.type === "array"
            ? value
                .split(",")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0)
            : value;
      }
    }
    try {
      await dispatch(
        createFinding({
          description: draft.description,
          fields,
          projectKey: project.key,
          title: trimmedTitle,
        }),
      ).unwrap();
      // On success clear the saved draft so it does not linger.
      globalThis.localStorage.removeItem(draftStorageKey(project.key));
      setDraft(emptyDraft);
    } catch {
      // The error is surfaced via createError; the draft is intentionally kept.
    }
  };

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="field">
        <span className="field__label">Title</span>
        <input
          className="field__input"
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          value={draft.title}
        />
        <span className={isTitleTooLong ? "field__counter field__counter--over" : "field__counter"}>
          {draft.title.length} / {TITLE_MAX_LENGTH}
        </span>
      </label>

      <label className="field">
        <span className="field__label">Description</span>
        <textarea
          className="field__input field__input--multiline"
          onChange={(event) =>
            setDraft((current) => ({ ...current, description: event.target.value }))
          }
          value={draft.description}
        />
      </label>

      {project.fields.map((field) => (
        <label className="field" key={field.fieldId}>
          <span className="field__label">
            {field.name}
            {field.required && <em className="field__required"> *</em>}
          </span>
          {field.allowedValues !== undefined && field.allowedValues.length > 0 ? (
            <select
              className="field__input"
              onChange={(event) =>
                setFieldValue({ fieldId: field.fieldId, value: event.target.value })
              }
              value={draft.fieldValues[field.fieldId] ?? ""}
            >
              <option value="">— select —</option>
              {field.allowedValues.map((allowed) => (
                <option
                  key={allowed.id ?? allowed.value ?? allowed.name}
                  value={allowed.id ?? allowed.value ?? ""}
                >
                  {allowed.name ?? allowed.value ?? allowed.id}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="field__input"
              onChange={(event) =>
                setFieldValue({ fieldId: field.fieldId, value: event.target.value })
              }
              placeholder={field.type === "array" ? "comma, separated, values" : ""}
              value={draft.fieldValues[field.fieldId] ?? ""}
            />
          )}
        </label>
      ))}

      {createError !== undefined && <p className="banner banner--error">{createError}</p>}

      <button className="button button--primary" disabled={!canSubmit} type="submit">
        {creating ? "Creating…" : "Create ticket"}
      </button>
    </form>
  );
};
