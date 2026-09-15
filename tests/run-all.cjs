// tests/run-all.cjs — CI test runner.
//
// Every tests/*.test.cjs file is already a standalone script that prints its
// own results and calls process.exit(FAIL ? 1 : 0). This just runs each one
// in its own process (so a crash in one file can't take down the rest),
// forwards its output, and fails the overall run if any file failed — the
// signal `npm test` / CI needs.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.cjs')).sort();

let failed = 0;
for (const file of files) {
  const full = path.join(dir, file);
  const res = spawnSync(process.execPath, [full], { stdio: 'inherit' });
  if (res.status !== 0) {
    failed += 1;
    console.error(`\nFAILED: ${file}\n`);
  }
}

console.log(`\n${files.length - failed}/${files.length} test files passed.\n`);
process.exit(failed ? 1 : 0);
