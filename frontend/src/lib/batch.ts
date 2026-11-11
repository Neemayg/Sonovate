// State helpers for the batch baseline uploader. Pure functions with no
// imports, so they can be tested with `node --test` (tests/batch.test.mjs).
//
// A batch is a list of files the user picked. Each is converted and uploaded
// on its own through the existing single-recording path; nothing here talks
// to the network. Statuses describe real steps only: there are no percentages.

export type BatchStatus = "queued" | "preparing" | "uploading" | "done" | "failed";

export type BatchItem = {
  /** Stable key for React and for updates. */
  key: string;
  file: File;
  status: BatchStatus;
  /** User-facing reason when status is "failed". */
  error?: string;
  /** Conversion note from the existing pipeline, e.g. "Converted from MP4 …". */
  note?: string | null;
  /** Id of the persisted recording once uploaded. */
  recordingId?: string;
};

/** Formats the existing pipeline understands (see lib/convert.ts). */
export const ACCEPTED_EXTENSIONS = ["wav", "mp3", "m4a", "aac", "ogg", "opus", "mp4", "mov", "webm"] as const;
export const ACCEPT_ATTRIBUTE = "audio/*,video/*," + ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");

type FileLike = Pick<File, "name" | "size" | "type" | "lastModified">;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** True when the file is something the browser-side converter can try. */
export function isAcceptedFile(file: FileLike): boolean {
  if ((ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) return true;
  return file.type.startsWith("audio/") || file.type.startsWith("video/");
}

/** Identity of a picked file: the same file picked twice is added once. */
export function fileIdentity(file: FileLike): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

let counter = 0;

/**
 * Adds picked files to the batch. Returns the new list plus the names that
 * were skipped as unsupported or already in the batch.
 */
export function addFiles(
  items: BatchItem[],
  files: File[],
): { items: BatchItem[]; unsupported: string[]; duplicates: string[] } {
  const seen = new Set(items.map((i) => fileIdentity(i.file)));
  const unsupported: string[] = [];
  const duplicates: string[] = [];
  const added: BatchItem[] = [];
  for (const file of files) {
    if (!isAcceptedFile(file)) {
      unsupported.push(file.name);
      continue;
    }
    const id = fileIdentity(file);
    if (seen.has(id)) {
      duplicates.push(file.name);
      continue;
    }
    seen.add(id);
    counter += 1;
    added.push({ key: `f${counter}-${id}`, file, status: "queued" });
  }
  return { items: [...items, ...added], unsupported, duplicates };
}

/** Removes a file that has not started uploading or has failed. */
export function removeItem(items: BatchItem[], key: string): BatchItem[] {
  return items.filter((i) => i.key !== key || !canRemove(i));
}

export function canRemove(item: BatchItem): boolean {
  return item.status === "queued" || item.status === "failed";
}

export function updateItem(items: BatchItem[], key: string, patch: Partial<BatchItem>): BatchItem[] {
  return items.map((i) => (i.key === key ? { ...i, ...patch } : i));
}

/** Files the next run should upload: queued ones, plus failed ones when retrying. */
export function pendingKeys(items: BatchItem[], includeFailed: boolean): string[] {
  return items
    .filter((i) => i.status === "queued" || (includeFailed && i.status === "failed"))
    .map((i) => i.key);
}

/** Marks failed files as queued again so the next run picks them up. Done files are never touched. */
export function requeueFailed(items: BatchItem[], key?: string): BatchItem[] {
  return items.map((i) =>
    i.status === "failed" && (key === undefined || i.key === key) ? { ...i, status: "queued", error: undefined } : i,
  );
}

/** Drops finished files from the list, keeping anything still to do. */
export function clearDone(items: BatchItem[]): BatchItem[] {
  return items.filter((i) => i.status !== "done");
}

export type BatchSummary = Record<BatchStatus, number> & { total: number };

export function summarise(items: BatchItem[]): BatchSummary {
  const s: BatchSummary = { queued: 0, preparing: 0, uploading: 0, done: 0, failed: 0, total: items.length };
  for (const i of items) s[i.status] += 1;
  return s;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
