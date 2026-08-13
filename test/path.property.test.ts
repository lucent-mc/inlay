import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { contentKey, normalizeContentPath } from "../src/lib/path.js";

test("portable path normalization is idempotent", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc
          .stringMatching(/^[A-Za-z0-9 _.-]+$/)
          .filter((segment) => segment !== "." && segment !== ".." && segment.length > 0),
        {
          minLength: 1,
          maxLength: 8,
        },
      ),
      (segments) => {
        const value = segments.join("/");
        assert.equal(normalizeContentPath(normalizeContentPath(value)), value);
      },
    ),
  );
});

test("content identity is case-insensitive while preserving declared spelling", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,20}$/), (segment) => {
      const path = `mods/${segment}.jar`;
      assert.equal(normalizeContentPath(path), path);
      assert.equal(contentKey(path), contentKey(path.toUpperCase()));
    }),
  );
});

test("escape and separator forms are always rejected", () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 30 }), (suffix) => {
      for (const value of [`../${suffix}`, `/absolute/${suffix}`, `C:/${suffix}`, `safe\\${suffix}`]) {
        assert.throws(() => normalizeContentPath(value));
      }
    }),
  );
});
