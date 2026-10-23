// Schema-contract test: every GraphQL document the frontend sends must be
// valid against schema.graphql. This catches field/arg/type drift between the
// client documents and the server schema at CI time (the class of bug that
// silently breaks tabs like batch settings, pull, refresh, logout).
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { describe, it, expect } from "vitest";
import { buildSchema, parse, validate, getVariableValues } from "graphql";
import { SCHEDULE_TYPES } from "../../constants/intents.js";

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

// ---------------------------------------------------------------------------
// Variable coercion: documents being valid is not enough. The server rejects a
// request before any resolver runs when the *variables* do not coerce into the
// declared input types — an unknown input field, or a String where an enum is
// required. Every mutation below had exactly that bug once, and none of them
// were visible in the UI as anything more useful than a generic failure.
//
// These cases run the same coercion the server performs (getVariableValues)
// over payloads shaped the way the forms shape them, so a form that drifts
// from the schema fails in CI instead of in production.
// ---------------------------------------------------------------------------

function opByName(name) {
  const doc = docs.find((d) => new RegExp(`\\b${name}\\b`).test(d));
  if (!doc) throw new Error(`no document named ${name} in queries.js`);
  const op = parse(doc).definitions.find((d) => d.kind === "OperationDefinition");
  return op.variableDefinitions;
}

function coerceErrors(opName, variables) {
  return getVariableValues(schema, opByName(opName), variables).errors || [];
}

const src = (rel) => readFileSync(resolve(here, rel), "utf8");

describe("GraphQL variable coercion", () => {
  const trackedAppBase = { name: "app", githubRepo: "org/app" };

  it("createTrackedApp accepts the enum spellings the form sends", () => {
    for (const sourceType of ["GITHUB", "GITLAB", "DOCKER"]) {
      expect(
        coerceErrors("CreateTrackedApp", { input: { ...trackedAppBase, sourceType } }).map(
          (e) => e.message
        )
      ).toEqual([]);
    }
  });

  it("createTrackedApp rejects the lowercase UI spelling (boundary must translate)", () => {
    // Documents the trap: the form keeps sourceType lowercase for its tab/URL
    // logic, so the payload builder must upper-case it.
    expect(
      coerceErrors("CreateTrackedApp", { input: { ...trackedAppBase, sourceType: "github" } })
        .length
    ).toBeGreaterThan(0);
    expect(src("../../components/AddTrackedAppModal.jsx")).toContain(
      'sourceType: (sourceType || "").toUpperCase()'
    );
  });

  it("createIntent/updateIntent coerce the schedule constants the form uses", () => {
    // Driven off SCHEDULE_TYPES itself: if the constants stop matching the
    // IntentScheduleType enum, this fails.
    for (const scheduleType of Object.values(SCHEDULE_TYPES)) {
      expect(
        coerceErrors("CreateIntent", { input: { name: "i", scheduleType } }).map((e) => e.message)
      ).toEqual([]);
      expect(
        coerceErrors("UpdateIntent", { id: "1", input: { name: "i", scheduleType } }).map(
          (e) => e.message
        )
      ).toEqual([]);
    }
    expect(
      coerceErrors("CreateIntent", { input: { name: "i", scheduleType: "immediate" } }).length
    ).toBeGreaterThan(0);
  });

  it("setUserRole passes instanceAdmin through", () => {
    // Coercion alone cannot catch an argument that is simply never sent, so
    // assert the document forwards it as well as accepting the variable.
    expect(
      coerceErrors("SetUserRole", { userId: "1", role: "ADMINISTRATOR", instanceAdmin: true }).map(
        (e) => e.message
      )
    ).toEqual([]);
    const doc = docs.find((d) => /\bSetUserRole\b/.test(d));
    expect(doc).toContain("$instanceAdmin: Boolean");
    expect(doc).toContain("instanceAdmin: $instanceAdmin");
  });

  it("updateSSOProvider omits name, which only exists on create", () => {
    const edit = {
      displayName: "Corp",
      providerType: "oidc",
      clientId: "cid",
      issuerUrl: "https://idp.example",
      scopes: "openid",
      autoRegister: true,
      defaultRole: "Member",
      enabled: true,
    };
    expect(
      coerceErrors("UpdateSSOProvider", { id: "1", input: edit }).map((e) => e.message)
    ).toEqual([]);
    // The identity is fixed at creation; sending name fails coercion, which is
    // why the modal builds separate create/update payloads.
    expect(
      coerceErrors("UpdateSSOProvider", { id: "1", input: { ...edit, name: "corp" } }).length
    ).toBeGreaterThan(0);
    expect(
      coerceErrors("CreateSSOProvider", { input: { ...edit, name: "corp", clientSecret: "s" } })
    ).toEqual([]);
  });

  it("trackedApps query selects the release dates the card renders", () => {
    const doc = docs.find((d) => /\bquery TrackedApps\b/.test(d));
    expect(doc).toContain("currentVersionPublishDate");
    expect(doc).toContain("latestVersionPublishDate");
  });
});
