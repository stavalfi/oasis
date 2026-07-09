/**
 * create-finding-form.tsx
 *
 * The create-finding form, built from the selected project's field metadata: it
 * always shows Title and Description, then every required field and the curated
 * optional fields the project exposes. Values are validated live and the work
 * is saved to localStorage per project so a failed submit never loses input.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchAssignees } from "../client.ts";
import type { Assignee } from "../client.ts";
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
  const [assignees, setAssignees] = useState<Assignee[]>([]);

  // Load the assignable users for the selected project (for user-type fields).
  useEffect(() => {
    if (selectedProjectKey === undefined) {
      return;
    }
    setAssignees([]);
    const loadAssignees = async (): Promise<void> => {
      try {
        setAssignees(await fetchAssignees(selectedProjectKey));
      } catch (error: unknown) {
        // Leave the picker empty so the rest of the form still works, but never
        // hide the failure — surface it in the console.
        console.error("Failed to load assignable users", error);
        setAssignees([]);
      }
    };
    void loadAssignees();
  }, [selectedProjectKey]);

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
  const trimmedDescription = draft.description.trim();
  const isTitleTooLong = draft.title.length > TITLE_MAX_LENGTH;
  const isDescriptionTooLong = draft.description.length > DESCRIPTION_MAX_LENGTH;
  const hasMissingRequired = project.fields.some(
    (field) => field.required && (draft.fieldValues[field.fieldId] ?? "").trim().length === 0,
  );
  const canSubmit =
    trimmedTitle.length > 0 &&
    trimmedDescription.length > 0 &&
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
      const isDate = field.type === "date" || field.type === "datetime";
      // Only send a field the user actually filled. A date value that isn't a
      // valid yyyy-MM-dd (e.g. a stale draft the date picker can't display) is
      // treated as empty, so we never submit a field that looks blank.
      const isUsable = value.length > 0 && (!isDate || /^\d{4}-\d{2}-\d{2}$/u.test(value));
      if (isUsable) {
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
    } catch (error: unknown) {
      // The message is surfaced to the user via createError and the draft is
      // intentionally kept; also log it so the full error is never hidden.
      console.error("Failed to create finding", error);
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
        <span className="field__label">
          Title<em className="field__required"> *</em>
        </span>
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
        <span className="field__label">
          Description<em className="field__required"> *</em>
        </span>
        <textarea
          className="field__input field__input--multiline"
          onChange={(event) =>
            setDraft((current) => ({ ...current, description: event.target.value }))
          }
          value={draft.description}
        />
      </label>

      {project.fields.map((field) => {
        let control: ReactNode;
        if (field.type === "user") {
          // A Jira user field (e.g. assignee): pick from the project's
          // assignable users so we only ever send a valid account.
          control = (
            <select
              className="field__input"
              onChange={(event) =>
                setFieldValue({ fieldId: field.fieldId, value: event.target.value })
              }
              value={draft.fieldValues[field.fieldId] ?? ""}
            >
              <option value="">— unassigned —</option>
              {assignees.map((user) => (
                <option key={user.accountId} value={user.accountId}>
                  {user.displayName}
                </option>
              ))}
            </select>
          );
        } else if (field.allowedValues !== undefined && field.allowedValues.length > 0) {
          control = (
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
          );
        } else {
          control = (
            <input
              className="field__input"
              onChange={(event) =>
                setFieldValue({ fieldId: field.fieldId, value: event.target.value })
              }
              placeholder={field.type === "array" ? "comma, separated, values" : ""}
              type={field.type === "date" ? "date" : "text"}
              value={draft.fieldValues[field.fieldId] ?? ""}
            />
          );
        }

        return (
          <label className="field" key={field.fieldId}>
            <span className="field__label">
              {field.name}
              {field.required ? (
                <em className="field__required"> *</em>
              ) : (
                <span className="field__optional"> (optional)</span>
              )}
            </span>
            {control}
          </label>
        );
      })}

      {createError !== undefined && <p className="banner banner--error">{createError}</p>}

      <button className="button button--primary" disabled={!canSubmit} type="submit">
        {creating ? "Creating…" : "Create ticket"}
      </button>
    </form>
  );
};
