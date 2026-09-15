// tests/rules/helpers.cjs
// Shared setup for Firestore Security Rules tests. Isolated from tests/*.test.cjs
// on purpose: these require the Firestore emulator (Java + a running process) and
// must never be picked up by the plain-Node `npm test` suite (tests/run-all.cjs
// only globs tests/*.test.cjs, not subdirectories, so this directory is skipped
// automatically).
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');
const PROJECT_ID = 'demo-rules-test';

// The owner email hardcoded in firestore.rules' ownerEmail() — always admin,
// even with no appSettings/roles doc. A real admin is anyone listed in
// appSettings/roles.admins (seeded per-test via withSecurityRulesDisabled).
const OWNER_EMAIL = 'konabhargav2003@gmail.com';
const ADMIN_EMAIL = 'admin@shop.test';
const STAFF_EMAIL = 'staff@shop.test';

async function makeTestEnv() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
}

// Seed appSettings/roles with the given admin emails, bypassing rules (the rules
// themselves make this collection admin-write-only — tests need an out-of-band
// way to set up "who is an admin" before exercising the rules against it).
async function seedAdmins(testEnv, emails) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = require('firebase/firestore');
    await setDoc(doc(ctx.firestore(), 'appSettings/roles'), { admins: emails });
  });
}

// Seed an arbitrary document, bypassing rules — for tests that need existing
// data in place (e.g. an update/delete target) without that seed write itself
// being part of what's under test.
async function seedDoc(testEnv, path_, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = require('firebase/firestore');
    await setDoc(doc(ctx.firestore(), path_), data);
  });
}

module.exports = {
  makeTestEnv, seedAdmins, seedDoc,
  PROJECT_ID, OWNER_EMAIL, ADMIN_EMAIL, STAFF_EMAIL,
};
