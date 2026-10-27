#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { mergeV8Entries, toIstanbul } from './v8-coverage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteDir = path.join(__dirname, '..');
const coverageDir = path.join(websiteDir, 'coverage');
const srcDir = path.join(websiteDir, 'src', 'assets', 'js');
const nycOutputDir = path.join(coverageDir, '.nyc_output');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

// Ensure directories exist
ensureDir(nycOutputDir);

// Read all coverage files
const files = fs.readdirSync(coverageDir)
  .filter(f => f.startsWith('coverage-') && f.endsWith('.json'));

if (files.length === 0) {
  // No data means the tests did not instrument anything — fail, never pass silently.
  console.error('No coverage files found');
  process.exit(1);
}

// Every Playwright test wrote one file of V8 entries; merge and convert them.
const entries = files.flatMap((file) => {
  const content = fs.readFileSync(path.join(coverageDir, file), 'utf-8').trim();
  return content === '' ? [] : JSON.parse(content);
});
const istanbulCoverage = await toIstanbul(
  mergeV8Entries(entries),
  srcDir,
  path.join(coverageDir, '.temp-sources'),
);

// Write Istanbul coverage
const istanbulFile = path.join(nycOutputDir, 'coverage.json');
fs.writeFileSync(istanbulFile, JSON.stringify(istanbulCoverage, null, 2));

// Generate HTML and LCOV reports using nyc
console.log('\nGenerating coverage reports...\n');

try {
  execSync(`npx nyc report --reporter=html --reporter=lcov --reporter=text --reporter=json-summary --temp-dir="${nycOutputDir}" --report-dir="${coverageDir}" --include="src/assets/js/**/*.js"`, {
    cwd: websiteDir,
    stdio: 'inherit',
  });
} catch (err) {
  console.error('Failed to generate reports:', err.message);
  process.exit(1);
}

// Clean up individual coverage files
for (const file of files) {
  fs.unlinkSync(path.join(coverageDir, file));
}

console.log(`\nHTML report: ${path.join(coverageDir, 'index.html')}`);
console.log(`LCOV report: ${path.join(coverageDir, 'lcov.info')}`);
console.log('');
