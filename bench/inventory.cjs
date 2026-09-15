const N = 2000;
const normalizeText = (str) => String(str ?? '')
  .replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
const parts = Array.from({length:N},(_,i)=>({
  id:`p${i}`, name:`Brake Pad Set Front ${i}`, sku:`BRK-${i}`, category:'Brakes',
  categories:['Brakes','Front'], vehicle:'Maruti Swift', compatibleCars:['Swift','Baleno','Dzire'],
  locationBin:`A-${i%50}`,
}));
const categoriesStr=(p)=>(p.categories||[]).join(' ');
const compatStr=(p)=>(p.compatibleCars||[]).join(' ');
const expandToken=(t)=>[t, `${t}s`];  // stand-in for the real synonym expansion
const partMatchesTokens=(part,tokens)=>{
  if(!tokens.length) return true;
  const hay = normalizeText([part.name,part.sku,part.category,categoriesStr(part),part.vehicle,compatStr(part),part.locationBin].filter(Boolean).join(' '));
  return tokens.every((tok)=>expandToken(tok).some((c)=>hay.includes(c)));
};
const t=(l,f,n=20)=>{f();const a=process.hrtime.bigint();for(let i=0;i<n;i++)f();const ms=Number(process.hrtime.bigint()-a)/1e6/n;console.log(`  ${l.padEnd(50)} ${ms.toFixed(2)} ms`);return ms;};
console.log(`\nInventory: ${N} parts\n`);
const tokens=['brake','front'];
const old=t('OLD: one keystroke (haystack rebuilt per part)',()=>parts.filter(p=>partMatchesTokens(p,tokens)));

// precomputed
const hay=new Map();
const build=()=>{hay.clear();parts.forEach(p=>hay.set(p.id,normalizeText([p.name,p.sku,p.category,categoriesStr(p),p.vehicle,compatStr(p),p.locationBin].filter(Boolean).join(' '))));};
t('NEW: build haystacks (once per data change)',build,5);
const cands=tokens.map(expandToken);
const nw=t('NEW: one keystroke',()=>parts.filter(p=>{const h=hay.get(p.id);return cands.every(cs=>cs.some(c=>h.includes(c)));}),50);
console.log(`\n  → ${old.toFixed(2)} ms → ${nw.toFixed(2)} ms  (${(old/nw).toFixed(0)}× faster)\n`);
