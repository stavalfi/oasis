/**
 * client.ts
 *
 * The typed Hono RPC client. `AppType` is imported from the backend, so request
 * and response types are inferred end to end with no codegen — a backend route
 * change becomes a compile error here. Every call sends the session cookie.
 * These thin wrappers return the typed body; the store's thunks call them.
 */
// Top-level `import type` (enforced by import/consistent-type-specifier-style)
// is fully erased. The inline `import { type AppType }` form would, under
// verbatimModuleSyntax, leave a side-effect `import "#backend/api/app.ts"` that
// drags the whole backend (redis, kysely, pg) into the browser bundle.
import type { AppType } from "#backend/api/app.ts";
import { hc } from "hono/client";
import type { InferRequestType, InferResponseType } from "hono/client";

const client = hc<AppType>("/", { init: { credentials: "include" } });

export type MeResponse = InferResponseType<typeof client.api.me.$get>;
export type Project = InferResponseType<typeof client.api.projects.$get>[number];
export type Ticket = InferResponseType<(typeof client.api.tickets)["$get"]>[number];
export type CreateFindingRequest = InferRequestType<(typeof client.api.tickets)["$post"]>["json"];
export type CreateFindingResponse = InferResponseType<(typeof client.api.tickets)["$post"]>;
export type ApiKeyMetadata = InferResponseType<(typeof client.api)["api-keys"]["$get"]>[number];
export type CreateApiKeyResponse = InferResponseType<(typeof client.api)["api-keys"]["$post"]>;

/** Current user and connected Jira site. */
export const fetchMe = async (): Promise<MeResponse> => {
  const response = await client.api.me.$get();
  if (!response.ok) {
    throw new Error(`GET /api/me failed with ${response.status}`);
  }
  return response.json();
};

/** End the session. */
export const postLogout = async (): Promise<void> => {
  await client.auth.logout.$post();
};

/** Creatable projects with their issue types and fields. */
export const fetchProjects = async (): Promise<Project[]> => {
  const response = await client.api.projects.$get();
  if (!response.ok) {
    throw new Error(`GET /api/projects failed with ${response.status}`);
  }
  return response.json();
};

/** Create a finding ticket. */
export const postFinding = async (body: CreateFindingRequest): Promise<CreateFindingResponse> => {
  const response = await client.api.tickets.$post({ json: body });
  if (!response.ok) {
    throw new Error(`POST /api/tickets failed with ${response.status}`);
  }
  return response.json();
};

/** Recent app-created tickets for a project. */
export const fetchRecentTickets = async (projectKey: string): Promise<Ticket[]> => {
  const response = await client.api.tickets.$get({ query: { projectKey } });
  if (!response.ok) {
    throw new Error(`GET /api/tickets failed with ${response.status}`);
  }
  return response.json();
};

/** The user's API keys (metadata only). */
export const fetchApiKeys = async (): Promise<ApiKeyMetadata[]> => {
  const response = await client.api["api-keys"].$get();
  if (!response.ok) {
    throw new Error(`GET /api/api-keys failed with ${response.status}`);
  }
  return response.json();
};

/** Create an API key (the raw key is returned once). */
export const postApiKey = async (name: string): Promise<CreateApiKeyResponse> => {
  const response = await client.api["api-keys"].$post({ json: { name } });
  if (!response.ok) {
    throw new Error(`POST /api/api-keys failed with ${response.status}`);
  }
  return response.json();
};

/** Revoke an API key by id. */
export const deleteApiKey = async (id: string): Promise<void> => {
  await client.api["api-keys"][":id"].$delete({ param: { id } });
};

/** Navigate the browser to the backend login route (starts OAuth). */
export const goToLogin = (): void => {
  globalThis.location.assign("/auth/login");
};
