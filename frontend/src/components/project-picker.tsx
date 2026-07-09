/**
 * project-picker.tsx
 *
 * A fuzzy-search combobox over every project the user can create issues in (the
 * backend pages through the whole workspace, so the list is complete). Typing
 * matches project names or keys fuzzily; a spinner shows while the list loads.
 * Selecting a project loads its recent tickets.
 */
import { useEffect } from "react";
import type { ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks.ts";
import { selectProject } from "../store/projects-slice.ts";
import { loadRecentTickets } from "../store/tickets-slice.ts";
import { FuzzySelect } from "./fuzzy-select.tsx";

export const ProjectPicker = (): ReactNode => {
  const dispatch = useAppDispatch();
  const { list, selectedProjectKey, loading, error } = useAppSelector((state) => state.projects);

  useEffect(() => {
    if (selectedProjectKey !== undefined) {
      void dispatch(loadRecentTickets(selectedProjectKey));
    }
  }, [dispatch, selectedProjectKey]);

  return (
    <div className="field">
      <label className="field__label" htmlFor="project-picker">
        Project<em className="field__required"> *</em>
      </label>
      <FuzzySelect
        inputId="project-picker"
        isLoading={loading}
        onChange={(projectKey) => {
          if (projectKey !== undefined) {
            dispatch(selectProject(projectKey));
          }
        }}
        options={list.map((project) => ({
          label: `${project.name} (${project.key})`,
          value: project.key,
        }))}
        placeholder={loading ? "Loading projects…" : "Select or search a project…"}
        value={selectedProjectKey}
      />
      {error !== undefined && <p className="banner banner--error">{error}</p>}
    </div>
  );
};
