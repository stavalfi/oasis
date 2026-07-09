/**
 * recent-tickets-list.tsx
 *
 * The recent app-created tickets for the selected project. Each opens the Jira
 * issue in a new tab and shows its current title (fetched live by the backend)
 * and a relative time.
 */
import type { ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks.ts";
import { loadRecentTickets } from "../store/tickets-slice.ts";
import { formatRelativeTime } from "../util/dates.ts";
import { useAutoRefresh } from "../util/use-auto-refresh.ts";

// Matches the backend recent-tickets cache TTL; polling faster only hits cache.
const RECENT_TICKETS_REFRESH_MS = 10_000;

export const RecentTicketsList = (): ReactNode => {
  const dispatch = useAppDispatch();
  const selectedProjectKey = useAppSelector((state) => state.projects.selectedProjectKey);
  const recentByProjectKey = useAppSelector((state) => state.tickets.recentByProjectKey);

  // Keep the list live: re-fetch on an interval and on tab focus, so new
  // findings and updated Jira titles/status appear without a manual reload. The
  // initial load happens on project selection (ProjectPicker).
  useAutoRefresh({
    enabled: selectedProjectKey !== undefined,
    intervalMs: RECENT_TICKETS_REFRESH_MS,
    onRefresh: () => {
      if (selectedProjectKey !== undefined) {
        void dispatch(loadRecentTickets(selectedProjectKey));
      }
    },
  });

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
            {ticket.status !== undefined && (
              <span className="tickets__status">{ticket.status}</span>
            )}
          </a>
          <span className="tickets__meta">
            <span className="tickets__reporter">
              {ticket.reporter}
              {ticket.priority !== undefined && (
                <span className="tickets__priority"> · {ticket.priority}</span>
              )}
            </span>
            <time className="tickets__time" dateTime={ticket.createdAt}>
              {formatRelativeTime(ticket.createdAt)}
            </time>
          </span>
        </li>
      ))}
    </ul>
  );
};
