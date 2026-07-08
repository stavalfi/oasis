/**
 * invalid-finding-error.ts
 *
 * Thrown when a create-finding request fails business validation (missing
 * required field, length limit exceeded). The API layer maps this to 400 with
 * the field-specific message.
 */
export class InvalidFindingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidFindingError";
  }
}
