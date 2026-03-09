/**
 * Runs the VSCode extension tests using @vscode/test-electron.
 * Captures all stdout/stderr to a timestamped log file.
 */

const fs = require('fs');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_FILE = path.join(
  LOG_DIR,
  `test-run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
);

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function logToFile(prefix, ...args) {
  const timestamp = new Date().toISOString();
  const message = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ');
  const line = `[${timestamp}] [${prefix}] ${message}\n`;
  logStream.write(line);
  // Also write to original stream so terminal still shows output
  if (prefix === 'ERR') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

// Poll the log file for "Test run complete" and extract the failure count.
function waitForTestCompletion(timeout = 300000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      try {
        const content = fs.readFileSync(LOG_FILE, 'utf8');
        const match = /Test run complete: (\d+) failures/.exec(content);
        if (match) {
          clearInterval(interval);
          resolve(parseInt(match[1], 10));
          return;
        }
      } catch { /* file may not exist yet */ }

      if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error('Timeout waiting for test completion'));
      }
    }, 1000);
  });
}

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, '../out/test/suite/index.js');

  logToFile('INFO', 'Log file:', LOG_FILE);
  logToFile('INFO', 'Extension development path:', extensionDevelopmentPath);
  logToFile('INFO', 'Extension tests path:', extensionTestsPath);

  // On CI (or when VSCODE_EXECUTABLE_PATH is unset), let @vscode/test-electron
  // download a fresh copy of VSCode. Only use a local install when explicitly set.
  const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH || undefined;

  try {
    // The code CLI may return immediately (forks VSCode process).
    // We capture the initial exit code but also poll the log for results.
    const runOptions = {
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--user-data-dir', '/tmp/vsc-tmc-test', extensionDevelopmentPath],
      extensionTestsEnv: {
        VERBOSE_LOGGING: 'true',
        TMC_TEST_LOG_FILE: LOG_FILE,
      },
    };
    if (vscodeExecutablePath) {
      runOptions.vscodeExecutablePath = vscodeExecutablePath;
    }
    const exitCode = await runTests(runOptions);

    logToFile('INFO', 'CLI exit code:', exitCode);

    // Wait for the actual test results in the log file.
    logToFile('INFO', 'Waiting for test completion...');
    const failures = await waitForTestCompletion();
    logToFile('INFO', 'Test failures:', failures);

    // Dump the full log to console so CI/terminal shows everything
    try {
      const fullLog = fs.readFileSync(LOG_FILE, 'utf8');
      process.stdout.write('\n=== FULL TEST LOG ===\n');
      process.stdout.write(fullLog);
      process.stdout.write('=== END TEST LOG ===\n\n');
    } catch { /* ignore */ }

    logStream.end();
    process.exit(failures > 0 ? 1 : 0);
  } catch (err) {
    logToFile('ERR', 'Failed:', String(err));
    logStream.end();
    process.exit(1);
  }
}

main();
