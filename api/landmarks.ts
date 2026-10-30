import { handleLandmarks } from "../server/routes.js";

export function POST(request: Request): Promise<Response> {
  return handleLandmarks(request);
}
