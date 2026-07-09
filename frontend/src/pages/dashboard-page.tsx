/**
 * dashboard-page.tsx
 *
 * The main authenticated view: pick a project, create a finding, and see the
 * recent app-created tickets for that project. Loads the project list on mount.
 */
import { useEffect } from "react";
import type { ReactNode } from "react";
import { CreateFindingForm } from "../components/create-finding-form.tsx";
import { Header } from "../components/header.tsx";
import { ProjectPicker } from "../components/project-picker.tsx";
import { RecentTicketsList } from "../components/recent-tickets-list.tsx";
import { useAppDispatch } from "../store/hooks.ts";
import { loadProjects } from "../store/projects-slice.ts";

export const DashboardPage = (): ReactNode => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    void dispatch(loadProjects());
  }, [dispatch]);

  return (
    <div className="page">
      <Header />
      <main className="dashboard">
        <section className="card dashboard__picker">
          <ProjectPicker />
          <p className="dashboard__picker-hint">
            The selected project drives both the finding form and the recent tickets below.
          </p>
        </section>
        <section className="card">
          <h2 className="card__title">Report a finding</h2>
          <CreateFindingForm />
        </section>
        <section className="card">
          <h2 className="card__title">Recent tickets</h2>
          <RecentTicketsList />
        </section>
      </main>
    </div>
  );
};
