/**
 * Builds the API functions the way Vercel's Node runtime does (each .ts file
 * transpiled on its own, no bundler), then imports every function in api/
 * and calls it once without keys or network. Catches import paths that only
 * a bundler would resolve.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "node_modules", ".check-api");
rmSync(out, { recursive: true, force: true });

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

for (const dir of ["api", "server", "src"]) {
  for (const file of files(join(root, dir))) {
    if (!file.endsWith(".ts")) continue;
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    const target = join(out, relative(root, file)).replace(/\.ts$/, ".js");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, outputText);
  }
}
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

for (const key of ["BASETEN_API_KEY", "MODEL_API_KEY", "META_API_KEY"]) delete process.env[key];
const lines = [];
for (const file of readdirSync(join(out, "api")).sort()) {
  const mod = await import(pathToFileURL(join(out, "api", file)).href);
  const method = typeof mod.GET === "function" ? "GET" : "POST";
  if (typeof mod[method] !== "function") throw new Error(`${file} exports neither GET nor POST`);
  const response = await mod[method](
    new Request(`http://local/api/${file.replace(/\.js$/, "")}`, {
      method,
      ...(method === "POST" ? { body: "{}", headers: { "Content-Type": "application/json" } } : {}),
    }),
  );
  lines.push(`${file} ${method} -> ${response.status}`);
}
console.log(lines.join("\n"));
rmSync(out, { recursive: true, force: true });
