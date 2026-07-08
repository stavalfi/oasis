/**
 * project-picker.tsx
 *
 * A searchable-by-typing dropdown of the projects the user can create issues in
 * (so there are no dead options). Selecting one loads its recent tickets.
 */
import { type ReactNode, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks.ts";
import { selectProject } from "../store/projects-slice.ts";
import { loadRecentTickets } from "../store/tickets-slice.ts";

export const ProjectPicker = (): ReactNode => {
  const dispatch = useAppDispatch();
  const { list, selectedProjectKey, loading, error } = useAppSelector((state) => state.projects);

  useEffect(() => {
    if (selectedProjectKey !== undefined) {
      void dispatch(loadRecentTickets(selectedProjectKey));
    }
  }, [dispatch, selectedProjectKey]);

  if (loading) {
    return <p className="muted">Loading projects…</p>;
  }
  if (error !== undefined) {
    return <p className="banner banner--error">{error}</p>;
  }
  if (list.length === 0) {
    return <p className="muted">You have no projects you can create issues in.</p>;
  }

  return (
    <label className="field">
      <span className="field__label">Project</span>
      <select
        className="field__input"
        onChange={(event) => dispatch(selectProject(event.target.value))}
        value={selectedProjectKey ?? ""}
      >
        {list.map((project) => (
          <option key={project.key} value={project.key}>
            {project.name} ({project.key})
          </option>
        ))}
      </select>
    </label>
  );
};
