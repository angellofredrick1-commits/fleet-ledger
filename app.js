(function(){
"use strict";
const INCOME_CATS = ["Weekly hesabu","Corporate / private hire","Insurance payout","Other income"];
const EXPENSE_CATS = ["Service","Repair","Tyres","Accident","Traffic fine","Insurance","TRA / LATRA licence","Tracker","Fuel","Driver advance","Other expense"];
const DEFAULTS = {loanAmount:40000000, rate:0.14, years:7, startMonth:"2026-12", breakEven:219000, defaultTarget:350000};
const TABS = [["overview","Overview"],["vehicles","Vehicles"],["drivers","Drivers"],["entries","Earnings & expenses"],["loan","Loan"]];

const S = {
  vehicles:[], drivers:[], entries:[], settings:null,
  loaded:{vehicles:false,drivers:false,entries:false,settings:false},
  period: monthKey(new Date()), tab:"overview",
  sb:null, user:null, canWrite:true, downloads:true, status:"connecting", slow:false,
  filter:{vehicle:"",type:"",cat:""}, modal:null, authMode:"signin", authMsg:""
};

/* ---------- Supabase field mapping (app uses camelCase, database uses snake_case) ---------- */
const FIELDS = {
  vehicles:{plate:"plate",model:"model",year:"year",purchasePrice:"purchase_price",purchaseDate:"purchase_date",weeklyTarget:"weekly_target",status:"status",driverId:"driver_id",history:"history",notes:"notes",createdAt:"created_at"},
  drivers:{name:"name",phone:"phone",licenceNo:"licence_no",nida:"nida",deposit:"deposit",startDate:"start_date",status:"status",notes:"notes",createdAt:"created_at"},
  entries:{type:"type",category:"category",amount:"amount",date:"date",vehicleId:"vehicle_id",driverId:"driver_id",note:"note",distanceKm:"distance_km",createdAt:"created_at"},
  settings:{loanAmount:"loan_amount",rate:"rate",years:"years",startMonth:"start_month",breakEven:"break_even",defaultTarget:"default_target"}
};
const NUMERIC = new Set(["purchasePrice","weeklyTarget","deposit","amount","loanAmount","rate","years","breakEven","defaultTarget","distanceKm"]);
const NULLABLE = new Set(["driver_id","vehicle_id","purchase_date","start_date","distance_km"]);
function toRow(table,obj){
  const map=FIELDS[table],row={};
  for(const k in map){
    if(!(k in obj)||k==="createdAt")continue;
    let v=obj[k];
    if(NULLABLE.has(map[k])&&(v===""||v==null))v=null;
    row[map[k]]=v;
  }
  return row;
}
function fromRow(table,row){
  const map=FIELDS[table],obj={id:row.id};
  for(const k in map){
    let v=row[map[k]];
    if(v==null)v=(k==="history"?[]:"");
    if(k==="createdAt")v=row.created_at?Date.parse(row.created_at):0;
    if(NUMERIC.has(k)&&v!=="")v=Number(v);
    obj[k]=v;
  }
  return obj;
}

/* ---------- helpers ---------- */
function pad(n){return String(n).padStart(2,"0")}
function monthKey(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)}
function todayISO(){const d=new Date();return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
const NF = new Intl.NumberFormat("en-US",{maximumFractionDigits:0});
function tsh(n){n=Math.round(+n||0);return (n<0?"−":"")+"TSh "+NF.format(Math.abs(n))}
function compact(n){const a=Math.abs(n),s=n<0?"−":"";if(a>=1e6)return s+(a/1e6).toFixed(a>=1e7?1:2).replace(/\.?0+$/,"")+"M";if(a>=1e3)return s+Math.round(a/1e3)+"k";return s+Math.round(a)}
function num(v){const n=parseFloat(String(v).replace(/[, ]/g,""));return isFinite(n)?n:0}
// Reads money as people type it: "45000", "45,000", "TSh 45,000", "45.000", "45k", "1.2m"
function parseAmount(v){
  let s=String(v==null?"":v).toLowerCase().replace(/tsh|tzs|sh\.?|\s/g,"");
  let mult=1;
  if(/k$/.test(s)){mult=1e3;s=s.slice(0,-1)} else if(/m$/.test(s)){mult=1e6;s=s.slice(0,-1)}
  if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,"");   // 45.000 = forty-five thousand
  s=s.replace(/,/g,"");
  if(!/^\d*\.?\d+$/.test(s))return NaN;
  return parseFloat(s)*mult;
}
function cfg(){return Object.assign({},DEFAULTS,S.settings||{})}
function monthsBetween(a,b){const[ay,am]=a.split("-").map(Number),[by,bm]=b.split("-").map(Number);return (by-ay)*12+(bm-am)}
function addMonths(k,n){let[y,m]=k.split("-").map(Number);m+=n;y+=Math.floor((m-1)/12);m=((m-1)%12+12)%12+1;return y+"-"+pad(m)}
function monthLabel(k,short){const[y,m]=k.split("-").map(Number);return new Date(y,m-1,1).toLocaleDateString("en-GB",short?{month:"short"}:{month:"long",year:"numeric"})}
function fmtDate(iso){if(!iso)return "—";const[y,m,d]=iso.split("-").map(Number);return new Date(y,m-1,d).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
function daysSince(iso){if(!iso)return Infinity;const[y,m,d]=iso.split("-").map(Number);return Math.floor((Date.now()-new Date(y,m-1,d).getTime())/864e5)}
function vById(id){return S.vehicles.find(v=>v.id===id)}
function dById(id){return S.drivers.find(d=>d.id===id)}
function vName(id){const v=vById(id);return v?v.plate:"—"}
function dName(id){const d=dById(id);return d?d.name:"—"}
function inPeriod(date){return S.period==="all"||(date||"").startsWith(S.period)}
function hasExamples(){return [...S.vehicles,...S.drivers,...S.entries].some(x=>x.example)}

function pmt(){const c=cfg(),r=c.rate/12,n=c.years*12;if(!c.loanAmount||!n)return 0;return r?c.loanAmount*r/(1-Math.pow(1+r,-n)):c.loanAmount/n}
function loanMonthActive(k){const c=cfg();const i=monthsBetween(c.startMonth,k);return i>=0&&i<c.years*12}
function loanPaidCount(){const c=cfg();const i=monthsBetween(c.startMonth,monthKey(new Date()))+1;return Math.max(0,Math.min(c.years*12,i))}
function loanBalance(k){const c=cfg(),r=c.rate/12,P=c.loanAmount,p=pmt();if(!r)return Math.max(0,P-p*k);return Math.max(0,P*Math.pow(1+r,k)-p*(Math.pow(1+r,k)-1)/r)}
function loanForPeriod(){if(S.period!=="all")return loanMonthActive(S.period)?pmt():0;return loanPaidCount()*pmt()}

function weeksElapsed(){
  const now=new Date(),cur=monthKey(now);
  if(S.period==="all"){
    const dates=S.entries.map(e=>e.date).filter(Boolean).sort();
    if(!dates.length)return 0;
    return Math.max(1,(daysSince(dates[0])+1)/7);
  }
  if(S.period>cur)return 0;
  const[y,m]=S.period.split("-").map(Number);
  const days=S.period===cur?now.getDate():new Date(y,m,0).getDate();
  return days/7;
}
function sums(list){
  let inc=0,exp=0,hes=0,km=0,kmInc=0,fines=0,acc=0;const cats={};
  for(const e of list){const a=num(e.amount),d=num(e.distanceKm);
    if(e.type==="income"){inc+=a;if(e.category==="Weekly hesabu")hes+=a;if(d>0){km+=d;kmInc+=a}}
    else{exp+=a;cats[e.category]=(cats[e.category]||0)+a;if(e.category==="Traffic fine")fines++;if(e.category==="Accident")acc++}}
  return{inc,exp,hes,cats,km,kmInc,fines,acc,net:inc-exp};
}
// profit margin = profit / earnings; null when nothing was earned
function margin(profit,inc){return inc>0?profit/inc:null}
function pctTxt(m){return m==null?"—":(m<0?"−":"")+Math.abs(m*100).toFixed(1)+"%"}
function pctCls(m){return m==null?"muted":m<0?"neg":m<0.25?"warn-t":"pos"}
// earnings per km only counts collections that had a distance logged
function perKm(t){return t.km>0?t.kmInc/t.km:null}
function kmTxt(km){return km>0?NF.format(Math.round(km))+" km":"—"}
function lastKmHint(vid){
  if(!vid)return ".";
  const prev=S.entries.filter(e=>e.vehicleId===vid&&num(e.distanceKm)>0).sort(byDateDesc)[0];
  return prev?`. Last logged: ${NF.format(num(prev.distanceKm))} km on ${fmtDate(prev.date)}.`:".";
}
function lastHesabu(vid){let best="";for(const e of S.entries)if(e.vehicleId===vid&&e.type==="income"&&e.category==="Weekly hesabu"&&e.date>best)best=e.date;return best}
function activeVehicles(){return S.vehicles.filter(v=>v.status!=="inactive")}

/* ---------- toast ---------- */
let toastT;
function toast(msg){const t=document.getElementById("toast");t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,4500)}
function formError(form,msg,fieldId){
  if(!form||!form.isConnected){toast(msg);return}
  let el=form.querySelector(".form-error");
  if(!el){el=document.createElement("p");el.className="form-error";el.setAttribute("role","alert");form.insertBefore(el,form.firstChild)}
  el.textContent=msg;
  const f=fieldId&&document.getElementById(fieldId);
  if(f){f.setAttribute("aria-invalid","true");f.focus()}
  el.scrollIntoView({block:"nearest"});
}
let lastWriteError="";
window.addEventListener("error",e=>{toast("Something went wrong: "+((e.error&&e.error.message)||e.message||"unknown error"))});
window.addEventListener("unhandledrejection",e=>{const r=e.reason;toast("Something went wrong: "+((r&&r.message)||String(r)))});

/* ---------- data writes ---------- */
async function save(col,id,body){
  lastWriteError="";
  if(!S.sb||!S.user){lastWriteError="You're signed out. Sign in again to save.";toast(lastWriteError);return false}
  const row=toRow(col,body);row.id=id;
  let error;
  try{({error}=await S.sb.from(col).upsert(row))}catch(e){error=e}
  if(error){handleWriteError(error);return false}
  applyLocal(col,id,body);
  return true;
}
async function remove(col,id){
  if(!S.sb)return false;
  const {error}=await S.sb.from(col).delete().eq("id",id);
  if(error){handleWriteError(error);return false}
  S[col]=S[col].filter(x=>x.id!==id);
  if(col==="vehicles")S.entries.forEach(e=>{if(e.vehicleId===id)e.vehicleId=""});
  if(col==="drivers"){S.entries.forEach(e=>{if(e.driverId===id)e.driverId=""});S.vehicles.forEach(v=>{if(v.driverId===id)v.driverId=""})}
  render();return true;
}
function applyLocal(col,id,body){
  const i=S[col].findIndex(x=>x.id===id);
  const obj=Object.assign({id},i>=0?S[col][i]:{},body);
  if(i>=0)S[col][i]=obj;else S[col].push(obj);
  render();
}
function handleWriteError(e){
  const msg=(e&&(e.message||e.details))||"";
  let out;
  if(e&&e.code==="23505")out="That driver is already on another car. Remove them from it first.";
  else if(/JWT|auth|permission|row-level/i.test(msg))out="Your session has expired. Sign out, sign in again, and retry.";
  else if(/fetch|network/i.test(msg))out="Couldn't reach the server. Check your connection and try again.";
  else out="That change wasn't saved: "+msg.slice(0,120);
  lastWriteError=out;toast(out);
}
function newId(){return (crypto.randomUUID?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==="x"?r:(r&3|8)).toString(16)}))}
function clean(o){const r={};for(const k in o){if(o[k]!==undefined)r[k]=o[k]}return r}

async function releaseDriver(driverId,exceptVehicleId){
  // one driver per car: take this driver off any other car
  for(const v of S.vehicles){
    if(v.id!==exceptVehicleId&&v.driverId===driverId){
      const hist=(v.history||[]).slice();hist.push({driverId:"",from:todayISO()});
      const body=clean(Object.assign({},v,{driverId:"",history:hist}));delete body.id;
      await save("vehicles",v.id,body);
    }
  }
}
async function assignDriver(vehicleId,driverId){
  const today=todayISO();
  if(driverId)await releaseDriver(driverId,vehicleId);
  const v=vById(vehicleId);if(!v)return;
  if((v.driverId||"")===(driverId||""))return;
  const hist=(v.history||[]).slice();hist.push({driverId:driverId||"",from:today});
  const body=clean(Object.assign({},v,{driverId:driverId||"",history:hist}));delete body.id;
  await save("vehicles",v.id,body);
}

/* ---------- render: chrome ---------- */
function renderChrome(){
  const counts={vehicles:S.vehicles.length,drivers:S.drivers.length,entries:S.entries.length};
  document.getElementById("tabs").innerHTML=TABS.map(([k,l])=>`<button class="tab" type="button" data-act="tab" data-tab="${k}" ${S.tab===k?'aria-current="page"':""}>${l}${counts[k]!=null?`<span class="count">${counts[k]}</span>`:""}</button>`).join("");
  const pm=document.getElementById("periodMonth");
  if(document.activeElement!==pm)pm.value=S.period==="all"?"":S.period;
  const pa=document.getElementById("periodAll");
  pa.className="btn small"+(S.period==="all"?" primary":"");
  document.getElementById("quick").innerHTML=(S.canWrite&&S.user?
    `<button class="btn primary" type="button" data-act="new-entry" data-type="income">+ Record hesabu</button><button class="btn" type="button" data-act="new-entry" data-type="expense">+ Expense</button>`:"")+
    (S.user?`<button class="btn ghost small" type="button" data-act="sign-out" title="${esc(S.user.email||"")}">Sign out</button>`:"");
}

function render(){
  renderChrome();
  const app=document.getElementById("app");
  let html="";
  if(S.status==="offline"){
    html=`<div class="panel empty"><h2>The database isn't connected yet</h2><p>Add your Supabase project URL and publishable key to <code>config.js</code>, then redeploy. The README explains where to find them.</p></div>`;
    app.innerHTML=html;return;
  }
  if(S.sb&&!S.user){renderAuth();return}
  if(S.status==="error"){
    html+=`<div class="banner"><p><b>Your records couldn't be loaded.</b> Reload the page to try again.</p></div>`;
  } else if(S.slow&&!allLoaded()){
    html+=`<div class="banner"><p>Still connecting to your saved records. What you see may be out of date.</p></div>`;
  }
  if(!S.canWrite)html+=`<div class="banner"><p>You have view-only access to this ledger.</p></div>`;
  if(hasExamples()&&S.canWrite)html+=`<div class="banner"><p><b>Example data.</b> The cars, drivers and entries marked <span class="chip ex">Example</span> show how the ledger works. Clear them when you're ready to add your own.</p><button class="btn" type="button" data-act="clear-examples">Clear example data</button></div>`;
  if(!allLoaded()&&!S.vehicles.length&&!S.entries.length&&S.status!=="error"){
    html+=`<div class="panel empty"><h2>Loading your fleet…</h2><p>Cars, drivers, hesabu and expenses will appear here.</p></div>`;
    app.innerHTML=html;return;
  }
  const views={overview:viewOverview,vehicles:viewVehicles,drivers:viewDrivers,entries:viewEntries,loan:viewLoan};
  html+=views[S.tab]();
  app.innerHTML=html;
}
function allLoaded(){return Object.values(S.loaded).every(Boolean)}
function periodName(){return S.period==="all"?"all time":monthLabel(S.period)}

/* ---------- overview ---------- */
function viewOverview(){
  if(!S.vehicles.length&&!S.entries.length){
    return `<div class="panel empty"><h2>Start by adding your cars</h2><p>Register each vehicle and its driver, then record the weekly hesabu and any costs. The ledger works out profit after the loan.</p><div class="actions">${S.canWrite?`<button class="btn primary" type="button" data-act="new-vehicle">Add a vehicle</button><button class="btn" type="button" data-act="new-driver">Add a driver</button>`:""}</div></div>`;
  }
  const list=S.entries.filter(e=>inPeriod(e.date));
  const t=sums(list),loan=loanForPeriod(),net=t.inc-t.exp-loan;
  const cars=Math.max(1,activeVehicles().length),wks=weeksElapsed();
  const avg=wks>0?t.hes/(cars*wks):0,c=cfg();
  const target=activeVehicles().length?activeVehicles().reduce((a,v)=>a+(num(v.weeklyTarget)||c.defaultTarget),0)/activeVehicles().length:c.defaultTarget;

  const opMargin=margin(t.net,t.inc),netMargin=margin(net,t.inc),pk=perKm(t);
  const costKm=t.km>0?t.exp/t.km:null;

  let out=`<section class="kpis" aria-label="Summary for ${esc(periodName())}">
    <div class="kpi"><div class="eyebrow">Earnings</div><div class="v pos">${tsh(t.inc)}</div><div class="s">Hesabu ${tsh(t.hes)}</div></div>
    <div class="kpi"><div class="eyebrow">Expenses</div><div class="v neg">${tsh(t.exp)}</div><div class="s">${list.filter(e=>e.type==="expense").length} entries</div></div>
    <div class="kpi"><div class="eyebrow">Loan repayment</div><div class="v">${tsh(loan)}</div><div class="s">${S.period==="all"?loanPaidCount()+" months due so far":(loan?"Due this month":"Outside loan schedule")}</div></div>
    <div class="kpi net"><div class="eyebrow">Net profit</div><div class="v">${tsh(net)}</div><div class="s">${esc(periodName())}, after loan</div></div>
    <div class="kpi"><div class="eyebrow">Profit margin</div><div class="v ${pctCls(netMargin)}">${pctTxt(netMargin)}</div><div class="s">After loan. Before loan: <span class="${pctCls(opMargin)}">${pctTxt(opMargin)}</span></div></div>
    <div class="kpi"><div class="eyebrow">Distance covered</div><div class="v">${kmTxt(t.km)}</div><div class="s">${pk!=null?`${tsh(pk)} earned per km${costKm!=null?` · ${tsh(costKm)} cost per km`:""}`:"Add km from the GPS app when you record hesabu"}</div></div>
  </section>`;

  // hesabu gauge
  const scale=Math.max(target,c.breakEven,avg)*1.15||1;
  const pct=x=>Math.min(100,x/scale*100).toFixed(1);
  out+=`<section class="grid2">
   <div class="panel">
    <div class="panel-head"><h2>Hesabu per car, per week</h2><span class="num">${tsh(avg)}</span></div>
    <div class="gauge">
      <div class="gauge-track"><div class="gauge-fill ${avg<c.breakEven?"low":""}" style="width:${pct(avg)}%"></div>
        <div class="gauge-mark" style="left:${pct(c.breakEven)}%"><span>Break-even ${compact(c.breakEven)}</span></div>
        <div class="gauge-mark above" style="left:${pct(target)}%"><span>Target ${compact(target)}</span></div>
      </div><div class="gauge-labels"></div>
      <p class="status-line">${wks>0?`Average across ${activeVehicles().length} active car${activeVehicles().length===1?"":"s"} over ${wks.toFixed(1)} weeks. ${avg>=target?"On or above target.":avg>=c.breakEven?"Covering costs and loan, below target.":"Below break-even: the cars are not covering running costs and the loan."}`:"No weeks have passed in this period yet."}</p>
    </div>
   </div>
   <div class="panel"><div class="panel-head"><h2>Needs attention</h2></div>${alertsHTML()}</div>
  </section>`;

  out+=`<section class="grid2"><div class="panel"><div class="panel-head"><h2>Top drivers</h2><span class="muted">${esc(periodName())}</span></div>${topDrivers(list)}</div>
    <div class="panel"><div class="panel-head"><h2>Where the money went</h2><span class="muted">${esc(periodName())}</span></div>${catBars(t.cats)}</div></section>`;

  out+=`<section class="panel"><div class="panel-head"><h2>Last 12 months</h2><div class="legend"><span><i style="background:var(--good)"></i>Earnings</span><span><i style="background:var(--bad)"></i>Expenses</span><span><i style="background:var(--loan)"></i>Loan</span><span><i style="background:var(--accent);border-radius:50%"></i>Net</span></div></div><div class="chart-wrap">${chartSVG()}</div></section>`;

  out+=`<section class="panel"><div class="panel-head"><h2>By vehicle</h2><span class="muted">${esc(periodName())}</span></div>${vehicleTable(list)}</section>`;

  const recent=[...S.entries].sort(byDateDesc).slice(0,6);
  out+=`<section class="panel"><div class="panel-head"><h2>Recent entries</h2><button class="btn small ghost" type="button" data-act="tab" data-tab="entries">See all</button></div>${recent.length?`<div class="entry-list">${recent.map(entryRow).join("")}</div>`:`<p class="muted">No entries yet.</p>`}</section>`;
  return out;
}

// Ranks drivers by what they brought in minus costs logged against them (fines, accidents, repairs)
function driverStats(list){
  const by={};
  for(const e of list){if(!e.driverId)continue;(by[e.driverId]=by[e.driverId]||[]).push(e)}
  return Object.keys(by).filter(id=>dById(id)).map(id=>{const t=sums(by[id]);return{id,t,m:margin(t.net,t.inc),pk:perKm(t)}})
    .filter(r=>r.t.inc>0||r.t.exp>0).sort((a,b)=>b.t.net-a.t.net||b.t.hes-a.t.hes);
}
function topDrivers(list){
  const rows=driverStats(list);
  if(!rows.length)return `<p class="muted">No driver activity in this period yet. Rankings appear once you record hesabu.</p>`;
  const top=rows[0],car=S.vehicles.find(v=>v.driverId===top.id);
  let html=`<div class="top-driver">
    <div class="rank1" aria-hidden="true">1</div>
    <div style="min-width:0"><div class="eyebrow">Top driver</div><h3>${esc(dName(top.id))}</h3><div class="muted" style="font-size:.85rem">${car?esc(car.plate)+" · ":""}${top.t.fines||top.t.acc?`${top.t.fines} fine${top.t.fines===1?"":"s"}, ${top.t.acc} accident${top.t.acc===1?"":"s"}`:"No fines or accidents"}</div></div>
    <div class="top-figs"><div><span class="eyebrow">Brought in</span><span class="num pos">${compact(top.t.net)}</span></div><div><span class="eyebrow">Margin</span><span class="num ${pctCls(top.m)}">${pctTxt(top.m)}</span></div><div><span class="eyebrow">Distance</span><span class="num">${kmTxt(top.t.km)}</span></div></div>
  </div>`;
  if(rows.length>1)html+=`<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Driver</th><th class="r">Brought in</th><th class="r">Margin</th><th class="r">Km</th><th class="r">TSh/km</th></tr></thead><tbody>${rows.slice(0,5).map((r,i)=>`<tr><td class="num muted">${i+1}</td><td>${esc(dName(r.id))}${r.t.fines?` <span class="chip bad">${r.t.fines} fine${r.t.fines===1?"":"s"}</span>`:""}</td><td class="r num ${r.t.net>=0?"pos":"neg"}">${compact(r.t.net)}</td><td class="r num ${pctCls(r.m)}">${pctTxt(r.m)}</td><td class="r num">${r.t.km?NF.format(Math.round(r.t.km)):"—"}</td><td class="r num">${r.pk!=null?NF.format(Math.round(r.pk)):"—"}</td></tr>`).join("")}</tbody></table></div>`;
  html+=`<p class="status-line" style="margin:10px 0 0">Ranked by what each driver brought in after costs logged against them: fines, accidents and repairs.</p>`;
  return html;
}
function byDateDesc(a,b){return (b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)}

function alertsHTML(){
  const items=[];
  for(const v of activeVehicles()){
    if(v.status==="repair")items.push(["warn",`<b>${esc(v.plate)}</b> is in the garage and not earning.`]);
    if(!v.driverId)items.push(["warn",`<b>${esc(v.plate)}</b> has no driver assigned.`]);
    else if(v.status!=="repair"){
      const last=lastHesabu(v.id),d=daysSince(last);
      if(d>7)items.push(["bad",`<b>${esc(v.plate)}</b>: no hesabu from ${esc(dName(v.driverId))} ${last?`for ${d} days (last ${fmtDate(last)})`:"recorded yet"}.`]);
    }
  }
  const fines={};
  for(const e of S.entries)if(e.category==="Traffic fine"&&daysSince(e.date)<=30&&e.driverId)fines[e.driverId]=(fines[e.driverId]||0)+1;
  for(const id in fines)if(fines[id]>=2)items.push(["warn",`<b>${esc(dName(id))}</b> has ${fines[id]} traffic fines in the last 30 days.`]);
  for(const e of S.entries)if(e.category==="Accident"&&daysSince(e.date)<=14)items.push(["bad",`Accident on <b>${esc(vName(e.vehicleId))}</b>, ${fmtDate(e.date)}: ${tsh(e.amount)}. Check whether to claim on insurance.`]);
  if(!items.length)return `<p class="muted">All cars are paying and nothing is overdue.</p>`;
  return `<div class="alerts">${items.slice(0,6).map(([k,t])=>`<div class="alert ${k==="bad"?"bad":""}"><p>${t}</p></div>`).join("")}</div>`;
}

function vehicleTable(list){
  if(!S.vehicles.length)return `<p class="muted">No vehicles yet.</p>`;
  const c=cfg(),wks=weeksElapsed();
  const rows=S.vehicles.map(v=>{
    const t=sums(list.filter(e=>e.vehicleId===v.id)),m=margin(t.net,t.inc),pk=perKm(t);
    const expct=v.status==="active"&&v.driverId?(num(v.weeklyTarget)||c.defaultTarget)*wks:0;
    const gap=t.hes-expct;
    return `<tr><td><span class="plate">${esc(v.plate)}</span>${v.example?' <span class="chip ex">Example</span>':""}<div class="muted" style="font-size:.82rem;margin-top:3px">${esc(dName(v.driverId))}</div></td>
      <td class="r num pos">${compact(t.inc)}</td><td class="r num neg">${compact(t.exp)}</td>
      <td class="r num ${t.net>=0?"pos":"neg"}">${compact(t.net)}</td>
      <td class="r num ${pctCls(m)}">${pctTxt(m)}</td>
      <td class="r num">${t.km?NF.format(Math.round(t.km)):"—"}</td>
      <td class="r num">${pk!=null?NF.format(Math.round(pk)):"—"}</td>
      <td class="r num">${expct?`<span class="${gap>=0?"pos":"neg"}">${gap>=0?"+":""}${compact(gap)}</span>`:'<span class="muted">—</span>'}</td></tr>`;
  }).join("");
  return `<div class="tbl-wrap"><table><thead><tr><th>Car</th><th class="r">Earned</th><th class="r">Spent</th><th class="r">Net</th><th class="r">Margin</th><th class="r">Km</th><th class="r">TSh/km</th><th class="r" title="Hesabu collected minus weekly target for the weeks elapsed">vs target</th></tr></thead><tbody>${rows}</tbody></table></div><p class="status-line" style="margin:10px 0 0">Net and margin here are before the loan. TSh/km uses collections that have a GPS distance logged.</p>`;
}

function catBars(cats){
  const arr=Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  if(!arr.length)return `<p class="muted">No expenses in this period.</p>`;
  const max=arr[0][1];
  return `<div class="bars">${arr.map(([k,v])=>`<div class="bar-row"><span class="lbl">${esc(k)}</span><div class="track"><div class="fill" style="width:${(v/max*100).toFixed(1)}%"></div></div><span class="num">${compact(v)}</span></div>`).join("")}</div>`;
}

function chartSVG(){
  const end=S.period==="all"?monthKey(new Date()):S.period;
  const months=[];for(let i=11;i>=0;i--)months.push(addMonths(end,-i));
  const data=months.map(k=>{const t=sums(S.entries.filter(e=>(e.date||"").startsWith(k)));const loan=loanMonthActive(k)&&k<=monthKey(new Date())?pmt():0;return{k,inc:t.inc,exp:t.exp,loan,net:t.inc-t.exp-loan}});
  let max=Math.max(1,...data.map(d=>Math.max(d.inc,d.exp+d.loan,d.net)));
  let min=Math.min(0,...data.map(d=>d.net));
  const step=niceStep((max-min)/4);max=Math.ceil(max/step)*step;min=Math.floor(min/step)*step;
  const W=760,H=260,L=56,R=12,T=14,B=30,iw=W-L-R,ih=H-T-B;
  const y=v=>T+ih-(v-min)/(max-min)*ih;
  const bw=iw/12,barW=Math.min(18,bw*0.3);
  let g="";
  for(let v=min;v<=max+1e-6;v+=step){g+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1" ${v===0?'':'stroke-dasharray="2 4"'}/><text x="${L-8}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${compact(v)}</text>`}
  let bars="",pts=[];
  data.forEach((d,i)=>{
    const cx=L+bw*i+bw/2;
    if(d.inc)bars+=`<rect x="${cx-barW-1}" y="${y(d.inc)}" width="${barW}" height="${y(0)-y(d.inc)}" fill="var(--good)" rx="2"><title>${monthLabel(d.k)} earnings ${tsh(d.inc)}</title></rect>`;
    if(d.exp)bars+=`<rect x="${cx+1}" y="${y(d.exp)}" width="${barW}" height="${y(0)-y(d.exp)}" fill="var(--bad)" rx="2"><title>${monthLabel(d.k)} expenses ${tsh(d.exp)}</title></rect>`;
    if(d.loan)bars+=`<rect x="${cx+1}" y="${y(d.exp+d.loan)}" width="${barW}" height="${y(d.exp)-y(d.exp+d.loan)}" fill="var(--loan)" rx="2"><title>${monthLabel(d.k)} loan ${tsh(d.loan)}</title></rect>`;
    bars+=`<text x="${cx}" y="${H-10}" text-anchor="middle" font-size="11" fill="${d.k===end?"var(--ink)":"var(--muted)"}" font-weight="${d.k===end?700:400}">${monthLabel(d.k,true)}</text>`;
    pts.push([cx,y(d.net),d]);
  });
  const line=`<polyline points="${pts.map(p=>p[0]+","+p[1]).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  const dots=pts.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="${i===11?5:3}" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"><title>${monthLabel(p[2].k)} net ${tsh(p[2].net)}</title></circle>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly earnings, expenses, loan and net profit for the last 12 months">${g}${bars}${line}${dots}</svg>`;
}
function niceStep(raw){if(raw<=0)return 1;const p=Math.pow(10,Math.floor(Math.log10(raw))),f=raw/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p}

/* ---------- vehicles ---------- */
function statusChip(s){return s==="active"?'<span class="chip good">On the road</span>':s==="repair"?'<span class="chip warn">In garage</span>':'<span class="chip">Inactive</span>'}
function viewVehicles(){
  const head=`<div class="panel-head" style="margin:0"><h2>Vehicles</h2>${S.canWrite?'<button class="btn primary" type="button" data-act="new-vehicle">+ Add vehicle</button>':""}</div>`;
  if(!S.vehicles.length)return head+`<div class="panel empty"><h2>No vehicles yet</h2><p>Add each car with its plate, purchase price and weekly hesabu target.</p></div>`;
  const list=S.entries.filter(e=>inPeriod(e.date)),c=cfg();
  return head+`<div class="cards">${[...S.vehicles].sort((a,b)=>(a.plate||"").localeCompare(b.plate||"")).map(v=>{
    const t=sums(list.filter(e=>e.vehicleId===v.id)),all=sums(S.entries.filter(e=>e.vehicleId===v.id));
    const last=lastHesabu(v.id);
    return `<article class="card">
      <div class="card-head"><span class="plate" style="font-size:1.05rem">${esc(v.plate)}</span><span>${v.example?'<span class="chip ex">Example</span> ':""}${statusChip(v.status)}</span></div>
      <dl class="kv">
        <dt>Model</dt><dd>${esc([v.model,v.year].filter(Boolean).join(", ")||"—")}</dd>
        <dt>Driver</dt><dd>${v.driverId?esc(dName(v.driverId)):'<span class="neg">None assigned</span>'}</dd>
        <dt>Weekly target</dt><dd class="num">${tsh(num(v.weeklyTarget)||c.defaultTarget)}</dd>
        <dt>Last hesabu</dt><dd>${last?fmtDate(last)+` <span class="muted">(${daysSince(last)}d ago)</span>`:"—"}</dd>
        <dt>Bought</dt><dd>${v.purchasePrice?`<span class="num">${tsh(v.purchasePrice)}</span>`:"—"}${v.purchaseDate?", "+fmtDate(v.purchaseDate):""}</dd>
      </dl>
      <div class="mini"><div><span class="eyebrow">Earned</span><span class="num pos">${compact(t.inc)}</span></div><div><span class="eyebrow">Spent</span><span class="num neg">${compact(t.exp)}</span></div><div><span class="eyebrow">Net</span><span class="num ${t.net>=0?"pos":"neg"}">${compact(t.net)}</span></div><div><span class="eyebrow">Margin</span><span class="num ${pctCls(margin(t.net,t.inc))}">${pctTxt(margin(t.net,t.inc))}</span></div><div><span class="eyebrow">Distance</span><span class="num">${kmTxt(t.km)}</span></div><div><span class="eyebrow">TSh/km</span><span class="num">${perKm(t)!=null?NF.format(Math.round(perKm(t))):"—"}</span></div></div>
      <p class="status-line" style="margin:-4px 0 0">${esc(periodName())}. All time: net <span class="num">${tsh(all.net)}</span>, margin <span class="num">${pctTxt(margin(all.net,all.inc))}</span>, ${kmTxt(all.km)}.</p>
      ${v.notes?`<p class="muted" style="margin:0;font-size:.88rem">${esc(v.notes)}</p>`:""}
      ${S.canWrite?`<div class="actions"><button class="btn small primary" type="button" data-act="new-entry" data-type="income" data-vehicle="${v.id}">+ Hesabu</button><button class="btn small" type="button" data-act="new-entry" data-type="expense" data-vehicle="${v.id}">+ Expense</button><button class="btn small ghost" type="button" data-act="edit-vehicle" data-id="${v.id}">Edit</button></div>`:""}
    </article>`}).join("")}</div>`;
}

/* ---------- drivers ---------- */
function viewDrivers(){
  const head=`<div class="panel-head" style="margin:0"><h2>Drivers</h2>${S.canWrite?'<button class="btn primary" type="button" data-act="new-driver">+ Add driver</button>':""}</div>`;
  if(!S.drivers.length)return head+`<div class="panel empty"><h2>No drivers yet</h2><p>Add each driver's phone, licence and deposit, then assign them to a car.</p></div>`;
  return head+`<div class="cards">${[...S.drivers].sort((a,b)=>(a.status==="inactive")-(b.status==="inactive")||(a.name||"").localeCompare(b.name||"")).map(d=>{
    const car=S.vehicles.find(v=>v.driverId===d.id);
    const mine=S.entries.filter(e=>e.driverId===d.id);
    const paid=mine.filter(e=>e.type==="income"&&e.category==="Weekly hesabu").reduce((a,e)=>a+num(e.amount),0);
    const fines=mine.filter(e=>e.category==="Traffic fine"),acc=mine.filter(e=>e.category==="Accident");
    const dt=sums(mine),dm=margin(dt.net,dt.inc),rank=driverStats(S.entries.filter(e=>inPeriod(e.date))).findIndex(r=>r.id===d.id);
    const last=mine.filter(e=>e.category==="Weekly hesabu").map(e=>e.date).sort().pop();
    return `<article class="card">
      <div class="card-head"><h3>${esc(d.name)}</h3><span>${rank===0?'<span class="chip top">Top driver</span> ':""}${d.example?'<span class="chip ex">Example</span> ':""}${d.status==="inactive"?'<span class="chip">Former driver</span>':car?'<span class="chip good">Driving</span>':'<span class="chip warn">No car</span>'}</span></div>
      <dl class="kv">
        <dt>Car</dt><dd>${car?`<span class="plate">${esc(car.plate)}</span>`:"—"}</dd>
        <dt>Phone</dt><dd>${d.phone?`<span class="num" style="user-select:all">${esc(d.phone)}</span> <button class="btn small ghost" type="button" data-act="copy" data-text="${esc(d.phone)}" aria-label="Copy phone number">Copy</button>`:"—"}</dd>
        <dt>Licence no.</dt><dd>${esc(d.licenceNo||"—")}</dd>
        <dt>Deposit held</dt><dd class="num">${d.deposit?tsh(d.deposit):"—"}</dd>
        <dt>Started</dt><dd>${fmtDate(d.startDate)}</dd>
      </dl>
      <div class="mini"><div><span class="eyebrow">Hesabu paid</span><span class="num pos">${compact(paid)}</span></div><div><span class="eyebrow">Brought in</span><span class="num ${dt.net>=0?"pos":"neg"}">${compact(dt.net)}</span></div><div><span class="eyebrow">Margin</span><span class="num ${pctCls(dm)}">${pctTxt(dm)}</span></div><div><span class="eyebrow">Distance</span><span class="num">${kmTxt(dt.km)}</span></div><div><span class="eyebrow">Fines</span><span class="num ${fines.length?"neg":""}">${fines.length}</span></div><div><span class="eyebrow">Accidents</span><span class="num ${acc.length?"neg":""}">${acc.length}</span></div></div>
      <p class="status-line" style="margin:-4px 0 0">Last hesabu: ${last?fmtDate(last):"none yet"}. All time.</p>
      ${d.notes?`<p class="muted" style="margin:0;font-size:.88rem">${esc(d.notes)}</p>`:""}
      ${S.canWrite?`<div class="actions"><button class="btn small" type="button" data-act="edit-driver" data-id="${d.id}">Update driver</button></div>`:""}
    </article>`}).join("")}</div>`;
}

/* ---------- entries ---------- */
function entryRow(e){
  const inc=e.type==="income";
  return `<div class="entry"><span class="date">${fmtDate(e.date)}</span>
    <div class="what"><span class="chip ${inc?"good":e.category==="Accident"||e.category==="Traffic fine"?"bad":""}">${esc(e.category)}</span> ${e.vehicleId?`<span class="plate" style="font-size:.8rem">${esc(vName(e.vehicleId))}</span>`:""} ${e.driverId?`<span class="muted" style="font-size:.85rem">${esc(dName(e.driverId))}</span>`:""}${num(e.distanceKm)>0?` <span class="km">${NF.format(num(e.distanceKm))} km</span>`:""}${e.example?' <span class="chip ex">Example</span>':""}${e.note?`<div class="note">${esc(e.note)}</div>`:""}</div>
    <span class="amt ${inc?"pos":"neg"}">${inc?"+":"−"}${NF.format(num(e.amount))}</span>
    <span class="ops">${S.canWrite?`<button class="btn small ghost" type="button" data-act="edit-entry" data-id="${e.id}">Edit</button><button class="btn small ghost" type="button" data-act="ask-delete" data-kind="entries" data-id="${e.id}" aria-label="Delete entry">Delete</button>`:""}</span></div>`;
}
function filteredEntries(){
  const f=S.filter;
  return S.entries.filter(e=>inPeriod(e.date)&&(!f.vehicle||e.vehicleId===f.vehicle)&&(!f.type||e.type===f.type)&&(!f.cat||e.category===f.cat)).sort(byDateDesc);
}
function viewEntries(){
  const f=S.filter,list=filteredEntries(),t=sums(list);
  const cats=f.type==="income"?INCOME_CATS:f.type==="expense"?EXPENSE_CATS:[...INCOME_CATS,...EXPENSE_CATS];
  return `<div class="panel-head" style="margin:0"><h2>Earnings &amp; expenses</h2><div class="actions">${S.downloads&&list.length?'<button class="btn" type="button" data-act="export">Export CSV</button>':""}${S.canWrite?'<button class="btn primary" type="button" data-act="new-entry" data-type="expense">+ Add entry</button>':""}</div></div>
  <section class="panel">
    <div class="filters" style="margin-bottom:12px">
      <select id="fVehicle" data-filter="vehicle" aria-label="Filter by vehicle"><option value="">All vehicles</option>${S.vehicles.map(v=>`<option value="${v.id}" ${f.vehicle===v.id?"selected":""}>${esc(v.plate)}</option>`).join("")}</select>
      <select id="fType" data-filter="type" aria-label="Filter by type"><option value="">Earnings and expenses</option><option value="income" ${f.type==="income"?"selected":""}>Earnings only</option><option value="expense" ${f.type==="expense"?"selected":""}>Expenses only</option></select>
      <select id="fCat" data-filter="cat" aria-label="Filter by category"><option value="">All categories</option>${cats.map(c=>`<option ${f.cat===c?"selected":""}>${esc(c)}</option>`).join("")}</select>
    </div>
    <p class="status-line" style="margin:0 0 6px">${list.length} entries, ${esc(periodName())}. Earned <span class="num pos">${tsh(t.inc)}</span>, spent <span class="num neg">${tsh(t.exp)}</span>.</p>
    ${list.length?`<div class="entry-list">${list.map(entryRow).join("")}</div>`:`<div class="empty"><p>No entries match. Change the period or filters, or record a hesabu payment.</p></div>`}
  </section>`;
}

/* ---------- loan ---------- */
function viewLoan(){
  const c=cfg(),p=pmt(),n=c.years*12,paid=loanPaidCount(),bal=loanBalance(paid);
  const totalInt=p*n-c.loanAmount;
  const allNet=sums(S.entries);
  return `<div class="loan-grid">
   <section class="panel">
    <div class="panel-head"><h2>Loan status</h2><span class="muted">as of ${fmtDate(todayISO())}</span></div>
    <dl class="kv" style="font-size:.95rem">
      <dt>Monthly repayment</dt><dd class="num">${tsh(p)}</dd>
      <dt>Repayments due so far</dt><dd class="num">${paid} of ${n}</dd>
      <dt>Remaining balance</dt><dd class="num">${tsh(bal)}</dd>
      <dt>Total interest over the loan</dt><dd class="num">${tsh(totalInt)}</dd>
      <dt>Final repayment</dt><dd>${monthLabel(addMonths(c.startMonth,n-1))}</dd>
    </dl>
    <div style="margin-top:14px" class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${paid}" aria-label="Repayments made"><div style="width:${(paid/n*100).toFixed(1)}%"></div></div>
    <p class="status-line">Cars have earned <span class="num">${tsh(allNet.inc-allNet.exp)}</span> after expenses so far, against <span class="num">${tsh(paid*p)}</span> of repayments due.</p>
   </section>
   <section class="panel">
    <div class="panel-head"><h2>Loan and targets</h2></div>
    <form id="loanForm" class="fields" novalidate>
      <div class="field"><label for="lAmount">Loan amount (TSh)</label><input id="lAmount" name="loanAmount" inputmode="numeric" value="${c.loanAmount}" ${S.canWrite?"":"disabled"}></div>
      <div class="field"><label for="lRate">Interest rate (% per year)</label><input id="lRate" name="rate" inputmode="decimal" value="${+(c.rate*100).toFixed(3)}" ${S.canWrite?"":"disabled"}></div>
      <div class="field"><label for="lYears">Term (years)</label><input id="lYears" name="years" inputmode="numeric" value="${c.years}" ${S.canWrite?"":"disabled"}></div>
      <div class="field"><label for="lStart">First repayment month</label><input id="lStart" name="startMonth" type="month" value="${c.startMonth}" ${S.canWrite?"":"disabled"}></div>
      <div class="field"><label for="lBE">Break-even hesabu per car / week</label><input id="lBE" name="breakEven" inputmode="numeric" value="${c.breakEven}" ${S.canWrite?"":"disabled"}><span class="hint">From your business plan: about 219,000</span></div>
      <div class="field"><label for="lTarget">Default weekly target per car</label><input id="lTarget" name="defaultTarget" inputmode="numeric" value="${c.defaultTarget}" ${S.canWrite?"":"disabled"}></div>
      ${S.canWrite?`<div class="field full"><button class="btn primary" type="submit">Save loan settings</button></div>`:""}
    </form>
   </section></div>`;
}

/* ---------- modals ---------- */
function openModal(m){S.modal=m;renderModal();setTimeout(()=>{const f=document.querySelector("#modal input:not([type=hidden]),#modal select");if(f)f.focus()},30)}
function closeModal(){S.modal=null;document.getElementById("modal").innerHTML=""}
function sheet(title,body){return `<div class="overlay" data-act="overlay"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><div class="sheet-head"><h2 id="sheetTitle">${title}</h2><button class="btn small ghost" type="button" data-act="close" aria-label="Close">Close</button></div>${body}</div></div>`}
function opt(val,label,sel){return `<option value="${esc(val)}" ${sel?"selected":""}>${esc(label)}</option>`}

function renderModal(){
  const m=S.modal,el=document.getElementById("modal");
  if(!m){el.innerHTML="";return}
  const c=cfg();
  if(m.kind==="vehicle"){
    const v=m.id?vById(m.id)||{}:{status:"active",weeklyTarget:c.defaultTarget};
    const drivers=S.drivers.filter(d=>d.status!=="inactive");
    el.innerHTML=sheet(m.id?"Edit vehicle":"Add vehicle",`<form id="vehicleForm" novalidate>
      <div class="fields">
        <div class="field"><label for="vPlate">Plate number</label><input id="vPlate" name="plate" required placeholder="T 123 ABC" value="${esc(v.plate||"")}" autocapitalize="characters"></div>
        <div class="field"><label for="vStatus">Status</label><select id="vStatus" name="status">${opt("active","On the road",v.status==="active")}${opt("repair","In garage",v.status==="repair")}${opt("inactive","Inactive / sold",v.status==="inactive")}</select></div>
        <div class="field"><label for="vModel">Make & model</label><input id="vModel" name="model" placeholder="Toyota IST" value="${esc(v.model||"")}"></div>
        <div class="field"><label for="vYear">Year</label><input id="vYear" name="year" inputmode="numeric" placeholder="2007" value="${esc(v.year||"")}"></div>
        <div class="field"><label for="vPrice">Purchase price (TSh)</label><input id="vPrice" name="purchasePrice" inputmode="numeric" value="${esc(v.purchasePrice||"")}"></div>
        <div class="field"><label for="vDate">Purchase date</label><input id="vDate" name="purchaseDate" type="date" value="${esc(v.purchaseDate||"")}"></div>
        <div class="field"><label for="vTarget">Weekly hesabu target (TSh)</label><input id="vTarget" name="weeklyTarget" inputmode="numeric" value="${esc(v.weeklyTarget||c.defaultTarget)}"></div>
        <div class="field"><label for="vDriver">Driver</label><select id="vDriver" name="driverId">${opt("","No driver",!v.driverId)}${drivers.map(d=>{const other=S.vehicles.find(x=>x.driverId===d.id&&x.id!==v.id);return opt(d.id,d.name+(other?` (now on ${other.plate})`:""),v.driverId===d.id)}).join("")}</select><span class="hint">Choosing a driver who is on another car moves them here.</span></div>
        <div class="field full"><label for="vNotes">Notes</label><textarea id="vNotes" name="notes" placeholder="Chassis no., insurance policy, tracker ID…">${esc(v.notes||"")}</textarea></div>
      </div>
      ${m.id&&(v.history||[]).length?`<div><div class="eyebrow" style="margin-bottom:6px">Driver history</div><ul class="history">${[...v.history].reverse().map(h=>`<li><span class="num muted">${fmtDate(h.from)}</span> — ${h.driverId?esc(dName(h.driverId)):"No driver"}</li>`).join("")}</ul></div>`:""}
      <div class="sheet-foot">${m.id?`<button class="btn danger" type="button" data-act="ask-delete" data-kind="vehicles" data-id="${m.id}" style="margin-right:auto">Delete</button>`:""}<button class="btn" type="button" data-act="close">Cancel</button><button class="btn primary" type="submit">${m.id?"Save changes":"Add vehicle"}</button></div>
    </form>`);
  } else if(m.kind==="driver"){
    const d=m.id?dById(m.id)||{}:{status:"active",startDate:todayISO()};
    const car=m.id?S.vehicles.find(v=>v.driverId===m.id):null;
    el.innerHTML=sheet(m.id?"Update driver":"Add driver",`<form id="driverForm" novalidate>
      <div class="fields">
        <div class="field full"><label for="dName">Full name</label><input id="dName" name="name" required value="${esc(d.name||"")}"></div>
        <div class="field"><label for="dPhone">Phone</label><input id="dPhone" name="phone" type="tel" placeholder="0712 345 678" value="${esc(d.phone||"")}"></div>
        <div class="field"><label for="dLic">Driving licence no.</label><input id="dLic" name="licenceNo" value="${esc(d.licenceNo||"")}"></div>
        <div class="field"><label for="dNida">NIDA no.</label><input id="dNida" name="nida" value="${esc(d.nida||"")}"></div>
        <div class="field"><label for="dDep">Deposit held (TSh)</label><input id="dDep" name="deposit" inputmode="numeric" value="${esc(d.deposit||"")}"></div>
        <div class="field"><label for="dStart">Start date</label><input id="dStart" name="startDate" type="date" value="${esc(d.startDate||"")}"></div>
        <div class="field"><label for="dStatus">Status</label><select id="dStatus" name="status">${opt("active","Active",d.status!=="inactive")}${opt("inactive","Former driver",d.status==="inactive")}</select></div>
        <div class="field full"><label for="dCar">Assigned car</label><select id="dCar" name="vehicleId">${opt("","No car",!car)}${S.vehicles.filter(v=>v.status!=="inactive").map(v=>opt(v.id,v.plate+(v.driverId&&v.driverId!==m.id?` (replaces ${dName(v.driverId)})`:""),car&&car.id===v.id)).join("")}</select><span class="hint">Setting a driver to "Former driver" releases their car.</span></div>
        <div class="field full"><label for="dNotes">Notes</label><textarea id="dNotes" name="notes" placeholder="Guarantor, contract terms, next of kin…">${esc(d.notes||"")}</textarea></div>
      </div>
      <div class="sheet-foot">${m.id?`<button class="btn danger" type="button" data-act="ask-delete" data-kind="drivers" data-id="${m.id}" style="margin-right:auto">Delete</button>`:""}<button class="btn" type="button" data-act="close">Cancel</button><button class="btn primary" type="submit">${m.id?"Save changes":"Add driver"}</button></div>
    </form>`);
  } else if(m.kind==="entry"){
    const e=m.id?S.entries.find(x=>x.id===m.id)||{}:{type:m.type||"income",date:todayISO(),vehicleId:m.vehicle||(S.vehicles.length===1?S.vehicles[0].id:"")};
    if(!m.id&&e.vehicleId){const v=vById(e.vehicleId);e.driverId=v?v.driverId:"";if(e.type==="income"){e.amount=v?(num(v.weeklyTarget)||c.defaultTarget):""}}
    if(!m.id)e.category=e.type==="income"?"Weekly hesabu":"Repair";
    const type=m.curType||e.type;
    const cats=type==="income"?INCOME_CATS:EXPENSE_CATS;
    el.innerHTML=sheet(m.id?"Edit entry":type==="income"?"Record earnings":"Record expense",`<form id="entryForm" novalidate>
      <div class="seg" role="group" aria-label="Entry type"><button type="button" class="in" data-act="etype" data-type="income" aria-pressed="${type==="income"}">Earnings</button><button type="button" class="out" data-act="etype" data-type="expense" aria-pressed="${type==="expense"}">Expense</button></div>
      <input type="hidden" name="type" value="${type}">
      <div class="fields">
        <div class="field"><label for="eCat">Category</label><select id="eCat" name="category">${cats.map(k=>opt(k,k,k===e.category)).join("")}</select></div>
        <div class="field"><label for="eAmt">Amount (TSh)</label><input id="eAmt" name="amount" inputmode="numeric" required value="${esc(e.amount||"")}"></div>
        <div class="field"><label for="eDate">Date</label><input id="eDate" name="date" type="date" required value="${esc(e.date||todayISO())}"></div>
        <div class="field"><label for="eVeh">Vehicle</label><select id="eVeh" name="vehicleId">${opt("","Whole business",!e.vehicleId)}${S.vehicles.map(v=>opt(v.id,v.plate,v.id===e.vehicleId)).join("")}</select></div>
        <div class="field full"><label for="eDrv">Driver</label><select id="eDrv" name="driverId">${opt("","None",!e.driverId)}${S.drivers.map(d=>opt(d.id,d.name,d.id===e.driverId)).join("")}</select><span class="hint">Filled in from the car's current driver. Change it if someone else was driving.</span></div>
        ${type==="income"?`<div class="field full"><label for="eKm">Distance since last collection (km)</label><input id="eKm" name="distanceKm" inputmode="decimal" placeholder="e.g. 1240" value="${esc(e.distanceKm||"")}"><span class="hint" id="eKmHint">Read it from the GPS tracking app for this car${lastKmHint(e.vehicleId)}</span></div>`:""}
        <div class="field full"><label for="eNote">Note</label><textarea id="eNote" name="note" placeholder="${type==="income"?"Week of 3–9 Nov, paid by M-Pesa":"Garage, police ref., insurance claim no.…"}">${esc(e.note||"")}</textarea></div>
      </div>
      <div class="sheet-foot"><button class="btn" type="button" data-act="close">Cancel</button><button class="btn primary" type="submit">${m.id?"Save changes":"Save entry"}</button></div>
    </form>`);
  } else if(m.kind==="confirm"){
    el.innerHTML=sheet(esc(m.title),`<form id="confirmForm"><p style="margin:0">${m.text}</p><div class="sheet-foot"><button class="btn" type="button" data-act="close">Keep it</button><button class="btn danger" type="submit">${esc(m.yes)}</button></div></form>`);
  }
}
function formData(form){const o={};new FormData(form).forEach((v,k)=>o[k]=typeof v==="string"?v.trim():v);return o}

/* ---------- events ---------- */
document.addEventListener("click",async ev=>{
  const b=ev.target.closest("[data-act]");if(!b)return;
  const act=b.dataset.act;
  if(act==="overlay"&&ev.target!==b)return;
  switch(act){
    case "tab":S.tab=b.dataset.tab;try{history.replaceState(null,"","#"+S.tab)}catch(e){location.hash=S.tab}render();window.scrollTo({top:0});break;
    case "period-all":S.period=S.period==="all"?monthKey(new Date()):"all";render();break;
    case "new-entry":if(!S.vehicles.length&&b.dataset.type==="income"){toast("Add a vehicle first.");openModal({kind:"vehicle"});break}openModal({kind:"entry",type:b.dataset.type,vehicle:b.dataset.vehicle||""});break;
    case "edit-entry":openModal({kind:"entry",id:b.dataset.id});break;
    case "new-vehicle":openModal({kind:"vehicle"});break;
    case "edit-vehicle":openModal({kind:"vehicle",id:b.dataset.id});break;
    case "new-driver":openModal({kind:"driver"});break;
    case "edit-driver":openModal({kind:"driver",id:b.dataset.id});break;
    case "close":case "overlay":closeModal();break;
    case "etype":{
      const form=document.getElementById("entryForm");const keep=formData(form);
      S.modal.curType=b.dataset.type;renderModal();
      const f=document.getElementById("entryForm");
      for(const k of ["amount","date","vehicleId","driverId","note","distanceKm"])if(f.elements[k]&&keep[k]!=null)f.elements[k].value=keep[k];
      if(b.dataset.type==="income")f.elements.category.value="Weekly hesabu";
      break;}
    case "ask-delete":{
      const kind=b.dataset.kind,id=b.dataset.id;
      let title="Delete entry",text="This entry will be removed from your totals. This can't be undone.";
      if(kind==="vehicles"){const v=vById(id);const n=S.entries.filter(e=>e.vehicleId===id).length;title="Delete vehicle";text=`Delete <b>${esc(v&&v.plate)}</b>? Its ${n} entries stay in your totals but will show no car. To keep its history, set it to "Inactive / sold" instead.`}
      if(kind==="drivers"){const d=dById(id);title="Delete driver";text=`Delete <b>${esc(d&&d.name)}</b>? Their past entries stay but will show no driver. To keep their record, set them to "Former driver" instead.`}
      openModal({kind:"confirm",title,text,yes:"Delete",action:{type:"delete",col:kind,id}});break;}
    case "clear-examples":{
      const n=[...S.vehicles,...S.drivers,...S.entries].filter(x=>x.example).length;
      openModal({kind:"confirm",title:"Clear example data",text:`Remove the ${n} example records? Anything you added yourself stays.`,yes:"Clear examples",action:{type:"clear"}});break;}
    case "copy":{const t=b.dataset.text;try{await navigator.clipboard.writeText(t);toast("Copied "+t)}catch(e){toast("Select the number to copy it")}break;}
    case "export":exportCSV();break;
  }
});
document.addEventListener("change",ev=>{
  const t=ev.target;
  if(t.id==="periodMonth"){if(t.value){S.period=t.value;render()}return}
  if(t.dataset&&t.dataset.filter){S.filter[t.dataset.filter]=t.value;if(t.dataset.filter==="type")S.filter.cat="";render();return}
  if(t.id==="eVeh"){const kh=document.getElementById("eKmHint");if(kh)kh.textContent="Read it from the GPS tracking app for this car"+lastKmHint(t.value);const v=vById(t.value);const drv=document.getElementById("eDrv");if(drv)drv.value=v&&v.driverId?v.driverId:"";
    const amt=document.getElementById("eAmt"),cat=document.getElementById("eCat");if(v&&amt&&!amt.value&&cat&&cat.value==="Weekly hesabu")amt.value=num(v.weeklyTarget)||cfg().defaultTarget}
});
document.addEventListener("keydown",ev=>{if(ev.key==="Escape"&&S.modal)closeModal()});
window.addEventListener("hashchange",()=>{const h=location.hash.slice(1);if(TABS.some(t=>t[0]===h)&&h!==S.tab){S.tab=h;render()}});

document.addEventListener("submit",async ev=>{
  ev.preventDefault();
  const form=ev.target;const btn=form.querySelector('[type="submit"]');
  if(btn&&btn.disabled)return;
  const old=form.querySelector(".form-error");if(old)old.remove();
  form.querySelectorAll("[aria-invalid]").forEach(x=>x.removeAttribute("aria-invalid"));
  const label=btn?btn.textContent:"";
  const go=async fn=>{
    if(btn){btn.disabled=true;btn.textContent="Saving…"}
    try{await fn()}
    catch(e){console.error(e);formError(form,"Couldn't save: "+((e&&e.message)||e)+". Please tell us this message if it keeps happening.")}
    finally{if(btn&&btn.isConnected){btn.disabled=false;btn.textContent=label}}
  };
  if(form.id==="vehicleForm")await go(async()=>{
    const o=formData(form);if(!o.plate){toast("Enter the plate number.");return}
    const id=S.modal.id||newId("vehicles");const prev=vById(id)||{};
    const changed=(o.driverId||"")!==(prev.driverId||"");
    const history=(prev.history||[]).slice();if(changed)history.push({driverId:o.driverId||"",from:todayISO()});
    const body=clean({plate:o.plate.toUpperCase(),model:o.model,year:o.year,purchasePrice:num(o.purchasePrice)||0,purchaseDate:o.purchaseDate,weeklyTarget:num(o.weeklyTarget)||cfg().defaultTarget,status:o.status,driverId:o.driverId||"",history,notes:o.notes,example:prev.example||undefined,createdAt:prev.createdAt||Date.now()});
    if(changed&&o.driverId)await releaseDriver(o.driverId,id);
    if(!(await save("vehicles",id,body))){formError(form,lastWriteError||"The vehicle wasn't saved. Try again.");return}
    closeModal();toast(prev.plate?"Vehicle saved":"Vehicle added");
  });
  else if(form.id==="driverForm")await go(async()=>{
    const o=formData(form);if(!o.name){toast("Enter the driver's name.");return}
    const id=S.modal.id||newId("drivers");const prev=dById(id)||{};
    const body=clean({name:o.name,phone:o.phone,licenceNo:o.licenceNo,nida:o.nida,deposit:num(o.deposit)||0,startDate:o.startDate,status:o.status,notes:o.notes,example:prev.example||undefined,createdAt:prev.createdAt||Date.now()});
    if(!(await save("drivers",id,body))){formError(form,lastWriteError||"The driver wasn't saved. Try again.");return}
    const cur=S.vehicles.find(v=>v.driverId===id);
    const want=o.status==="inactive"?"":o.vehicleId;
    if((cur?cur.id:"")!==want){
      if(want)await assignDriver(want,id); else if(cur)await assignDriver(cur.id,"");
    }
    closeModal();toast(prev.name?"Driver updated":"Driver added");
  });
  else if(form.id==="entryForm")await go(async()=>{
    const o=formData(form);const amt=parseAmount(o.amount);
    if(!o.amount){formError(form,"Enter the amount in TSh, for example 45000.","eAmt");return}
    if(!(amt>0)){formError(form,`"${o.amount}" isn't an amount we can read. Type digits only, for example 45000 or 45,000.`,"eAmt");return}
    if(!o.date){formError(form,"Choose the date of this entry.","eDate");return}
    const id=S.modal.id||newId("entries");const prev=S.entries.find(x=>x.id===id)||{};
    let km="";
    if(o.type==="income"&&o.distanceKm){km=parseAmount(o.distanceKm);if(!(km>=0)){formError(form,"Enter the distance as a number of km, for example 1240.","eKm");return}}
    const body=clean({type:o.type,category:o.category,amount:amt,date:o.date,vehicleId:o.vehicleId||"",driverId:o.driverId||"",note:o.note,distanceKm:km,example:prev.example||undefined,createdAt:prev.createdAt||Date.now()});
    if(!(await save("entries",id,body))){formError(form,lastWriteError||"That entry wasn't saved. Try again.");return}
    closeModal();toast(o.type==="income"?`Earnings of ${tsh(amt)} recorded`:`Expense of ${tsh(amt)} recorded`);
  });
  else if(form.id==="loanForm")await go(async()=>{
    const o=formData(form);
    const body={loanAmount:num(o.loanAmount),rate:num(o.rate)/100,years:Math.max(1,Math.round(num(o.years))),startMonth:o.startMonth||DEFAULTS.startMonth,breakEven:num(o.breakEven),defaultTarget:num(o.defaultTarget)||DEFAULTS.defaultTarget};
    const row=toRow("settings",body);row.owner_id=S.user.id;
    const {error}=await S.sb.from("settings").upsert(row);
    if(error){handleWriteError(error);return}
    S.settings=body;render();toast("Loan settings saved");
  });
  else if(form.id==="confirmForm")await go(async()=>{
    const a=S.modal.action;
    if(a.type==="delete"){
      if(a.col==="drivers"){const car=S.vehicles.find(v=>v.driverId===a.id);if(car)await assignDriver(car.id,"")}
      if(await remove(a.col,a.id)){closeModal();toast("Deleted")}
    } else if(a.type==="clear"){
      for(const col of ["entries","vehicles","drivers"])for(const x of S[col].filter(x=>x.example))await remove(col,x.id);
      closeModal();toast("Example data cleared");
    }
  });
});

async function exportCSV(){
  if(!S.downloads)return;
  const rows=[["Date","Type","Category","Amount (TSh)","Distance (km)","Vehicle","Driver","Note"]];
  for(const e of filteredEntries())rows.push([e.date,e.type==="income"?"Earnings":"Expense",e.category,num(e.amount),num(e.distanceKm)||"",vName(e.vehicleId),dName(e.driverId),e.note||""]);
  const csv=rows.map(r=>r.map(v=>{v=String(v==null?"":v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}).join(",")).join("\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  const a=document.createElement("a");a.href=url;a.download=`fleet-entries-${S.period}.csv`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/* ---------- auth ---------- */
function renderAuth(){
  document.getElementById("tabs").innerHTML="";
  document.getElementById("quick").innerHTML="";
  const up=S.authMode==="signup";
  document.getElementById("app").innerHTML=`<section class="panel auth">
    <h2>${up?"Create your account":"Sign in to your fleet"}</h2>
    <p class="muted" style="margin:0">${up?"Use an email you can open. You'll get a link to confirm it.":"Your cars, drivers and entries are saved to your account."}</p>
    <form id="authForm" class="fields" style="grid-template-columns:minmax(0,1fr)" novalidate>
      <div class="field"><label for="aEmail">Email</label><input id="aEmail" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="aPass">Password</label><input id="aPass" name="password" type="password" autocomplete="${up?"new-password":"current-password"}" minlength="8" required>${up?'<span class="hint">At least 8 characters</span>':""}</div>
      ${S.authMsg?`<p class="status-line" role="status" style="margin:0">${esc(S.authMsg)}</p>`:""}
      <button class="btn primary" type="submit">${up?"Create account":"Sign in"}</button>
      <button class="btn ghost" type="button" data-act="auth-mode">${up?"I already have an account":"New here? Create an account"}</button>
    </form></section>`;
}
document.addEventListener("submit",async ev=>{
  if(ev.target.id!=="authForm")return;
  ev.preventDefault();
  const o=formData(ev.target);const btn=ev.target.querySelector('[type="submit"]');
  if(!o.email||!o.password){S.authMsg="Enter your email and password.";renderAuth();return}
  btn.disabled=true;
  const fn=S.authMode==="signup"?S.sb.auth.signUp({email:o.email,password:o.password,options:{emailRedirectTo:location.origin}}):S.sb.auth.signInWithPassword({email:o.email,password:o.password});
  const {data,error}=await fn;
  btn.disabled=false;
  if(error){S.authMsg=error.message;renderAuth();return}
  if(S.authMode==="signup"&&!data.session){S.authMsg="Check your email for a confirmation link, then come back and sign in.";S.authMode="signin";renderAuth()}
});
document.addEventListener("click",async ev=>{
  const b=ev.target.closest("[data-act]");if(!b)return;
  if(b.dataset.act==="auth-mode"){S.authMode=S.authMode==="signup"?"signin":"signup";S.authMsg="";renderAuth()}
  if(b.dataset.act==="sign-out"){await S.sb.auth.signOut()}
});

async function loadAll(){
  const timer=setTimeout(()=>{S.slow=true;render()},10000);
  const [v,d,e,s]=await Promise.all([
    S.sb.from("vehicles").select("*"),
    S.sb.from("drivers").select("*"),
    S.sb.from("entries").select("*").order("date",{ascending:false}),
    S.sb.from("settings").select("*").eq("owner_id",S.user.id).maybeSingle()
  ]);
  clearTimeout(timer);S.slow=false;
  const err=v.error||d.error||e.error||s.error;
  if(err){S.status="error";console.error(err);render();return}
  S.vehicles=v.data.map(r=>fromRow("vehicles",r));
  S.drivers=d.data.map(r=>fromRow("drivers",r));
  S.entries=e.data.map(r=>fromRow("entries",r));
  S.settings=s.data?fromRow("settings",s.data):null;
  if(S.settings)delete S.settings.id;
  S.loaded={vehicles:true,drivers:true,entries:true,settings:true};
  S.status="ok";render();
}

/* ---------- boot ---------- */
async function init(){
  const h=location.hash.slice(1);if(TABS.some(t=>t[0]===h))S.tab=h;
  const cfgv=window.FLEET_CONFIG||{};
  if(!window.supabase||!cfgv.supabaseUrl||!cfgv.supabaseKey||/YOUR_/.test(cfgv.supabaseUrl)){
    S.status="offline";render();return;
  }
  S.sb=window.supabase.createClient(cfgv.supabaseUrl,cfgv.supabaseKey);
  const {data}=await S.sb.auth.getSession();
  S.sb.auth.onAuthStateChange((event,session)=>{
    const was=S.user&&S.user.id;S.user=session?session.user:null;
    if(!S.user){S.vehicles=[];S.drivers=[];S.entries=[];S.settings=null;S.loaded={vehicles:false,drivers:false,entries:false,settings:false};closeModal();renderAuth();return}
    if(S.user.id!==was){S.status="connecting";render();loadAll()}
  });
  S.user=data.session?data.session.user:null;
  if(!S.user){renderAuth();return}
  render();loadAll();
}
init();
})();
