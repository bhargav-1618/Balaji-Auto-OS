// TDZ scanner: a const/let binding *read* at a source position before its declaration,
// within the same function body — the classic "Cannot access 'x' before initialization"
// crash that the Next build accepts. Especially deadly inside hook dependency arrays.
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const traverse = require('@babel/traverse').default;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', 'public'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const root = process.argv[2];
let findings = 0, scanned = 0;

for (const f of walk(root)) {
  const code = fs.readFileSync(f, 'utf8');
  const ast = babel.parseSync(code, {
    filename: f, babelrc: false, configFile: false,
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
    sourceType: 'module',
  });
  scanned++;

  traverse(ast, {
    Scopable(p) {
      const bindings = p.scope.bindings;
      for (const name of Object.keys(bindings)) {
        const b = bindings[name];
        if (b.kind !== 'const' && b.kind !== 'let') continue;
        const declStart = b.path.node.start;
        for (const ref of b.referencePaths) {
          // Babel registers the enclosing ExportNamedDeclaration as a "reference".
          // It is not a read — it starts before the declarator by construction.
          if (!ref.isIdentifier() && !ref.isJSXIdentifier()) continue;
          if (ref.node === b.identifier) continue;
          if (ref.node.start >= declStart) continue;

          // THE RULE: a read positioned before the declaration is a TDZ error when it
          // executes in the SAME function as the declaration — i.e. it runs as part of
          // that function's straight-line statement flow. A read inside a NESTED
          // function is deferred until that function is called, which normally happens
          // after initialisation, so it is safe.
          //
          // The previous version of this scanner had this backwards and skipped every
          // same-function read. That is the ONLY case that actually throws, so it found
          // nothing — it missed a live "Cannot access 'payments' before initialization"
          // that broke every invoice save. Do not "simplify" this again.
          const refFn = ref.getFunctionParent();
          const declFn = b.path.getFunctionParent();
          const sameExecutionContext = refFn === declFn;

          // A read inside a hook dependency array is evaluated on every render, i.e.
          // immediately — so it is unsafe even though it sits inside a call expression.
          const inDepArray = ref.findParent((pp) =>
            pp.isArrayExpression()
            && pp.parentPath?.isCallExpression()
            && /^use[A-Z]/.test(pp.parentPath.node.callee.name || '')
            && pp.parentPath.node.arguments[1] === pp.node);

          if (!sameExecutionContext && !inDepArray) continue;

          const line = ref.node.loc ? ref.node.loc.start.line : '?';
          const declLine = b.path.node.loc ? b.path.node.loc.start.line : '?';
          console.log(
            `TDZ  ${path.relative(root, f)}:${line}  '${name}' read before ${b.kind} declaration (line ${declLine})` +
            (inDepArray ? '  [in hook dependency array]' : '')
          );
          findings++;
        }
      }
    },
  });
}

console.log(`\n--- TDZ scan: ${scanned} files, ${findings} finding(s) ---`);
process.exit(findings ? 1 : 0);
