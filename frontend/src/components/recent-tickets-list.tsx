/**
 * recent-tickets-list.tsx
 *
 * The recent app-created tickets for the selected project. Each opens the Jira
 * issue in a new tab and shows its current title (fetched live by the backend)
 * and a relative time.
 */
import { type ReactNode } from "react";
import { useAppSelector } from "../store/hooks.ts";
import { formatRelativeTime } from "../util/dates.ts";

export const RecentTicketsList = (): ReactNode => {
  const selectedProjectKey = useAppSelector((state) => state.projects.selectedProjectKey);
  const recentByProjectKey = useAppSelector((state) => state.tickets.recentByProjectKey);

  if (selectedProjectKey === undefined) {
    return <p className="muted">Select a project to see its recent findings.</p>;
  }

  const tickets = recentByProjectKey[selectedProjectKey] ?? [];
  if (tickets.length === 0) {
    return <p className="muted">No findings reported for this project yet.</p>;
  }

  return (
    <ul className="tickets">
      {tickets.map((ticket) => (
        <li className="tickets__item" key={ticket.key}>
          <a className="tickets__link" href={ticket.url} rel="noopener" target="_blank">
            <span className="tickets__key">{ticket.key}</span>
            <span className="tickets__title">{ticket.title}</span>
          </a>
          <time className="tickets__time" dateTime={ticket.createdAt}>
            {formatRelativeTime(ticket.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
};
