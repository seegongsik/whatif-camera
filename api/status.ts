import { handleStatus } from "../server/routes.js";

export function GET(request: Request): Promise<Response> {
  return handleStatus(request);
}
