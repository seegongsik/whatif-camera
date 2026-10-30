import { defineConfig } from "vitest/config";
import { dispatchApi } from "./server/dispatch.js";

function readBody(req: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default defineConfig({
  plugins: [
    {
      // The same handlers as the Vercel functions, mounted on the dev server.
      name: "dev-api",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url || !req.url.startsWith("/api/")) {
            next();
            return;
          }
          void (async () => {
            try {
              const headers = new Headers();
              for (const [key, value] of Object.entries(req.headers)) {
                if (typeof value === "string") headers.set(key, value);
                else if (Array.isArray(value)) headers.set(key, value.join(", "));
              }
              const method = req.method ?? "GET";
              const body = method === "GET" || method === "HEAD" ? undefined : new Uint8Array(await readBody(req));
              const response = await dispatchApi(
                new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, { method, headers, body }),
              );
              res.statusCode = response.status;
              response.headers.forEach((value, key) => res.setHeader(key, value));
              res.end(Buffer.from(await response.arrayBuffer()));
            } catch (error) {
              next(error);
            }
          })();
        });
      },
    },
  ],
  server: { host: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
