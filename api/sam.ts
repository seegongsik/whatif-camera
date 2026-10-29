import { handleSam } from "../server/routes.js";

export function POST(request: Request): Promise<Response> {
  return handleSam(request);
}
