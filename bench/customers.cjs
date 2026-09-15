// Customers search: invoicesOf(c) runs a REGEX over every invoice, per customer, per keystroke.
const N_CUST = 200, N_JOBS = 1400, N_INV = 1129;
const customers = Array.from({length:N_CUST},(_,i)=>({id:`c${i}`,name:`Cust ${i}`,phone:`98${10000000+i}`,code:`C${i}`,vehicles:[{regNo:`AP${i}`,model:'Swift'}]}));
const jobCards = Array.from({length:N_JOBS},(_,i)=>({jobNo:`J${i}`,phone:customers[i%N_CUST].phone}));
const invoices = Array.from({length:N_INV},(_,i)=>({invNo:`INV-${i}`,customerId:customers[i%N_CUST].id,phone:customers[i%N_CUST].phone}));

const cardsOf=(c)=>jobCards.filter((j)=>(j.phone||'').replace(/\D/g,'')===(c.phone||'').replace(/\D/g,''));
const invoicesOf=(c)=>invoices.filter((iv)=>iv.customerId===c.id||(iv.phone||'').replace(/\D/g,'')===(c.phone||'').replace(/\D/g,''));

const oldFilter=(ql)=>customers.filter((c)=>{
  const jobNos=cardsOf(c).map((j)=>j.jobNo);
  const invNos=invoicesOf(c).map((iv)=>iv.invNo);
  return [c.name,c.code,c.phone,...(c.vehicles||[]).flatMap((v)=>[v.regNo,v.model]),...jobNos,...invNos].filter(Boolean).join(' ').toLowerCase().includes(ql);
});

const t=(l,f,n=1)=>{f();const a=process.hrtime.bigint();for(let i=0;i<n;i++)f();const b=process.hrtime.bigint();const ms=Number(b-a)/1e6/n;console.log(`  ${l.padEnd(46)} ${ms.toFixed(2)} ms`);return ms;};
console.log(`\nCustomers: ${N_CUST} customers · ${N_JOBS} job cards · ${N_INV} invoices\n`);
const o=t('OLD: one keystroke (no debounce at all)',()=>oldFilter('swift'),5);

// indexed + precomputed haystack
const byId=new Map(), byPhone=new Map();
const norm=(p)=>String(p||'').replace(/\D/g,'');
jobCards.forEach(j=>{const k=norm(j.phone);if(!byPhone.has(k))byPhone.set(k,[]);byPhone.get(k).push(j);});
invoices.forEach(iv=>{const k=iv.customerId;if(!byId.has(k))byId.set(k,[]);byId.get(k).push(iv);});
const hay=new Map();
const build=()=>{hay.clear();customers.forEach(c=>{const jn=(byPhone.get(norm(c.phone))||[]).map(j=>j.jobNo);const iv=(byId.get(c.id)||[]).map(x=>x.invNo);hay.set(c.id,[c.name,c.code,c.phone,...(c.vehicles||[]).flatMap(v=>[v.regNo,v.model]),...jn,...iv].filter(Boolean).join(' ').toLowerCase());});};
t('NEW: build index + haystacks (once per data change)',build);
const n=t('NEW: one keystroke',()=>customers.filter(c=>hay.get(c.id).includes('swift')),50);
console.log(`\n  → ${o.toFixed(2)} ms  →  ${n.toFixed(2)} ms   (${(o/n).toFixed(0)}× faster)\n`);
