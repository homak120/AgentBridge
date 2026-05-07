import type { Response } from "express";

export type AnthropicErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "not_found_error"
  | "rate_limit_error"
  | "api_error"
  | "overloaded_error";

export interface AnthropicErrorEnvelope {
  type: "error";
  error: {
    type: AnthropicErrorType;
    message: string;
  };
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorType: AnthropicErrorType,
    message: string,
  ) {
    super(message);
  }
}

export function envelope(type: AnthropicErrorType, message: string): AnthropicErrorEnvelope {
  return { type: "error", error: { type, message } };
}

export function sendError(
  res: Response,
  status: number,
  type: AnthropicErrorType,
  message: string,
): void {
  res.status(status).json(envelope(type, message));
}

// Map any thrown value to a status + envelope type. HttpError is honoured;
// anything else collapses to api_error 500.
export function classifyError(err: unknown): { status: number; type: AnthropicErrorType; message: string } {
  if (err instanceof HttpError) {
    return { status: err.status, type: err.errorType, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, type: "api_error", message };
}
