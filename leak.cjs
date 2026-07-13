// Find useEffects that create a subscription/timer/listener but return NO cleanup.
const fs=require('fs'),babel=require('@babel/core'),traverse=require('@babel/traverse').default;
const RISK=/(onSnapshot|setInterval|setTimeout|addEventListener|createObjectURL|new Worker|requestAnimationFrame)/;
let total=0,leaks=0;
for(const f of process.argv.slice(2)){
  if(!fs.existsSync(f))continue;
  const code=fs.readFileSync(f,'utf8');
  const ast=babel.parseSync(code,{presets:[['@babel/preset-react',{runtime:'classic'}]],filename:f,sourceType:'module'});
  traverse(ast,{
    CallExpression(p){
      if(p.node.callee.name!=='useEffect')return;
      const fn=p.node.arguments[0];
      if(!fn||!fn.body)return;
      total++;
      const src=code.slice(fn.start,fn.end);
      if(!RISK.test(src))return;
      // does the effect body return anything?
      let hasReturn=false;
      p.traverse({ReturnStatement(r){
        if(r.getFunctionParent().node===fn && r.node.argument) hasReturn=true;
      }});
      if(!hasReturn){
        const line=p.node.loc.start.line;
        const what=(src.match(RISK)||[])[0];
        console.log(`  LEAK ${f}:${line}  creates ${what} — NO cleanup returned`);
        leaks++;
      }
    }
  });
}
console.log(`\n  ${total} useEffects scanned, ${leaks} potential leak(s)`);
