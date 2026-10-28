import { handleStreet } from "../server/routes.js";

export function GET(request: Request): Promise<Response> {
  return handleStreet(request);
}
