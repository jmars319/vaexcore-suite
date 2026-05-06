import assert from "node:assert/strict";
import test from "node:test";
import { validateJsonSchema } from "../lib/json-schema-lite.mjs";

test("validates required properties and blocks additional properties", () => {
  const schema = {
    type: "object",
    required: ["id"],
    additionalProperties: false,
    properties: {
      id: { type: "string", pattern: "^vaexcore-[a-z]+$" },
    },
  };

  assert.deepEqual(validateJsonSchema(schema, { id: "vaexcore-studio" }), []);
  assert.match(validateJsonSchema(schema, { id: "studio" }).join("\n"), /pattern/);
  assert.match(validateJsonSchema(schema, { id: "vaexcore-studio", extra: true }).join("\n"), /extra is not allowed/);
  assert.match(validateJsonSchema(schema, {}).join("\n"), /id is required/);
});

test("validates strict date-time and URL formats", () => {
  const schema = {
    type: "object",
    required: ["createdAt", "url"],
    properties: {
      createdAt: { type: "string", format: "date-time" },
      url: { type: "string", format: "uri" },
    },
  };

  assert.deepEqual(
    validateJsonSchema(schema, {
      createdAt: "2026-05-06T12:00:00Z",
      url: "http://127.0.0.1:51287/health",
    }),
    [],
  );
  assert.match(
    validateJsonSchema(schema, {
      createdAt: "2026-05-06 12:00:00",
      url: "/health",
    }).join("\n"),
    /date-time[\s\S]*absolute URL/,
  );
});

test("allows relative URI references when requested", () => {
  assert.deepEqual(
    validateJsonSchema({ type: "string", format: "uri-reference" }, "handoffs/pulse-recording-intake.json"),
    [],
  );
  assert.match(validateJsonSchema({ type: "string", format: "uri-reference" }, "").join("\n"), /URL reference/);
});
