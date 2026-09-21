// Answers and refusals, in the shape every Papol client already reads.
//
// A refusal is `{detail}` with a status, as FastAPI answered and as the
// three apps and the desktop parse. Throwing one from anywhere in a route
// ends the request with it; anything else thrown is a 500 with its message.

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly detail: unknown) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.name = "HttpError";
  }
}

export function refuse(status: number, detail: unknown): never {
  throw new HttpError(status, detail);
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return refuse(422, "The request body is not JSON");
  }
}

export type Handler = (context: RouteContext) => Promise<Response> | Response;

export interface RouteContext {
  request: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
}

interface Route {
  method: string;
  pattern: URLPattern;
  handler: Handler;
}

// Method and path to handler. Paths use URLPattern syntax: `/api/jobs/:uuid`.
export class Router {
  private routes: Route[] = [];

  // The fallback answers a request no route claims.
  constructor(private fallback: Handler = () => json({ detail: "Not Found" }, { status: 404 })) {}

  on(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, pattern: new URLPattern({ pathname: path }), handler });
    return this;
  }

  async handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    for (const route of this.routes) {
      if (route.method !== request.method) continue;
      const match = route.pattern.exec(url);
      if (!match) continue;
      const params = Object.fromEntries(
        Object.entries(match.pathname.groups).map(([k, v]) => [k, v ?? ""]),
      );
      try {
        return await route.handler({ request, env, url, params });
      } catch (error) {
        if (error instanceof HttpError) return json({ detail: error.detail }, { status: error.status });
        console.error(`${request.method} ${url.pathname}:`, error);
        return json({ detail: String((error as Error)?.message ?? error) }, { status: 500 });
      }
    }
    try {
      return await this.fallback({ request, env, url, params: {} });
    } catch (error) {
      if (error instanceof HttpError) return json({ detail: error.detail }, { status: error.status });
      console.error(`${request.method} ${url.pathname}:`, error);
      return json({ detail: String((error as Error)?.message ?? error) }, { status: 500 });
    }
  }
}
