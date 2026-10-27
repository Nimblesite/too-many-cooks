/// Shared filesystem cleanup helpers for tests.
///
/// Every test file used to re-declare these guards; they now live here
/// once ([DEDUP-DESLOP]).

import fs from "node:fs";

/** Deletes a file if it exists; never throws. */
export const deleteIfExists = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }
};

/** Deletes a directory (recursively) if it exists; never throws. */
export const deleteDirIfExists = (dirPath: string): void => {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true });
    }
  } catch {
    // ignore
  }
};

/** Force-removes a directory tree (workspace teardown after server tests). */
export const removeTree = (dirPath: string): void => {
  fs.rmSync(dirPath, { recursive: true, force: true });
};
