import { error, InlayError } from "../diagnostics.js";
import type { RemoteFileDeclaration } from "../types.js";
import { ContentCache, type IntegrityExpectation, verifyBytes } from "./cache.js";

const MODRINTH_ALLOWED_DOWNLOAD_HOSTS = new Set([
  "cdn.modrinth.com",
  "github.com",
  "raw.githubusercontent.com",
  "gitlab.com",
]);

export interface DownloadOptions {
  allowedHosts?: Set<string>;
  offline?: boolean;
  signal?: AbortSignal;
}

export class HttpAdapter {
  constructor(readonly cache = new ContentCache()) {}

  async download(
    urls: string[],
    expected: IntegrityExpectation,
    options: DownloadOptions = {},
  ): Promise<Uint8Array> {
    const cached = await this.cache.get(expected);
    if (cached) return cached;
    if (options.offline === true) {
      throw new InlayError(
        error("offline-cache-miss", `Required immutable content is absent from the cache.`),
      );
    }

    const failures: string[] = [];
    for (const value of urls) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        failures.push(`${value}: invalid URL`);
        continue;
      }
      if (url.protocol !== "https:") {
        failures.push(`${value}: HTTPS is required`);
        continue;
      }
      if (options.allowedHosts && !options.allowedHosts.has(url.hostname.toLowerCase())) {
        failures.push(`${value}: host is not permitted`);
        continue;
      }
      try {
        const response = await fetch(url, {
          redirect: "follow",
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        verifyBytes(bytes, expected, value);
        await this.cache.put(bytes, expected);
        return bytes;
      } catch (cause) {
        failures.push(`${value}: ${(cause as Error).message}`);
      }
    }
    throw new InlayError(
      error("download-failed", `No download source produced the expected content.`, {
        detail: failures.join("\n"),
      }),
    );
  }

  async downloadModrinthFile(
    file: RemoteFileDeclaration,
    options: Omit<DownloadOptions, "allowedHosts"> = {},
  ) {
    return this.download(
      file.downloads,
      { fileSize: file.fileSize, sha1: file.hashes.sha1, sha512: file.hashes.sha512 },
      { ...options, allowedHosts: MODRINTH_ALLOWED_DOWNLOAD_HOSTS },
    );
  }
}
