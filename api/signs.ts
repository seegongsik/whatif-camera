import { handleSigns } from "../server/routes.js";

export function POST(request: Request): Promise<Response> {
  return handleSigns(request);
}
