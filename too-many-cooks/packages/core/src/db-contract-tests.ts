/// Contract test suite for the TooManyCooksDb interface.
///
/// Re-exports the suite from the dedicated test modules so the public module
/// path stays stable while the suite itself lives in `*.test.ts` files
/// (matching the project's test-file lint overrides).
///
/// Usage:
///   import { runDbContractTests } from "too-many-cooks-core";
///   runDbContractTests(async () => ({
///     db: yourDbInstance,
///     cleanup: async () => { /* tear down */ },
///   }));

export { runDbContractTests } from "./db-contract/run.js";
