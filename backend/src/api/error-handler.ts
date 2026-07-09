/**
 * error-handler.ts
 *
 * Central mapping from thrown errors to HTTP responses, so every failure has a
 * consistent JSON shape ({ message }) and the right status. This is where the
 * backend half of the error taxonomy lives: user-input errors are 400/404,
 * auth/reconnect are 401, Jira upstream is 502, and anything unexpected is 500.
 */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import type { ErrorResponse } from "../dto/types.ts";
import type { AppEnv } from "./app-env.ts";
import {
  InvalidFindingError,
  JiraApiError,
  NotConnectedError,
  ProjectNotFoundError,
  RefreshTokenExpiredError,
} from "./domain-errors.ts";

interface MappedError {
  status: ContentfulStatusCode;
  message: string;
}

export class ErrorHandler {
  /** Decide the status and user-facing message for a thrown error. */
  static #mapError(error: unknown): MappedError {
    if (error instanceof ZodError) {
      const [issue] = error.issues;
      const field = issue?.path.join(".") ?? "input";
      return { message: `Invalid ${field}: ${issue?.message ?? "invalid value"}`, status: 400 };
    }
    if (error instanceof InvalidFindingError) {
      return { message: error.message, status: 400 };
    }
    if (error instanceof ProjectNotFoundError) {
      return { message: error.message, status: 404 };
    }
    if (error instanceof NotConnectedError || error instanceof RefreshTokenExpiredError) {
      return { message: "Your Jira connection needs to be re-established.", status: 401 };
    }
    if (error instanceof JiraApiError) {
      // A 4xx from Jira means it received the request but rejected our data
      // (e.g. an invalid field value). Surface Jira's own reason as a 400 so the
      // user can fix it. Only genuine upstream failures stay a 502.
      if (error.status >= 400 && error.status < 500) {
        return {
          message: error.detail ?? "Jira rejected the request. Please check the field values.",
          status: 400,
        };
      }
      return { message: "We couldn't reach Jira. Please try again.", status: 502 };
    }
    if (error instanceof HTTPException) {
      return { message: error.message, status: error.status };
    }
    return { message: "Something went wrong on our side. Please try again.", status: 500 };
  }

  /**
   * Convert a thrown error into a JSON response, logging 5xx at error level and
   * others at warn. Used by the app's onError and validation hook.
   */
  public static respond({
    error,
    context,
  }: {
    error: unknown;
    context: Context<AppEnv>;
  }): Response {
    const { status, message } = ErrorHandler.#mapError(error);
    const requestLogger = context.get("logger");
    if (requestLogger !== undefined) {
      if (status >= 500) {
        requestLogger.error({ err: error, status }, "request failed");
      } else {
        requestLogger.warn({ err: error, status }, "request failed");
      }
    }
    const body: ErrorResponse = { message };
    return context.json(body, status);
  }
}
