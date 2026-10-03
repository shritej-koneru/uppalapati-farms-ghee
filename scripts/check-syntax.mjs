import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Syntax-checks every module in src/.

   This used to be a hand-written chain of `node --check` calls with each file
   listed by name, which quietly stopped covering new files: shop.js was added
   and product.js deleted, and the script only failed once the stale name was
   reached. Reading the directory means the list can never drift from reality. */

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = readdirSync(srcDir)
  .filter((name) => name.endsWith('.js'))
  .sort();

const failed = [];

for (const name of files) {
  try {
    execFileSync(process.execPath, ['--check', join(srcDir, name)], { stdio: 'pipe' });
  } catch (error) {
    failed.push(name);
    process.stderr.write(error.stderr?.toString() ?? String(error));
  }
}

if (failed.length > 0) {
  process.stderr.write(`\nSyntax errors in: ${failed.join(', ')}\n`);
  process.exit(1);
}

process.stdout.write(`${files.length} modules OK\n`);
