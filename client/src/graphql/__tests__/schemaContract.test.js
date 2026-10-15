// Schema-contract test: every GraphQL document the frontend sends must be
// valid against schema.graphql. This catches field/arg/type drift between the
// client documents and the server schema at CI time (the class of bug that
// silently breaks tabs like batch settings, pull, refresh, logout).
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { describe, it, expect } from "vitest";
import { buildSchema, parse, validate } from "graphql";

const here = dirname(fileURLToPath(import.meta.url));
const schemaSrc = readFileSync(resolve(here, "../../../../schema.graphql"), "utf8");
const queriesSrc = readFileSync(resolve(here, "../queries.js"), "utf8");

const schema = buildSchema(schemaSrc);

// Extract each /* GraphQL */ `...` template literal from queries.js.
const docs = [...queriesSrc.matchAll(/\/\* GraphQL \*\/\s*`([\s\S]*?)`/g)].map((m) => m[1]);

// Best-effort operation name for readable test titles.
function nameOf(doc, i) {
  const m = doc.match(/\b(query|mutation|subscription|fragment)\s+([A-Za-z0-9_]+)/);
  return m ? `${m[1]} ${m[2]}` : `document #${i}`;
}

describe("GraphQL schema contract", () => {
  it("finds the frontend documents", () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  for (let i = 0; i < docs.length; i++) {
    it(`${nameOf(docs[i], i)} is valid against schema.graphql`, () => {
      const errors = validate(schema, parse(docs[i]));
      expect(errors.map((e) => e.message)).toEqual([]);
    });
  }
});
