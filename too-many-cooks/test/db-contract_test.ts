/// SQLite runner for the TooManyCooksDb contract test suite.
///
/// Runs the same contract tests that will validate the PostgreSQL
/// backend in tmc-cloud. If these pass, the SQLite implementation
/// conforms to the interface contract.

import fs from "node:fs";

import { createDataConfig, createDb } from "../lib/src/data/data.js";
import { runDbContractTests } from "../lib/src/db-contract-tests.js";

const TEST_DB_PATH = ".test_contract.db";

const deleteIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch {
    // ignore
  }
};

runDbContractTests(async () => {
  deleteIfExists(TEST_DB_PATH);
  const config = createDataConfig({ dbPath: TEST_DB_PATH });
  const result = createDb(config);
  if (!result.ok) {
    throw new Error(`Failed to create db: ${result.error}`);
  }
  return await Promise.resolve({
    db: result.value,
    cleanup: async () => {
      await result.value.close();
      deleteIfExists(TEST_DB_PATH);
    },
  });
});
