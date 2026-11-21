/** Base class of every error this library throws. */
export class DomovError extends Error {
  /** Creates an error with a message and an optional cause. */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Thrown when a protocol id is not in the protocol catalogue. */
export class UnknownProtocolError extends DomovError {
  /** The id that was asked for. */
  readonly protocolId: string;
  /** Creates the error for the unknown `protocolId`. */
  constructor(protocolId: string) {
    super(`Unknown protocol id: ${JSON.stringify(protocolId)}`);
    this.protocolId = protocolId;
  }
}

/** Thrown when a bundled protocol file does not have the expected shape. */
export class ProtocolFormatError extends DomovError {}

/** Thrown when a moment given to the library is not a valid date. */
export class InvalidMomentError extends DomovError {}

/** Thrown when a requested record does not exist (HTTP 404 `not_found`). */
export class NotFoundError extends DomovError {}

/** Thrown when an action conflicts with the stored state (HTTP 409 `conflict`). */
export class ConflictError extends DomovError {}

/** One invalid field of an input. */
export interface FieldError {
  field: string;
  message: string;
}

/** Thrown when input is invalid (HTTP 422 `validation_error`). */
export class ValidationError extends DomovError {
  /** The invalid fields. */
  readonly details: FieldError[];
  /** Creates the error with its per-field details. */
  constructor(message: string, details: FieldError[] = []) {
    super(message);
    this.details = details;
  }
}

/** Thrown when a credential is missing or bad (HTTP 401 `unauthenticated`). */
export class UnauthenticatedError extends DomovError {}

/** Thrown when an action is forbidden (HTTP 403 `forbidden`). */
export class ForbiddenError extends DomovError {}

/** Thrown when an HTTP method is not allowed on a resource (HTTP 405 `method_not_allowed`). */
export class MethodNotAllowedError extends DomovError {}

/** Thrown when a setting of the service is missing or invalid. */
export class ConfigError extends DomovError {}

/** Thrown when the database fails. */
export class StorageError extends DomovError {}

/** No protocol of the catalogue matches a report's procedure. */
export class NoMatchingProtocolError extends DomovError {}

/** Thrown when a call to the language model fails. */
export class LlmError extends DomovError {}
