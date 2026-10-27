import { handleDesign } from "../server/routes.js";

export function POST(request: Request): Promise<Response> {
  return handleDesign(request);
}
