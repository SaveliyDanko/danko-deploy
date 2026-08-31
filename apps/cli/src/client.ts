export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = payload.error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

export class DankoDeployClient {
  constructor(
    private readonly panelUrl: string,
    private readonly token: string | undefined,
  ) {}

  async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await fetch(`${this.panelUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new Error(
        `Не удалось подключиться к DankoDeploy: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      throw new ApiError(
        errorMessage(payload, `HTTP ${response.status}`),
        response.status,
        payload,
      );
    }
    return payload as T;
  }
}
