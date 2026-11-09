export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
      signal: options?.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "Cannot reach the server. Check that the backend is running and try again.",
    );
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body: {
        error?: string;
        issues?: { path: string; message: string }[];
      } = await response.json();
      message =
        body.issues
          ?.map((issue) => `${issue.path}: ${issue.message}`)
          .join("; ") ||
        body.error ||
        message;
    } catch {
      /* Keep the safe fallback for a non-JSON proxy error. */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
