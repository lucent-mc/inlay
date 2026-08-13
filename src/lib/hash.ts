import { createHash } from "node:crypto";

export type HashAlgorithm = "sha1" | "sha256" | "sha512";

export function digest(bytes: Uint8Array, algorithm: HashAlgorithm): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

export function hashes(bytes: Uint8Array): { sha1: string; sha256: string; sha512: string } {
  return {
    sha1: digest(bytes, "sha1"),
    sha256: digest(bytes, "sha256"),
    sha512: digest(bytes, "sha512"),
  };
}
