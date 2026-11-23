export class RequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    window.location.assign("/sign-in?error=expired");
    throw new RequestError("Signed out", "unauthorized");
  }
  const data = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string; details?: { path: string; message: string }[] };
  };
  if (!response.ok) {
    throw new RequestError(
      data.error?.message ?? "That didn't work. Try again.",
      data.error?.code ?? "unknown",
      data.error?.details,
    );
  }
  return data as T;
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>("POST", path, body);
}
