import { handleDesign, handleFootprints, handleQuest, handleSam, handleSigns, handleStatus, handleStreet } from "./routes.js";

const ROUTES: Record<string, (request: Request) => Promise<Response>> = {
  "/api/status": (r) => handleStatus(r),
  "/api/footprints": (r) => handleFootprints(r),
  "/api/design": (r) => handleDesign(r),
  "/api/street": (r) => handleStreet(r),
  "/api/quest": (r) => handleQuest(r),
  "/api/signs": (r) => handleSigns(r),
  "/api/sam": (r) => handleSam(r),
};

export async function dispatchApi(request: Request): Promise<Response> {
  let path = new URL(request.url).pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const handler = ROUTES[path];
  if (!handler) return Response.json({ error: "not found" }, { status: 404 });
  return handler(request);
}
