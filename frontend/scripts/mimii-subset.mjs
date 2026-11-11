// Fetches selected clips of the public MIMII DG dataset (Zenodo record 6529888,
// v1.0, CC BY 4.0) without downloading whole archives: HTTP range requests read
// the zip's central directory, then only the chosen members. Each member is
// checked against the CRC-32 and size recorded in the archive.
//
// If the full dataset is already prepared locally (data/raw/mimii_dg, see
// CLAUDE.md), clips are copied from there instead.

import { access, copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

export const ZENODO_RECORD = "https://zenodo.org/records/6529888";
const archiveUrl = (machineType) => `${ZENODO_RECORD}/files/${machineType}.zip?download=1`;

// Zenodo answers 403 to Node's default "node" user agent, so name the client.
const USER_AGENT = "sonovate-test-data-seeder/1.0";

async function range(url, start, end) {
  const res = await fetch(url, {
    headers: { range: end === undefined ? `bytes=${start}` : `bytes=${start}-${end}`, "user-agent": USER_AGENT },
  });
  if (res.status !== 206) throw new Error(`Zenodo did not return a byte range (HTTP ${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Central directory of a (non-zip64) archive: name -> { offset, method, crc, compressedSize, size }.
async function centralDirectory(url) {
  const eocd = await range(url, -22);
  if (eocd.readUInt32LE(0) !== 0x06054b50) throw new Error(`Unexpected end of archive for ${url} (zip comment or zip64?)`);
  const cdSize = eocd.readUInt32LE(12);
  const cdOffset = eocd.readUInt32LE(16);
  const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
  const entries = new Map();
  for (let pos = 0; pos + 46 <= cd.length && cd.readUInt32LE(pos) === 0x02014b50; ) {
    const nameLength = cd.readUInt16LE(pos + 28);
    const extraLength = cd.readUInt16LE(pos + 30);
    const commentLength = cd.readUInt16LE(pos + 32);
    const name = cd.toString("utf8", pos + 46, pos + 46 + nameLength);
    entries.set(name, {
      method: cd.readUInt16LE(pos + 10),
      crc: cd.readUInt32LE(pos + 16),
      compressedSize: cd.readUInt32LE(pos + 20),
      size: cd.readUInt32LE(pos + 24),
      offset: cd.readUInt32LE(pos + 42),
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function member(url, name, entry) {
  const header = await range(url, entry.offset, entry.offset + 29);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`Bad local header for ${name}`);
  const dataStart = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const raw = await range(url, dataStart, dataStart + entry.compressedSize - 1);
  const bytes = entry.method === 8 ? zlib.inflateRawSync(raw) : entry.method === 0 ? raw : null;
  if (!bytes) throw new Error(`Unsupported compression method ${entry.method} for ${name}`);
  if (bytes.length !== entry.size || zlib.crc32(bytes) !== entry.crc) {
    throw new Error(`Integrity check failed for ${name} (size or CRC-32 differs from the archive)`);
  }
  return bytes;
}

const exists = (p) => access(p).then(() => true, () => false);

// Names of the `test` clips for one machine type: from the local full dataset if
// present, else from the archive's central directory. Both give the same list.
export async function testClipNames(machineType, fullDataDir) {
  const localDir = path.join(fullDataDir, machineType, "test");
  if (await exists(localDir)) {
    return { source: "local", names: (await readdir(localDir)).filter((f) => f.endsWith(".wav")).sort() };
  }
  const entries = await centralDirectory(archiveUrl(machineType));
  const prefix = `${machineType}/test/`;
  const names = [...entries.keys()]
    .filter((n) => n.startsWith(prefix) && n.endsWith(".wav"))
    .map((n) => n.slice(prefix.length))
    .sort();
  return { source: "zenodo", names, entries };
}

// Ensures every requested clip is in cacheDir/<type>/test and returns their paths.
export async function ensureClips(machineType, names, { fullDataDir, cacheDir, listing }) {
  const dir = path.join(cacheDir, machineType, "test");
  await mkdir(dir, { recursive: true });
  const missing = [];
  for (const name of names) if (!(await exists(path.join(dir, name)))) missing.push(name);
  let downloaded = 0;
  let copied = 0;
  const url = archiveUrl(machineType);
  let entries = listing.entries;
  const queue = [...missing];
  const worker = async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      const target = path.join(dir, name);
      const local = path.join(fullDataDir, machineType, "test", name);
      if (await exists(local)) {
        await copyFile(local, target);
        copied++;
        continue;
      }
      entries ??= await centralDirectory(url);
      const entry = entries.get(`${machineType}/test/${name}`);
      if (!entry) throw new Error(`${machineType}/test/${name} is not in ${url}`);
      await writeFile(target, await member(url, name, entry));
      downloaded++;
    }
  };
  if (missing.length > 0) {
    // Read the archive directory once, before the parallel workers need it.
    if (listing.source === "zenodo") entries ??= await centralDirectory(url);
    await Promise.all([worker(), worker(), worker(), worker()]);
  }
  return {
    paths: names.map((n) => path.join(dir, n)),
    downloaded,
    copied,
    cached: names.length - downloaded - copied,
  };
}
