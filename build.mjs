import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = dirname(fileURLToPath(import.meta.url));
const distDir = join(root, "dist");
const docs = ["README.md", "NOTICE.md", "License"];
const iconSizes = [16, 32, 48, 128];

const variants = [
  {
    sourceManifest: "manifest.json",
    outputDirectory: "extension",
    archiveSuffix: ""
  },
  {
    sourceManifest: "manifest.with-youtube.json",
    outputDirectory: "extension-with-youtube",
    archiveSuffix: "-with-youtube"
  }
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp() {
  const year = 2026 - 1980;
  const month = 7;
  const day = 30;
  const hour = 12;
  const minute = 0;
  const second = 0;
  return {
    time: (hour << 11) | (minute << 5) | Math.floor(second / 2),
    date: (year << 9) | (month << 5) | day
  };
}

function listFiles(directory) {
  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current).sort()) {
      const absolute = join(current, entry);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else files.push(absolute);
    }
  }
  walk(directory);
  return files;
}

function createZip(directory, destination) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const timestamp = dosTimestamp();
  const files = listFiles(directory);

  for (const absolute of files) {
    const name = relative(directory, absolute).split(sep).join("/");
    const nameBuffer = Buffer.from(name, "utf8");
    const raw = readFileSync(absolute);
    const compressed = deflateRawSync(raw, { level: 9 });
    const checksum = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  writeFileSync(destination, Buffer.concat([...localParts, centralDirectory, end]));
}

function addManifestFiles(manifest, runtimeFiles) {
  for (const contentScript of manifest.content_scripts ?? []) {
    for (const file of contentScript.js ?? []) runtimeFiles.add(file);
    for (const file of contentScript.css ?? []) runtimeFiles.add(file);
  }
  for (const file of Object.values(manifest.icons ?? {})) runtimeFiles.add(file);
  for (const file of Object.values(manifest.action?.default_icon ?? {})) runtimeFiles.add(file);
}

function copyRelative(sourceRelative, outputRelative, outDir) {
  const source = join(root, sourceRelative);
  if (!existsSync(source)) throw new Error(`Missing build input: ${sourceRelative}`);
  const destination = join(outDir, outputRelative);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const primeManifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const version = primeManifest.version;
if (!version) throw new Error("manifest.json is missing a version");

for (const variant of variants) {
  const manifest = JSON.parse(readFileSync(join(root, variant.sourceManifest), "utf8"));
  if (manifest.manifest_version !== 3) throw new Error(`${variant.sourceManifest} must use Manifest V3`);
  if (manifest.version !== version) throw new Error("All manifest variants must use the same version");

  const outDir = join(distDir, variant.outputDirectory);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const runtimeFiles = new Set();
  addManifestFiles(manifest, runtimeFiles);
  for (const file of runtimeFiles) copyRelative(file, file, outDir);
  for (const file of docs) {
    if (existsSync(join(root, file))) copyRelative(file, file, outDir);
  }

  for (const size of iconSizes) {
    const icon = join(outDir, "icons", `icon${size}.png`);
    if (!existsSync(icon)) throw new Error(`Missing ${size}px icon in ${variant.outputDirectory}`);
  }

  const archiveName = `prime-video-ad-skipper-v${version}${variant.archiveSuffix}.zip`;
  const archivePath = join(distDir, archiveName);
  createZip(outDir, archivePath);
  const hash = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  writeFileSync(join(distDir, archiveName.replace(/\.zip$/, ".sha256")), `${hash}  ${archiveName}\n`);

  console.log(`Built ${variant.outputDirectory} and ${archiveName}`);
}
