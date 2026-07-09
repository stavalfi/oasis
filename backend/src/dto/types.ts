/**
 * types.ts
 *
 * Types inferred from the API schemas, used by the services and API layers. The
 * schemas in schemas.ts are the single source of truth on the backend; the
 * frontend keeps its own equivalent plain types.
 */
import type { z } from "zod";
import type {
  apiKeyMetadataSchema,
  createApiKeyRequestSchema,
  createApiKeyResponseSchema,
  createFindingRequestSchema,
  createFindingResponseSchema,
  errorResponseSchema,
  fieldMetaSchema,
  meResponseSchema,
  projectSchema,
  ticketSchema,
} from "./schemas.ts";

export type MeResponse = z.infer<typeof meResponseSchema>;
export type FieldMeta = z.infer<typeof fieldMetaSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Ticket = z.infer<typeof ticketSchema>;
export type CreateFindingRequest = z.infer<typeof createFindingRequestSchema>;
export type CreateFindingResponse = z.infer<typeof createFindingResponseSchema>;
export type ApiKeyMetadata = z.infer<typeof apiKeyMetadataSchema>;
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
