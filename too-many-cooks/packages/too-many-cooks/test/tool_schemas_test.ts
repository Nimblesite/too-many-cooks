/// Tests for tool input schema definitions.
/// Ensures maxLength and other constraints are present
/// so agents respect limits.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  MESSAGE_INPUT_SCHEMA,
  PLAN_INPUT_SCHEMA,
  REGISTER_INPUT_SCHEMA,
  REGISTER_TOOL_CONFIG,
} from "too-many-cooks-core";
import { isRecord } from "./support/json.js";

type SchemaObj = Record<string, unknown>;

/** Narrows any schema value to a record without casts. */
const schemaRecord = (schema: unknown): SchemaObj => {
  if (!isRecord(schema)) {throw new Error("Invalid schema");}
  return schema;
};

const props = (schema: SchemaObj): Record<string, unknown> => {
  const p = schema.properties;
  if (!isRecord(p)) {throw new Error("No properties in schema");}
  return p;
};

const field = (schema: SchemaObj, name: string): SchemaObj => {
  const f = props(schema)[name];
  if (!isRecord(f)) {throw new Error(`No field ${name} in schema`);}
  return f;
};

const desc = (schema: SchemaObj, name: string): string => {
  const d = field(schema, name).description;
  if (typeof d !== "string") {throw new Error(`No description for ${name}`);}
  return d;
};

/** Asserts a schema field's maxLength constraint. */
const assertFieldMaxLength = (schema: unknown, name: string, expected: number): void => {
  assert.strictEqual(field(schemaRecord(schema), name).maxLength, expected);
};

/** Asserts a schema field's description mentions a needle. */
const assertDescriptionMentions = (schema: unknown, name: string, needle: string): void => {
  assert.ok(desc(schemaRecord(schema), name).includes(needle));
};

describe("message tool schema", () => {
  it("content has maxLength 200", () => {
    assertFieldMaxLength(MESSAGE_INPUT_SCHEMA, "content", 200);
  });

  it("content description mentions 200 char limit", () => {
    assertDescriptionMentions(MESSAGE_INPUT_SCHEMA, "content", "200");
  });
});

describe("plan tool schema", () => {
  it("goal has maxLength 100", () => {
    assertFieldMaxLength(PLAN_INPUT_SCHEMA, "goal", 100);
  });

  it("goal description mentions 100 char limit", () => {
    assertDescriptionMentions(PLAN_INPUT_SCHEMA, "goal", "100");
  });

  it("current_task has maxLength 100", () => {
    assertFieldMaxLength(PLAN_INPUT_SCHEMA, "current_task", 100);
  });

  it("current_task description mentions char limit", () => {
    assertDescriptionMentions(PLAN_INPUT_SCHEMA, "current_task", "100");
  });
});

describe("register tool schema", () => {
  it("has name field for first registration", () => {
    assert.ok("name" in props(REGISTER_INPUT_SCHEMA));
  });

  it("has key field for reconnect", () => {
    assert.ok("key" in props(REGISTER_INPUT_SCHEMA));
  });

  it("name description says first registration only", () => {
    assertDescriptionMentions(REGISTER_INPUT_SCHEMA, "name", "FIRST");
  });

  it("key description says reconnect only", () => {
    assertDescriptionMentions(REGISTER_INPUT_SCHEMA, "key", "RECONNECT");
  });

  it("does not require both name and key", () => {
    // Schema should NOT have required: ['name', 'key']
    // Either name or key, not both — validated in handler
    assert.strictEqual(
      schemaRecord(REGISTER_INPUT_SCHEMA).required,
      undefined,
    );
  });

  it("description explains both modes", () => {
    const description = REGISTER_TOOL_CONFIG.description;
    assert.ok(description.includes("name"));
    assert.ok(description.includes("key"));
    assert.ok(description.includes("RECONNECT"));
  });
});
