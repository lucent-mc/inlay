import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { error, InlayError } from "../diagnostics.js";
import { digest, hashes } from "../lib/hash.js";

export interface IntegrityExpectation {
  fileSize: number;
  sha1?: string;
  sha256?: string;
  sha512?: string;
}

export function defaultCacheRoot(): string {
  if (process.env["INLAY_CACHE_DIR"]) return path.resolve(process.env["INLAY_CACHE_DIR"]);
  if (process.platform === "win32" && process.env["LOCALAPPDATA"]) {
    return path.join(process.env["LOCALAPPDATA"], "Inlay", "cache");
  }
  return path.join(process.env["XDG_CACHE_HOME"] ?? path.join(os.homedir(), ".cache"), "inlay");
}

export function verifyBytes(bytes: Uint8Array, expected: IntegrityExpectation, label: string): void {
  const failures: string[] = [];
  if (bytes.byteLength !== expected.fileSize)
    failures.push(`size ${bytes.byteLength} != ${expected.fileSize}`);
  for (const algorithm of ["sha1", "sha256", "sha512"] as const) {
    const wanted = expected[algorithm];
    if (wanted && digest(bytes, algorithm).toLowerCase() !== wanted.toLowerCase())
      failures.push(`${algorithm} mismatch`);
  }
  if (failures.length > 0) {
    throw new InlayError(
      error("integrity-mismatch", `${label} failed integrity verification: ${failures.join(", ")}.`),
    );
  }
}

export class ContentCache {
  constructor(readonly root = defaultCacheRoot()) {}

  private filename(expected: IntegrityExpectation): string {
    const identity = expected.sha512 ?? expected.sha256 ?? expected.sha1;
    if (!identity)
      throw new InlayError(
        error("cache-identity-missing", "Cached content requires at least one expected digest."),
      );
    return path.join(this.root, identity.slice(0, 2), identity);
  }

  async get(expected: IntegrityExpectation): Promise<Uint8Array | undefined> {
    const filename = this.filename(expected);
    try {
      const bytes = await readFile(filename);
      verifyBytes(bytes, expected, filename);
      return bytes;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      await rm(filename, { force: true });
      return undefined;
    }
  }

  async put(bytes: Uint8Array, expected?: IntegrityExpectation): Promise<string> {
    const actual = hashes(bytes);
    const expectation = expected ?? { fileSize: bytes.byteLength, ...actual };
    verifyBytes(bytes, expectation, "downloaded content");
    // Use the caller's strongest declared digest as the cache key. Adding a
    // stronger computed digest here would make a subsequent get(expectation)
    // look in a different location.
    const filename = this.filename(expectation);
    await mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${process.pid}.tmp`;
    await writeFile(temporary, bytes);
    try {
      await rename(temporary, filename);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      await rm(temporary, { force: true });
    }
    return filename;
  }
}
