import { handleLandmarks } from "../server/routes.js";

export function POST(request: Request): Promise<Response> {
  return handleLandmarks(request);
}

/** A demo street's picks (?demo=<id>), cached by the CDN. */
export function GET(request: Request): Promise<Response> {
  return handleLandmarks(request);
}
