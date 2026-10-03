import { readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Syntax-checks every module in src/ and functions/.

   This used to be a hand-written chain of `node --check` calls with each file
   listed by name, which quietly stopped covering new files: shop.js was added
   and product.js deleted, and the script only failed once the stale name was
   reached. Reading the directories means the list can never drift from reality.

   `functions/` is included because it runs on Workers rather than in a browser,
   so nothing else in the toolchain parses it before deploy. A mangled regular
   expression in the order endpoint would otherwise ship unnoticed: it is valid
   JavaScript, just not the regular expression that was written. */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['src', 'functions'];

/* Collected by walking the tree rather than readdirSync at one level, so a new
   subdirectory of functions/ is covered without editing this file. */
function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const files = roots.flatMap((dir) => collect(join(root, dir))).sort();
const failed = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed.push(relative(root, file));
    process.stderr.write(error.stderr?.toString() ?? String(error));
  }
}

if (failed.length > 0) {
  process.stderr.write(`\nSyntax errors in: ${failed.join(', ')}\n`);
  process.exit(1);
}

process.stdout.write(`${files.length} modules OK\n`);
