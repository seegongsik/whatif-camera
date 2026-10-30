# Working notes for coding agents

What's Ahead (first named What If Camera, a building prototype removed on 2026-10-30; the repository, package and deployment keep that name). Stand on a street and take one photo along it; GPS, compass and the map find the street and the direction; then, as a moving infographic on black, a light runs 5 km down the street dotting every place at its distance and side and stopping at the landmarks Muse Spark knows by name, and each category chip sends it down the street again for that kind of place. Quests, the signs in the photo (SAM 3.1 and Muse Spark), walking the street with the live dot, and nine demo streets from the map alone. Entry for the Meta Global AI Developer Hackathon. Operator: Minwoo Kwon. Read `README.md` for the product, `DECISIONS.md` for why things are the way they are, and the top of `PROGRESS.md` for where work stands.

## Rules

- Contest: all code is new work written in this repository from 2026-10-27 02:00 KST. Do not copy code from other repositories (the operator's other entry included); protocol facts such as an API's request shape may be reused. List every third-party package in the README table.
- Meta models do the AI work: Muse Spark Open (`meta-models/muse-spark-open-1026` on Baseten) and SAM 3.1 (Meta Model API). Muse Wonder is unavailable in South Korea.
- Estimates are allowed (operator's decision) but always shown as estimates: "≈" on screen (walking times), and Muse Spark's judgements marked ✦ with their reason; assumptions are listed as assumptions in the README. Unknown facts are written as "확인 필요" in the Korean docs. Synthetic data is labeled SYNTHETIC and used only in tests and the synthetic demo.
- Muse Spark only chooses: list numbers or ids from the places it was shown and words from fixed menus (`src/street/picks.ts`, `src/street/spotted.ts`); its only free text, a quest's title and lines, is checked before the page sees it (`src/street/quest.ts`). Names, distances and sides on screen come from the map. Never let model text carry a number.
- Map data is OpenStreetMap (ODbL) and Overture Maps (CDLA-Permissive-2.0): the attribution stays on screen, on the share card and in every recorded video.
- Keys live only in server environment variables (`BASETEN_API_KEY`, `MODEL_API_KEY`/`META_API_KEY`). Never log, print, commit or send them to the browser.
- Do not call the Meta Model API until Minwoo confirms the hackathon credits show under Billing; calls before that are charged to his card.
- Work on a branch and open a pull request. Never push to `main`. Minwoo merges.
- UI text, README and code comments in English. `PROGRESS.md` and `DECISIONS.md` in Korean.
- No medical advice, no identifying people, no brand names in generated text. Photos and screenshots committed to the repo must show no faces, licence plates or house numbers.

## Commands

`npm test` · `npm run lint` · `npm run build` (runs `tsc --noEmit` first) · `npm run check:api` (per-file transpile of the Vercel functions) · `npm run check:demo` (opens the nine demo streets on the deployment: checks them and fills the CDN; run after each deployment) · `npm run dev` (`?demo=street` (the SYNTHETIC street), `?street=lat,lon,heading[,name]`, `?street=fifth-avenue` (a demo street's id), `?sam=0`).

In the Claude Code cloud environment, start the dev server with `NODE_USE_ENV_PROXY=1` so the API routes' own `fetch` goes through the session proxy; each outside host (Overpass, OpenFreeMap, Baseten) must be on the environment's allowed domains. The deployment is https://whatif-camera.vercel.app.

## Map

- `src/geo/enu.ts` local east-north metres, bearings, compass words. `src/data/mvt.ts` the vector tile reader.
- `src/camera/pose.ts` W3C device orientation and the iOS compass, as the camera's heading, pitch and roll.
- `src/capture/`, `src/ui/` phone sensors and camera, EXIF, help when the browser holds something back (`help.ts`), the photo for the models, the page (`app.ts`).
- `src/street/` What's Ahead: OSM streets and shops (`osm.ts`, `overpass.ts`, `tiles.ts`), matching the street and following it 5 km (`route.ts`), shops along it (`ahead.ts`, `street.ts`), the show on black and its page (`show.ts`), its plan without the page (`show-plan.ts`: chips, landmarks by the map's ranking, the light's pace, the camera, the signs' flight), Muse Spark's picks of the places to name (`picks.ts`), walking the street and the SIMULATED walk (`walk.ts`), the last street kept on the phone (`saved.ts`), drawing it shares with the share card (`show-draw.ts`), name tags laid out on the screen (`street-labels.ts`), category colours and distances (`signs.ts`), quests (`quest.ts`, `quest-ui.ts`), the photo sign check (`spotted.ts`), the share card (`share-card.ts`), Overture places (`overture.ts`: categories and rows), the demo streets (`famous.ts`), data errors put right (`errata.ts`), SAM's sign boxes numbered and cut out (`sign-boxes.ts`), the field log (`field-log.ts`), the SYNTHETIC street (`synthetic.ts`).
- `server/` the outside services and their credits (`upstream.ts`), street lookup (`street-sources.ts`: vector tiles, then Overpass), Overture row groups from the bucket (`overture.ts`, index in `data/overture-places.ts` made by `scripts/overture-index.mjs`), landmark, quest and sign check prompts (`street-spark.ts`), SAM 3.1 (`sam.ts`), Baseten client, routes, call caps. `api/` holds one Vercel function per route.
