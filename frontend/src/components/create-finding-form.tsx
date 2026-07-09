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
import { FuzzySelect } from "./fuzzy-select.tsx";

const TITLE_MAX_LENGTH = 255;
const DESCRIPTION_MAX_LENGTH = 32_767;

interface DraftState {
  title: string;
  description: string;
  fieldValues: Record<string, string>;
}

const emptyDraft: DraftState = { description: "", fieldValues: {}, title: "" };

const draftStorageKey = (projectKey: string): string => `draft:finding:${projectKey}`;

/**
 * A field the user picks a Jira account for: the built-in user fields and
 * multi-user-picker arrays (e.g. a custom "Owner" field). These render as the
 * assignee dropdown so only a valid account can be chosen.
 */
const isUserField = (field: { type: string; itemsType?: string | undefined }): boolean =>
  field.type === "user" || (field.type === "array" && field.itemsType === "user");

/**
 * Render a server error message with the offending field name in bold, so the
 * user sees which field to fix. Each line is one error; the field name is either
 * before a colon ("Owner: Specify a valid value") or the start of a plain
 * sentence naming a known field ("Owner is required for this project.").
 */
const renderErrorMessage = ({
  fieldNames,
  message,
}: {
  fieldNames: string[];
  message: string;
}): ReactNode =>
  message.split("\n").map((line) => {
    const separator = line.indexOf(": ");
    if (separator !== -1) {
      return (
        <p className="banner__line" key={line}>
          <strong>{line.slice(0, separator)}</strong>
          {line.slice(separator)}
        </p>
      );
    }
    // No colon: bold a known field name that begins the line. Longest match
    // first so a multi-word name ("Budget Amount") wins over a prefix.
    const field = [...fieldNames]
      .toSorted((first, second) => second.length - first.length)
      .find((name) => line.startsWith(`${name} `));
    if (field !== undefined) {
      return (
        <p className="banner__line" key={line}>
          <strong>{field}</strong>
          {line.slice(field.length)}
        </p>
      );
    }
    return (
      <p className="banner__line" key={line}>
        {line}
      </p>
    );
  });

export const CreateFindingForm = (): ReactNode => {
  const dispatch = useAppDispatch();
  const projects = useAppSelector((state) => state.projects.list);
  const selectedProjectKey = useAppSelector((state) => state.projects.selectedProjectKey);
  const { creating, createError } = useAppSelector((state) => state.tickets);
  const project = projects.find((candidate) => candidate.key === selectedProjectKey);

  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);

  // Load the assignable users for the selected project (for user-type fields).
  useEffect(() => {
    if (selectedProjectKey === undefined) {
      return;
    }
    setAssignees([]);
    setAssigneesLoading(true);
    const loadAssignees = async (): Promise<void> => {
      try {
        setAssignees(await fetchAssignees(selectedProjectKey));
      } catch (error: unknown) {
        // Leave the picker empty so the rest of the form still works, but never
        // hide the failure — surface it in the console.
        console.error("Failed to load assignable users", error);
        setAssignees([]);
      } finally {
        setAssigneesLoading(false);
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

  // A field's current value is usable only if the control could have produced
  // it: a real assignable user, a real select option, a valid date, or any
  // non-empty text. A stale/invalid value (e.g. an old free-text entry now that
  // the field is a dropdown) counts as empty, so a required field holding one is
  // still treated as missing and never submitted.
  const fieldValueIsUsable = (field: (typeof project.fields)[number]): boolean => {
    const value = (draft.fieldValues[field.fieldId] ?? "").trim();
    if (value.length === 0) {
      return false;
    }
    if (isUserField(field)) {
      return assignees.some((user) => user.accountId === value);
    }
    if (field.allowedValues !== undefined && field.allowedValues.length > 0) {
      return field.allowedValues.some((allowed) => (allowed.id ?? allowed.value ?? "") === value);
    }
    if (field.type === "date" || field.type === "datetime") {
      return /^\d{4}-\d{2}-\d{2}$/u.test(value);
    }
    return true;
  };

  const trimmedTitle = draft.title.trim();
  const trimmedDescription = draft.description.trim();
  const isTitleTooLong = draft.title.length > TITLE_MAX_LENGTH;
  const isDescriptionTooLong = draft.description.length > DESCRIPTION_MAX_LENGTH;
  const hasMissingRequired = project.fields.some(
    (field) => field.required && !fieldValueIsUsable(field),
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
      // Same usability rule as canSubmit, so we never submit a field that looks
      // empty on screen (a stale/invalid value the control can't display).
      if (fieldValueIsUsable(field)) {
        const value = (draft.fieldValues[field.fieldId] ?? "").trim();
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
        const fieldInputId = `field-${field.fieldId}`;
        const currentValue = draft.fieldValues[field.fieldId] ?? "";
        let control: ReactNode;
        if (isUserField(field)) {
          // A Jira user field (assignee or a custom user picker): choose from the
          // project's assignable users so we only ever send a valid account.
          control = (
            <FuzzySelect
              inputId={fieldInputId}
              isClearable
              isLoading={assigneesLoading}
              onChange={(value) => setFieldValue({ fieldId: field.fieldId, value: value ?? "" })}
              options={assignees.map((user) => ({
                label: user.displayName,
                value: user.accountId,
              }))}
              placeholder={assigneesLoading ? "Loading users…" : "Search users…"}
              value={currentValue}
            />
          );
        } else if (field.allowedValues !== undefined && field.allowedValues.length > 0) {
          control = (
            <FuzzySelect
              inputId={fieldInputId}
              isClearable
              onChange={(value) => setFieldValue({ fieldId: field.fieldId, value: value ?? "" })}
              options={field.allowedValues.map((allowed) => ({
                label: allowed.name ?? allowed.value ?? allowed.id ?? "",
                value: allowed.id ?? allowed.value ?? "",
              }))}
              value={currentValue}
            />
          );
        } else {
          let inputType = "text";
          if (field.type === "date") {
            inputType = "date";
          } else if (field.type === "number") {
            inputType = "number";
          }
          control = (
            <input
              className="field__input"
              id={fieldInputId}
              onChange={(event) =>
                setFieldValue({ fieldId: field.fieldId, value: event.target.value })
              }
              placeholder={field.type === "array" ? "comma, separated, values" : ""}
              type={inputType}
              value={currentValue}
            />
          );
        }

        return (
          <div className="field" key={field.fieldId}>
            <label className="field__label" htmlFor={fieldInputId}>
              {field.name}
              {field.required ? (
                <em className="field__required"> *</em>
              ) : (
                <span className="field__optional"> (optional)</span>
              )}
            </label>
            {control}
          </div>
        );
      })}

      {createError !== undefined && (
        <div className="banner banner--error">
          {renderErrorMessage({
            fieldNames: [...project.fields.map((field) => field.name), "Title", "Description"],
            message: createError,
          })}
        </div>
      )}

      <button className="button button--primary" disabled={!canSubmit} type="submit">
        {creating ? "Creating…" : "Create ticket"}
      </button>
    </form>
  );
};
