// Merge Playwright V8 coverage entries and convert them to Istanbul format.
// Split out of merge-coverage.js so the merge can be tested on real V8 data.
import fs from 'fs';
import path from 'path';
import libCoverage from 'istanbul-lib-coverage';
import v8toIstanbul from 'v8-to-istanbul';

// Group V8 entries (one per script load) by URL, keeping each load's functions
// separate. V8 block coverage only lists the sub-blocks whose count differs from
// their parent, so two loads of one script can report DIFFERENT range lists for
// the same function — merging those lists by index paired unrelated blocks.
export const mergeV8Entries = (entries) => {
  const merged = {};
  for (const entry of entries) {
    if (!entry.url || !entry.source || !entry.functions) continue;
    merged[entry.url] ??= { url: entry.url, source: entry.source, runs: [] };
    merged[entry.url].runs.push(entry.functions);
  }
  return merged;
};

// Istanbul coverage for ONE script load.
const convertRun = async (tempFile, source, functions) => {
  const converter = v8toIstanbul(tempFile, 0, { source });
  await converter.load();
  converter.applyCoverage(functions);
  return Object.values(converter.toIstanbul());
};

// Convert every load to Istanbul and sum hit counts by source location,
// keyed by the real source path.
export const toIstanbul = async (mergedV8, srcDir, tempDir) => {
  const coverageMap = libCoverage.createCoverageMap({});
  fs.mkdirSync(tempDir, { recursive: true });

  for (const [url, v8Data] of Object.entries(mergedV8)) {
    const fileName = url.split('/').pop() || 'unknown.js';
    // v8-to-istanbul reads a temp copy; the report points at the real source
    const tempFile = path.join(tempDir, fileName);
    const realSourceFile = path.join(srcDir, fileName);
    fs.writeFileSync(tempFile, v8Data.source);
    for (const functions of v8Data.runs) {
      for (const data of await convertRun(tempFile, v8Data.source, functions)) {
        coverageMap.merge({ [realSourceFile]: { ...data, path: realSourceFile } });
      }
    }
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  return coverageMap.toJSON();
};
