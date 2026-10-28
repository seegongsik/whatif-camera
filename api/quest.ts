import { handleQuest } from "../server/routes.js";

export function POST(request: Request): Promise<Response> {
  return handleQuest(request);
}
