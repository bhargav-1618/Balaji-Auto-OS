// Undefined-identifier scanner: Program-level globals Babel could not resolve.
// Catches crashes the Next build happily accepts (orphaned setState refs, typos).
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const KNOWN = new Set([
  'window','document','console','localStorage','sessionStorage','navigator','location',
  'setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame',
  'cancelAnimationFrame','fetch','Blob','File','FileReader','URL','URLSearchParams',
  'FormData','Image','Audio','Event','CustomEvent','AbortController','IntersectionObserver',
  'ResizeObserver','MutationObserver','Worker','crypto','structuredClone','alert','confirm','prompt',
  'process','require','module','exports','__dirname','__filename','global','globalThis','Buffer',
  'React','JSON','Math','Object','Array','String','Number','Boolean','Date','RegExp','Error',
  'TypeError','RangeError','Promise','Symbol','Map','Set','WeakMap','WeakSet','Proxy','Reflect',
  'Intl','isNaN','isFinite','parseInt','parseFloat','NaN','Infinity','undefined','encodeURIComponent',
  'decodeURIComponent','encodeURI','decodeURI','btoa','atob','queueMicrotask','print','Uint8Array',
  'ArrayBuffer','DataView','Int8Array','Float32Array','Float64Array','Uint16Array','Uint32Array',
  'TextEncoder','TextDecoder','performance','history','screen','getComputedStyle','matchMedia',
  'HTMLElement','Node','Element','DOMParser','XMLHttpRequest','WebSocket','Notification','scrollTo',
  // Standard web globals (Fetch API + Service Worker scope) — used by public/sw.js.
  'self','caches','Response','Request','Headers','ServiceWorkerGlobalScope','clients','skipWaiting',
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
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
  let res;
  try {
    res = babel.transformSync(code, {
      filename: f,
      babelrc: false, configFile: false,
      presets: [['@babel/preset-react', { runtime: 'classic' }]],
      plugins: [],
      ast: true, code: false,
      sourceType: 'module',
    });
  } catch (e) {
    console.log(`PARSE FAIL ${f}: ${e.message.split('\n')[0]}`);
    findings++;
    continue;
  }
  scanned++;
  const traverse = require('@babel/traverse').default;
  traverse(res.ast, {
    Program(p) {
      const globals = p.scope.globals;
      for (const name of Object.keys(globals)) {
        if (KNOWN.has(name)) continue;
        const node = globals[name];
        const line = node.loc ? node.loc.start.line : '?';
        console.log(`UNDEF  ${path.relative(root, f)}:${line}  ${name}`);
        findings++;
      }
    },
  });
}

console.log(`\n--- undefined-identifier scan: ${scanned} files, ${findings} finding(s) ---`);
process.exit(findings ? 1 : 0);
