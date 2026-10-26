// Regression: merging V8 coverage from several page loads lost covered
// branches. V8 block coverage only lists the sub-blocks whose count differs
// from their parent, so two runs that take different branches report
// DIFFERENT range lists for the same function. Merging those lists by array
// index paired unrelated blocks, so a branch one test executed could still
// report 0 hits (main.js getPreferredTheme's `return saved` showed uncovered
// although theme.spec reloads with a stored theme).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { mergeV8Entries, toIstanbul } from '../scripts/v8-coverage.js';

const SAMPLE_NAME = 'sample.js';
// Same shape as main.js getPreferredTheme: an early return on a saved value.
const SAMPLE_SOURCE = [
  'const pick = (saved) => {',
  '  if (saved) return saved;',
  "  return 'light';",
  '};',
  'pick(process.argv[2]);',
  '',
].join('\n');
const SAVED_ARG = 'dark';
const IF_LINE = 2;

/** Run the sample under NODE_V8_COVERAGE and return its V8 entry (Playwright shape). */
const coverageRun = (workDir, args) => {
  const covDir = mkdtempSync(join(workDir, 'cov-'));
  const samplePath = join(workDir, SAMPLE_NAME);
  execFileSync(process.execPath, [samplePath, ...args], { env: { ...process.env, NODE_V8_COVERAGE: covDir } });
  const url = pathToFileURL(samplePath).href;
  const entry = readdirSync(covDir)
    .flatMap((f) => JSON.parse(readFileSync(join(covDir, f), 'utf8')).result)
    .find((e) => e.url === url);
  assert.ok(entry !== undefined, `no V8 coverage recorded for ${url}`);
  return { ...entry, source: SAMPLE_SOURCE };
};

/** Istanbul branch hit counts for the branch on `line`. */
const branchCountsOnLine = (fileCoverage, line) => {
  const id = Object.keys(fileCoverage.branchMap).find((k) => fileCoverage.branchMap[k].loc.start.line === line);
  assert.ok(id !== undefined, `no branch recorded on line ${line}`);
  return fileCoverage.b[id];
};

describe('merging V8 coverage across page loads', () => {
  // realpath: V8 reports script URLs by real path (macOS /var -> /private/var).
  const workDir = realpathSync(mkdtempSync(join(tmpdir(), 'v8-merge-')));
  let fileCoverage;

  before(async () => {
    writeFileSync(join(workDir, SAMPLE_NAME), SAMPLE_SOURCE);
    const savedRun = coverageRun(workDir, [SAVED_ARG]);
    const defaultRun = coverageRun(workDir, []);
    const merged = mergeV8Entries([defaultRun, savedRun]);
    const istanbul = await toIstanbul(merged, workDir, join(workDir, 'tmp-sources'));
    fileCoverage = Object.values(istanbul)[0];
  });

  after(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('counts a branch taken in only one of the runs', () => {
    const counts = branchCountsOnLine(fileCoverage, IF_LINE);
    assert.ok(counts.length > 0, 'the if on line 2 must be a recorded branch');
    for (const [arm, hits] of counts.entries()) {
      assert.ok(hits > 0, `branch arm ${arm} on line ${IF_LINE} was executed by one run but merged to ${hits} hits`);
    }
  });

  it('counts every statement executed by either run', () => {
    for (const [id, hits] of Object.entries(fileCoverage.s)) {
      const line = fileCoverage.statementMap[id].start.line;
      assert.ok(hits > 0, `statement on line ${line} was executed by one run but merged to ${hits} hits`);
    }
  });
});
