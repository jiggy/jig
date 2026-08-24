#!/usr/bin/env bun

// DESIGN PROBE ONLY: a trusted application frontend, not a FLOW package.
import {
  openProject,
  type JsonValue,
  type ProjectClient,
} from "@jigging/jig";

const projectRoot = new URL("../", import.meta.url);
const publicRoot = new URL("./public/", import.meta.url);

// `openProject` is a candidate local embedding surface. The caller does not
// self-author an authority object: host policy decides whether this same-user
// process may open the project at all.
const jig = await openProject({ root: projectRoot });

const json = (value: unknown, status = 200): Response =>
  Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const value: unknown = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request body must be an object");
  }
  return value as Record<string, unknown>;
};

const requiredString = (
  value: unknown,
  name: string,
  maximum: number,
): string => {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${name} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
};

const start = async (
  jigClient: ProjectClient,
  bindingId: "ingest" | "search",
  input: JsonValue,
  submissionId: string,
): Promise<Response> =>
  json(await jigClient.runs.start({ bindingId, input, submissionId }), 202);

const staticFile = async (
  path: "index.html" | "app.js" | "styles.css",
  contentType: string,
): Promise<Response> => new Response(
  await Bun.file(new URL(path, publicRoot)).text(),
  { headers: { "content-type": contentType, "cache-control": "no-store" } },
);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4010,
  async fetch(request): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/") {
        return await staticFile("index.html", "text/html; charset=utf-8");
      }
      if (request.method === "GET" && url.pathname === "/app.js") {
        return await staticFile("app.js", "text/javascript; charset=utf-8");
      }
      if (request.method === "GET" && url.pathname === "/styles.css") {
        return await staticFile("styles.css", "text/css; charset=utf-8");
      }

      if (request.method === "POST" && url.pathname === "/api/documents") {
        const value = await body(request);
        const submissionId = requiredString(value.submissionId, "submissionId", 128);
        const input = {
          documentId: requiredString(value.documentId, "documentId", 128),
          revision: Number(value.revision),
          text: requiredString(value.text, "text", 262_144),
        };
        return await start(jig, "ingest", input, submissionId);
      }

      if (request.method === "POST" && url.pathname === "/api/search") {
        const value = await body(request);
        const submissionId = requiredString(value.submissionId, "submissionId", 128);
        const input = {
          query: requiredString(value.query, "query", 4_096),
          limit: 20,
        };
        return await start(jig, "search", input, submissionId);
      }

      const runMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
      if (runMatch && request.method === "GET") {
        return json(await jig.runs.get(decodeURIComponent(runMatch[1])));
      }
      if (runMatch && request.method === "DELETE") {
        const value = await body(request);
        return json(await jig.runs.cancel({
          runId: decodeURIComponent(runMatch[1]),
          cancellationId: requiredString(value.cancellationId, "cancellationId", 128),
        }), 202);
      }

      return json({ error: "not-found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      return json({ error: "invalid-request", message }, 400);
    }
  },
});

console.error(`Document Desk listening on http://127.0.0.1:${server.port}`);

const stop = async (): Promise<void> => {
  server.stop(true);
  await jig.close();
};

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
