import { handleFootprints } from "../server/routes.js";

export function GET(request: Request): Promise<Response> {
  return handleFootprints(request);
}
