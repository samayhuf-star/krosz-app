import * as m from './base44/shared/visa/review/contract.ts';
const fn=Object.values(m).find((x:any)=>typeof x==='function' && /^run.*ContractTests$/.test(x.name)) as any;
const r:any=await fn(); console.log(JSON.stringify({suite:'review',pass:r?.pass,total:r?.total,passed:r?.passed,failed:r?.failed||r?.results?.filter((x:any)=>x.pass===false)},null,2)); if(r?.pass===false) process.exit(1);
