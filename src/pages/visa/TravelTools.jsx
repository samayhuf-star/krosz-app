import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, ScanLine, ShieldCheck, CalendarCheck, FileSearch, FileArchive, Images, Files, ListChecks, IndianRupee, Globe2, WandSparkles, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import { inspectPassportImage } from '@/lib/passportImage';
import { inspectVisaPhoto } from '@/lib/visaPhoto';

/** @type {Array<[string, string, import('react').ComponentType<any>, string]>} */
const tools = [
  ['Visa Photo Checker','Check photo quality before you apply.',Camera,'photo'],
  ['Passport Scanner','Check whether your passport scan is clear enough to process.',ScanLine,'passport'],
  ['Passport Quality Check','Catch glare, blur, low resolution and framing issues.',ShieldCheck,'passport'],
  ['Passport Validity','Check expiry and destination validity requirements in your application.',CalendarCheck,'apply'],
  ['Document Scanner','Upload documents once and let Krosz organise them in your application.',FileSearch,'apply'],
  ['PDF Compressor','Prepare smaller files for visa portals.',FileArchive,'documents'],
  ['Image to PDF','Prepare document images for your visa file.',Images,'documents'],
  ['Merge & Split PDF','Organise multi-page supporting documents.',Files,'documents'],
  ['Visa Checklist','Get the checklist resolved for your destination and traveller.',ListChecks,'apply'],
  ['Visa Cost Calculator','See Krosz fee + government fee in ₹ before payment.',IndianRupee,'apply'],
  ['Where can I travel?','Explore destinations and entry routes for Indian passports.',Globe2,'destinations'],
  ['Fix My Visa Documents','Run your documents through the Krosz readiness flow.',WandSparkles,'apply'],
];

export default function TravelTools() {
  const [mode,setMode]=useState(''); const [result,setResult]=useState(null); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const title=useMemo(()=>mode==='photo'?'Visa Photo Checker':'Passport Scan Checker',[mode]);
  async function inspect(file){ if(!file)return; setBusy(true); setError(''); setResult(null); try { setResult(mode==='photo'?await inspectVisaPhoto(file):await inspectPassportImage(file)); } catch(e){ setError(e?.message||'Could not inspect this file.'); } finally{setBusy(false);} }
  const destination=(kind)=>kind==='apply'?'/apply':kind==='documents'?'/documents':kind==='destinations'?'/destinations':null;
  return <main className="min-h-screen bg-[#fffaf6] text-slate-950">
    <section className="mx-auto max-w-6xl px-5 pb-12 pt-16 sm:pt-24">
      <span className="rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-semibold text-orange-700">Free Krosz travel tools</span>
      <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Get visa-ready before you apply.</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">Simple checks for passports, photos and visa documents. No inflated AI claims — we show what can be checked automatically and route uncertain items to review.</p>
    </section>
    <section className="mx-auto grid max-w-6xl grid-cols-1 gap-3 px-5 pb-20 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map(([name,desc,Icon,kind])=>{ const href=destination(kind); const body=<><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Icon size={20}/></div><h2 className="mt-5 text-lg font-semibold">{name}</h2><p className="mt-2 min-h-10 text-sm leading-5 text-slate-500">{desc}</p><span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-orange-600">{kind==='photo'||kind==='passport'?'Check now':'Open'} <ArrowRight size={14}/></span></>;
        const cls='rounded-2xl border border-orange-100 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md';
        return href?<Link key={name} to={href} className={cls}>{body}</Link>:<button key={name} className={cls} onClick={()=>{setMode(kind);setResult(null);setError('');window.setTimeout(()=>document.getElementById('quick-check')?.scrollIntoView({behavior:'smooth'}),0)}}>{body}</button>})}
    </section>
    <section id="quick-check" className="border-y border-orange-100 bg-white">
      <div className="mx-auto max-w-3xl px-5 py-14">
        <h2 className="text-2xl font-semibold">{mode?title:'Quick document check'}</h2>
        <p className="mt-2 text-sm text-slate-500">Choose Visa Photo Checker or Passport Scanner above. Checks run locally in your browser where possible.</p>
        {mode&&<label className="mt-6 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50/40 p-6 text-center">
          <ScanLine className="text-orange-600"/><span className="mt-2 text-sm font-semibold">{busy?'Checking…':'Choose an image'}</span><span className="mt-1 text-xs text-slate-500">JPG or PNG</span><input type="file" accept="image/jpeg,image/png" disabled={busy} className="sr-only" onChange={e=>inspect(e.target.files?.[0])}/>
        </label>}
        {error&&<p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {result&&mode==='passport'&&<div className="mt-5 rounded-2xl border border-slate-200 p-5"><p className="flex items-center gap-2 font-semibold">{result.checks?.length?<AlertTriangle className="text-amber-500" size={18}/>:<CheckCircle2 className="text-emerald-600" size={18}/>} {result.checks?.length?'Needs attention':'Basic quality checks passed'}</p>{result.checks?.map(x=><p key={x.code} className="mt-2 text-sm text-slate-600">• {x.message}</p>)}</div>}
        {result&&mode==='photo'&&<div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 p-5 text-sm sm:grid-cols-4"><Metric k="Size" v={`${result.width}×${result.height}`}/><Metric k="Sharpness" v={`${Math.round((result.blur_score||0)*100)}%`}/><Metric k="Background" v={`${Math.round((result.background_uniformity||0)*100)}%`}/><Metric k="Face" v={result.face_count==null?'Needs review':String(result.face_count)}/><p className="col-span-full mt-2 text-xs text-slate-500">This is an image-quality pre-check. Final compliance depends on the verified photo policy for your destination.</p></div>}
      </div>
    </section>
  </main>
}
function Metric({k,v}){return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-400">{k}</p><p className="mt-1 font-semibold">{v}</p></div>}
