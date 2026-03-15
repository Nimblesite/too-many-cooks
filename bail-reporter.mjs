/// Custom node:test reporter — exits on first test failure (bail/fail-fast).
///
/// Usage with node:test:
///   node --test --test-reporter=spec --test-reporter-destination=stdout \
///     --test-reporter=./bail-reporter.mjs --test-reporter-destination=stderr \
///     test/*.ts

const BAIL_EXIT_CODE = 1;

export default async function* bailReporter(source) {
  for await (const event of source) {
    if (event.type === "test:fail") {
      const name = event.data?.name ?? "unknown";
      const file = event.data?.file ?? "";
      yield `\nBAIL OUT — test failed: ${name} (${file})\n`;
      process.exit(BAIL_EXIT_CODE);
    }
  }
}
