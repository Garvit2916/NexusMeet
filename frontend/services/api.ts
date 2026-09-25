import type { ApiEnvelope } from "@/lib/api-types";
import type { ApiErrorShape } from "@/lib/types";

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1").replace(/\/$/, "");

export class ApiError extends Error implements ApiErrorShape {
  status?: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status?: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type ApiRequestOptions = {
  userId?: string;
};

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.userId && !headers.has("X-User-ID")) {
    headers.set("X-User-ID", options.userId);
  }

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as
      | ApiEnvelope<T>
      | { error?: { code?: string; message?: string; details?: unknown } }
      | null;
    if (!response.ok) {
      const error = body && "error" in body ? body.error : undefined;
      throw new ApiError(
        error?.message ?? "Unable to connect to the server. Please try again.",
        response.status,
        error?.code,
        error?.details,
      );
    }
    if (body && "data" in body && body.data !== undefined) {
      return body.data;
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The request timed out. Please try again.");
    }
    throw new ApiError("Unable to connect to the server. Please try again.");
  } finally {
    clearTimeout(timeout);
  }
}
