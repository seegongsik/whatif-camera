import { beforeEach, describe, expect, it } from "vitest";
import { resetLimitsForTests } from "../server/limits.js";
import { handleSam } from "../server/routes.js";
import { outputText, SamError, signsFromSamText, signsWithSam, SIGN_PROMPT } from "../server/sam.js";

// The sample line from Meta's SAM documentation (reading segmentation output): two objects on a 320 × 334 frame, lossless masks.
const SAMPLE =
  "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>," +
  "1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>";
const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const reply = (text: string) => ({ object: "response", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] });

beforeEach(() => resetLimitsForTests());

describe("SAM 3.1 shop signs", () => {
  it("reads SAM's token text into boxes with outlines, in the image's pixels", () => {
    const { width, height, signs } = signsFromSamText(SAMPLE);
    expect({ width, height }).toEqual({ width: 320, height: 334 });
    // SAM's x2 and y2 are the last pixels inside; the edges come back one past them.
    expect(signs.map((s) => [s.id, s.x1, s.y1, s.x2, s.y2])).toEqual([
      ["0", 211, 228, 271, 255],
      ["1", 155, 228, 203, 255],
    ]);
    for (const s of signs) {
      expect(s.path.startsWith("M")).toBe(true);
      expect(s.ox).toBe(s.x1);
      expect(s.oy).toBe(s.y1);
    }
  });

  it("takes no match as no signs, and keeps the most certain ones first", () => {
    expect(signsFromSamText("").signs).toEqual([]);
    const sure = SAMPLE.replace("w=320;h=334|>", "w=320;h=334;c=0.4|>").replace("y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,48", "y2=254;w=320;h=334;c=0.9|><|mask;x=0;y=0;c=0.9;data=27,48");
    const { signs } = signsFromSamText(sure.replace("<|mask;x=0;y=0;data=27,60", "<|mask;x=0;y=0;c=0.4;data=27,60"));
    expect(signs.map((s) => s.id)).toEqual(["1", "0"]);
    expect(signs[0].confidence).toBeCloseTo(0.9, 6);
  });

  it("asks SAM 3.1 for one concept with compact masks, and reads the reply's text", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return Response.json(reply(SAMPLE));
    }) as unknown as typeof fetch;
    const result = await signsWithSam(IMAGE, { env: { MODEL_API_KEY: "test-key" }, fetchImpl, now: () => 0 });
    expect(result.signs).toHaveLength(2);
    expect(result.model).toBe("sam-3.1");
    expect(sent!.url).toBe("https://api.meta.ai/v1/responses");
    const body = JSON.parse(String(sent!.init.body));
    expect(body.model).toBe("sam-3.1");
    expect(body.input[0].content).toEqual([
      { type: "input_text", text: SIGN_PROMPT },
      { type: "input_image", image_url: IMAGE },
    ]);
    expect(body.metadata).toEqual({ mask_encoding: "one_bit", include_confidence: "true" });
    expect(outputText({ output_text: "x" })).toBe("x");
  });

  it("fails clearly without a key or when SAM refuses, without repeating the key", async () => {
    await expect(signsWithSam(IMAGE, { env: {} })).rejects.toBeInstanceOf(SamError);
    const refuse = (async () => Response.json({ error: { message: "invalid image" } }, { status: 400 })) as unknown as typeof fetch;
    const error = (await signsWithSam(IMAGE, { env: { MODEL_API_KEY: "secret-123" }, fetchImpl: refuse }).then(
      () => null,
      (e: unknown) => e,
    )) as SamError;
    expect(error.status).toBe(502);
    expect(error.message).toContain("invalid image");
    expect(error.message).not.toContain("secret-123");
  });

  it("checks the request at the route and keeps to the daily allowance", async () => {
    const post = (body: unknown) => new Request("http://x/api/sam", { method: "POST", body: JSON.stringify(body) });
    expect((await handleSam(post({ image: IMAGE }), { env: {} })).status).toBe(503);
    expect((await handleSam(post({ image: "not a picture" }), { env: { MODEL_API_KEY: "k" } })).status).toBe(400);
    const fetchImpl = (async () => Response.json(reply(SAMPLE))) as unknown as typeof fetch;
    const env = { MODEL_API_KEY: "k", DAILY_SAM_CALL_CAP: "1" };
    const ok = await handleSam(post({ image: IMAGE }), { env, fetchImpl });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { signs: unknown[] }).signs).toHaveLength(2);
    expect((await handleSam(post({ image: IMAGE }), { env, fetchImpl })).status).toBe(429);
  });
});
