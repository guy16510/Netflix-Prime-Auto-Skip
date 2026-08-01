import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

const root = process.cwd();
const dist = join(root, "dist");
const version = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version;

function listRelativeFiles(directory) {
  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current).sort()) {
      const absolute = join(current, entry);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else files.push(relative(directory, absolute).split(sep).join("/"));
    }
  }
  walk(directory);
  return files;
}

function findEndOfCentralDirectory(zip) {
  for (let index = zip.length - 22; index >= Math.max(0, zip.length - 65557); index -= 1) {
    if (zip.readUInt32LE(index) === 0x06054b50) return index;
  }
  throw new Error("ZIP end-of-central-directory record not found");
}

function readZip(zipPath) {
  const zip = readFileSync(zipPath);
  const endOffset = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(endOffset + 10);
  let centralOffset = zip.readUInt32LE(endOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(zip.readUInt32LE(centralOffset), 0x02014b50, "invalid ZIP central header");
    const method = zip.readUInt16LE(centralOffset + 10);
    const compressedSize = zip.readUInt32LE(centralOffset + 20);
    const rawSize = zip.readUInt32LE(centralOffset + 24);
    const nameLength = zip.readUInt16LE(centralOffset + 28);
    const extraLength = zip.readUInt16LE(centralOffset + 30);
    const commentLength = zip.readUInt16LE(centralOffset + 32);
    const localOffset = zip.readUInt32LE(centralOffset + 42);
    const name = zip.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8");

    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50, "invalid ZIP local header");
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    const raw = method === 8 ? inflateRawSync(compressed) : compressed;
    assert.equal(raw.length, rawSize);
    entries.set(name, raw);

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function pngDimensions(path) {
  const png = readFileSync(path);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const variants = [
  {
    directory: "extension",
    archive: `prime-video-ad-skipper-v${version}.zip`,
    expectsYouTube: false
  },
  {
    directory: "extension-with-youtube",
    archive: `prime-video-ad-skipper-v${version}-with-youtube.zip`,
    expectsYouTube: true
  }
];

for (const variant of variants) {
  const output = join(dist, variant.directory);
  assert(existsSync(output), `missing ${variant.directory}`);
  const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.version, version);
  const matches = manifest.content_scripts.flatMap((entry) => entry.matches ?? []);
  assert.equal(matches.some((match) => match.includes("youtube.com")), variant.expectsYouTube);
  assert(existsSync(join(output, "amazon.js")));
  for (const doc of ["README.md", "NOTICE.md", "License"]) assert(existsSync(join(output, doc)));
  assert.equal(existsSync(join(output, "youtube.js")), variant.expectsYouTube);

  for (const size of [16, 32, 48, 128]) {
    const iconPath = join(output, "icons", `icon${size}.png`);
    assert(existsSync(iconPath));
    assert.deepEqual(pngDimensions(iconPath), { width: size, height: size });
  }

  const archivePath = join(dist, variant.archive);
  const checksumPath = join(dist, variant.archive.replace(/\.zip$/, ".sha256"));
  assert(existsSync(archivePath));
  assert(existsSync(checksumPath));
  const expectedHash = readFileSync(checksumPath, "utf8").trim().split(/\s+/)[0];
  const actualHash = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  assert.equal(actualHash, expectedHash, `${variant.archive} checksum mismatch`);

  const zipEntries = readZip(archivePath);
  const outputFiles = listRelativeFiles(output);
  assert.deepEqual([...zipEntries.keys()].sort(), outputFiles);
  for (const file of outputFiles) {
    assert.deepEqual(zipEntries.get(file), readFileSync(join(output, file)), `${file} differs in ZIP`);
  }
}

assert(!listRelativeFiles(join(dist, "extension")).includes("youtube.js"));
assert(listRelativeFiles(join(dist, "extension-with-youtube")).includes("youtube.js"));
console.log("All build, ZIP, checksum, icon, and variant tests passed");
