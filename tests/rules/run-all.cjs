// tests/rules/run-all.cjs — runs every Firestore-rules emulator test file in its
// own process (a crash in one can't take down the rest), forwards output, and
// fails the run if any file fails. Invoked by `npm run test:rules` inside a fresh
// `firebase emulators:exec` session, so all files share one emulator instance;
// each file calls testEnv.clearFirestore() per block, so they don't interfere.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.test.cjs'))
  .sort(); // firestore.rules.test.cjs before security-bypass.rules.test.cjs

let failed = 0;
for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const res = spawnSync(process.execPath, [path.join(dir, file)], { stdio: 'inherit' });
  if (res.status !== 0) { failed += 1; console.error(`\nFAILED: ${file}\n`); }
}
console.log(`\n${files.length - failed}/${files.length} rules test files passed.\n`);
process.exit(failed ? 1 : 0);
