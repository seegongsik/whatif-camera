# Working notes for coding agents

What If Camera: point a phone at a building; one photo plus the map becomes a 3D model with its measurements, then a short video of what it could become (roof garden, green walls, evening light). Entry for the Meta Global AI Developer Hackathon. Operator: Minwoo Kwon. Read `README.md` for the product, `DECISIONS.md` for why things are the way they are, and the top of `PROGRESS.md` for where work stands.

## Rules

- Contest: all code is new work written in this repository from 2026-10-27 02:00 KST. Do not copy code from other repositories (the operator's other entry included); protocol facts such as an API's request shape may be reused. List every third-party package in the README table.
- Meta models do the AI work: Muse Spark Open (`meta-models/muse-spark-open-1026` on Baseten) and SAM 3.1 (Meta Model API). Muse Wonder is unavailable in South Korea.
- Estimates are allowed (operator's decision) but always shown as estimates: "≈" and "AI estimate" on screen and in the video; assumptions are listed as assumptions in the facts panel. Unknown facts are written as "확인 필요" in the Korean docs. Synthetic data is labeled SYNTHETIC and used only in tests and the synthetic demo.
- The design model only chooses from the menu in `src/design/plan.ts`; positions and sizes come from `src/design/layout.ts`, numbers on screen from the building spec. Never let model text carry a number.
- Map data is OpenStreetMap (ODbL): the attribution stays on screen and in every recorded video.
- Keys live only in server environment variables (`BASETEN_API_KEY`, `MODEL_API_KEY`/`META_API_KEY`). Never log, print, commit or send them to the browser.
- Do not call the Meta Model API until Minwoo confirms the hackathon credits show under Billing; calls before that are charged to his card.
- Work on a branch and open a pull request. Never push to `main`. Minwoo merges.
- UI text, README and code comments in English. `PROGRESS.md` and `DECISIONS.md` in Korean.
- No medical advice, no identifying people, no brand names in generated text. Preset photos committed to the repo must show no faces, licence plates or house numbers.

## Commands

`npm test` · `npm run lint` · `npm run build` (runs `tsc --noEmit` first) · `npm run check:api` (per-file transpile of the Vercel functions) · `npm run dev` (`?demo=synthetic`, `?preset=/presets/x.json&autoplay=1`, `&size=1080`, `?fov=`).

In the Claude Code cloud environment, start the dev server with `NODE_USE_ENV_PROXY=1` so the API routes' own `fetch` goes through the session proxy; each outside host (Overpass, OpenFreeMap, Baseten) must be on the environment's allowed domains. The deployment is https://whatif-camera.vercel.app.

## Map

- `src/geo/` local east-north metres (`enu.ts`), polygons, sun position.
- `src/camera/pose.ts` pinhole camera, W3C device orientation, iOS compass.
- `src/estimate/` which building (`identify.ts`), photo-to-map registration (`register.ts`), height (`height.ts`), tilt from the photo (`verticals.ts`), the building spec every scene is drawn from (`spec.ts`).
- `src/design/` the design menu and local plan (`plan.ts`), item placement (`layout.ts`).
- `src/scene/` three.js: photo projection (`projection.ts`), the world, dimension lines, decorations, the shot list (`timeline.ts`), the player and recorder (`player.ts`).
- `src/synthetic/` the SYNTHETIC scene with a rendered photo and known truth.
- `src/capture/`, `src/preset/`, `src/ui/` phone sensors and camera, EXIF, presets, the page.
- `server/` footprint sources (Overpass servers, then vector tiles via `src/data/mvt.ts`), Baseten client, design prompt, routes, call caps. `api/` holds one Vercel function per route.
