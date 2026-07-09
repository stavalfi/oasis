/**
 * index.ts
 *
 * Barrel for the service-layer domain errors, so a service can import several
 * from one path (keeping per-file dependency counts in check).
 */
export { InvalidFindingError } from "./invalid-finding-error.ts";
export { NotConnectedError } from "./not-connected-error.ts";
export { ProjectNotFoundError } from "./project-not-found-error.ts";
