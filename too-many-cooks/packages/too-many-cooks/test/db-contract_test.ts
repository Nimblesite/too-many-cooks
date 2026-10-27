/// SQLite runner for the TooManyCooksDb contract test suite.
///
/// Runs the same contract tests that will validate the PostgreSQL
/// backend in tmc-cloud. If these pass, the SQLite implementation
/// conforms to the interface contract.

import { runDbContractTests } from "too-many-cooks-core";
import { freshTestDb } from "./support/db_fixture.js";
import { deleteIfExists } from "./support/fs_helpers.js";

const TEST_DB_PATH = ".test_contract.db";

runDbContractTests(async () => {
  const { db } = freshTestDb(TEST_DB_PATH);
  return await Promise.resolve({
    db,
    cleanup: async () => {
      await db.close();
      deleteIfExists(TEST_DB_PATH);
    },
  });
});
