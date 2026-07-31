import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, "dist", "extension");
const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) {
  throw new Error("manifest.json must use Manifest V3");
}

const runtimeFiles = new Set(["manifest.json"]);
for (const contentScript of manifest.content_scripts ?? []) {
  for (const file of contentScript.js ?? []) runtimeFiles.add(file);
  for (const file of contentScript.css ?? []) runtimeFiles.add(file);
}

for (const file of runtimeFiles) {
  const source = join(root, file);
  if (!existsSync(source)) throw new Error(`Missing runtime file: ${file}`);
  if (file.endsWith(".js")) {
    execFileSync(process.execPath, ["--check", source], { stdio: "inherit" });
  }
}

rmSync(join(root, "dist"), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const file of runtimeFiles) {
  cpSync(join(root, file), join(outDir, file), { recursive: true });
}

for (const file of ["README.md", "NOTICE.md", "License"]) {
  const source = join(root, file);
  if (existsSync(source)) cpSync(source, join(outDir, file));
}

console.log(`Built ${runtimeFiles.size} runtime files in ${outDir}`);
