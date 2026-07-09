/**
 * app.ts
 *
 * Assembles the Hono application as a single chained expression so the route
 * types flow into `AppType`, which the frontend imports for its typed Hono RPC
 * client (a route change there becomes a compile error). Middleware, error
 * handling, and business logic live in their own classes; this module only
 * wires routes to services. Both thrown errors and request-validation failures
 * map through the same error responder.
 */
import { serveStatic } from "@hono/node-server/serve-static";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  apiKeysResponseSchema,
  assigneesResponseSchema,
  createApiKeyRequestSchema,
  createApiKeyResponseSchema,
  createFindingRequestSchema,
  createFindingResponseSchema,
  meResponseSchema,
  projectsResponseSchema,
  recentTicketsResponseSchema,
} from "../dto/schemas.ts";
import { config } from "../lib/config.ts";
import {
  ApiKeysService,
  AuthService,
  MeService,
  ProjectsService,
  TicketsService,
} from "../services/index.ts";
import type { AppEnv } from "./app-env.ts";
import { ErrorHandler } from "./error-handler.ts";
import { Middleware } from "./middleware.ts";

const sessionOnly = [Middleware.requireSession];

/**
 * The wired application. Built as one chain so `typeof app` captures every
 * route for the frontend RPC client.
 */
const openApiApp = new OpenAPIHono<AppEnv>({
  // On request-validation failure, return the same error shape as thrown
  // errors; on success, return undefined to proceed to the handler.
  defaultHook: (result, context): Response | undefined =>
    result.success ? undefined : ErrorHandler.respond({ context, error: result.error }),
});

// Middleware and error handling are applied as statements: the fluent .use()/
// .onError() return a plain Hono type that would break the .openapi() chain
// below (which is what carries the route types into AppType).
openApiApp.use("*", Middleware.requestContext);
openApiApp.onError((caughtError, context) => ErrorHandler.respond({ context, error: caughtError }));

export const app = openApiApp
  // --- Internal browser API (session-authenticated) ---
  .openapi(
    createRoute({
      method: "get",
      middleware: sessionOnly,
      path: "/api/me",
      responses: {
        200: {
          content: { "application/json": { schema: meResponseSchema } },
          description: "Current user and connected Jira site.",
        },
      },
    }),
    async (context) => context.json(await MeService.getMe(context.get("userId")), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      middleware: sessionOnly,
      path: "/api/projects",
      responses: {
        200: {
          content: { "application/json": { schema: projectsResponseSchema } },
          description: "Creatable projects with their fields.",
        },
      },
    }),
    async (context) => context.json(await ProjectsService.getProjects(context.get("userId")), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      middleware: sessionOnly,
      path: "/api/projects/{projectKey}/assignees",
      request: { params: z.object({ projectKey: z.string() }) },
      responses: {
        200: {
          content: { "application/json": { schema: assigneesResponseSchema } },
          description: "Users who can be assigned issues in the project.",
        },
      },
    }),
    async (context) =>
      context.json(
        await ProjectsService.getAssignees({
          projectKey: context.req.valid("param").projectKey,
          userId: context.get("userId"),
        }),
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "post",
      middleware: sessionOnly,
      path: "/api/tickets",
      request: {
        body: { content: { "application/json": { schema: createFindingRequestSchema } } },
      },
      responses: {
        201: {
          content: { "application/json": { schema: createFindingResponseSchema } },
          description: "Ticket created.",
        },
      },
    }),
    async (context) =>
      context.json(
        await TicketsService.createFinding({
          input: context.req.valid("json"),
          userId: context.get("userId"),
        }),
        201,
      ),
  )
  .openapi(
    createRoute({
      method: "get",
      middleware: sessionOnly,
      path: "/api/tickets",
      request: { query: z.object({ projectKey: z.string() }) },
      responses: {
        200: {
          content: { "application/json": { schema: recentTicketsResponseSchema } },
          description: "Recent tickets for the project.",
        },
      },
    }),
    async (context) =>
      context.json(
        await TicketsService.getRecentTickets({
          projectKey: context.req.valid("query").projectKey,
          userId: context.get("userId"),
        }),
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "get",
      middleware: sessionOnly,
      path: "/api/api-keys",
      responses: {
        200: {
          content: { "application/json": { schema: apiKeysResponseSchema } },
          description: "API key metadata.",
        },
      },
    }),
    async (context) => context.json(await ApiKeysService.list(context.get("userId")), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      middleware: sessionOnly,
      path: "/api/api-keys",
      request: { body: { content: { "application/json": { schema: createApiKeyRequestSchema } } } },
      responses: {
        201: {
          content: { "application/json": { schema: createApiKeyResponseSchema } },
          description: "Created key (shown once).",
        },
      },
    }),
    async (context) =>
      context.json(
        await ApiKeysService.create({
          expiresInDays: context.req.valid("json").expiresInDays,
          name: context.req.valid("json").name,
          userId: context.get("userId"),
        }),
        201,
      ),
  )
  .openapi(
    createRoute({
      method: "delete",
      middleware: sessionOnly,
      path: "/api/api-keys/{id}",
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
          description: "Revoked.",
        },
        404: {
          content: { "application/json": { schema: z.object({ message: z.string() }) } },
          description: "Not found.",
        },
      },
    }),
    async (context) =>
      (await ApiKeysService.revoke({
        id: context.req.valid("param").id,
        userId: context.get("userId"),
      }))
        ? context.json({ ok: true }, 200)
        : context.json({ message: "API key not found." }, 404),
  )
  // --- Public machine API (API-key authenticated, versioned) ---
  .openapi(
    createRoute({
      method: "post",
      middleware: [Middleware.requireApiKey],
      path: "/api/v1/findings",
      request: {
        body: { content: { "application/json": { schema: createFindingRequestSchema } } },
      },
      responses: {
        201: {
          content: { "application/json": { schema: createFindingResponseSchema } },
          description: "Finding ticket created.",
        },
      },
    }),
    async (context) =>
      context.json(
        await TicketsService.createFinding({
          input: context.req.valid("json"),
          userId: context.get("userId"),
        }),
        201,
      ),
  )
  // --- Public OAuth login flow (browser redirects; registered last because
  // plain .get/.post do not chain the OpenAPI route types) ---
  .get("/auth/login", async (context) => context.redirect(await AuthService.buildAuthorizeUrl()))
  .get("/auth/callback", async (context): Promise<Response> => {
    const code = context.req.query("code");
    const state = context.req.query("state");
    if (code === undefined || state === undefined) {
      return context.redirect("/login?error=oauth");
    }
    try {
      const session = await AuthService.handleCallback({ code, state });
      // JS-invisible, CSRF-resistant session cookie. Not marked Secure: the app
      // is served over plain HTTP, and a Secure cookie is never stored or sent
      // over HTTP.
      setCookie(context, config.constants.sessionCookieName, session.sessionId, {
        expires: session.expiresAt,
        httpOnly: true,
        path: "/",
        sameSite: "Lax",
        secure: false,
      });
      return context.redirect("/");
    } catch (error: unknown) {
      context.get("logger").warn({ err: error }, "oauth callback failed");
      return context.redirect("/login?error=oauth");
    }
  })
  .post("/auth/logout", async (context): Promise<Response> => {
    const sessionId = getCookie(context, config.constants.sessionCookieName);
    if (sessionId !== undefined) {
      await AuthService.logout(sessionId);
    }
    deleteCookie(context, config.constants.sessionCookieName);
    return context.json({ ok: true });
  });

export type AppType = typeof app;

// Serve the Vite-built React app from the same origin as the API, so the app's
// relative URLs and the session cookie work without a proxy or CORS. Registered
// after every API/auth route (as statements, to keep them out of AppType): a
// request reaches these only when no API route matched. First try a real file
// under frontend/dist (hashed JS/CSS, index.html); on a miss, fall back to
// index.html so client-side routes like /login and /dashboard load the SPA.
app.get("*", serveStatic({ root: "./frontend/dist" }));
app.get("*", serveStatic({ path: "./frontend/dist/index.html" }));
