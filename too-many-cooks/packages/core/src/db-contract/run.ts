/// Entry module for the TooManyCooksDb contract test suite.
///
/// Runs the per-feature contract test modules in a fixed order so every
/// backend implementation is validated against the same suite. Re-exported
/// publicly through `db-contract-tests.ts`.

import { runAdminTests } from "./admin.test.js";
import { runActivationTests, runAuthenticationTests, runRegistrationTests } from "./agents.test.js";
import { runLockTests } from "./locks.test.js";
import { runMessageTests } from "./messages.test.js";
import { runPlanTests } from "./plans.test.js";
import type { DbFactory } from "./setup.test.js";

/**
 * Run the full TooManyCooksDb contract test suite.
 *
 * @param createTestDb - Factory that creates a fresh db instance per test
 */
export const runDbContractTests = (createTestDb: DbFactory): void => {
  runRegistrationTests(createTestDb);
  runAuthenticationTests(createTestDb);
  runLockTests(createTestDb);
  runMessageTests(createTestDb);
  runPlanTests(createTestDb);
  runActivationTests(createTestDb);
  runAdminTests(createTestDb);
};
