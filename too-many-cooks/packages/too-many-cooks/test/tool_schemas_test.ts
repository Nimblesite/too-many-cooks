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

type SchemaObj = Record<string, unknown>;

const props = (schema: SchemaObj): Record<string, SchemaObj> => {
  const p = schema.properties as Record<string, SchemaObj> | undefined;
  if (p === undefined) {throw new Error("No properties in schema");}
  return p;
};

const field = (schema: SchemaObj, name: string): SchemaObj => {
  const f = props(schema)[name];
  if (f === undefined) {throw new Error(`No field ${name} in schema`);}
  return f;
};

const desc = (schema: SchemaObj, name: string): string => {
  const d = field(schema, name).description;
  if (typeof d !== "string") {throw new Error(`No description for ${name}`);}
  return d;
};

describe("message tool schema", () => {
  it("content has maxLength 200", () => {
    assert.strictEqual(
      field(MESSAGE_INPUT_SCHEMA as SchemaObj, "content").maxLength,
      200,
    );
  });

  it("content description mentions 200 char limit", () => {
    assert.ok(
      desc(MESSAGE_INPUT_SCHEMA as SchemaObj, "content").includes("200"),
    );
  });
});

describe("plan tool schema", () => {
  it("goal has maxLength 100", () => {
    assert.strictEqual(
      field(PLAN_INPUT_SCHEMA as SchemaObj, "goal").maxLength,
      100,
    );
  });

  it("goal description mentions 100 char limit", () => {
    assert.ok(
      desc(PLAN_INPUT_SCHEMA as SchemaObj, "goal").includes("100"),
    );
  });

  it("current_task has maxLength 100", () => {
    assert.strictEqual(
      field(PLAN_INPUT_SCHEMA as SchemaObj, "current_task").maxLength,
      100,
    );
  });

  it("current_task description mentions char limit", () => {
    assert.ok(
      desc(PLAN_INPUT_SCHEMA as SchemaObj, "current_task").includes("100"),
    );
  });
});

describe("register tool schema", () => {
  it("has name field for first registration", () => {
    assert.ok("name" in props(REGISTER_INPUT_SCHEMA as SchemaObj));
  });

  it("has key field for reconnect", () => {
    assert.ok("key" in props(REGISTER_INPUT_SCHEMA as SchemaObj));
  });

  it("name description says first registration only", () => {
    assert.ok(
      desc(REGISTER_INPUT_SCHEMA as SchemaObj, "name").includes("FIRST"),
    );
  });

  it("key description says reconnect only", () => {
    assert.ok(
      desc(REGISTER_INPUT_SCHEMA as SchemaObj, "key").includes("RECONNECT"),
    );
  });

  it("does not require both name and key", () => {
    // Schema should NOT have required: ['name', 'key']
    // Either name or key, not both — validated in handler
    assert.strictEqual(
      (REGISTER_INPUT_SCHEMA as SchemaObj).required,
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
