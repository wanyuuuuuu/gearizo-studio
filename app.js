/* Gearizo content studio: app logic (moved from the claude.ai artifact). */
(function(){
"use strict";
const SERIES=[
  {id:"garage",name:"Garage Notes",c:"#125F4E"},
  {id:"trend",name:"Trend",c:"#EC4E8E"},
  {id:"product",name:"Product",c:"#2AA198"},
  {id:"graphic",name:"Graphic",c:"#8C6BD1"},
  {id:"festival",name:"Festival",c:"#F0883E"}
];
const STATUSES=[
  {id:"idea",name:"Idea"},{id:"script",name:"Scripting"},{id:"shoot",name:"Shooting"},
  {id:"edit",name:"Editing"},{id:"review",name:"In review"},{id:"changes",name:"Needs changes"},
  {id:"approved",name:"Approved"},{id:"scheduled",name:"Scheduled"},{id:"posted",name:"Posted"}
];
const PLATFORMS=[
  {id:"reel",name:"IG Reel",s:"Reel"},{id:"carousel",name:"IG Carousel",s:"Carousel"},{id:"story",name:"IG Story",s:"Story"},
  {id:"tiktok",name:"TikTok",s:"TikTok"},{id:"fb",name:"Facebook",s:"FB"},{id:"shop",name:"Shopee / Lazada",s:"Shop"},
  {id:"shopee",name:"Shopee",s:"Shopee"},{id:"lazada",name:"Lazada",s:"Lazada"},{id:"web",name:"Website",s:"Website"}
];
const LANGS=[{id:"en",name:"English"},{id:"manglish",name:"Manglish"},{id:"bm",name:"BM"},{id:"zh",name:"中文"}];
const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const CACHE_KEY="gearizo-plan-cache-v1";
const sMap=Object.fromEntries(SERIES.map(s=>[s.id,s]));
const SHOP_P=["shopee","lazada","web"];                       // E-commerce works on these, not social
/* E-commerce sees fewer, plainer stages */
const EC_PIPE=[{id:"req",name:"Requested",sts:["idea","script","shoot"],k:"var(--ink-3)"},{id:"making",name:"Making",sts:["edit","changes"],k:"var(--edit)"},
  {id:"review",name:"To review",sts:["review"],k:"var(--review)"},{id:"ready",name:"Approved",sts:["approved","scheduled"],k:"var(--ready)"},{id:"live",name:"Live",sts:["posted"],k:"var(--pink)"}];
const stMap=Object.fromEntries(STATUSES.map(s=>[s.id,s]));
const pMap=Object.fromEntries(PLATFORMS.map(s=>[s.id,s]));

const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const pad=n=>String(n).padStart(2,"0");
const ymd=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const shortDate=s=>{const d=parse(s);return d.getDate()+" "+MONTHS[d.getMonth()].slice(0,3)};
const fmtTime=ms=>{const d=new Date(ms);let h=d.getHours();const ap=h>=12?"pm":"am";h=h%12||12;return d.getDate()+" "+MONTHS[d.getMonth()].slice(0,3)+", "+h+":"+pad(d.getMinutes())+" "+ap};
const newId=()=>"i"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);

let items=new Map(), versions=[], feedback=[], focus=[];
let db=null, assets=null, userNs=null, myId=null, amOwner=false, names={}, myName="";
let mode="local", readOnly=false, live={items:false,focus:false,team:false};
let team={}, promptedRole=false, inbox=[], tasks=[], shoots=[], avail=[], busy=[], jobs={}, metaState=null;
const AUTO_P=["reel","fb"];
const ROLES={content:{name:"Content & video",k:"var(--blue)"},marketing:{name:"Marketing",k:"var(--mk)"},ecomm:{name:"E-commerce",k:"#E8772E"},hr:{name:"HR",k:"#8C6BD1"}};
const TEAMS={marketing:"Marketing",ecomm:"E-commerce"};
const SIZES=[{id:"sq",name:"Square 1:1 (product)",s:"1:1"},{id:"post",name:"Post 4:5",s:"4:5"},{id:"story",name:"Story 9:16",s:"9:16"},{id:"banner",name:"Banner 16:9",s:"16:9"},{id:"wide",name:"Wide banner 3:1",s:"3:1"},{id:"thumb",name:"Thumbnail 1280×720",s:"Thumbnail"}];
const sizeName=id=>(SIZES.find(x=>x.id===id)||{}).name||id;
/* Owner preview: see the app as another role (read only); raw holds the real data */
let previewRole="", realRO=null, teamF="";
const raw={items:null,versions:null,feedback:null,tasks:null,focus:null,inbox:null};
const myRole=()=>previewRole||(myId&&team[myId])||"";
/* isMk = a requesting team that reviews and approves (Marketing or E-commerce) */
const isMk=()=>["marketing","ecomm"].includes(myRole()), isCr=()=>myRole()==="content", isHr=()=>myRole()==="hr", isEc=()=>myRole()==="ecomm";
let focusRO=false, selId=null, nShow=20, vOpenFor=null;
const NOTIF_KEY="gearizo-notif-read-v1";
function saveRead(s){ try{localStorage.setItem(NOTIF_KEY,JSON.stringify({floor:s.floor,ids:[...s.ids].slice(-400)}))}catch(e){} }
let nRead=(()=>{
  try{ const r=JSON.parse(localStorage.getItem(NOTIF_KEY)||"null"); if(r&&r.floor) return {floor:Number(r.floor)||0,ids:new Set(Array.isArray(r.ids)?r.ids:[])} }catch(e){}
  const s={floor:Date.now(),ids:new Set()}; saveRead(s); return s;
})();
const VIEWS=["home","calendar","review","pipeline","tasks","shoots"];
function hashView(){ const h=location.hash.slice(1), i=h.indexOf("/"), v=i<0?h:h.slice(0,i); return {v:VIEWS.includes(v)?v:"home",a:i<0?"":decodeURIComponent(h.slice(i+1))} }
let view=hashView().v, wantSel=hashView().v==="review"&&hashView().a||null;
const now=new Date(); const todayStr=ymd(now);
let cursor=new Date(now.getFullYear(),now.getMonth(),1);
let filters=new Set();
let editingId=null, editingProduct="", dlgTab="plan";
const narrow=window.matchMedia("(max-width: 720px)");

function normalize(id,d){
  d=d||{};
  let st=d.status==="ready"?"approved":d.status;
  return {id,
    title:String(d.title||"Untitled"),
    series:sMap[d.series]?d.series:"garage",
    status:stMap[st]?st:"idea",
    platforms:Array.isArray(d.platforms)?d.platforms.filter(p=>pMap[p]):[],
    langs:Array.isArray(d.langs)?d.langs.filter(l=>LANGS.some(x=>x.id===l)):[],
    date:typeof d.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d.date)?d.date:"",
    due:typeof d.due==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d.due)?d.due:"",
    product:String(d.product||""),
    kind:d.kind==="ai"||d.kind==="real"?d.kind:"",
    team:d.team==="ecomm"?"ecomm":"marketing",
    type:d.type==="design"?"design":"video",
    sizes:Array.isArray(d.sizes)?d.sizes.filter(x=>typeof x==="string").slice(0,12):[],
    sizeNote:String(d.sizeNote||"").slice(0,300),
    refs:normFiles(d.refs),
    notes:String(d.notes||""),
    caption:String(d.caption||""),
    approvedBy:String(d.approvedBy||""), approvedAt:Number(d.approvedAt)||0, postedAt:Number(d.postedAt)||0, postedBy:String(d.postedBy||""),
    submittedBy:String(d.submittedBy||""), submittedAt:Number(d.submittedAt)||0, submittedV:Number(d.submittedV)||0,
    changesBy:String(d.changesBy||""), changesAt:Number(d.changesAt)||0,
    postAt:Number(d.postAt)||0, scheduledBy:String(d.scheduledBy||""), scheduledAt:Number(d.scheduledAt)||0, remindedAt:Number(d.remindedAt)||0,
    postUrl:/^https?:\/\//i.test(String(d.postUrl||""))?String(d.postUrl).slice(0,500):"",
    createdBy:String(d.createdBy||""), created:Number(d.created)||0,
    code:/^GZ\d{3,5}$/.test(String(d.code||""))?String(d.code):""};
}
/* Each item gets a short code (GZ001, GZ002…) to put in video file names */
const codeNum=c=>{ const m=/^GZ(\d+)$/.exec(c||""); return m?Number(m[1]):0 };
function nextCode(){ let max=0; items.forEach(i=>{ max=Math.max(max,codeNum(i.code)) }); return "GZ"+String(max+1).padStart(3,"0") }
const fileSafe=t=>String(t||"").replace(/[\/\\:*?"<>|]+/g,"-").replace(/\s+/g," ").trim().slice(0,60);
const STAMP_KEYS=["approvedBy","approvedAt","postedAt","postedBy","submittedBy","submittedAt","submittedV","changesBy","changesAt","postAt","scheduledBy","scheduledAt","remindedAt","postUrl"];
/* Who moved an item into a status, and when. Feeds the notifications. */
function stamp(st,id){
  const t=Date.now(), me=myId||"";
  if(st==="review"){ const l=vFor(id)[0]; return {submittedBy:me,submittedAt:t,submittedV:l?l.n:0} }
  if(st==="changes") return {changesBy:me,changesAt:t};
  if(st==="approved") return {approvedBy:me,approvedAt:t};
  if(st==="scheduled") return {scheduledBy:me,scheduledAt:t};
  if(st==="posted") return {postedBy:me,postedAt:t};
  return {};
}
function loadCache(){ try{const raw=localStorage.getItem(CACHE_KEY); if(!raw) return; items=new Map(JSON.parse(raw).map(x=>[x.id,normalize(x.id,x)]))}catch(e){} }
function saveCache(){ try{localStorage.setItem(CACHE_KEY,JSON.stringify([...items.values()]))}catch(e){} }

let toastT;
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),3000)}
function setNote(){ $("saveNote").textContent=readOnly?"View only":mode==="db"?"Live":(items.size===0?"Sign in to see the plan":"This device only") }
function who(id){ if(!id) return "Someone"; if(id==="auto") return "Auto-post"; if(id===myId) return "You"; return names[id]||"Someone" }

const vFor=id=>versions.filter(v=>v.item===id).sort((a,b)=>b.n-a.n);
const fbFor=id=>feedback.filter(f=>f.item===id).sort((a,b)=>a.at-b.at);
function visible(it){ return (filters.size===0||filters.has(it.series))&&(!teamF||it.team===teamF) }
function sorted(list){ return list.sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999")||a.created-b.created) }

const stLabel=it=>it.status==="scheduled"&&it.postAt?"Scheduled "+hm(it.postAt):it.status==="posted"&&it.team==="ecomm"?"Live":stMap[it.status].name;
function chip(it,showDate,extra){
  const s=sMap[it.series];
  const meta=[];
  if(it.code) meta.push(it.code);
  if(it.type==="design") meta.push("Design");
  if(showDate&&it.date) meta.push(shortDate(it.date));
  if(view!=="pipeline") meta.push(stLabel(it)); else if(it.status==="scheduled"&&it.postAt) meta.push(hm(it.postAt));
  if(!showDate&&view==="calendar"){ const vs0=vFor(it.id); const open0=fbFor(it.id).filter(f=>!f.done).length;
    return '<button class="chip s-'+it.status+(it.status==="posted"?" posted":"")+(extra||"")+'" draggable="'+(!readOnly)+'" data-id="'+esc(it.id)+'" style="--c:'+s.c+'" title="'+esc(s.name+(it.code?" · "+it.code:""))+'">'+
      '<span class="t">'+esc(it.title)+'</span><span class="m">'+esc((isCr()&&it.team==="ecomm"?"E-com · ":"")+(it.type==="design"?"Design · ":"")+stLabel(it))+'</span>'+(open0?'<span class="flag">'+open0+' to fix</span>':"")+'</button>'; }
  const vs=vFor(it.id); if(vs.length) meta.push("v"+vs[0].n);
  if(it.due&&["idea","script","shoot","edit","changes"].includes(it.status)) meta.push("Due "+shortDate(it.due));

  const open=fbFor(it.id).filter(f=>!f.done).length;
  return '<button class="chip s-'+it.status+(it.status==="posted"?" posted":"")+(extra||"")+'" draggable="'+(!readOnly)+'" data-id="'+esc(it.id)+'" style="--c:'+s.c+'" title="'+esc(s.name)+'">'+
    '<span class="t">'+esc(it.title)+'</span><span class="m">'+esc(meta.join(", "))+(open?' <span class="flag">'+open+' to fix</span>':"")+'</span></button>';
}

function renderFilters(){
  const f=$("filters"); f.classList.toggle("dim",filters.size>0);
  f.innerHTML=SERIES.map(s=>'<button class="fchip" data-series="'+s.id+'" style="--c:'+s.c+'" aria-pressed="'+filters.has(s.id)+'">'+esc(s.name)+'</button>').join("");
}
const stat=(n,label,hot)=>'<span class="stat'+(hot?" hot":"")+'"><b>'+n+'</b>'+esc(label)+'</span>';
function renderHeader(){
  const all=[...items.values()].filter(visible);
  const waiting=[...items.values()].filter(i=>i.status==="review").length;
  const mine=isCr()?[...items.values()].filter(i=>i.status==="changes").length+inbox.length:waiting;
  $("revBadge").hidden=!mine; $("revBadge").textContent=mine;
  $("vRev").title=isCr()?"Review: "+mine+" need changes or a home":"Review: "+waiting+" waiting for approval";
  const r=myRole();
  $("roleBtn").hidden=mode!=="db"||!myId||!live.team;
  $("roleBtn").textContent=r?ROLES[r].name:"Role";
  $("roleBtn").style.setProperty("--k",r?ROLES[r].k:"var(--ink-3)");
  $("newBtn").textContent=isMk()?"Request":"New";
  /* Each role has its own cat: the round one for content, the tabby for marketing */
  const catSrc=isMk()?"cat-mk.png":"cat.png", ci=$("catImg");
  if(ci.getAttribute("src")!==catSrc){ ci.setAttribute("src",catSrc); ci.width=isMk()?203:188; ci.height=240; $("cat").classList.toggle("mk",isMk()) }
  const isCal=view==="calendar", isHome=view==="home";
  $("kicker").hidden=!isHome;
  if(isHome){ const d=new Date(); $("kicker").textContent=DOW_LONG[d.getDay()]+", "+d.getDate()+" "+MONTHS[d.getMonth()] }
  $("monthLabel").textContent=isHome?(myName?"Hi, "+myName.split(/\s+/)[0]:"Hi there"):isCal?MONTHS[cursor.getMonth()]+" "+cursor.getFullYear():view==="review"?"Review":view==="tasks"?"Tasks":view==="shoots"?"Shoots":"Pipeline";
  if(isHome){ $("stats").innerHTML="" }
  else if(isCal){
    const prefix=cursor.getFullYear()+"-"+pad(cursor.getMonth()+1);
    const inMonth=all.filter(i=>i.date.startsWith(prefix));
    const posted=inMonth.filter(i=>i.status==="posted").length;
    const nodate=all.filter(i=>!i.date).length;
    $("stats").innerHTML=stat(inMonth.length,"planned")+stat(waiting,isEc()?"to review":"in review",waiting>0)+stat(posted,isEc()?"live":"posted")+(nodate?stat(nodate,"no date"):"");
  }else if(view==="review"){
    const ch=all.filter(i=>i.status==="changes"||(isEc()&&i.status==="edit")).length, ap=all.filter(i=>i.status==="approved"||(isEc()&&i.status==="scheduled")).length;
    $("stats").innerHTML=stat(waiting,isEc()?"to review":"to approve",waiting>0)+stat(ch,"being fixed")+stat(ap,isEc()?"approved":"ready to post");
  }else if(view==="shoots"){
    const now=Date.now(), mine=isHr()?shoots.filter(x=>x.talent.includes(myId)):shoots;
    const ask=mine.filter(x=>x.status==="proposed"&&x.end>now).length, conf=mine.filter(x=>x.status==="confirmed"&&x.end>now).length, no=mine.filter(x=>x.status==="declined"&&x.end>now).length;
    $("stats").innerHTML=stat(ask,isHr()?"to confirm":"waiting for reply",ask>0&&isHr())+stat(conf,"confirmed")+(no?stat(no,"can’t make it",!isHr()):"");
  }else if(view==="tasks"){
    const r0=myRole(), mineT=tasks.filter(t=>!r0||t.for===r0), openT=mineT.filter(t=>!t.done), lateT=openT.filter(t=>t.due&&t.due<todayStr);
    $("stats").innerHTML=stat(openT.length,r0?"open for you":"open",openT.length>0)+stat(lateT.length,"overdue",lateT.length>0)+stat(tasks.filter(t=>t.done).length,"done");
  }else{
    $("stats").innerHTML=isEc()?stat(all.filter(i=>["idea","script","shoot"].includes(i.status)).length,"requested")+stat(all.filter(i=>["edit","changes"].includes(i.status)).length,"making")
      :stat(all.filter(i=>!["idea","posted"].includes(i.status)).length,"in production")+stat(all.filter(i=>i.status==="idea").length,"ideas");
  }
  $("prev").hidden=$("next").hidden=$("todayBtn").hidden=!isCal;
  $("vHome").setAttribute("aria-pressed",isHome); $("vCal").setAttribute("aria-pressed",isCal); $("vRev").setAttribute("aria-pressed",view==="review"); $("vPipe").setAttribute("aria-pressed",view==="pipeline"); $("vTask").setAttribute("aria-pressed",view==="tasks"); $("vShoot").setAttribute("aria-pressed",view==="shoots");
  $("newBtn").hidden=readOnly||isHr();
  $("teamFilter").hidden=!isCr()||view==="tasks"||view==="shoots"||isHome;
  $("teamFilter").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.t===teamF));
  $("pvBar").hidden=!previewRole; if(previewRole) $("pvRole").textContent=ROLES[previewRole].name;
}
function stCls(list){
  list=list||[];
  if(list.some(i=>i.status==="edit"||i.status==="changes")) return " st-edit";
  if(list.some(i=>i.status==="review")) return " st-review";
  if(list.some(i=>["approved","scheduled"].includes(i.status))) return " st-ready";
  return "";
}
const LEGEND='<div class="legend"><span><i style="--k:var(--edit)"></i>Editing or needs changes</span><span><i style="--k:var(--review)"></i>In review</span><span><i style="--k:var(--ready)"></i>Approved, ready to post</span></div>';

function renderCalendar(){
  const y=cursor.getFullYear(), m=cursor.getMonth();
  const offset=(new Date(y,m,1).getDay()+6)%7, dim=new Date(y,m+1,0).getDate(), weeks=Math.ceil((offset+dim)/7);
  const byDate={};
  sorted([...items.values()].filter(visible)).forEach(it=>{ if(it.date){(byDate[it.date]=byDate[it.date]||[]).push(it)} });
  let html;
  if(narrow.matches){
    html=LEGEND+'<div class="agenda">'; let any=false;
    for(let d=1;d<=dim;d++){
      const dt=new Date(y,m,d), ds=ymd(dt), list=byDate[ds]||[];
      if(!list.length&&ds!==todayStr) continue; any=true;
      html+='<section class="aday'+(ds===todayStr?" today":"")+stCls(list)+'"><h3><span>'+d+' '+MONTHS[m].slice(0,3)+'</span><small>'+DOW[(dt.getDay()+6)%7]+(ds===todayStr?", today":"")+'</small></h3><div class="list">'+
        (list.length||shootChips(ds)?list.map(i=>chip(i)).join("")+shootChips(ds):'<div class="empty">Nothing planned today.</div>')+'</div></section>';
    }
    if(!any) html+='<div class="empty">Nothing scheduled this month. Tap New item to add one.</div>';
    html+='</div>';
  }else{
    html=LEGEND+'<div class="grid" role="grid">'+DOW.map(d=>'<div class="dow">'+d+'</div>').join("");
    for(let i=0;i<weeks*7;i++){
      const dt=new Date(y,m,1-offset+i), ds=ymd(dt);
      html+='<div class="cell'+(dt.getMonth()!==m?" out":"")+(ds===todayStr?" today":"")+stCls(byDate[ds])+'" data-date="'+ds+'"><span class="dnum">'+dt.getDate()+'</span>'+(byDate[ds]||[]).map(it=>chip(it)).join("")+shootChips(ds)+'</div>';
    }
    html+='</div>';
  }
  $("main").innerHTML=html;
}
/* A liquid-glass group button: dot, one word, count; tap to open its list */
const CHEV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
function qbtn(id,name,n,open,attr,o){ o=o||{};
  return '<button type="button" class="qbtn" '+attr+'="'+esc(id)+'" aria-expanded="'+open+'"'+(o.can===false||(o.can==null&&!n)?" disabled":"")+'><i></i><span>'+esc(name)+'</span><b class="dn'+(o.hot?" hot":"")+'">'+n+'</b>'+CHEV+'</button>' }
const pipeOpen=new Set();
function renderColumns(cols){
  const all=sorted([...items.values()].filter(visible)), ec=isEc();
  const groups=ec?EC_PIPE:cols.map(c=>({id:c.id,name:c.name,sts:[c.id],k:ST_K[c.id]||"var(--ink-3)"}));
  $("main").innerHTML='<div class="gboard">'+groups.map(g=>{
    const list=all.filter(i=>g.sts.includes(i.status)), open=pipeOpen.has(g.id)&&list.length>0;
    return '<section class="'+(ec?"":"col ")+'qg'+(open?" open":"")+'"'+(ec?"":' data-status="'+g.id+'"')+' style="--k:'+g.k+'">'+qbtn(g.id,g.name,list.length,open,"data-pg")+
      (open?'<div class="qlist">'+list.map(i=>chip(i,true)).join("")+'</div>':"")+'</section>';
  }).join("")+'</div>';
}
function render(){
  if(isHr()&&!["home","tasks","shoots"].includes(view)){ view="home"; history.replaceState(null,"","#home") }
  if(view==="shoots"&&isMk()){ view="home"; history.replaceState(null,"","#home") }
  renderHeader(); renderFilters();
  ["vCal","vRev","vPipe"].forEach(k=>{ $(k).hidden=isHr() });
  $("vShoot").hidden=!(isCr()||isHr());
  const hv=view==="home", sv=view==="shoots";
  $("homeView").hidden=!hv; $("shoots").hidden=!sv;
  const rev=view==="review", tv=view==="tasks"||sv;
  $("layout").classList.toggle("full",rev||tv||hv||isEc()); $("main").hidden=rev||tv||hv; $("desk").hidden=!rev; $("tasks").hidden=!tv; $("fbar").hidden=hv; $("filters").hidden=tv||isEc();
  if(hv) renderHome();
  else if(view==="calendar") renderCalendar();
  else if(rev) renderDesk();
  else if(sv) renderShoots();
  else if(tv) {}
  else renderColumns(STATUSES);
  renderFocus(); renderNotifs(); renderTasks();
  if($("dlg").open&&editingId) renderPublish();
}

/* Persistence */
function writeErr(e,what){
  const code=e&&e.code;
  if(code==="not_granted"||code==="revoked"){ toast("You don’t have edit access for "+what+". Ask the plan owner to give you edit access."); return true }
  if(code==="resource_exhausted"||code==="quota_exceeded"){ toast("Saving too fast. Wait a moment and try again."); return false }
  toast("Couldn’t save "+what+". Check your connection and try again."); return false;
}
async function persist(id,data){
  if(readOnly){toast("This plan is view only for you.");return}
  if(data) items.set(id,data); else items.delete(id);
  saveCache(); render();
  if(mode!=="db") return;
  try{ const ref=db.collection("items").doc(id); if(data){const {id:_,...rest}=data; await ref.set(rest)} else await ref.delete() }
  catch(e){ if(writeErr(e,"the plan")){readOnly=true;setNote();render()} }
}
async function resolveNames(){
  if(!userNs) return;
  const ids=new Set();
  versions.forEach(v=>v.by&&ids.add(v.by)); feedback.forEach(f=>f.by&&ids.add(f.by));
  items.forEach(i=>["approvedBy","submittedBy","changesBy","postedBy","createdBy"].forEach(k=>i[k]&&ids.add(i[k])));
  Object.keys(team).forEach(id=>ids.add(id));
  tasks.forEach(t=>{ t.by&&ids.add(t.by); t.doneBy&&ids.add(t.doneBy) });
  // Ask again for anyone still unnamed: a teammate's profile can arrive after their first note
  const need=[...ids].filter(id=>(!(id in names)||names[id]==="Someone")&&id!==myId); if(!need.length) return;
  need.forEach(id=>{ if(!(id in names)) names[id]="Someone" });
  try{ const ps=await userNs.profiles(need); let changed=false;
    need.forEach(id=>{ if(ps[id]&&ps[id].name&&names[id]!==ps[id].name){ names[id]=ps[id].name; changed=true } });
    if(changed) render(); }catch(e){}
}
async function connect(){
  if(!window.claude||typeof window.claude.use!=="function"){mode="local";setNote();renderNotifs();renderFocus();return}
  const timer=setTimeout(()=>{ if(!live.items){mode="local";setNote();renderNotifs();renderFocus()} },10000);
  try{
    userNs=await window.claude.use("user");
    if(userNs){ try{myId=await userNs.id()}catch(e){} try{amOwner=await userNs.isOwner()}catch(e){} try{ const me=await userNs.me(); myName=(me&&me.name)||"" }catch(e){} }
    try{ assets=await window.claude.use("assets") }catch(e){ assets=null }
    const d=await window.claude.use("db");
    if(!d){clearTimeout(timer);mode="local";setNote();renderNotifs();renderFocus();return}
    db=d; mode="db";
    /* Private note of this viewer's own id, so a personal alert job can skip their own actions */
    if(myId){ const me=db.collection("data/users/"+myId).doc("whoami"); me.get().then(s=>{ if(!s.exists||(s.data()||{}).id!==myId) return me.set({id:myId}) }).catch(()=>{}) }
    db.collection("items").onSnapshot(snap=>{
      clearTimeout(timer); const wasLive=live.items; live.items=true;
      const m=new Map(); snap.docs.forEach(x=>{ if(x.exists) m.set(x.id,normalize(x.id,x.data())) });
      const before=wasLive?items:null;
      raw.items=m; applyPreview(); saveCache(); setNote(); render(); resolveNames(); syncShootScripts();
      if(before) catWatch(before,m);
    },()=>{clearTimeout(timer);mode="local";setNote();toast("Couldn’t load the online plan. Showing the copy on this device.")});
    db.collection("versions").onSnapshot(snap=>{
      raw.versions=snap.docs.filter(x=>x.exists).map(x=>{const v=x.data()||{};return {id:x.id,item:String(v.item||""),n:Number(v.n)||1,link:String(v.link||""),asset:String(v.asset||""),assetType:String(v.assetType||""),note:String(v.note||""),files:normFiles(v.files),at:Number(v.at)||0,by:String(v.by||""),gone:Number(v.previewGone)||0}}); applyPreview();
      render(); resolveNames();
    },()=>{});
    db.collection("feedback").onSnapshot(snap=>{
      raw.feedback=snap.docs.filter(x=>x.exists).map(x=>{const v=x.data()||{};return {id:x.id,item:String(v.item||""),text:String(v.text||""),version:Number(v.version)||0,img:Number(v.img)>0?Number(v.img):null,t:secOrNull(v.t),t2:secOrNull(v.t2),files:normFiles(v.files),at:Number(v.at)||0,by:String(v.by||""),done:!!v.done}}); applyPreview();
      render(); resolveNames();
    },()=>{});
    db.collection("tasks").onSnapshot(snap=>{
      live.tasks=true;
      raw.tasks=snap.docs.filter(x=>x.exists).map(x=>{const v=x.data()||{};return {id:x.id,text:String(v.text||"").slice(0,200),for:ROLES[v.for]?v.for:"content",
        due:typeof v.due==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v.due)?v.due:"",done:!!v.done,doneBy:String(v.doneBy||""),doneAt:Number(v.doneAt)||0,by:String(v.by||""),at:Number(v.at)||0}}).filter(t=>t.text);
      applyPreview(); render(); resolveNames(); taskWatch();
    },()=>{ live.tasks=true; renderTasks() });
    db.collection("shoots").onSnapshot(snap=>{
      live.shoots=true;
      shoots=snap.docs.filter(x=>x.exists).map(x=>{const v=x.data()||{};return {id:x.id,talent:Array.isArray(v.talent)?v.talent.map(String):[],item:String(v.item||""),items:Array.isArray(v.items)?v.items.map(String).filter(Boolean).slice(0,12):v.item?[String(v.item)]:[],scripts:shScripts(v.scripts),title:String(v.title||""),
        start:Number(v.start)||0,end:Number(v.end)||0,location:String(v.location||""),notes:String(v.notes||""),status:["proposed","confirmed","declined","cancelled"].includes(v.status)?v.status:"proposed",
        reply:String(v.reply||""),by:String(v.by||""),at:Number(v.at)||0,respondedBy:String(v.respondedBy||""),respondedAt:Number(v.respondedAt)||0}}).filter(x=>x.start&&x.end>x.start);
      render(); shootWatch(); syncShootScripts();
    },()=>{ live.shoots=true });
    db.collection("availability").onSnapshot(snap=>{
      avail=snap.docs.filter(x=>x.exists).map(x=>{const v=x.data()||{};return {id:x.id,user:String(v.user||""),start:Number(v.start)||0,end:Number(v.end)||0}}).filter(x=>x.end>x.start);
      if(view==="shoots") renderShoots();
    },()=>{});
    db.collection("busy").onSnapshot(snap=>{
      busy=snap.docs.filter(x=>x.exists).map(x=>{const v=x.data()||{};return {user:String(v.user||""),start:Number(v.start)||0,end:Number(v.end)||0}}).filter(x=>x.end>x.start);
      if(view==="shoots") renderShoots();
    },()=>{});
    db.collection("inbox").onSnapshot(snap=>{
      raw.inbox=snap.docs.filter(x=>x.exists).map(x=>{const v=x.data()||{};return {id:x.id,path:String(v.path||""),name:String(v.name||"video"),asset:String(v.asset||""),assetType:String(v.assetType||"video/mp4"),size:Number(v.size)||0,mtime:Number(v.mtime)||0,at:Number(v.at)||0}}).sort((a,b)=>a.at-b.at); applyPreview();
      render();
    },()=>{});
    db.collection("team").onSnapshot(snap=>{
      live.team=true;
      const t={}; snap.docs.forEach(x=>{ if(x.exists){ const r=(x.data()||{}).role; if(ROLES[r]) t[x.id]=r } });
      team=t; render(); resolveNames(); maybeAskRole();
      if($("roleDlg").open) renderRoleDlg();
    },()=>{});
    db.collection("postjobs").onSnapshot(snap=>{
      const j={}; snap.docs.forEach(x=>{ if(x.exists) j[x.id]=x.data()||{} }); jobs=j;
      if(view==="home") renderHome(); if($("dlg").open&&editingId) renderPublish();
    },()=>{});
    loadMeta();
    db.collection("focus").onSnapshot(snap=>{
      live.focus=true;
      raw.focus=snap.docs.filter(x=>x.exists).map(x=>{const v=x.data()||{};return {id:x.id,name:String(v.name||""),month:String(v.month||""),created:Number(v.created)||0}}).filter(f=>f.name).sort((a,b)=>a.created-b.created); applyPreview();
      renderFocus();
    },()=>renderFocus());
  }catch(e){clearTimeout(timer);mode="local";setNote();renderNotifs();renderFocus()}
}

/* Dialog */
function buildForm(){
  $("fSeries").innerHTML=SERIES.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join("");
  $("fStatus").innerHTML=STATUSES.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join("");
  $("fPlatforms").innerHTML=PLATFORMS.map(p=>'<label title="'+esc(p.name)+'"><input type="checkbox" value="'+p.id+'" aria-label="'+esc(p.name)+'"><span>'+esc(p.s)+'</span></label>').join("");
  $("fLangs").innerHTML=LANGS.map(p=>'<label><input type="checkbox" value="'+p.id+'"><span>'+esc(p.name)+'</span></label>').join("");
  $("fSizes").innerHTML=SIZES.map(p=>'<label title="'+esc(p.name)+'"><input type="checkbox" value="'+p.id+'" aria-label="'+esc(p.name)+'"><span>'+esc(p.s)+'</span></label>').join("");
}
function setTab(t){
  if(t!=="publish") t="plan";
  dlgTab=t;
  [["plan","tPlan","pPlan"],["publish","tPub","pPub"]].forEach(([k,b,p])=>{ $(b).setAttribute("aria-selected",k===t); $(p).hidden=k!==t });
  if(t==="publish") renderPublish();
}
function openItem(id,presetDate,presetProduct){
  if(readOnly&&!id) return;
  editingId=id||null; editingProduct=id?"":(presetProduct||"");
  const it=id?items.get(id):{title:presetProduct||"",series:presetProduct||isEc()?"product":(filters.size===1?[...filters][0]:"garage"),status:"idea",platforms:isEc()?["shopee","lazada"]:["reel"],langs:[],kind:"",date:presetDate||"",notes:"",caption:"",
    type:myRole()==="ecomm"?"design":"video",sizes:[],sizeNote:"",refs:[],team:isMk()?myRole():(teamF||"marketing")};
  if(!it) return;
  $("fTitle").value=it.title==="Untitled"&&id?"":it.title;
  $("fStatus").querySelectorAll("option").forEach(o=>{ o.disabled=o.value!==it.status&&(o.value==="scheduled"||isCr()&&["approved","posted"].includes(o.value)) });
  $("fTeamWrap").hidden=!isCr(); $("fTeam").value=it.team||(isMk()?myRole():"marketing");
  $("fSeries").value=it.series; $("fStatus").value=it.status; $("fDate").value=it.date; $("fDue").value=it.due||""; $("fNotes").value=it.notes; $("fCaption").value=it.caption||"";
  $("fPlatforms").querySelectorAll("input").forEach(i=>i.checked=it.platforms.includes(i.value));
  $("fLangs").querySelectorAll("input").forEach(i=>i.checked=it.langs.includes(i.value));
  $("fKind").querySelectorAll("input").forEach(i=>i.checked=it.kind===i.value);
  $("fType").querySelectorAll("input").forEach(i=>i.checked=(it.type||"video")===i.value);
  $("fSizes").querySelectorAll("input").forEach(i=>i.checked=(it.sizes||[]).includes(i.value));
  $("fSizeNote").value=it.sizeNote||"";
  $("fRefs").innerHTML=attHtml(it.refs||[]);
  pending.refs=[]; renderPending("refs");
  $("fMore").open=!!(it.kind||(it.langs||[]).length||(it.refs||[]).length||it.notes);
  typeFields(); platVis();
  $("fCode").hidden=!(id&&it.code); $("fCode").textContent=id&&it.code?it.code:"";
  $("fDelete").hidden=!id||readOnly; $("fDelete").textContent="Delete"; $("fDelete").dataset.armed="";
  $("fSave").hidden=readOnly; $("pubInfo")._h="";
  tint();
  setTab(id&&["approved","scheduled"].includes(it.status)?"publish":"plan");
  $("dlg").showModal();
  if(!id) setTimeout(()=>$("fTitle").focus(),30);
}
/* Platforms follow the team: E-commerce → Shopee, Lazada, Website; marketing → social */
function platVis(){
  const team=isCr()?$("fTeam").value:(isMk()?myRole():"marketing"), shop=team==="ecomm";
  $("fPlatforms").querySelectorAll("label").forEach(l=>{ const v=l.querySelector("input").value; l.hidden=shop?!SHOP_P.includes(v):SHOP_P.includes(v) });
  const lab=$("fDate").closest(".f").querySelector(".lab"); if(lab) lab.textContent=shop?"Needed by":"Post";
  $("fSeries").closest(".f").hidden=isEc();
}
function typeFields(){ const d=(document.querySelector("#fType input:checked")||{}).value==="design"; $("fSizesWrap").hidden=!d; $("fKindWrap").hidden=d }
function tint(){ $("dlgInner").style.setProperty("--c",sMap[$("fSeries").value].c) }
function formData(prev,id){
  const d={id,title:$("fTitle").value.trim()||(prev?prev.title:"Untitled"),series:$("fSeries").value,status:$("fStatus").value,
    platforms:[...$("fPlatforms").querySelectorAll("input:checked")].map(i=>i.value),
    langs:[...$("fLangs").querySelectorAll("input:checked")].map(i=>i.value),
    kind:(document.querySelector("#fKind input:checked")||{}).value||"",
    date:$("fDate").value||"",due:$("fDue").value||"",notes:$("fNotes").value.trim(),caption:$("fCaption").value,
    created:prev?prev.created:Date.now(),product:prev?prev.product:editingProduct,
    type:(document.querySelector("#fType input:checked")||{}).value==="design"?"design":"video",
    sizes:[...$("fSizes").querySelectorAll("input:checked")].map(i=>i.value),
    sizeNote:$("fSizeNote").value.trim().slice(0,300),
    refs:prev?prev.refs||[]:[]};
  STAMP_KEYS.forEach(k=>{ d[k]=prev?prev[k]:(k.endsWith("By")?"":0) });
  d.createdBy=prev?prev.createdBy:(myId||"");
  d.code=prev&&prev.code?prev.code:nextCode();
  d.team=isMk()?myRole():(isCr()?$("fTeam").value:(prev?prev.team:"marketing"));
  return d;
}
async function saveItem(close){
  if(!$("fTitle").value.trim()){setTab("plan");$("fTitle").focus();toast("Give it a title first.");return}
  const isNew=!editingId;
  const id=editingId||newId();
  const prev=editingId?items.get(editingId):null;
  const data=formData(prev,id);
  if(pending.refs.length){
    if(!assets){ toast("You can’t upload files here. Remove the references or add them later."); return }
    $("fSave").disabled=true; $("fSave").textContent="Uploading…";
    try{ data.refs=[...data.refs,...await uploadPending("refs")]; pending.refs=[]; renderPending("refs") }
    catch(e){ uploadErr(e); return }
    finally{ $("fSave").disabled=false; $("fSave").textContent="Save" }
  }
  if(!prev||prev.status!==data.status) Object.assign(data,stamp(data.status,id));
  persist(id,data);
  if(isNew){ editingId=id; $("fDelete").hidden=readOnly; toast("Added."); }
  else toast("Saved.");
  if(close!==false) $("dlg").close(); else renderPublish();
}
function setStatusFor(id,st,useForm){
  const prev=items.get(id); if(!prev) return;
  const inDlg=useForm&&$("dlg").open&&editingId===id;
  const next={...(inDlg?formData(prev,id):prev),status:st,...stamp(st,id)};
  if(inDlg) $("fStatus").value=st;
  persist(id,next);
  if(st==="approved"||st==="posted") catMove("hop");
}

/* Attachments and video times */
const ACCEPT={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml",mp4:"video/mp4",webm:"video/webm",pdf:"application/pdf",csv:"text/csv",md:"text/markdown",json:"application/json",txt:"text/plain"};
const ACCEPT_TYPES=new Set(Object.values(ACCEPT));
function typeFor(f){ if(ACCEPT_TYPES.has(f.type)) return f.type; const ext=(f.name.split(".").pop()||"").toLowerCase(); return ACCEPT[ext]||"" }
const secOrNull=v=>typeof v==="number"&&isFinite(v)&&v>=0?v:null;
const normFiles=a=>Array.isArray(a)?a.filter(f=>f&&typeof f.id==="string"&&/^[A-Za-z0-9_-]{8,64}$/.test(f.id)).slice(0,12).map(f=>({id:f.id,name:String(f.name||"file"),type:String(f.type||"")})):[];
function parseTime(str){
  str=String(str||"").trim(); if(!str) return null;
  let m=str.match(/^(\d{1,3}):([0-5]?\d)(?:\.\d+)?$/); if(m) return Number(m[1])*60+Number(m[2]);
  m=str.match(/^(\d{1,4})(?:\.\d+)?s?$/i); if(m) return Number(m[1]);
  return NaN;
}
function attHtml(files){
  if(!files||!files.length) return "";
  return '<div class="atts">'+files.map(f=>{
    const url="/_blob/"+f.id;
    if(f.type.startsWith("image/")) return '<button type="button" class="img" data-lb="'+url+'" data-name="'+esc(f.name)+'" title="View '+esc(f.name)+'"><img src="'+url+'" alt="'+esc(f.name)+'" loading="lazy"></button>';
    if(f.type.startsWith("video/")) return '<video src="'+url+'" controls preload="metadata" playsinline></video>';
    const kind=f.type==="application/pdf"?"PDF":(f.name.split(".").pop()||"FILE").toUpperCase().slice(0,4);
    return '<button type="button" class="attf" data-dl="'+url+'" data-name="'+esc(f.name)+'" title="Save '+esc(f.name)+'"><b>'+esc(kind)+'</b>'+esc(f.name)+'</button>';
  }).join("")+'</div>';
}
const pending={fb:[],v:[],refs:[]};
function renderPending(k){
  $(k+"Files").innerHTML=pending[k].map((f,i)=>'<span class="att-p">'+(f.type.startsWith("image/")?'<img src="'+(f._u||(f._u=URL.createObjectURL(f)))+'" alt="">':"")+esc(f.name)+'<button type="button" data-rm="'+k+':'+i+'" aria-label="Remove '+esc(f.name)+'">×</button></span>').join("");
}
function addPending(k,files){
  let bad=[];
  [...files].forEach(f=>{
    if(!typeFor(f)){ bad.push(f.name+" (this file type can’t be attached)"); return }
    if(f.size>20*1024*1024){ bad.push(f.name+" (over 20 MB)"); return }
    if(pending[k].length>=8){ bad.push(f.name+" (8 files max)"); return }
    pending[k].push(f);
  });
  renderPending(k);
  if(bad.length) toast("Not attached: "+bad.join(", ")+". Use images, MP4, PDF or text files under 20 MB.");
}
async function uploadPending(k){
  const out=[];
  for(const f of pending[k]){
    const r=await assets.upload(f,{type:typeFor(f)});
    out.push({id:r.id,name:f.name,type:r.contentType||typeFor(f)});
  }
  return out;
}
function uploadErr(e){
  const c=e&&e.code;
  toast(c==="too_large"?"A file is too big. Keep each file under 20 MB.":c==="unsupported_type"?"A file type can’t be uploaded. Use images, MP4, PDF or text files.":c==="quota_or_state"?"File storage is full. Remove old previews or add the NAS link only.":c==="not_granted"?"You don’t have permission to upload files here.":"Upload failed. Check your connection and try again.");
}

/* View and save attachments inside the app */
let dlNs, lbFile=null;
async function getDl(){ if(dlNs===undefined){ try{ dlNs=(window.claude&&typeof window.claude.use==="function")?await window.claude.use("downloads"):null }catch(e){ dlNs=null } } return dlNs }
const EXT_BY_TYPE={"image/png":"png","image/jpeg":"jpg","image/gif":"gif","image/webp":"webp","image/svg+xml":"svg","video/mp4":"mp4","video/webm":"webm","application/pdf":"pdf","text/csv":"csv","text/markdown":"md","application/json":"json","text/plain":"txt"};
async function dlFile(url,name){
  const dl=await getDl();
  if(!dl){ toast("Saving files isn’t available in this view. Right-click the image and choose Save Image As."); return }
  try{
    const r=await fetch(url); if(!r.ok) throw {code:"fetch"};
    const blob=await r.blob();
    let fn=String(name||"file"); if(!/\.[a-z0-9]{2,5}$/i.test(fn)) fn+="."+(EXT_BY_TYPE[blob.type]||"png");
    await dl.save({filename:fn,data:blob}); toast("Saved.");
  }catch(e){
    const c=e&&e.code; if(c==="declined") return;
    toast(c==="fetch"?"Couldn’t load that file. It may have been removed.":c==="rejected_extension"?"This file type can’t be saved here.":c==="rate_limited"?"A save is already waiting for you. Finish that one first.":"Couldn’t save the file. Try again.");
  }
}
function openLb(url,name){ lbFile={url,name}; $("lbImg").src=url; $("lbImg").alt=name||""; $("lbName").textContent=name||""; $("lb").showModal() }
document.addEventListener("click",e=>{
  const v=e.target.closest("[data-lb]"); if(v){ e.preventDefault(); openLb(v.dataset.lb,v.dataset.name); return }
  const d=e.target.closest("[data-dl]"); if(d){ e.preventDefault(); dlFile(d.dataset.dl,d.dataset.name) }
});
$("lbClose").onclick=()=>$("lb").close();
$("lb").addEventListener("click",e=>{ if(e.target===$("lb")) $("lb").close() });
$("lbSave").onclick=()=>{ if(lbFile) dlFile(lbFile.url,lbFile.name) };

/* Review desk: one content item's videos and feedback */
/* NAS (UGREEN DXP2800, share "Marketing Content"). Each item has a folder the preview job watches. */
const NAS_MAC="/Volumes/Marketing Content/", NAS_SMB="smb://TAYARLO-DXP2800.local/Marketing%20Content/";
const NAS_CHECKING="Content Video/Checking", NAS_APPROVE="Content Video/approve";
const smbUrl=rel=>NAS_SMB+rel.split("/").map(encodeURIComponent).join("/");
function nasBoxHtml(it){
  const mk=isMk(), rel=mk?NAS_APPROVE:NAS_CHECKING;
  const nextN=((vFor(it.id)[0]||{n:0}).n)+1, fname=(it.code?it.code+" ":"")+fileSafe(it.title)+" v"+nextN+".mp4";
  const hint=mk?"When you approve a video, its file moves from Checking to this folder within about 15 minutes."
    :"Export the finished version here with this file name. Within about 15 minutes it’s added here, sent for review, and marketing gets a notification. Once approved, the file moves to approve.";
  return '<div class="nas"><div><b>NAS folder</b><code>Marketing Content / '+esc(rel.split("/").join(" / "))+'</code>'+
    (mk?"":'<div class="fname"><b>File name</b><code>'+esc(fname)+'</code><button class="btn sm ghost" type="button" data-copy="'+esc(fname.replace(/\.mp4$/,""))+'">Copy name</button></div>')+
    '<span class="hint">'+esc(hint)+'</span></div><div class="acts"><a class="btn sm" href="'+esc(smbUrl(rel))+'" target="_blank" rel="noopener" title="Open in Finder">Finder ↗</a><button class="btn sm ghost" type="button" data-copy="'+esc(NAS_MAC+rel)+'">Copy path</button></div></div>';
}
function linkHtml(link){
  if(!link) return "";
  if(link.startsWith(NAS_MAC)){ const rel=link.slice(NAS_MAC.length); return '<div class="path"><span>NAS:</span><code>'+esc(rel)+'</code><a class="btn sm" href="'+esc(smbUrl(rel))+'" target="_blank" rel="noopener" title="Open in Finder">Finder ↗</a><button class="btn sm ghost" data-copy="'+esc(link)+'" type="button">Copy path</button></div>' }
  if(/^https?:\/\//i.test(link)) return '<div class="path"><a class="btn sm" href="'+esc(link)+'" target="_blank" rel="noopener">Open on NAS</a><code>'+esc(link)+'</code><button class="btn sm ghost" data-copy="'+esc(link)+'" type="button">Copy</button></div>';
  return '<div class="path"><span>NAS:</span><code>'+esc(link)+'</code><button class="btn sm ghost" data-copy="'+esc(link)+'" type="button">Copy path</button></div>';
}
let qOpen=null;
function goReview(id){ selId=id||null; const gi=id&&items.get(id); if(gi) qOpen=groupOf(gi.status); $("desk").classList.toggle("phone-detail",!!id&&narrow.matches); window.scrollTo(0,0); if(view!=="review") location.hash="review"; else render(); }
const QGROUPS=[
  {id:"review",name:"In review",k:"var(--review)"},
  {id:"changes",name:"Needs changes",k:"var(--edit)"},
  {id:"edit",name:"Editing",k:"var(--ink-3)"},
  {id:"approved",name:"Approved",k:"var(--ready)"},
  {id:"scheduled",name:"Scheduled",k:"var(--sched)"}];
const qgroups=()=>isEc()?[{id:"review",name:"To review",sts:["review"],k:"var(--review)"},{id:"changes",name:"Being fixed",sts:["changes","edit"],k:"var(--edit)"},{id:"approved",name:"Approved",sts:["approved","scheduled"],k:"var(--ready)"}]
  :QGROUPS.map(g=>({...g,sts:[g.id]}));
const groupOf=st=>(qgroups().find(g=>g.sts.includes(st))||{id:st}).id;
function setHTML(el,h){ if(el._h!==h){ el.innerHTML=h; el._h=h } }
function pickSel(){
  if(wantSel&&items.has(wantSel)){ selId=wantSel; qOpen=groupOf(items.get(wantSel).status); wantSel=null; return }
  if(selId&&items.has(selId)) return;
  const all=sorted([...items.values()].filter(visible));
  for(const g of qgroups()){ const f=all.find(i=>g.sts.includes(i.status)); if(f){ selId=f.id; return } }
  selId=null;
}
function verCard(v,latest,it){
  if(it&&it.type==="design"&&v.files&&v.files.length&&!v.asset){
    const imgs=v.files.filter(f=>f.type.startsWith("image/")), other=v.files.filter(f=>!f.type.startsWith("image/"));
    return '<div class="ver'+(latest?" latest":"")+'"><div class="ver-h"><b>v'+v.n+(latest?" (latest)":"")+'</b><span>'+esc(who(v.by))+', '+esc(fmtTime(v.at))+'</span></div>'+
      '<div class="atts big">'+imgs.map((f,i)=>'<figure><button type="button" class="img" data-lb="/_blob/'+f.id+'" data-name="'+esc(f.name)+'" title="View '+esc(f.name)+'"><img src="/_blob/'+f.id+'" alt="Image '+(i+1)+': '+esc(f.name)+'" loading="lazy"></button><figcaption><b>Image '+(i+1)+'</b> · '+esc(f.name)+'</figcaption></figure>').join("")+'</div>'+
      attHtml(other)+linkHtml(v.link)+(v.note?'<p>'+fbHtml(v.note)+'</p>':"")+'</div>';
  }
  const media=v.asset?(v.assetType.startsWith("image/")?'<img src="'+esc(v.asset)+'" alt="Preview for v'+v.n+'" style="max-width:100%;border-radius:8px;margin:6px 0">':'<video src="'+esc(v.asset)+'" controls preload="metadata" playsinline></video>'):v.gone?'<div class="vgone">Preview cleared after posting · full video on the NAS</div>':"";
  const cap=latest&&v.asset&&!v.assetType.startsWith("image/")&&assets&&!readOnly&&mode==="db"
    ?'<button type="button" class="camcap" data-cap aria-label="Capture this frame into your feedback" title="Capture this frame into your feedback"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button>':"";
  return '<div class="ver'+(latest?" latest":"")+'"><div class="ver-h"><b>v'+v.n+(latest?" (latest)":"")+'</b><span>'+esc(who(v.by))+', '+esc(fmtTime(v.at))+'</span></div>'+(cap?'<div class="vwrap">'+media+cap+'</div>':media)+linkHtml(v.link)+(v.note?'<p>'+fbHtml(v.note)+'</p>':"")+attHtml(v.files)+'</div>';
}
const fbHtml=t=>esc(t).replace(/\b(\d{1,2}):([0-5]\d)\b/g,(m,a,b)=>'<button type="button" class="ts" data-t="'+(Number(a)*60+Number(b))+'" title="Jump to '+m+' in the video">'+m+'</button>');
let deskFor;
function renderInbox(){
  const box=$("inboxBox");
  if(isMk()||readOnly||mode!=="db"||!inbox.length){ setHTML(box,""); return }
  const keep={}; box.querySelectorAll("select[data-inb-sel]").forEach(sl=>keep[sl.dataset.inbSel]=sl.value);
  const rank={edit:0,changes:1,shoot:2,script:3,idea:4,review:5,approved:6};
  const opts=[...items.values()].filter(i=>i.status!=="posted").sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)||a.title.localeCompare(b.title))
    .map(i=>'<option value="'+esc(i.id)+'">'+esc(i.title+" · "+stMap[i.status].name+(i.date?" · "+shortDate(i.date):""))+'</option>').join("");
  setHTML(box,'<div class="inbox"><div class="qh"><span><i style="--k:var(--blue)"></i>New in Checking</span><span>'+inbox.length+'</span></div>'+
    
    inbox.map(x=>'<div class="inb" data-id="'+esc(x.id)+'">'+(x.asset?'<video src="'+esc(x.asset)+'" controls preload="metadata" playsinline></video>':"")+
      '<div class="inb-n">'+esc(x.name)+'</div><span class="hint">'+esc(fmtTime(x.at))+'</span>'+
      '<select data-inb-sel="'+esc(x.id)+'" aria-label="Which content is '+esc(x.name)+'?"><option value="">Which content?</option>'+opts+'</select>'+
      '<div class="row"><button type="button" class="btn primary sm" data-inb="add" title="Add as the next version and send for review">Add + send</button><button type="button" class="btn ghost sm" data-inb="dismiss">Not content</button></div></div>').join("")+'</div>');
  box.querySelectorAll("select[data-inb-sel]").forEach(sl=>{ if(keep[sl.dataset.inbSel]) sl.value=keep[sl.dataset.inbSel] });
}
async function assignInbox(xid,itemId){
  const x=inbox.find(v=>v.id===xid), prev=items.get(itemId); if(!x||!prev||!db) return;
  const n=(vFor(itemId)[0]||{n:0}).n+1;
  try{
    if(versions.some(v=>v.item===itemId&&v.asset&&v.asset===x.asset)){ await db.collection("inbox").doc(xid).delete(); toast("That video is already a version of “"+prev.title+"”."); goReview(itemId); return }
    await db.collection("versions").add({item:itemId,n,link:x.path,asset:x.asset,assetType:x.assetType,note:"From Checking: "+x.name,files:[],size:x.size,mtime:x.mtime,at:Date.now(),by:myId||""});
    persist(itemId,{...prev,status:"review",...stamp("review",itemId),submittedV:n});
    await db.collection("inbox").doc(xid).delete();
    toast("Added as v"+n+" of “"+prev.title+"” and sent for review."); goReview(itemId);
  }catch(e){ writeErr(e,"this video") }
}
function renderDesk(){
  pickSel(); renderInbox();
  const all=sorted([...items.values()].filter(visible));
  /* Only the status buttons show; tap one to open its videos */
  setHTML($("queue"),qgroups().map(g=>{
    const list=all.filter(i=>g.sts.includes(i.status)), open=qOpen===g.id&&list.length>0;
    return '<div class="qg'+(open?" open":"")+'" style="--k:'+g.k+'">'+qbtn(g.id,g.name,list.length,open,"data-qg")+
      (open?'<div class="qlist">'+list.map(i=>chip(i,true,i.id===selId?" sel":"")).join("")+'</div>':"")+'</div>';
  }).join(""));
  const it=selId?items.get(selId):null;
  $("dEmpty").hidden=!!it; $("dBody").hidden=!it;
  if(deskFor!==selId){ deskFor=selId; ["vLink","vNote","vFile","fbText","fbAt","fbTo"].forEach(k=>$(k).value=""); pending.fb=[]; pending.v=[]; renderPending("fb"); renderPending("v") }
  if(!it){ $("detail").style.removeProperty("--c"); return }
  const s=sMap[it.series];
  $("detail").style.setProperty("--c",s.c);
  $("dSeries").textContent=s.name+(it.code?" · "+it.code:"");
  $("dTitle").textContent=it.title;
  $("dMeta").textContent=[TEAMS[it.team]+(it.type==="design"?" design":" video"), it.date?(it.type==="design"?"Needed ":"Posting ")+shortDate(it.date):"No date yet",
    it.type==="design"?[...it.sizes.map(sizeName),it.sizeNote].filter(Boolean).join(", "):"", it.platforms.map(p=>pMap[p].name).join(", "),
    it.kind?(it.kind==="ai"?"AI video":"Real people"):"", it.langs.map(l=>(LANGS.find(x=>x.id===l)||{}).name).join(", ")].filter(Boolean).join(" · ");
  $("dEdit").textContent=readOnly?"Details":"Edit";

  const vs=vFor(it.id), fbs=fbFor(it.id), open=fbs.filter(f=>!f.done).length, latest=vs[0];
  const can=!readOnly&&mode==="db", mk=isMk(), cr=isCr();
  let k="var(--ink-3)", head="", sub="", acts="";
  const due=it.due?"First cut due "+shortDate(it.due):"";
  const st=it.status, submit=latest&&can&&!mk?'<button class="btn primary" data-act="submit">Send v'+latest.n+' for review</button>':"";
  const by=(id,t)=>[id?who(id):"",t?fmtTime(t):""].filter(Boolean).join(" · ");
  if(["idea","script","shoot"].includes(st)){ head=stMap[st].name; sub=due||"Not cut yet"; acts=submit; }
  else if(st==="edit"){ k="var(--edit)"; head="Editing"; sub=[latest?"v"+latest.n:"",due].filter(Boolean).join(" · ")||"No cut yet"; acts=submit; }
  else if(st==="changes"){ k="var(--edit)"; head="Needs changes"; sub=[it.changesBy?who(it.changesBy):"",open?open+" to fix":"All fixed, send the new version"].filter(Boolean).join(" · "); acts=submit; }
  else if(st==="review"){ k="var(--review)"; head="In review"; sub=[latest?"v"+latest.n:"",by(it.submittedBy,it.submittedAt)].filter(Boolean).join(" · "); if(can&&!cr) acts='<button class="btn stop" data-act="changes">Ask for changes</button><button class="btn go" data-act="approve">Approve</button>'; }
  else if(st==="approved"){ k="var(--ready)"; head="Approved"; sub=by(it.approvedBy,it.approvedAt); if(can&&!cr) acts='<button class="btn" data-act="reopen">Back to editing</button><button class="btn go" data-act="gopub">'+(it.team==="ecomm"?"Mark live":"Schedule")+'</button>'; }
  else if(st==="scheduled"){ const due=it.postAt&&it.postAt<=Date.now(); k=due?"var(--pink)":"var(--sched)"; head=due?"Time to post":"Scheduled"; sub=[it.postAt?postWhen(it.postAt):"",it.platforms.map(p=>pMap[p].s).join(", ")].filter(Boolean).join(" · "); if(can&&!cr) acts='<button class="btn go" data-act="gopub">Open Publish</button>'; }
  else { k="var(--blue)"; head=it.team==="ecomm"?"Live":"Posted"; sub=it.postedAt?fmtTime(it.postedAt):""; if(it.postUrl) acts='<a class="btn sm" href="'+esc(it.postUrl)+'" target="_blank" rel="noopener">'+(it.team==="ecomm"?"Open listing ↗":"Open post ↗")+'</a>'; }
  setHTML($("vStatus"),'<div class="banner" style="--k:'+k+'"><div><b>'+esc(head)+'</b><span>'+esc(sub)+'</span></div>'+(acts?'<div class="acts">'+acts+'</div>':"")+'</div>');

  const isD=it.type==="design";
  setHTML($("nasBox"),(isD?"":nasBoxHtml(it))+(it.refs.length?'<div class="refs"><b>References</b>'+attHtml(it.refs)+'</div>':""));
  setHTML($("vLatest"),latest?verCard(latest,true,it):'<p class="empty">'+(isD?"No design yet.":"No video yet.")+(can?" Add the first "+(isD?"version":"cut")+" below.":" The content team hasn’t added one.")+'</p>');
  setHTML($("vOlder"),vs.length>1?'<details class="older"><summary>Earlier versions ('+(vs.length-1)+')</summary>'+vs.slice(1).map(v=>verCard(v,false,it)).join("")+'</details>':"");
  $("vVideoRows").hidden=isD; $("vAttTxt").textContent=isD?"+ Images":"+ Files";
  $("fbTimeRow").hidden=isD; $("fbImgRow").hidden=!isD;
  if(isD){ const imgs=latest?(latest.files||[]).filter(f=>f.type.startsWith("image/")):[]; const o='<option value="">Whole design</option>'+imgs.map((f,i)=>'<option value="'+(i+1)+'">Image '+(i+1)+' · '+esc(f.name)+'</option>').join(""); const sel=$("fbImg"); if(sel._o!==o){ const keep=sel.value; sel.innerHTML=o; sel._o=o; sel.value=keep } }
  const showV=can&&!mk, vOpen=vOpenFor===it.id||!latest;
  $("vOpen").hidden=!showV||vOpen; $("vForm").hidden=!showV||!vOpen;
  $("fbText").placeholder=cr?"Reply or note":"What should change?";
  $("vAdd").textContent="Add v"+((latest?latest.n:0)+1);
  $("vAttach").hidden=$("fbAttach").hidden=!assets;
  $("fbHint").textContent=isD?"":"Empty time = whole video";

  setHTML($("fbHead"),'Feedback'+(open?'<span class="flagc">'+open+' to fix</span>':""));
  const fbVers=[...new Set(fbs.map(f=>f.version))].sort((a,b)=>b-a);
  setHTML($("fbList"),fbs.length?fbVers.map(n=>'<div class="fbv">'+(n?"Feedback on v"+n:"General feedback")+'</div>'+
    fbs.filter(f=>f.version===n).sort((a,b)=>(a.img||0)-(b.img||0)||(a.t==null?-1:a.t)-(b.t==null?-1:b.t)||a.at-b.at).map(f=>{
    const mine=f.by&&f.by===myId;
    const tc=f.img?'<button type="button" class="tcb" data-img="'+f.img+'" data-v="'+f.version+'" title="Open image '+f.img+'">Image '+f.img+'</button>':f.t!=null?'<button type="button" class="tcb ts" data-t="'+f.t+'" title="Play from '+fmtSec(f.t)+'">'+fmtSec(f.t)+(f.t2!=null&&f.t2>f.t?'–'+fmtSec(f.t2):"")+'</button>':'<span class="tcg">'+(isD?"Whole design":"Whole video")+'</span>';
    return '<div class="fb'+(f.done?" done":"")+'" data-id="'+esc(f.id)+'"><div class="fb-top">'+tc+'</div>'+(f.text?'<p>'+fbHtml(f.text)+'</p>':"")+attHtml(f.files)+'<div class="rmeta"><span>'+esc(who(f.by))+', '+esc(fmtTime(f.at))+(f.done?", fixed":"")+'</span>'+
      (can?'<button type="button" data-fb="done">'+(f.done?"Reopen":"Mark fixed")+'</button>':"")+((mine||amOwner)&&can?'<button type="button" class="del" data-fb="del">Delete</button>':"")+'</div></div>';
  }).join("")).join(""):'<p class="empty">No feedback yet.</p>');
  $("fbForm").hidden=!can;
  $("fbAdd").textContent="Post";
}
const fmtSec=s=>{s=Math.max(0,Math.floor(s));return Math.floor(s/60)+":"+pad(s%60)};
function seek(t,from){
  const card=from&&from.closest(".ver");
  const v=(card&&card.querySelector("video"))||$("vLatest").querySelector("video");
  if(!v){ toast("There’s no preview video here. Open the NAS file to check that time."); return }
  v.currentTime=t; v.play().catch(()=>{}); v.scrollIntoView({block:"nearest"});
}
async function addVersion(){
  if(!db||!selId) return;
  const id=selId;
  const link=$("vLink").value.trim(), file=$("vFile").files[0], note=$("vNote").value.trim();
  const isD=(items.get(id)||{}).type==="design";
  if(isD&&!pending.v.length&&!link){ toast("Add the design images for this version."); return }
  if(!isD&&!link&&!file){toast("Paste the NAS link or path, or choose a preview file.");$("vLink").focus();return}
  const btn=$("vAdd"); let asset="", assetType="";
  if(file){
    if(file.size>20*1024*1024){toast("That file is "+(file.size/1048576).toFixed(0)+" MB. Export a smaller preview under 20 MB, or just add the NAS link.");return}
    if(!assets){toast("You can’t upload files here. Add the NAS link instead.");return}
    btn.disabled=true; btn.textContent="Uploading…";
    try{ const r=await assets.upload(file,{type:file.type||"video/mp4"}); asset=r.url; assetType=r.contentType||file.type||"" }
    catch(e){
      const c=e&&e.code;
      toast(c==="too_large"?"That file is too big. Keep previews under 20 MB.":c==="unsupported_type"?"That file type can’t be previewed. Try an MP4.":c==="quota_or_state"?"Preview storage is full. Delete old previews or add the NAS link only.":c==="not_granted"?"You don’t have permission to upload. Add the NAS link instead.":"Upload failed. Try again, or add the NAS link only.");
      btn.disabled=false; renderDesk(); return;
    }
  }
  let files=[];
  if(pending.v.length){
    if(!assets){ toast("You can’t upload files here. Remove the attachments or ask the plan owner for edit access."); return }
    btn.disabled=true; btn.textContent="Uploading files…";
    try{ files=await uploadPending("v") }catch(e){ uploadErr(e); btn.disabled=false; renderDesk(); return }
  }
  const n=(vFor(id)[0]||{n:0}).n+1;
  btn.disabled=true; btn.textContent="Saving…";
  try{
    await db.collection("versions").add({item:id,n,link,asset,assetType,note,files,at:Date.now(),by:myId||""});
    $("vLink").value=""; $("vNote").value=""; $("vFile").value=""; pending.v=[]; renderPending("v");
    vOpenFor=null; toast("v"+n+" added.");
    const it=items.get(id); if(it&&["idea","script","shoot"].includes(it.status)) setStatusFor(id,"edit");
  }catch(e){ writeErr(e,"this version") }
  btn.disabled=false; renderDesk();
}
async function addFeedback(){
  if(!db||!selId) return;
  const id=selId, text=$("fbText").value.trim();
  const isD=(items.get(id)||{}).type==="design";
  const img=isD?(Number($("fbImg").value)||null):null;
  const t=isD?null:parseTime($("fbAt").value), t2=isD?null:parseTime($("fbTo").value);
  if(Number.isNaN(t)){ toast("Write the time as minutes:seconds, e.g. 0:05."); $("fbAt").focus(); return }
  if(Number.isNaN(t2)){ toast("Write the end time as minutes:seconds, e.g. 0:08, or leave it empty."); $("fbTo").focus(); return }
  if(t==null&&t2!=null){ toast("Add the start time too, or clear the end time."); $("fbAt").focus(); return }
  if(t2!=null&&t2<=t){ toast("The end time must be after the start time."); $("fbTo").focus(); return }
  if(!text&&!pending.fb.length){ toast("Write what needs to change."); $("fbText").focus(); return }
  const latest=vFor(id)[0], btn=$("fbAdd");
  btn.disabled=true;
  let files=[];
  if(pending.fb.length){
    if(!assets){ toast("You can’t upload files here. Remove the attachments and describe the change in words."); btn.disabled=false; return }
    btn.textContent="Uploading…";
    try{ files=await uploadPending("fb") }catch(e){ uploadErr(e); btn.disabled=false; renderDesk(); return }
  }
  try{
    await db.collection("feedback").add({item:id,text,version:latest?latest.n:0,t,t2,img,files,at:Date.now(),by:myId||"",done:false});
    $("fbText").value=""; $("fbAt").value=""; $("fbTo").value=""; pending.fb=[]; renderPending("fb");
    toast("Feedback posted.");
  }catch(e){ writeErr(e,"feedback") }
  btn.disabled=false; renderDesk();
}

/* Publish tab */
function renderPublish(){
  const box=$("pubInfo");
  if(!editingId){ setHTML(box,'<p class="hint" style="margin-top:12px">Save the item first.</p>'); return }
  const it=items.get(editingId); if(!it) return;
  const latest=vFor(it.id)[0], now=Date.now(), plats=it.platforms.map(p=>pMap[p].s).join(", ");
  const banner=(k,b,t,extra)=>'<div class="banner" style="--k:'+k+';margin-top:14px"><div><b>'+esc(b)+'</b>'+(t?'<span>'+esc(t)+'</span>':"")+'</div>'+(extra?'<div class="acts">'+extra+'</div>':"")+'</div>';
  $("capWrap").hidden=it.team==="ecomm";
  if(it.team==="ecomm"){
    if(it.status==="posted"){ setHTML(box,banner("var(--blue)","Live",it.postedAt?fmtTime(it.postedAt):"",it.postUrl?'<a class="btn sm" href="'+esc(it.postUrl)+'" target="_blank" rel="noopener">Open listing ↗</a>':"")); return }
    if(!["approved","scheduled"].includes(it.status)){ setHTML(box,banner("var(--ink-3)","Not approved yet","")); return }
    setHTML(box,banner("var(--ready)","Approved",plats)+(!readOnly&&mode==="db"&&isMk()
      ?'<div class="pubdone"><input type="url" id="pubLink" placeholder="Listing link (optional)" aria-label="Link to the live listing"><button class="btn go sm" type="button" data-pub="posted">Mark live</button></div>'
      :'<p class="waitnote pubnote">E-commerce marks it live.</p>'));
    return;
  }
  if(it.status==="posted"){ setHTML(box,banner("var(--blue)","Posted",it.postedAt?fmtTime(it.postedAt):"",it.postUrl?'<a class="btn sm" href="'+esc(it.postUrl)+'" target="_blank" rel="noopener">Open post ↗</a>':"")); return }
  if(!["approved","scheduled"].includes(it.status)){ setHTML(box,banner("var(--ink-3)","Not approved yet","You can pick a time once it’s approved.")); return }
  const can=!readOnly&&mode==="db"&&isMk(), sch=it.status==="scheduled"&&it.postAt>0, due=sch&&it.postAt<=now;
  const ig=it.platforms.some(p=>["reel","carousel","story","fb"].includes(p)), tt=it.platforms.includes("tiktok");
  const d0=sch?new Date(it.postAt):null, today=ymd(new Date());
  const dv=sch?ymd(d0):(it.date&&it.date>=today?it.date:today), tv=sch?pad(d0.getHours())+":"+pad(d0.getMinutes()):"20:00";
  let html=sch?banner(due?"var(--pink)":"var(--sched)",due?"Time to post":"Scheduled",[postWhen(it.postAt),plats].filter(Boolean).join(" · ")):banner("var(--ready)","Ready to post",plats||"Pick platforms in Plan");
  if(can){
    html+='<div class="pubwhen"><input type="date" id="pubDate" value="'+dv+'" aria-label="Post date"><input type="time" id="pubTime" value="'+tv+'" step="300" aria-label="Post time">'+
      '<button class="btn primary sm" type="button" data-pub="schedule">'+(sch?"Update time":"Schedule")+'</button>'+(sch?'<button class="btn ghost sm" type="button" data-pub="unschedule">Unschedule</button>':"")+'</div>'+
      '<div class="pubdone"><input type="url" id="pubLink" placeholder="Post link (optional)" aria-label="Link to the live post"><button class="btn go sm" type="button" data-pub="posted">Mark posted</button></div>';
  }else html+='<p class="waitnote pubnote">'+(sch?"Marketing posts it at this time.":"Marketing picks the time.")+'</p>';
  const autoOn=!!(metaState&&metaState.connected), job=jobs[it.id]||{};
  if(it.platforms.length) html+='<div class="aplrow">'+it.platforms.map(p=>{
    const nm=pMap[p].s;
    if(!autoOn||!AUTO_P.includes(p)) return '<span class="apl man" title="Post this one yourself">'+esc(nm)+' · You</span>';
    const j=(p==="reel"?job.ig:job.fb)||{}, st=j.state;
    const lab=st==="posted"?"Posted ✓":st==="uploaded"||st==="scheduled"?"Ready ✓":st==="failed"?"Failed":"Auto";
    return '<span class="apl '+(st||"auto")+'" title="'+esc(st==="failed"?(j.error||""):st==="uploaded"||st==="scheduled"?"Uploaded, goes out at the time":"Uploads up to a day before")+'">'+esc(nm)+' · '+lab+'</span>';
  }).join("")+'</div>'+(autoOn&&job.error==="nofile"?'<p class="waitnote pubnote">Final video not found on the NAS.</p>':"");
  html+='<div class="pubacts">'+(latest&&latest.link?'<button class="btn sm" type="button" data-copy="'+esc(latest.link)+'">Copy v'+latest.n+' path</button>':"")+
    (ig||!tt?'<a class="btn sm" href="https://business.facebook.com/" target="_blank" rel="noopener">Meta ↗</a>':"")+(tt?'<a class="btn sm" href="https://www.tiktok.com/tiktokstudio" target="_blank" rel="noopener">TikTok ↗</a>':"")+'</div>';
  setHTML(box,html);
}
$("pubInfo").addEventListener("click",e=>{
  const b=e.target.closest("[data-pub]"); if(!b||!editingId) return;
  if(readOnly||!isMk()){ toast("Marketing schedules and posts."); return }
  const id=editingId, prev=items.get(id); if(!prev) return;
  const base=formData(prev,id), act=b.dataset.pub;
  if(act==="schedule"){
    const d=$("pubDate").value, t=$("pubTime").value; if(!d||!t){ toast("Pick a date and time."); return }
    const at=new Date(d+"T"+t+":00").getTime(); if(!(at>Date.now()-60000)){ toast("That time has already passed."); return }
    if(!base.platforms.length){ toast("Pick at least one platform in Plan first."); setTab("plan"); return }
    const next={...base,status:"scheduled",postAt:at,date:ymd(new Date(at)),remindedAt:0,scheduledBy:myId||"",scheduledAt:Date.now()};
    $("fStatus").value="scheduled"; $("fDate").value=next.date;
    persist(id,next); toast((prev.status==="scheduled"?"Moved to ":"Scheduled for ")+postWhen(at)+".");
  }else if(act==="unschedule"){
    $("fStatus").value="approved"; persist(id,{...base,status:"approved",postAt:0,remindedAt:0}); toast("Unscheduled.");
  }else if(act==="posted"){
    const url=($("pubLink").value||"").trim(); if(url&&!/^https?:\/\/\S+$/i.test(url)){ toast("The link should start with https://"); return }
    $("fStatus").value="posted"; persist(id,{...base,status:"posted",...stamp("posted",id),postUrl:url||base.postUrl||""}); catMove("hop"); toast(base.team==="ecomm"?"Marked live.":"Marked as posted.");
  }
});
async function copyText(t){
  try{ await navigator.clipboard.writeText(t); toast("Copied."); return }catch(e){}
  const ta=document.createElement("textarea"); ta.value=t; ta.style.position="fixed"; ta.style.opacity="0"; $("dlg").appendChild(ta); ta.select();
  try{ document.execCommand("copy"); toast("Copied.") }catch(e){ toast("Couldn’t copy. Select the text and copy it yourself.") }
  ta.remove();
}

/* Notifications: built from versions, feedback and status stamps */
const NT={scheduled:"var(--sched)",shoot:"var(--pink)",shootreply:"var(--ready)",task:"var(--pink)",taskdone:"var(--ready)",planned:"var(--ink-2)",version:"var(--ink-3)",submit:"var(--review)",feedback:"var(--blue)",changes:"var(--edit)",approve:"var(--ready)",posted:"var(--blue)"};
function events(){
  const ev=[];
  versions.forEach(v=>{ const it=items.get(v.item); if(it) ev.push({id:"v:"+v.id,at:v.at,by:v.by,item:it,type:"version",n:v.n}) });
  feedback.forEach(f=>{ const it=items.get(f.item); if(it) ev.push({id:"f:"+f.id,at:f.at,by:f.by,item:it,type:"feedback",n:f.version,t:f.t,text:f.text||(f.files.length?"Attached "+f.files.length+" file"+(f.files.length>1?"s":""):"")}) });
  items.forEach(it=>{
    if(it.createdBy&&it.created) ev.push({id:"n:"+it.id,at:it.created,by:it.createdBy,item:it,type:"planned"});
    if(it.submittedAt) ev.push({id:"s:"+it.id+":"+it.submittedAt,at:it.submittedAt,by:it.submittedBy,item:it,type:"submit",n:it.submittedV});
    if(it.changesAt) ev.push({id:"c:"+it.id+":"+it.changesAt,at:it.changesAt,by:it.changesBy,item:it,type:"changes"});
    if(it.approvedAt) ev.push({id:"a:"+it.id+":"+it.approvedAt,at:it.approvedAt,by:it.approvedBy,item:it,type:"approve"});
    if(it.scheduledAt&&it.postAt&&["scheduled","posted"].includes(it.status)) ev.push({id:"sc:"+it.id+":"+it.scheduledAt,at:it.scheduledAt,by:it.scheduledBy,item:it,type:"scheduled"});
    if(it.postedAt) ev.push({id:"p:"+it.id+":"+it.postedAt,at:it.postedAt,by:it.postedBy,item:it,type:"posted"});
  });
  tasks.forEach(t=>{
    if(t.at) ev.push({id:"k:"+t.id,at:t.at,by:t.by,item:null,type:"task",text:t.text,for:t.for});
    if(t.done&&t.doneAt) ev.push({id:"kd:"+t.id+":"+t.doneAt,at:t.doneAt,by:t.doneBy,item:null,type:"taskdone",text:t.text});
  });
  shoots.forEach(x=>{
    if(x.at) ev.push({id:"sh:"+x.id+":"+x.at,at:x.at,by:x.by,item:null,type:"shoot",shoot:x});
    if(x.respondedAt) ev.push({id:"shr:"+x.id+":"+x.respondedAt,at:x.respondedAt,by:x.respondedBy,item:null,type:"shootreply",shoot:x});
  });
  return ev.filter(e=>e.at).sort((a,b)=>b.at-a.at);
}
const isUnread=e=>(!myId||e.by!==myId)&&e.at>nRead.floor&&!nRead.ids.has(e.id);
function nText(e){
  const t=e.item?'<b>'+esc(e.item.title)+'</b>':'', w='<b>'+esc(who(e.by))+'</b>', v=e.n?' v'+e.n:'';
  if(e.type==="shoot") return w+' booked a shoot with '+esc(e.shoot.talent.map(who).join(", "))+': '+esc(shootWhen(e.shoot))+(e.shoot.title?' · '+esc(e.shoot.title):'');
  if(e.type==="shootreply") return w+(e.shoot.status==="declined"?' can’t make the shoot on ':' confirmed the shoot on ')+esc(shootWhen(e.shoot));
  if(e.type==="task") return w+' added a task for '+ROLE_SHORT[e.for]+': '+esc(e.text);
  if(e.type==="taskdone") return w+' finished: '+esc(e.text);
  if(e.type==="planned") return w+(["marketing","ecomm"].includes(team[e.by])?' assigned ':' planned ')+t+(e.item.date?' for '+esc(shortDate(e.item.date)):'');
  if(e.type==="version") return w+' added v'+e.n+' of '+t;
  if(e.type==="submit") return w+' sent '+t+v+' for review';
  if(e.type==="feedback") return w+' left feedback on '+t+v+(e.t!=null?' at '+fmtSec(e.t):'');
  if(e.type==="changes") return w+' asked for changes on '+t;
  if(e.type==="approve") return w+' approved '+t;
  if(e.type==="scheduled") return w+' scheduled '+t+' for '+esc(postWhen(e.item.postAt));
  if(e.by==="auto") return t+' was posted automatically';
  if(e.item&&e.item.team==="ecomm") return w+' marked '+t+' live';
  return w+' marked '+t+' as posted';
}
function renderNotifs(){
  const list=$("nList");
  const ev=live.items?events():[], unread=ev.filter(isUnread).length;
  $("homeBadge").hidden=!unread; $("homeBadge").textContent=unread>99?"99+":unread;
  if(!live.items){ $("nAll").hidden=true; $("nCount").hidden=true; list.innerHTML='<div class="empty">'+(mode==="db"?"Loading…":"Sign in to see updates.")+'</div>'; return }
  $("nCount").hidden=!unread; $("nCount").textContent=unread; $("nAll").hidden=!unread;
  if(!ev.length){ list.innerHTML='<div class="empty">Nothing yet.</div>'; return }
  list.innerHTML=ev.slice(0,nShow).map(e=>'<button type="button" class="nitem'+(isUnread(e)?" unread":"")+'" data-n="'+esc(e.id)+'" data-item="'+esc(e.item?e.item.id:"")+'" data-kind="'+e.type+'"><span class="dot" style="--k:'+NT[e.type]+'"></span><span><span class="nt">'+nText(e)+'</span>'+
    (e.type==="feedback"&&e.text?'<span class="q">“'+esc(e.text)+'”</span>':"")+'<time>'+esc(fmtTime(e.at))+'</time></span></button>').join("")+
    (ev.length>nShow?'<button type="button" class="btn sm ghost more" id="nMore">Show older</button>':"");
}
function openNotif(b){
  nRead.ids.add(b.dataset.n); saveRead(nRead);
  if($("nDlg").open) $("nDlg").close();
  if(b.dataset.item) goReview(b.dataset.item); else if(/^shoot/.test(b.dataset.kind)) location.hash="shoots"; else goTasks();
  render();
}
function openUpdates(){ nShow=20; renderNotifs(); if(!$("nDlg").open) $("nDlg").showModal() }
$("nList").addEventListener("click",e=>{
  if(e.target.closest("#nMore")){ nShow+=20; renderNotifs(); return }
  const b=e.target.closest(".nitem"); if(b) openNotif(b);
});
$("nAll").onclick=()=>{ nRead={floor:Date.now(),ids:new Set()}; saveRead(nRead); render(); toast("All caught up.") };
$("nClose").onclick=()=>$("nDlg").close();
$("nDlg").addEventListener("click",e=>{ if(e.target===$("nDlg")) $("nDlg").close() });

/* Home: a few big numbers, one word each; tap a tile for the details */
const DOW_LONG=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const ic=d=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>';
const IC={
  fix:ic('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'),
  posted:ic('<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>'),
  tasks:ic('<path d="M4 6.5l1.6 1.6L8.8 5"/><path d="M4 12.5l1.6 1.6 3.2-3.1"/><path d="M4 18.5l1.6 1.6 3.2-3.1"/><path d="M12 7h8M12 13h8M12 19h8"/>'),
  shoot:ic('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>'),
  review:ic('<rect x="3" y="4.5" width="18" height="13" rx="2"/><path d="M10.2 8.4v5.2l4.3-2.6z" fill="currentColor"/><path d="M8 21h8M12 17.5V21"/>'),
  ready:ic('<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  booked:ic('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>'),
  pulse:ic('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
  next:ic('<path d="M5 12h14M13 6l6 6-6 6"/>')
};
const ST1={idea:"Idea",script:"Script",shoot:"Shoot",edit:"Edit",review:"Review",changes:"Fix",approved:"Ready",scheduled:"Scheduled",posted:"Live"};
const ST_K={idea:"var(--ink-3)",script:"var(--ink-3)",shoot:"var(--ink-3)",edit:"var(--edit)",changes:"var(--edit)",review:"var(--review)",approved:"var(--ready)",scheduled:"var(--sched)",posted:"var(--pink)"};
const ago=ms=>{ const m=Math.max(0,Math.round((Date.now()-ms)/60000)); return m<1?"now":m<60?m+"m":m<1440?Math.round(m/60)+"h":Math.round(m/1440)+"d" };
const byDue=(a,b)=>(a.due||a.date||"9999").localeCompare(b.due||b.date||"9999")||(a.date||"9999").localeCompare(b.date||"9999");
function nextUp(){
  const rank=isEc()?{review:0,approved:1}:isMk()?{review:0}:{changes:0,edit:1,shoot:2,script:3,idea:4};
  return [...items.values()].filter(i=>i.status in rank).sort((a,b)=>rank[a.status]-rank[b.status]||byDue(a,b));
}
function tile(cls,icon,word,n,o){
  o=o||{};
  return '<button type="button" class="tile '+cls+'" data-go="'+esc(o.go||"")+'">'+
    '<span class="th"><span class="ti">'+icon+'</span><span>'+esc(word)+'</span>'+(o.pill?'<span class="tp">'+esc(o.pill)+'</span>':"")+'</span>'+
    '<span class="dn">'+n+'</span>'+(o.ticks!=null?'<span class="ticks" style="--p:'+o.ticks+'"></span>':"")+(o.cap?'<span class="cap">'+esc(o.cap)+'</span>':"")+'</button>';
}
function renderHome(){
  const all=[...items.values()], t0=new Date(), nowMs=t0.getTime(), pm=ymd(t0).slice(0,7), today=ymd(t0), r=myRole();
  const cnt=sts=>all.filter(i=>sts.includes(i.status));
  const inMonth=all.filter(i=>i.date.startsWith(pm)), postedM=inMonth.filter(i=>i.status==="posted").length;
  const myT=tasks.filter(t=>!t.done&&(!r||t.for===r)).sort((a,b)=>(a.due||"9999").localeCompare(b.due||"9999")||a.at-b.at), lateT=myT.filter(t=>t.due&&t.due<today).length;
  const myShoots=shoots.filter(x=>x.end>nowMs&&x.status!=="cancelled"&&(!isHr()||x.talent.includes(myId))).sort((a,b)=>a.start-b.start);
  const first=list=>list.slice().sort(byDue)[0];
  const tasksTile=tile("c"+(isHr()?" solo":""),IC.tasks,"Tasks",myT.length,{go:"view:tasks",pill:lateT?lateT+" late":"",cap:myT.length?myT[0].text:"All done"});
  const toPost=cnt(["approved","scheduled"]).filter(i=>i.team!=="ecomm"), sched=toPost.filter(i=>i.status==="scheduled"&&i.postAt).sort((a,b)=>a.postAt-b.postAt), noTime=toPost.length-sched.length, dueN=sched.filter(i=>i.postAt<=nowMs).length, nextP=sched.find(i=>i.postAt>nowMs);
  const postedTile=tile("b green",IC.posted,"To post",toPost.length,{go:"scroll:posting",pill:dueN?dueN+" due":noTime?noTime+" no time":"",cap:nextP?"Next · "+postWhen(nextP.postAt):toPost.length?"No times yet":"All posted"});
  let tiles;
  if(isHr()){
    const ask=myShoots.filter(x=>x.status==="proposed"), conf=myShoots.filter(x=>x.status==="confirmed");
    tiles=tile("a pink",IC.shoot,"To confirm",ask.length,{go:"view:shoots",cap:ask.length?shootWhen(ask[0]):"All replied"})+
      tile("b green",IC.booked,"Booked",conf.length,{go:"view:shoots",cap:conf.length?shootWhen(conf[0]):"Nothing booked"})+tasksTile;
  }else if(isEc()){
    const rv=cnt(["review"]), ap=cnt(["approved","scheduled"]), wip=cnt(["idea","script","shoot","edit","changes"]), f=first(rv), g=first(ap), w=first(wip);
    tiles=tile("a pink",IC.review,"To review",rv.length,{go:f?"item:"+f.id:"view:review",cap:f?f.title:"All clear"})+
      tile("b green",IC.ready,"Approved",ap.length,{go:g?"publish:"+g.id:"view:review",cap:g?g.title:"Nothing to upload"})+tasksTile+
      tile("d",IC.next,"Requests",wip.length,{go:"view:pipeline",cap:w?w.title+(w.due||w.date?" · "+shortDate(w.due||w.date):""):"None open"});
  }else if(isMk()){
    const rv=cnt(["review"]), ap=cnt(["approved"]), f=first(rv), g=first(ap);
    tiles=tile("a pink",IC.review,"To review",rv.length,{go:f?"item:"+f.id:"view:review",cap:f?f.title:"All clear"})+postedTile+tasksTile+
      tile("d",IC.ready,"To schedule",ap.length,{go:g?"publish:"+g.id:"scroll:posting",cap:g?g.title:"All set"});
  }else{
    const ch=cnt(["changes"]), f=first(ch), wait=myShoots.filter(x=>x.status==="proposed").length, upS=myShoots.filter(x=>x.status!=="declined");
    tiles=tile("a pink",IC.fix,"To fix",ch.length,{go:f?"item:"+f.id:"view:review",pill:inbox.length?inbox.length+" new file"+(inbox.length>1?"s":""):"",cap:f?f.title:"All clear"})+postedTile+tasksTile+
      tile("d",IC.shoot,"Shoots",upS.length,{go:"view:shoots",pill:wait?wait+" waiting":"",cap:upS.length?shootWhen(upS[0]):"None booked"});
  }
  const strip=isHr()?"":isEc()?'<div class="hstrip">'+EC_PIPE.map(g=>'<button type="button" class="hs" data-go="'+(g.id==="review"?"view:review":"view:pipeline")+'"><span class="dn">'+cnt(g.sts).length+'</span><span class="pl" style="--k:'+g.k+'"><i></i>'+g.name+'</span></button>').join("")+'</div>':'<div class="hstrip">'+[
    ["Ideas",cnt(["idea","script"]).length,"var(--ink-3)","view:pipeline"],
    ["Making",cnt(["shoot","edit","changes"]).length,"var(--edit)","view:pipeline"],
    ["Review",cnt(["review"]).length,"var(--review)","view:review"],
    ["To post",cnt(["approved","scheduled"]).length,"var(--sched)","scroll:posting"],
    ["Posted",cnt(["posted"]).length,"var(--pink)","view:pipeline"]
  ].map(([w,n,k,go])=>'<button type="button" class="hs" data-go="'+go+'"><span class="dn">'+n+'</span><span class="pl" style="--k:'+k+'"><i></i>'+w+'</span></button>').join("")+'</div>';
  /* Updates: last 14 days as a dot timeline, plus the latest three */
  const ev=live.items?events():[], unread=ev.filter(isUnread).length;
  const days=[]; for(let i=13;i>=0;i--) days.push(ymd(new Date(t0.getFullYear(),t0.getMonth(),t0.getDate()-i)));
  const byDay={}; ev.forEach(e=>{ const k=ymdOf(e.at); (byDay[k]=byDay[k]||[]).push(e) });
  const dots=days.map((d,i)=>{ const list=byDay[d]||[]; let h=""; for(let j=0;j<6;j++){ const e=list[j]; h+=e?'<i class="on" style="--k:'+NT[e.type]+'"></i>':'<i></i>' }
    return '<div class="tl-col'+(i===13?" today":"")+'" title="'+esc(shortDate(d)+": "+list.length+" update"+(list.length===1?"":"s"))+'">'+h+'</div>' }).join("");
  const labs=days.map((d,i)=>'<span>'+(i===0||i===7?esc(shortDate(d)):i===13?"Today":"")+'</span>').join("");
  const glass='<button type="button" class="glass" data-go="updates">'+(unread?'<span class="dn">'+unread+'</span><span><b>new</b></span>':'<span><b>All read</b></span>')+'</button>';
  const theirs=ev.filter(e=>!myId||e.by!==myId);
  const rows=(theirs.length?theirs:ev).slice(0,3).map(e=>'<button type="button" class="ur'+(isUnread(e)?" unread":"")+'" data-n="'+esc(e.id)+'" data-item="'+esc(e.item?e.item.id:"")+'" data-kind="'+e.type+'"><span class="dot" style="--k:'+NT[e.type]+'"></span><span class="tx">'+nText(e)+'</span><time>'+ago(e.at)+'</time></button>').join("");
  const upd='<section class="hcard upd"><h2 class="ch"><span class="ti">'+IC.pulse+'</span>Updates<button type="button" class="btn sm see" data-go="updates">See all</button></h2>'+
    '<div class="tl">'+glass+'<div class="tl-dots">'+dots+'</div><div class="tl-lab">'+labs+'</div></div>'+
    '<div class="ul">'+(rows||'<div class="empty">'+(live.items?"Nothing yet.":mode==="db"?"Loading…":"Sign in to see updates.")+'</div>')+'</div></section>';
  /* Next up */
  let nrows, more;
  if(isHr()){
    nrows=myShoots.slice(0,4).map(x=>'<button type="button" class="nx" data-go="view:shoots"><span class="dot" style="--k:var(--pink)"></span><span class="tx">'+esc(x.title||"Shoot")+'</span><span class="pl" style="--k:'+(x.status==="confirmed"?"var(--ready)":"var(--review)")+'"><i></i>'+esc(shootWhen(x).split(",")[0])+'</span></button>').join("");
    more=myShoots.length>4?"view:shoots":"";
  }else{
    const list=nextUp();
    nrows=list.slice(0,4).map(i=>{ const d=["review","approved"].includes(i.status)?i.date:(i.due||i.date);
      return '<button type="button" class="nx" data-go="item:'+esc(i.id)+'"><span class="dot" style="--k:'+sMap[i.series].c+'"></span><span class="tx">'+esc(i.title)+'</span><span class="pl" style="--k:'+ST_K[i.status]+'"><i></i>'+esc(ST1[i.status])+(d?" · "+esc(shortDate(d)):"")+'</span></button>' }).join("");
    more=list.length>4?"view:pipeline":"";
  }
  const nxCard='<section class="hcard"><h2 class="ch"><span class="ti">'+IC.next+'</span>Next'+(more?'<button type="button" class="btn sm see" data-go="'+more+'">See all</button>':"")+'</h2><div class="ul">'+(nrows||'<div class="empty">All clear.</div>')+'</div></section>';
  const newCard=(readOnly||isHr())?"":'<button type="button" class="newc" data-go="new"><span class="plus" aria-hidden="true">+</span><span><b>'+(isMk()?"New request":"New")+'</b><small>Video or design</small></span><span class="stack" aria-hidden="true"><i></i><i></i><i></i></span></button>';
  /* Posting: a 14-day ruler (3 days back, 10 ahead) with a dot per post; the pill shows the chosen one */
  let posting="";
  if(!isHr()&&!isEc()){
    const DAYS=14, start=new Date(t0.getFullYear(),t0.getMonth(),t0.getDate()-3).getTime();
    const dayIdx=ms=>{ const d=new Date(ms); d.setHours(0,0,0,0); return Math.round((d.getTime()-start)/864e5) };
    const evs=[...sched.map(i=>({i,at:i.postAt,k:i.postAt<=nowMs?"due":"sch"})),...cnt(["posted"]).filter(i=>i.postedAt>=start).map(i=>({i,at:i.postedAt,k:"done"}))];
    const cols=Array.from({length:DAYS},()=>[]); let later=0;
    evs.forEach(e=>{ const d=dayIdx(e.at); if(d>=DAYS) later++; else if(d>=0) cols[d].push(e) });
    const pick=evs.find(e=>e.i.id===postSel)||evs.filter(e=>e.k==="due").sort((a,b)=>a.at-b.at)[0]||evs.filter(e=>e.k==="sch").sort((a,b)=>a.at-b.at)[0]||evs.slice().sort((a,b)=>b.at-a.at)[0];
    const ruler='<div class="pt-rail">'+cols.map((c,d)=>{ const day=new Date(start+d*864e5);
      return '<div class="pt-col'+(d===3?" today":d<3?" past":"")+'"><div class="pt-dots">'+c.sort((a,b)=>a.at-b.at).slice(0,3).map(e=>'<button type="button" class="pt-dot '+e.k+(pick&&e.i.id===pick.i.id?" sel":"")+'" data-psel="'+esc(e.i.id)+'" title="'+esc(e.i.title+" · "+postWhen(e.at))+'" aria-label="'+esc(e.i.title+", "+postWhen(e.at))+'"></button>').join("")+'</div>'+
        '<i class="pt-tick"></i><span class="pt-lab">'+(d===3?"Today":day.getDate())+'</span></div>' }).join("")+(later?'<span class="pt-later">+'+later+' later</span>':"")+'</div>';
    const pill=pick?'<button type="button" class="pt-pill '+pick.k+'" data-go="'+(isMk()&&pick.k!=="done"?"publish:":"item:")+esc(pick.i.id)+'"><span class="pt-ic">'+IC.posted+'</span><span class="pt-tx"><b>'+esc(pick.i.title)+'</b><span>'+esc(postWhen(pick.at))+(pick.i.platforms.length?" · "+esc(pick.i.platforms.map(x=>pMap[x].s).join(", ")):"")+'</span></span><span class="pt-st">'+(pick.k==="done"?"Posted":pick.k==="due"?"Due now":(metaState&&metaState.connected&&pick.i.platforms.length&&pick.i.platforms.every(p=>AUTO_P.includes(p))?"Auto":"Scheduled"))+'</span></button>'
      :'<div class="pt-pill empty"><span class="pt-ic">'+IC.posted+'</span><span class="pt-tx"><b>Nothing scheduled</b><span>'+(toPost.length?toPost.length+" waiting for a time":"All posted")+'</span></span></div>';
    const nt=toPost.filter(i=>!(i.status==="scheduled"&&i.postAt));
    const ntRow=nt.length?'<div class="pt-nt"><span class="pt-ntl">No time</span>'+nt.slice(0,6).map(i=>'<button type="button" class="pt-chip" data-go="'+(isMk()?"publish:":"item:")+esc(i.id)+'" style="--c:'+sMap[i.series].c+'">'+esc(i.title)+'</button>').join("")+(nt.length>6?'<span class="pt-ntl">+'+(nt.length-6)+'</span>':"")+'</div>':"";
    posting='<section class="hcard posting" id="posting"><h2 class="ch"><span class="ti">'+IC.posted+'</span>Posting'+
      '<span class="pl" style="--k:var(--sched)"><i></i>'+toPost.length+' to post</span>'+(dueN?'<span class="pl" style="--k:var(--pink)"><i></i>'+dueN+' due</span>':"")+
      '<span class="pmonth" title="Posted this month">'+postedM+' / '+inMonth.length+' in '+MONTHS[t0.getMonth()].slice(0,3)+'<span class="pticks" style="--p:'+(inMonth.length?(postedM/inMonth.length).toFixed(3):0)+'"></span></span></h2>'+
      '<div class="pt">'+ruler+pill+ntRow+'</div></section>';
  }
  setHTML($("homeView"),strip+'<div class="hgrid">'+tiles+'</div>'+posting+'<div class="hrow">'+upd+'<div class="hside">'+nxCard+newCard+'</div></div>');
}
let postSel=null;
$("homeView").addEventListener("click",e=>{
  const n=e.target.closest("[data-n]"); if(n){ openNotif(n); return }
  const ps=e.target.closest("[data-psel]");
  if(ps){ const it=items.get(ps.dataset.psel); if(postSel===ps.dataset.psel&&it){ if(isMk()&&it.status!=="posted"){ openItem(it.id); setTab("publish") } else goReview(it.id); return } postSel=ps.dataset.psel; renderHome(); return }
  const b=e.target.closest("[data-go]"); if(!b||!b.dataset.go) return;
  const i=b.dataset.go.indexOf(":"), k=i<0?b.dataset.go:b.dataset.go.slice(0,i), v=i<0?"":b.dataset.go.slice(i+1);
  if(k==="view"){ if(v==="tasks") taskOpen.add(myRole()||"content"); window.scrollTo(0,0); location.hash=v }
  else if(k==="item") goReview(v);
  else if(k==="publish"){ openItem(v); setTab("publish") }
  else if(k==="new") openItem(null,"");
  else if(k==="updates") openUpdates();
  else if(k==="scroll"){ const el=document.getElementById(v); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}) }
});

/* Tasks: its own page in the rail, one column per role */
const ROLE_SHORT={content:"Content",marketing:"Marketing",ecomm:"E-commerce",hr:"HR"};
const tkShowDone={}, taskOpen=new Set();
const taskCols=()=>{ const r=myRole(); return !r||r==="content"?["content","marketing","ecomm","hr"]:[r,"content"] };
function taskRow(t){
  const late=!t.done&&t.due&&t.due<todayStr, today=!t.done&&t.due===todayStr;
  const meta=[t.due?'<span class="'+(late?"late":"")+'">'+(late?"Overdue, ":today?"Today, ":"Due ")+esc(shortDate(t.due))+'</span>':"",
    t.done&&t.doneBy?'<span>Done by '+esc(who(t.doneBy))+'</span>':(t.by&&t.by!==myId?'<span>from '+esc(who(t.by))+'</span>':"")].filter(Boolean).join("");
  return '<div class="tk'+(t.done?" done":"")+'" data-id="'+esc(t.id)+'"><button type="button" class="tkchk" role="checkbox" aria-checked="'+t.done+'" aria-label="'+(t.done?"Mark not done: ":"Mark done: ")+esc(t.text)+'"></button>'+
    '<div><span class="tkt">'+esc(t.text)+'</span>'+(meta?'<span class="tkm">'+meta+'</span>':"")+'</div>'+
    (readOnly?"":'<button type="button" class="tkx" aria-label="Delete task: '+esc(t.text)+'">×</button>')+'</div>';
}
function renderTasks(){
  const r=myRole();
  const myOpen=r?tasks.filter(t=>t.for===r&&!t.done).length:0;
  $("tkBadge").hidden=!myOpen; $("tkBadge").textContent=myOpen;
  if(view!=="tasks") return;
  const ready=mode==="db"&&live.tasks, cols=taskCols();
  $("tkForm").hidden=!ready||readOnly;
  const sel=$("tkFor"), opts=cols.map(k=>'<option value="'+k+'">→ '+esc(ROLE_SHORT[k])+'</option>').join("");
  if(sel._opts!==opts){ sel.innerHTML=opts; sel._opts=opts; sel.dataset.touched="" }
  if(!sel.dataset.touched) sel.value="content";
  $("tkCols").innerHTML=cols.map(role=>{
    if(!ready) return '<section class="qg tkg" style="--k:'+ROLES[role].k+'">'+qbtn(role,ROLE_SHORT[role],0,false,"data-tg",{can:false})+'</section>';
    const all=tasks.filter(t=>t.for===role);
    const open=all.filter(t=>!t.done).sort((a,b)=>(a.due||"9999").localeCompare(b.due||"9999")||a.at-b.at);
    const done=all.filter(t=>t.done).sort((a,b)=>b.doneAt-a.doneAt).slice(0,20);
    const show=!!tkShowDone[role];
    const isOpen=taskOpen.has(role)&&all.length>0, late=open.some(t=>t.due&&t.due<todayStr);
    return '<section class="qg tkg'+(isOpen?" open":"")+(role===r?" mine":"")+'" style="--k:'+ROLES[role].k+'">'+qbtn(role,role===r&&r!=="content"?"Yours":ROLE_SHORT[role],open.length,isOpen,"data-tg",{can:all.length>0,hot:late})+
      (isOpen?'<div class="qlist tklist"><div class="list">'+(open.length?open.map(taskRow).join(""):'<div class="empty">All done.</div>')+'</div>'+
      (done.length?'<button class="tkdone-t" type="button" data-for="'+role+'">'+(show?"Hide":"Show")+' done ('+done.length+')</button>'+(show?'<div class="list">'+done.map(taskRow).join("")+'</div>':""):"")+'</div>':"")+'</section>';
  }).join("");
}
$("tkFor").addEventListener("change",()=>{ $("tkFor").dataset.touched="1" });
$("tasks").addEventListener("click",e=>{ const g=e.target.closest("[data-tg]"); if(g){ const k=g.dataset.tg; taskOpen.has(k)?taskOpen.delete(k):taskOpen.add(k); renderTasks(); return } const b=e.target.closest(".tkdone-t"); if(b){ tkShowDone[b.dataset.for]=!tkShowDone[b.dataset.for]; renderTasks() } });
$("tkForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const text=$("tkText").value.trim(); if(!text||!db){ $("tkText").focus(); return }
  const f=$("tkFor").value;
  const t={text:text.slice(0,200),for:ROLES[f]?f:"content",due:$("tkDue").value||"",done:false,doneBy:"",doneAt:0,by:myId||"",at:Date.now()};
  $("tkText").value=""; $("tkDue").value=""; $("tkText").focus();
  try{ await db.collection("tasks").add(t); toast(t.for===myRole()?"Task added.":"Task sent to "+ROLE_SHORT[t.for]+".") }
  catch(err){ $("tkText").value=text; writeErr(err,"tasks") }
});
async function taskClick(e){
  const row=e.target.closest(".tk"); if(!row||!db) return;
  const t=tasks.find(x=>x.id===row.dataset.id); if(!t) return;
  const ref=db.collection("tasks").doc(t.id);
  if(e.target.closest(".tkchk")){
    if(readOnly){ toast("This plan is view only for you."); return }
    const done=!t.done;
    e.target.closest(".tkchk").setAttribute("aria-checked",done); if(done) row.classList.add("leaving");
    try{ await ref.update(done?{done:true,doneBy:myId||"",doneAt:Date.now()}:{done:false,doneBy:"",doneAt:0}); if(done) toast("Done: "+t.text) }
    catch(err){ writeErr(err,"tasks"); renderTasks() }
    return;
  }
  const x=e.target.closest(".tkx");
  if(x){ if(!x.dataset.armed){ x.dataset.armed="1"; x.textContent="Delete?"; return } try{ await ref.delete() }catch(err){ writeErr(err,"tasks") } }
}
$("tasks").addEventListener("click",taskClick);
function goTasks(){ taskOpen.add(myRole()||"content"); window.scrollTo(0,0); if(view!=="tasks") location.hash="tasks"; else render() }

/* Roles: set by the studio owner in the Team screen */
const ROLE_HINT={content:"Sees and makes everything.",marketing:"Asks for videos, reviews and approves its own work.",ecomm:"Asks for designs and videos, reviews and approves its own work.",hr:"Sees their shoots with the scripts, and their tasks."};
function maybeAskRole(){}
async function renderRoleDlg(){
  const r=myRole();
  $("myRoleLine").textContent=r?("You’re "+ROLES[r].name+"."+(amOwner?"":" The owner can change it.")):"No role yet. Ask the owner to add you.";
  $("teamBox").hidden=!amOwner;
  renderSocial();
  if(!amOwner||!window.gzTeam) return;
  const roleOpts=v=>Object.entries(ROLES).map(([k,x])=>'<option value="'+k+'"'+(v===k?" selected":"")+'>'+esc(x.name)+'</option>').join("");
  $("teamRole").innerHTML=roleOpts("ecomm");
  let list=[];
  try{ list=await window.gzTeam.list() }catch(e){ $("teamList").innerHTML='<p class="empty">Couldn’t load the team.</p>'; return }
  $("teamList").innerHTML=list.map(m=>'<div class="teamrow"><span class="tm"><b>'+esc(m.email)+'</b>'+(m.is_owner?' <i>owner</i>':"")+'</span>'+
    (m.is_owner?'<span class="tmr">'+esc(ROLES[m.role].name)+'</span>':'<span class="tmr"><select data-email="'+esc(m.email)+'" aria-label="Role for '+esc(m.email)+'">'+roleOpts(m.role)+'</select>'+
    '<button type="button" class="btn ghost sm" data-rm="'+esc(m.email)+'">Remove</button></span>')+'</div>').join("");
}
function openRole(){ renderRoleDlg(); $("roleDlg").showModal() }
/* Social: connect Facebook & Instagram so Reels and Page posts go out by themselves */
async function loadMeta(){
  if(!window.gzMeta||mode!=="db") return;
  try{ metaState=await window.gzMeta.status() }catch(e){ metaState={connected:false,error:e.message} }
  if($("roleDlg").open) renderSocial(); if(view==="home") renderHome(); if($("dlg").open&&editingId) renderPublish();
}
function renderSocial(){
  const can=!!window.gzMeta&&!previewRole&&(amOwner||isMk());
  $("socialBox").hidden=!can; if(!can) return;
  const m=metaState;
  if(!m){ $("socialLine").textContent="Checking…"; $("socialSetup").hidden=true; $("socialActs").innerHTML=""; loadMeta(); return }
  const on=!!m.connected;
  $("socialLine").innerHTML=on?'<b class="ok">✓ Connected</b> '+esc([m.page,m.ig?"@"+m.ig:""].filter(Boolean).join(" · "))+(m.error?'<br><span class="err">'+esc(m.error)+'</span>':"")
    :(m.error?'<span class="err">'+esc(m.error)+'</span>':"Not connected. Once connected, Reels and Facebook posts go out by themselves.");
  $("socialSetup").hidden=on;
  $("metaSteps").innerHTML='<li>Instagram must be a <b>Business</b> account linked to the Gearizo <b>Facebook Page</b>, and you must be an admin of that Page.</li>'+
    '<li>On <b>developers.facebook.com</b>: My Apps → <b>Create app</b> → <b>Other</b> → <b>Business</b>.</li>'+
    '<li>In the app, add <b>Facebook Login for Business</b> and <b>Instagram</b> (API setup with Facebook login).</li>'+
    '<li>Facebook Login for Business → Settings → <b>Valid OAuth Redirect URIs</b>: paste this, then Save.<div class="row"><code>'+esc(m.callback||"")+'</code><button class="btn ghost sm" type="button" data-copy="'+esc(m.callback||"")+'">Copy</button></div></li>'+
    '<li>App settings → <b>Basic</b>: copy the <b>App ID</b> and <b>App Secret</b> into the boxes above.</li>'+
    '<li>Press <b>Connect</b>, sign in, tick the Gearizo Page and Instagram account, and allow everything.</li>';
  $("socialActs").innerHTML=on?'<button class="btn sm" type="button" data-meta="check">Check</button><button class="btn ghost sm danger" type="button" data-meta="off">Disconnect</button>'
    :'<button class="btn primary sm" type="button" data-meta="go">Connect Facebook &amp; Instagram</button>';
}
$("socialBox").addEventListener("click",async e=>{
  const cp=e.target.closest("[data-copy]"); if(cp){ copyText(cp.dataset.copy); return }
  const b=e.target.closest("[data-meta]"); if(!b||!window.gzMeta) return;
  const act=b.dataset.meta;
  try{
    if(act==="go"){ b.disabled=true; b.textContent="Opening Facebook…"; await window.gzMeta.start($("metaAppId").value.trim(),$("metaSecret").value.trim()); return }
    if(act==="check"){ b.disabled=true; b.textContent="Checking…"; const r=await window.gzMeta.check(); toast(r.ok?"Working: "+[r.page,r.ig?"@"+r.ig:""].filter(Boolean).join(" · "):"Problem: "+r.error) }
    if(act==="off"){ if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="Tap again to disconnect"; return } await window.gzMeta.disconnect(); toast("Disconnected. Posts go back to reminders.") }
  }catch(err){ toast("Couldn’t do that: "+err.message); b.disabled=false }
  metaState=null; loadMeta();
});
/* Back from Facebook sign-in */
(function(){ const q=new URLSearchParams(location.search); if(!q.has("meta")) return;
  const ok=q.get("meta")==="ok", why=q.get("why")||"";
  history.replaceState(null,"",location.pathname+location.hash);
  setTimeout(()=>{ toast(ok?"Facebook & Instagram connected.":"Couldn’t connect: "+why); if(ok) openRole() },1500);
})();
$("roleBtn").onclick=openRole;
$("roleClose").onclick=()=>$("roleDlg").close();
$("roleDlg").addEventListener("click",async e=>{
  if(e.target===$("roleDlg")){ $("roleDlg").close(); return }
  const rm=e.target.closest("[data-rm]"); if(!rm) return;
  if(!rm.dataset.armed){ rm.dataset.armed="1"; rm.textContent="Tap again to remove"; return }
  try{ await window.gzTeam.remove(rm.dataset.rm); toast(rm.dataset.rm+" removed from the studio."); renderRoleDlg() }catch(err){ toast("Couldn’t remove: "+err.message) }
});
$("teamList").addEventListener("change",async e=>{
  const sel=e.target.closest("select[data-email]"); if(!sel) return;
  try{ await window.gzTeam.setRole(sel.dataset.email,sel.value); toast(sel.dataset.email+" is now "+ROLES[sel.value].name+".") }catch(err){ toast("Couldn’t change the role: "+err.message) }
});
$("teamAdd").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("teamEmail").value.trim().toLowerCase(), role=$("teamRole").value;
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast("Enter a full email address."); $("teamEmail").focus(); return }
  try{ await window.gzTeam.add(email,role); $("teamEmail").value=""; toast(email+" added as "+ROLES[role].name+". They can sign up now."); renderRoleDlg() }
  catch(err){ toast(/duplicate|already/i.test(err.message)?"That email is already on the team.":"Couldn’t add: "+err.message) }
});

/* Instant heads-up while the page is open: a soft chime and the cat pops up */
let audioCtx=null, seenTasks=null;
document.addEventListener("pointerdown",()=>{ if(!audioCtx){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)() }catch(e){} } },{once:true});
function chime(){
  if(!audioCtx) return;
  try{
    const t0=audioCtx.currentTime;
    [[880,0],[1318.5,.14]].forEach(([f,d])=>{
      const o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.type="sine"; o.frequency.value=f; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0,t0+d); g.gain.linearRampToValueAtTime(.18,t0+d+.02); g.gain.exponentialRampToValueAtTime(.001,t0+d+.5);
      o.start(t0+d); o.stop(t0+d+.55);
    });
  }catch(e){}
}
function taskWatch(){
  const ids=new Set(tasks.map(t=>t.id));
  if(seenTasks===null){ seenTasks=ids; return }
  const fresh=tasks.filter(t=>!seenTasks.has(t.id)&&!t.done&&t.by&&t.by!==myId&&(!myRole()||t.for===myRole()));
  seenTasks=ids;
  if(!fresh.length) return;
  const t=fresh[0];
  chime(); catMove("hop");
  catSays("New task from "+who(t.by),t.text+(t.due?" (due "+shortDate(t.due)+")":"")+(fresh.length>1?" +"+(fresh.length-1)+" more":""),{label:"Open Tasks",fn:goTasks});
}

/* Studio cat */
let catT, catGo=null;
function catSays(title,text,go){
  const b=$("catSay");
  b.innerHTML='<b>'+esc(title)+'</b>'+esc(text)+(go?'<br><button type="button" class="go">'+esc(go.label)+' →</button>':"");
  catGo=go||null; b.hidden=false;
  clearTimeout(catT); catT=setTimeout(()=>{ b.hidden=true },7000);
}
function catMove(cls){ stopWalk(); const c=$("cat"); c.classList.remove("hop","poke"); void c.offsetWidth; c.classList.add(cls) }
const CHEERS=["Meow. Keep going.","Good videos take a few tries.","Stretch break? Then one more cut.","Hooks in the first 2 seconds!","You’re doing great."];
function catSummary(){
  const r=myRole(), all=[...items.values()], first=a=>a.slice().sort((x,y)=>(x.due||x.date||"9999").localeCompare(y.due||y.date||"9999"))[0];
  const cheer=CHEERS[Math.floor(Math.random()*CHEERS.length)];
  const late=tasks.filter(t=>!t.done&&t.for===myRole()&&t.due&&t.due<todayStr);
  if(late.length) return catSays(late.length+" task"+(late.length>1?"s":"")+" overdue","“"+late[0].text+"” was due "+shortDate(late[0].due)+".",{label:"See tasks",fn:goTasks});
  if(!live.items) return catSays("Meow!","Sign in to claude.ai and I’ll keep track of your videos.");
  if(!r) return catSays("Meow! Who are you?","Pick your role and I’ll tell you what’s waiting for you.",{label:"Choose your role",fn:openRole});
  if(r==="content"){
    if(inbox.length) return catSays(inbox.length+" new in Checking","“"+inbox[0].name+"” needs to know which content it belongs to.",{label:"Pick it",fn:()=>goReview(selId)});
    const ch=all.filter(i=>i.status==="changes"), wip=all.filter(i=>["idea","script","shoot","edit"].includes(i.status));
    if(ch.length){ const f=first(ch); return catSays(ch.length+" to fix","“"+f.title+"” needs changes"+(ch.length>1?", plus "+(ch.length-1)+" more":"")+". "+cheer,{label:"Open it",fn:()=>goReview(f.id)}) }
    if(wip.length){ const f=first(wip); return catSays(wip.length+" in progress","Next up: “"+f.title+"”"+(f.due?", first cut due "+shortDate(f.due):f.date?", posting "+shortDate(f.date):"")+". "+cheer,{label:"Open it",fn:()=>goReview(f.id)}) }
    return catSays("All clear!","Nothing to make or fix right now. Nap time?");
  }
  const dueP=all.filter(i=>i.status==="scheduled"&&i.postAt&&i.postAt<=Date.now());
  if(dueP.length){ const f=dueP[0]; return catSays("Time to post","“"+f.title+"” was set for "+postWhen(f.postAt)+".",{label:"Open Publish",fn:()=>{ openItem(f.id); setTab("publish") }}) }
  const rv=all.filter(i=>i.status==="review"), ap=all.filter(i=>i.status==="approved");
  if(rv.length){ const f=first(rv); return catSays(rv.length+" to review","“"+f.title+"” is waiting for you"+(ap.length?". "+ap.length+" approved and ready to post.":"."),{label:"Watch it",fn:()=>goReview(f.id)}) }
  if(ap.length){ const f=first(ap); return catSays(ap.length+(isEc()?" approved":" to schedule"),"“"+f.title+"” is approved. "+(isEc()?"Mark it live once it’s up.":"Pick a posting time."),{label:"Open Publish",fn:()=>{ openItem(f.id); setTab("publish") }}) }
  return catSays("All clear!","Nothing to review. Maybe assign the next video?");
}
function catWatch(before,after){
  for(const [id,it] of after){
    const old=before.get(id); if(!old||old.status===it.status) continue;
    const by=it.status==="scheduled"?it.scheduledBy:it.status==="approved"?it.approvedBy:it.status==="posted"?it.postedBy:it.status==="changes"?it.changesBy:it.status==="review"?it.submittedBy:"";
    const name=by?who(by):"Someone";
    const ding=()=>{ if(by&&by!==myId) chime() };
    if(it.status==="approved"){ ding(); catMove("hop"); catSays("Approved!",name+" approved “"+it.title+"”. Nice work.",{label:"Open it",fn:()=>goReview(id)}); return }
    if(it.status==="scheduled"&&isCr()){ ding(); catMove("hop"); catSays("Scheduled",name+" will post “"+it.title+"” "+postWhen(it.postAt)+".",{label:"Open it",fn:()=>goReview(id)}); return }
    if(it.status==="posted"){ ding(); catMove("hop"); catSays("It’s live!","“"+it.title+"” is posted. Meow!"); return }
    if(it.status==="changes"&&isCr()){ ding(); catMove("poke"); catSays("Changes asked",name+" left notes on “"+it.title+"”. You got this.",{label:"See notes",fn:()=>goReview(id)}); return }
    if(it.status==="review"&&isMk()){ ding(); catMove("poke"); catSays("New video to watch",name+" sent “"+it.title+"” for review.",{label:"Watch it",fn:()=>goReview(id)}); return }
  }
}
$("cat").onclick=()=>{ if(!$("catSay").hidden&&!walking){ $("catSay").hidden=true; return } catMove("poke"); catSummary() };
$("catSay").addEventListener("click",e=>{ if(e.target.closest(".go")&&catGo){ const g=catGo; $("catSay").hidden=true; g.fn() } });

/* The cat goes for a stroll every minute or so, then walks home */
const calmMotion=window.matchMedia("(prefers-reduced-motion: reduce)");
let walking=null;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function catHome(){
  const c=$("cat");
  if(walking) walking.anims.forEach(a=>{ try{a.cancel()}catch(e){} });
  c.classList.remove("walking","rest"); c.style.left=c.style.top="";
  walking=null;
}
function stopWalk(){ if(walking){ walking.stop=true; catHome() } }
async function catWalk(){
  const c=$("cat");
  if(walking||calmMotion.matches||document.hidden||!$("catSay").hidden||$("dlg").open||$("roleDlg").open||typeof c.animate!=="function") return;
  const r=c.getBoundingClientRect(); if(!r.width) return;
  const vw=document.documentElement.clientWidth, minX=16, maxX=vw-16-r.width;
  if(maxX-minX<160) return;
  let tx=r.left; for(let i=0;i<8&&Math.abs(tx-r.left)<140;i++) tx=minX+Math.random()*(maxX-minX);
  if(Math.abs(tx-r.left)<140) return;
  const dx=Math.round(tx-r.left), ms=Math.abs(dx)/65*1000, face=d=>d<0?" scaleX(-1)":"";
  const state={stop:false,anims:[]}; walking=state;
  c.classList.add("walking"); c.style.left=r.left+"px"; c.style.top=r.top+"px";
  try{
    const out=c.animate([{transform:"translateX(0)"+face(dx)},{transform:"translateX("+dx+"px)"+face(dx)}],{duration:ms,easing:"linear",fill:"forwards"});
    state.anims.push(out); await out.finished; if(state.stop) return;
    c.classList.add("rest"); await pause(2400); if(state.stop) return; c.classList.remove("rest");
    const back=c.animate([{transform:"translateX("+dx+"px)"+face(-dx)},{transform:"translateX(0)"+face(-dx)}],{duration:ms,easing:"linear",fill:"forwards"});
    state.anims.push(back); await back.finished;
  }catch(e){}
  finally{ if(walking===state) catHome() }
}
(function strollLater(first){ setTimeout(()=>{ catWalk(); strollLater(false) }, first?6000:30000) })(true);
window.addEventListener("resize",stopWalk);

/* Focus products */
const monthKey=()=>cursor.getFullYear()+"-"+pad(cursor.getMonth()+1);
function renderFocus(){
  const list=$("fpList"), mk=monthKey(), label=MONTHS[cursor.getMonth()];
  $("fpTitle").textContent="Focus · "+label.slice(0,3);
  $("fpSub").textContent=narrow.matches?"Tap a product to plan a video for it.":"Drag a product onto a day to plan it, or tap it to open the form.";
  if(!live.focus){ $("fpForm").hidden=true; list.innerHTML='<div class="empty">'+(mode==="db"?"Loading…":"Sign in to claude.ai to see focus products.")+'</div>'; return }
  $("fpForm").hidden=focusRO;
  const mine=focus.filter(f=>f.month===mk);
  if(!mine.length){ list.innerHTML='<div class="empty">None yet.</div>'; return }
  list.innerHTML=mine.map(f=>{
    const n=[...items.values()].filter(i=>i.product===f.name&&i.date.startsWith(mk)).length;
    return '<div class="pchip" draggable="'+(!readOnly)+'" data-name="'+esc(f.name)+'" data-id="'+esc(f.id)+'" tabindex="0" role="button"><span class="pn">'+esc(f.name)+'</span><span class="pc">'+(n?n+" planned":"–")+'</span>'+(focusRO?"":'<button type="button" class="px" aria-label="Remove '+esc(f.name)+'">×</button>')+'</div>';
  }).join("");
}
async function addFocus(){
  if(!db) return;
  const name=$("fpText").value.trim(); if(!name){$("fpText").focus();return}
  if(focus.some(f=>f.month===monthKey()&&f.name.toLowerCase()===name.toLowerCase())){toast("That product is already on this month’s list.");return}
  try{ await db.collection("focus").add({name,month:monthKey(),created:Date.now()}); $("fpText").value="" }
  catch(e){ if(writeErr(e,"focus products")){focusRO=true;renderFocus()} }
}
$("fpAdd").onclick=addFocus;
$("fpText").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addFocus()}});
$("fpList").addEventListener("click",async e=>{
  const p=e.target.closest(".pchip"); if(!p) return;
  const x=e.target.closest(".px");
  if(x){ if(!x.dataset.armed){x.dataset.armed="1";x.textContent="Remove?";return} try{await db.collection("focus").doc(p.dataset.id).delete()}catch(err){if(writeErr(err,"focus products")){focusRO=true;renderFocus()}} return }
  openItem(null,"",p.dataset.name);
});
$("fpList").addEventListener("keydown",e=>{ if(e.key==="Enter"&&e.target.classList.contains("pchip")) openItem(null,"",e.target.dataset.name) });
function addProductItem(name,date){
  if(!date) return;
  const id=newId();
  persist(id,{id,title:name,series:"product",status:"idea",platforms:["reel"],langs:[],kind:"",date,due:"",code:nextCode(),team:isMk()?myRole():"marketing",notes:"",caption:"",product:name,approvedBy:"",approvedAt:0,postedAt:0,createdBy:myId||"",created:Date.now()});
  toast("Planned "+name+" on "+shortDate(date)+".");
}

/* Events */
$("prev").onclick=()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1);render()};
$("next").onclick=()=>{cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);render()};
$("todayBtn").onclick=()=>{cursor=new Date(now.getFullYear(),now.getMonth(),1);render()};
$("newBtn").onclick=()=>openItem(null,"");
$("vHome").onclick=()=>{location.hash="home"};
$("vCal").onclick=()=>{location.hash="calendar"};
$("vRev").onclick=()=>{ $("desk").classList.remove("phone-detail"); location.hash="review" };
$("dBack").onclick=()=>{ $("desk").classList.remove("phone-detail"); window.scrollTo(0,0) };
$("vPipe").onclick=()=>{location.hash="pipeline"};
$("vTask").onclick=()=>{location.hash="tasks"};
$("vShoot").onclick=()=>{location.hash="shoots"};
window.addEventListener("hashchange",()=>{ const h=hashView(); view=h.v; if(h.v==="review"&&h.a){ wantSel=h.a; selId=null; $("desk").classList.toggle("phone-detail",narrow.matches) } render(); window.scrollTo(0,0) });
narrow.addEventListener("change",render);
$("filters").addEventListener("click",e=>{const b=e.target.closest(".fchip"); if(!b) return; const s=b.dataset.series; filters.has(s)?filters.delete(s):filters.add(s); render()});
$("main").addEventListener("click",e=>{
  const pg=e.target.closest("[data-pg]"); if(pg){ const k=pg.dataset.pg; pipeOpen.has(k)?pipeOpen.delete(k):pipeOpen.add(k); renderColumns(STATUSES); return }
  if(e.target.closest(".shootchip")){ location.hash="shoots"; return }
  const c=e.target.closest(".chip"); if(c){openItem(c.dataset.id);return}
  const cell=e.target.closest(".cell"); if(cell&&!readOnly) openItem(null,cell.dataset.date);
});
document.querySelector(".tabs").addEventListener("click",e=>{
  const b=e.target.closest("button[data-tab]"); if(!b) return;
  if(b.dataset.tab==="video"){ if(!editingId){ toast("Save it first, then add videos and feedback in Review."); return } const id=editingId; $("dlg").close(); goReview(id); return }
  setTab(b.dataset.tab);
});
$("fSeries").onchange=tint;
$("fClearDate").onclick=()=>{$("fDate").value=""};
$("fClearDue").onclick=()=>{$("fDue").value=""};
$("fCancel").onclick=()=>$("dlg").close();
$("fSave").onclick=()=>saveItem(true);
$("fTitle").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();saveItem(true)}});
$("fDelete").onclick=()=>{
  const b=$("fDelete");
  if(!b.dataset.armed){b.dataset.armed="1";b.textContent="Tap again to delete";return}
  const id=editingId; $("dlg").close(); if(selId===id) selId=null; persist(id,null); toast("Deleted.");
  if(db){ vFor(id).forEach(v=>db.collection("versions").doc(v.id).delete().catch(()=>{})); fbFor(id).forEach(f=>db.collection("feedback").doc(f.id).delete().catch(()=>{})) }
};
$("dlg").addEventListener("click",e=>{
  if(e.target===$("dlg")){ $("dlg").close(); return }
  const cp=e.target.closest("[data-copy]"); if(cp){ copyText(cp.dataset.copy); return }
  const a=e.target.closest("[data-act]");
  if(a&&a.dataset.act==="posted"&&editingId){ setStatusFor(editingId,"posted",true); toast("Marked as posted."); }
});
$("desk").addEventListener("click",e=>{
  const c=e.target.closest(".chip");
  if(c){ selId=c.dataset.id; render();
    if(narrow.matches){ $("desk").classList.add("phone-detail"); window.scrollTo(0,0) }   /* phone: list → full-screen video */
    else if(window.matchMedia("(max-width: 860px)").matches) $("detail").scrollIntoView({block:"start"});
    return }
  const cp=e.target.closest("[data-copy]"); if(cp){ copyText(cp.dataset.copy); return }
  const ib=e.target.closest("[data-inb]");
  if(ib){
    const card=ib.closest(".inb"), xid=card.dataset.id;
    if(ib.dataset.inb==="add"){ const v=card.querySelector("select").value; if(!v){ toast("Pick which content this video belongs to."); card.querySelector("select").focus(); return } assignInbox(xid,v); return }
    if(!ib.dataset.armed){ ib.dataset.armed="1"; ib.textContent="Tap again to remove"; return }
    const x=inbox.find(v=>v.id===xid);
    db&&db.collection("inbox").doc(xid).delete().then(()=>{ toast("Removed. The file stays in Checking."); if(assets&&x&&x.asset) assets.delete(x.asset).catch(()=>{}) }).catch(err=>writeErr(err,"this video"));
    return;
  }
  const cp2=e.target.closest("[data-cap]"); if(cp2){ captureFrame(cp2); return }
  const ib2=e.target.closest("[data-img]");
  if(ib2&&selId){ const v=vFor(selId).find(x=>x.n===Number(ib2.dataset.v))||vFor(selId)[0]; const f=v&&(v.files||[]).filter(x=>x.type.startsWith("image/"))[Number(ib2.dataset.img)-1]; if(f) openLb("/_blob/"+f.id,f.name); else toast("That image isn’t in this version any more."); return }
  const ts=e.target.closest(".ts"); if(ts){ seek(Number(ts.dataset.t),ts); return }
  const rm=e.target.closest("[data-rm]"); if(rm){ const [k,i]=rm.dataset.rm.split(":"); pending[k].splice(Number(i),1); renderPending(k); return }
  const id=selId; if(!id) return;
  const a=e.target.closest("[data-act]");
  if(a){
    const act=a.dataset.act;
    if(["approve","changes","reopen","gopub"].includes(act)&&isCr()){ toast("Only the team that asked for it can do that."); return }
    if(act==="submit"&&isMk()){ toast("The content team sends videos for review."); return }
    if(act==="submit"){ setStatusFor(id,"review"); toast("Sent for review. Marketing gets a notification."); }
    else if(act==="approve"){ setStatusFor(id,"approved"); toast("Approved. The file moves to the approve folder shortly."); }
    else if(act==="changes"){
      if(!fbFor(id).filter(f=>!f.done).length){ toast("Write what needs to change in Feedback first."); $("fbText").focus(); return }
      setStatusFor(id,"changes"); toast("Sent back for changes.");
    }
    else if(act==="reopen"){ setStatusFor(id,"edit"); }
    else if(act==="gopub"){ openItem(id); setTab("publish"); }
    return;
  }
  const fb=e.target.closest("[data-fb]");
  if(fb&&db){
    const fid=fb.closest(".fb").dataset.id, f=feedback.find(x=>x.id===fid); if(!f) return;
    const ref=db.collection("feedback").doc(fid);
    (async()=>{ try{
      if(fb.dataset.fb==="done") await ref.update({done:!f.done});
      else{ if(!fb.dataset.armed){fb.dataset.armed="1";fb.textContent="Tap again to delete";return} await ref.delete() }
    }catch(err){ writeErr(err,"feedback") } })();
  }
});
$("dEdit").onclick=()=>{ if(selId) openItem(selId) };
$("queue").addEventListener("click",e=>{ const b=e.target.closest("[data-qg]"); if(!b) return; qOpen=qOpen===b.dataset.qg?null:b.dataset.qg; renderDesk() });
function setFbTime(sec){
  const now=fmtSec(sec);
  if(!$("fbAt").value.trim()||$("fbTo").value.trim()) { $("fbAt").value=now; $("fbTo").value=""; }
  else if(parseTime($("fbAt").value)<Math.floor(sec)) $("fbTo").value=now;
  else { $("fbAt").value=now; $("fbTo").value=""; }
}
$("fbTime").onclick=()=>{
  const v=$("vLatest").querySelector("video");
  if(!v){ toast("There’s no preview video to take the time from. Type it in, e.g. 0:05."); $("fbAt").focus(); return }
  setFbTime(v.currentTime); $("fbText").focus();
};
async function captureFrame(btn){
  const v=btn.closest(".ver")&&btn.closest(".ver").querySelector("video");
  if(!v||!v.videoWidth){ toast("Play the video first, then pause where you want the frame."); return }
  if(!assets){ toast("You can’t attach files here."); return }
  v.pause();
  const t=v.currentTime, c=document.createElement("canvas");
  const scale=Math.min(1,1280/Math.max(v.videoWidth,v.videoHeight));
  c.width=Math.round(v.videoWidth*scale); c.height=Math.round(v.videoHeight*scale);
  try{
    c.getContext("2d").drawImage(v,0,0,c.width,c.height);
    const blob=await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error("empty")),"image/jpeg",0.88));
    const file=new File([blob],"frame "+fmtSec(t).replace(":","m")+"s.jpg",{type:"image/jpeg"});
    addPending("fb",[file]); setFbTime(t);
    $("fbForm").scrollIntoView({block:"nearest"}); $("fbText").focus();
    toast("Frame at "+fmtSec(t)+" added. Write what to change, then post.");
  }catch(e){ toast("Couldn’t capture this video. Take a screenshot and paste it into the feedback box instead.") }
}
$("fbAtt").addEventListener("change",e=>{ addPending("fb",e.target.files); e.target.value="" });
$("vAtt").addEventListener("change",e=>{ addPending("v",e.target.files); e.target.value="" });
$("fbText").addEventListener("paste",e=>{
  if(!assets) return;
  const fs=[...((e.clipboardData&&e.clipboardData.files)||[])].filter(f=>f.type.startsWith("image/"));
  if(!fs.length) return;
  e.preventDefault(); addPending("fb",fs); toast("Screenshot attached.");
});
$("vAdd").onclick=addVersion;
$("vOpen").onclick=()=>{ vOpenFor=selId; renderDesk(); $("vNote").focus() };
$("fbAdd").onclick=addFeedback;
$("copyCap").onclick=()=>{ const t=$("fCaption").value.trim(); if(!t){toast("No caption yet.");return} copyText(t) };
$("fCaption").addEventListener("blur",()=>{ if(editingId&&!readOnly){ const prev=items.get(editingId); if(prev&&prev.caption!==$("fCaption").value) persist(editingId,{...prev,caption:$("fCaption").value}) } });

/* Drag and drop */
let dragId=null, dragProduct=null;
document.addEventListener("dragstart",e=>{
  const pc=e.target.closest&&e.target.closest(".pchip");
  if(pc){ if(readOnly) return; dragProduct=pc.dataset.name; e.dataTransfer.effectAllowed="copy"; try{e.dataTransfer.setData("text/plain",dragProduct)}catch(_){} return }
  const c=e.target.closest&&e.target.closest(".chip"); if(!c||readOnly) return;
  dragId=c.dataset.id; c.classList.add("dragging");
  e.dataTransfer.effectAllowed="move"; try{e.dataTransfer.setData("text/plain",dragId)}catch(_){}
});
document.addEventListener("dragend",()=>{dragId=null;dragProduct=null;document.querySelectorAll(".dragging,.over").forEach(el=>el.classList.remove("dragging","over"))});
const target=e=>e.target.closest&&e.target.closest(".cell,.col");
document.addEventListener("dragover",e=>{
  const t=target(e); if(!t||!(dragId||(dragProduct&&t.classList.contains("cell")))) return; e.preventDefault();
  document.querySelectorAll(".over").forEach(el=>{if(el!==t)el.classList.remove("over")}); t.classList.add("over");
});
document.addEventListener("drop",e=>{
  const t=target(e); if(!t) return;
  if(dragProduct){ if(!t.classList.contains("cell")) return; e.preventDefault(); addProductItem(dragProduct,t.dataset.date); return }
  if(!dragId) return; e.preventDefault();
  const it=items.get(dragId); if(!it) return;
  const next={...it};
  if(t.classList.contains("col")){ if(it.status===t.dataset.status) return;
    if(t.dataset.status==="scheduled"){ if(isMk()&&!readOnly){ openItem(it.id); setTab("publish"); toast("Pick a time to schedule it.") } else toast("Marketing sets the posting time."); return }
    if(isCr()&&["approved","posted"].includes(t.dataset.status)){ toast("Only the team that asked for it can approve or mark it posted."); return } Object.assign(next,{status:t.dataset.status},stamp(t.dataset.status,it.id)); }
  else { const d=t.dataset.date; if(!d||it.date===d) return; next.date=d;
    if(it.status==="scheduled"&&it.postAt){ if(!isMk()){ toast("Marketing sets the posting time."); return } const o=new Date(it.postAt), nd=parse(d); nd.setHours(o.getHours(),o.getMinutes(),0,0); Object.assign(next,{postAt:nd.getTime(),remindedAt:0,scheduledBy:myId||"",scheduledAt:Date.now()}) } }
  persist(it.id,next);
});

/* ===== Shoots: book HR for filming, see their free and busy times ===== */
const DAY_FROM=8, DAY_TO=20;                       // board shows 8am–8pm
const hrPeople=()=>Object.keys(team).filter(id=>team[id]==="hr");
const ymdOf=ms=>ymd(new Date(ms));
const hm=ms=>{ const d=new Date(ms); let h=d.getHours(); const ap=h>=12?"pm":"am"; h=h%12||12; return h+(d.getMinutes()?":"+pad(d.getMinutes()):"")+ap };
const hmParts=ms=>{ const d=new Date(ms); let h=d.getHours(); const ap=h>=12?"pm":"am"; h=h%12||12; return [h+":"+pad(d.getMinutes()),ap] };
const postWhen=ms=>{ const d=new Date(ms); return DOW[(d.getDay()+6)%7]+" "+d.getDate()+" "+MONTHS[d.getMonth()].slice(0,3)+", "+hm(ms) };
/* Marketing gets a nudge in the open app when a scheduled post is due (the server also sends a push) */
const remindedLocal=new Set();
function postWatch(){
  if(view==="home") renderHome();
  if(!isMk()||readOnly) return;
  const now=Date.now(), due=[...items.values()].filter(i=>i.status==="scheduled"&&i.postAt&&i.postAt<=now&&i.postAt>now-6*3600e3&&!remindedLocal.has(i.id+":"+i.postAt));
  due.forEach(i=>remindedLocal.add(i.id+":"+i.postAt));
  if(!due.length) return;
  const f=due[0]; chime(); catMove("hop");
  catSays("Time to post","“"+f.title+"”"+(f.platforms.length?" on "+f.platforms.map(p=>pMap[p].s).join(", "):"")+(due.length>1?" +"+(due.length-1)+" more":""),{label:"Open Publish",fn:()=>{ openItem(f.id); setTab("publish") }});
}
setInterval(postWatch,60000);
function shootWhen(x){ const d=new Date(x.start); return DOW[(d.getDay()+6)%7]+" "+d.getDate()+" "+MONTHS[d.getMonth()].slice(0,3)+", "+hm(x.start)+"–"+hm(x.end) }
const gcalUtc=ms=>new Date(ms).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
function gcalLink(x){ return "https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent("Gearizo shoot"+(x.title?": "+x.title:""))+"&dates="+gcalUtc(x.start)+"/"+gcalUtc(x.end)+"&details="+encodeURIComponent(x.notes||"")+"&location="+encodeURIComponent(x.location||"") }
function shootChips(ds){
  if(!isCr()) return "";
  return shoots.filter(x=>x.status!=="cancelled"&&ymdOf(x.start)===ds).sort((a,b)=>a.start-b.start).map(x=>'<button class="chip shootchip" type="button" draggable="false" title="Shoot"><span class="t">Shoot '+esc(hm(x.start))+'</span><span class="m">'+esc(x.talent.map(who).join(", ")+" · "+({proposed:"Waiting",confirmed:"Confirmed",declined:"Can’t make it"}[x.status]||""))+'</span></button>').join("");
}
/* A shoot can cover several videos. It keeps a copy of each video's script (the item's Notes) and reference
   files, because HR can't open items themselves. The hub's app refreshes that copy when a script changes. */
const shScripts=a=>Array.isArray(a)?a.filter(s=>s&&typeof s==="object").slice(0,12).map(s=>({id:String(s.id||""),title:String(s.title||"").slice(0,200),script:String(s.script||"").slice(0,20000),refs:normFiles(s.refs)})):[];
const shLabel=i=>(i.code?i.code+" ":"")+i.title;
function shScriptsFor(ids,old){ return shScripts(ids.map(id=>{ const i=items.get(id); return i?{id,title:shLabel(i),script:i.notes,refs:i.refs}:(old||[]).find(s=>s.id===id) }).filter(Boolean)) }
let shSyncT=0; const shSyncing=new Set();
function syncShootScripts(){
  if(!isCr()||previewRole||readOnly||mode!=="db"||!db||!live.items||!live.shoots) return;
  clearTimeout(shSyncT);
  shSyncT=setTimeout(()=>{
    const now=Date.now();
    shoots.filter(x=>x.items.length&&x.end>now&&["proposed","confirmed"].includes(x.status)&&!shSyncing.has(x.id)).forEach(x=>{
      const sc=shScriptsFor(x.items,x.scripts), title=sc.map(s=>s.title).join(" · ")||x.title;
      if(JSON.stringify(sc)===JSON.stringify(x.scripts)&&title===x.title) return;
      shSyncing.add(x.id);
      db.collection("shoots").doc(x.id).update({scripts:sc,title}).catch(()=>{}).finally(()=>shSyncing.delete(x.id));
    });
  },1500);
}
function shootScriptsHtml(x){
  const list=x.scripts.length?x.scripts:shScriptsFor(x.items,[]);
  if(!list.length) return "";
  return '<div class="shscripts">'+list.map(s=>(s.script||s.refs.length)?
    '<details class="shscript"><summary><span class="spill">Script</span>'+esc(s.title)+'</summary>'+(s.script?'<div class="sctext">'+esc(s.script)+'</div>':"")+attHtml(s.refs)+'</details>':
    '<div class="shscript none"><span class="spill">Script</span>'+esc(s.title)+' · not written yet</div>').join("")+'</div>';
}
function shootCard(x,forHr){
  const d=new Date(x.start), past=x.end<Date.now();
  const pill='<span class="spill '+x.status+'">'+({proposed:forHr?"Reply":"Waiting",confirmed:"Confirmed",declined:"Can’t",cancelled:"Cancelled"}[x.status])+'</span>';
  let acts="";
  if(!readOnly&&!past){
    if(forHr&&x.status==="proposed") acts='<button class="btn go sm" type="button" data-sh="confirm" data-id="'+x.id+'">Confirm</button><input type="text" data-reply="'+x.id+'" placeholder="Reason or new time (optional)" aria-label="Reason or another time (optional)"><button class="btn sm" type="button" data-sh="decline" data-id="'+x.id+'">Can’t make it</button>';
    if(!forHr&&x.status!=="cancelled") acts='<button class="btn sm" type="button" data-sh="edit" data-id="'+x.id+'">Change</button><button class="btn ghost sm danger" type="button" data-sh="cancel" data-id="'+x.id+'">Cancel</button>';
    if(forHr&&x.status==="confirmed") acts='<button class="btn sm" type="button" data-sh="undo" data-id="'+x.id+'">Can’t make it</button>';
  }
  if(x.status==="confirmed"&&!past) acts+='<a class="btn sm" href="'+esc(gcalLink(x))+'" target="_blank" rel="noopener" title="Add to Google Calendar">+ Google Calendar</a>';
  return '<div class="shcard"><div class="when"><small>'+DOW[(d.getDay()+6)%7]+'</small>'+d.getDate()+' '+MONTHS[d.getMonth()].slice(0,3)+'<small>'+esc(hm(x.start))+'</small></div>'+
    '<div class="what"><b>'+esc(x.title||"Shoot")+' '+pill+'</b><span>'+esc(hm(x.start)+"–"+hm(x.end))+(forHr?"":" · with "+esc(x.talent.map(who).join(", ")))+(x.location?" · "+esc(x.location):"")+'</span>'+
    (x.notes?'<span>'+esc(x.notes)+'</span>':"")+(x.reply?'<span><b>Reply:</b> '+esc(x.reply)+'</span>':"")+'</div>'+shootScriptsHtml(x)+(acts?'<div class="acts">'+acts+'</div>':"")+'</div>';
}
function dayBar(uid,day){
  const d0=new Date(day+"T00:00:00").getTime(), from=d0+DAY_FROM*3600e3, to=d0+DAY_TO*3600e3, span=to-from;
  const seg=(s,e,cls)=>{ const a=Math.max(s,from), b=Math.min(e,to); if(b<=a) return ""; return '<i class="'+cls+'" style="left:'+((a-from)/span*100).toFixed(2)+'%;width:'+((b-a)/span*100).toFixed(2)+'%"></i>' };
  return '<div class="bar" data-user="'+esc(uid)+'" data-day="'+day+'" title="Tap a time to book">'+
    avail.filter(a=>a.user===uid).map(a=>seg(a.start,a.end,"free")).join("")+
    busy.filter(b=>b.user===uid).map(b=>seg(b.start,b.end,"busy")).join("")+
    shoots.filter(x=>x.talent.includes(uid)&&["proposed","confirmed"].includes(x.status)).map(x=>seg(x.start,x.end,"sh "+x.status)).join("")+'</div>';
}
let calState=null;
async function loadCal(){ if(!window.gzCal) return; try{ await window.gzCal.ensure(); calState=(await window.gzCal.get())||{} }catch(e){ calState={error:e.message} } if(view==="shoots") renderShoots() }
function renderShoots(){
  const box=$("shoots"), now=Date.now();
  if(isHr()){
    const mine=previewRole?shoots:shoots.filter(x=>x.talent.includes(myId));
    const ask=mine.filter(x=>x.status==="proposed"&&x.end>now).sort((a,b)=>a.start-b.start);
    const up=mine.filter(x=>x.status==="confirmed"&&x.end>now).sort((a,b)=>a.start-b.start);
    if(!previewRole&&calState===null){ calState={loading:true}; loadCal() }
    const c=previewRole?{preview:true}:(calState||{});
    const mineFree=avail.filter(a=>a.user===myId&&a.end>now).sort((a,b)=>a.start-b.start);
    box.innerHTML=
      '<div class="shsec"><h2>Requests'+(ask.length?'<span class="ncount">'+ask.length+'</span>':"")+'</h2>'+(ask.length?ask.map(x=>shootCard(x,true)).join(""):'<p class="empty">None.</p>')+'</div>'+
      '<div class="shsec"><h2>Coming up</h2>'+(up.length?up.map(x=>shootCard(x,true)).join(""):'<p class="empty">None yet.</p>')+'</div>'+
      '<div class="shsec calbox"><h2>Google Calendar</h2>'+
        (c.preview?'<p class="hint">HR connects their own calendar here.</p>':c.loading?'<p class="hint">Loading…</p>':
        '<p class="calstat '+(c.error||c.holiday?"err":c.connected?"ok":"")+'">'+(c.holiday?"Wrong calendar: this is Google’s holidays calendar, not yours. Paste your own calendar’s address below.":c.error&&c.publicLink&&/404/.test(c.error)?"Not public yet. In Google Calendar → your calendar → Access permissions, tick “Make available to public” and choose “See only free/busy”.":c.error?"Couldn’t read it: "+esc(c.error):c.connected?"✓ Connected"+(c.lastSync?" · read "+esc(fmtTime(Date.parse(c.lastSync))):""):"Not connected")+'</p>'+
        '<div class="row"><input type="url" id="calUrl" placeholder="Secret iCal address" aria-label="Secret address in iCal format" autocomplete="off"><button class="btn primary sm" type="button" data-sh="calsave">'+(c.connected?"Replace link":"Connect")+'</button>'+(c.connected?'<button class="btn sm" type="button" data-sh="calsync">Read now</button><button class="btn ghost sm danger" type="button" data-sh="calremove">Disconnect</button>':"")+'</div>'+
        '<details><summary class="hint">How?</summary><ol><li>On a computer, open <b>calendar.google.com</b>.</li><li>Click ⚙ <b>Settings</b>, then your calendar’s name on the left under “Settings for my calendars”.</li><li>Scroll to <b>Integrate calendar</b> and copy <b>Secret address in iCal format</b>.</li><li>Paste it above and press Connect. You can reset that address in Google any time to cut the link.</li></ol><p class="hint"><b>No “Secret address”?</b> Company accounts often hide it. Then, on the same page, open <b>Access permissions for events</b>, tick <b>Make available to public</b> and choose <b>See only free/busy (hide details)</b>. Copy <b>Public address in iCal format</b> instead. Others then see only when you’re busy, never what.</p><p class="hint">Only start and end times are read, never titles or guests. Busy times update about every 15 minutes.</p></details>'+
        (c.feedUrl?'<details><summary class="hint">Shoots in Google Calendar automatically</summary><p class="hint">In Google Calendar choose <b>Other calendars → + → From URL</b> and paste this. Google refreshes it every few hours.</p><div class="row"><code>'+esc(c.feedUrl)+'</code><button class="btn ghost sm" type="button" data-copy="'+esc(c.feedUrl)+'">Copy</button></div></details>':""))+
      '</div>'+
      '<div class="shsec"><h2>Free times</h2>'+
        '<div class="freeform"><input type="date" id="frDate" aria-label="Date"><input type="time" id="frFrom" step="900" aria-label="From" value="10:00"><span>to</span><input type="time" id="frTo" step="900" aria-label="To" value="12:00"><button class="btn sm" type="button" data-sh="freeadd">Add</button></div>'+
        '<div class="freelist">'+mineFree.map(a=>'<div><span>'+esc(DOW[(new Date(a.start).getDay()+6)%7]+" "+new Date(a.start).getDate()+" "+MONTHS[new Date(a.start).getMonth()].slice(0,3)+", "+hm(a.start)+"–"+hm(a.end))+'</span><button class="btn ghost sm" type="button" data-sh="freedel" data-id="'+a.id+'" aria-label="Remove">×</button></div>').join("")+'</div></div>';
    return;
  }
  const people=hrPeople();
  const up=shoots.filter(x=>x.end>now-3600e3&&x.status!=="cancelled").sort((a,b)=>a.start-b.start);
  let board="";
  if(!people.length) board='<p class="empty">No HR yet. Add them in Team.</p>';
  else{
    board='<div class="blegend"><span><i style="background:color-mix(in srgb,var(--ready) 28%,#fff)"></i>Free</span><span><i style="background:repeating-linear-gradient(135deg,#D9E1DD 0 4px,#E7EDEA 4px 8px)"></i>Busy</span><span><i style="background:var(--pink)"></i>Shoot</span><span class="hint">Tap to book</span></div>'+
      '<div class="bscale"><span></span><span></span><span class="ticks">'+[8,10,12,14,16,18,20].map(h=>'<span>'+(h%12||12)+(h<12?"am":"pm")+'</span>').join("")+'</span></div><div class="board">';
    for(let i=0;i<14;i++){
      const dt=new Date(); dt.setHours(0,0,0,0); dt.setDate(dt.getDate()+i); const day=ymd(dt);
      board+='<div class="bday'+(i===0?" today":"")+'"><div class="dl">'+DOW[(dt.getDay()+6)%7]+' '+dt.getDate()+'<small>'+MONTHS[dt.getMonth()].slice(0,3)+(i===0?", today":"")+'</small></div><div class="bpeople">'+
        people.map(uid=>'<div class="bp"><span class="nm">'+esc(who(uid))+'</span>'+dayBar(uid,day)+'</div>').join("")+'</div></div>';
    }
    board+='</div>';
  }
  box.innerHTML='<div class="shhead">'+(readOnly?"":'<button class="btn primary" type="button" data-sh="book">+ Book</button>')+'</div>'+
    '<div class="shsec"><h2>Upcoming</h2>'+(up.length?up.map(x=>shootCard(x,false)).join(""):'<p class="empty">Nothing booked.</p>')+'</div>'+
    '<div class="shsec"><h2>Who’s free</h2>'+board+'</div>';
}
let editingShoot=null;
function openShoot(pre){
  pre=pre||{};
  const people=hrPeople();
  if(!people.length){ toast("Add someone with the HR role in the Team screen first."); return }
  editingShoot=pre.id||null;
  $("shH").textContent=editingShoot?"New time":"Book a shoot";
  $("shSave").textContent="Send";
  $("shWho").innerHTML=people.map(id=>'<option value="'+esc(id)+'">'+esc(who(id))+'</option>').join("");
  const ex=editingShoot?shoots.find(x=>x.id===editingShoot):null, picked=new Set(ex?ex.items:[]);
  const stage={shoot:0,script:1,idea:2}, vids=[...items.values()].filter(i=>picked.has(i.id)||(i.type!=="design"&&i.status!=="posted"))
    .sort((a,b)=>(stage[a.status]??3)-(stage[b.status]??3)||(a.code||"~").localeCompare(b.code||"~")||a.title.localeCompare(b.title));
  $("shItems").innerHTML=vids.length?vids.map(i=>'<label><input type="checkbox" value="'+esc(i.id)+'"'+(picked.has(i.id)?" checked":"")+'><span>'+esc(shLabel(i))+(i.notes.trim()?"":' <em>no script</em>')+'</span></label>').join(""):'<p class="hint">No videos to shoot yet.</p>';
  const start=ex?ex.start:pre.start||null;
  $("shWho").value=ex?ex.talent[0]:(pre.user||people[0]);
  $("shDate").value=start?ymdOf(start):(pre.day||todayStr);
  $("shStart").value=start?pad(new Date(start).getHours())+":"+pad(new Date(start).getMinutes()):"10:00";
  $("shLen").value=ex?String(Math.round((ex.end-ex.start)/60000)):"60"; if(!$("shLen").value) $("shLen").value="60";
  $("shLoc").value=ex?ex.location:""; $("shNotes").value=ex?ex.notes:"";
  shootWarn(); $("shootDlg").showModal();
}
function shootTimes(){
  const d=$("shDate").value, t=$("shStart").value; if(!d||!t) return null;
  const s=new Date(d+"T"+t+":00").getTime(); return {start:s,end:s+Number($("shLen").value||60)*60000};
}
function shootWarn(){
  const tm=shootTimes(), uid=$("shWho").value, w=$("shWarn");
  if(!tm){ w.hidden=true; return }
  const clash=busy.some(b=>b.user===uid&&b.start<tm.end&&b.end>tm.start)?"Busy on their calendar then.":
    shoots.some(x=>x.id!==editingShoot&&x.talent.includes(uid)&&["proposed","confirmed"].includes(x.status)&&x.start<tm.end&&x.end>tm.start)?"Already has a shoot then.":"";
  w.hidden=!clash; w.textContent=clash?clash+" You can still send it.":"";
}
["shWho","shDate","shStart","shLen"].forEach(k=>$(k).addEventListener("change",shootWarn));
$("shClose").onclick=()=>$("shootDlg").close();
$("shootForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const tm=shootTimes(); if(!tm){ toast("Pick a date and start time."); return }
  if(tm.end<Date.now()){ toast("That time has already passed."); return }
  const ids=[...$("shItems").querySelectorAll("input:checked")].map(c=>c.value).filter(id=>items.has(id));
  const sc=shScriptsFor(ids,[]);
  const data={talent:[$("shWho").value],item:ids[0]||"",items:ids,scripts:sc,title:sc.length?sc.map(s=>s.title).join(" · "):"Shoot",start:tm.start,end:tm.end,location:$("shLoc").value.trim(),notes:$("shNotes").value.trim(),status:"proposed",reply:"",by:myId||"",at:Date.now(),respondedBy:"",respondedAt:0};
  try{
    if(editingShoot) await db.collection("shoots").doc(editingShoot).update({start:data.start,end:data.end,item:data.item,items:data.items,scripts:data.scripts,title:data.title,location:data.location,notes:data.notes,talent:data.talent,status:"proposed",reply:"",respondedBy:"",respondedAt:0});
    else await db.collection("shoots").add(data);
    $("shootDlg").close(); toast(editingShoot?"New time sent. They’ll get a notification.":"Request sent. "+who(data.talent[0])+" gets a notification to confirm.");
  }catch(err){ writeErr(err,"the shoot") }
});
$("shoots").addEventListener("click",async e=>{
  const bar=e.target.closest(".bar");
  if(bar&&!readOnly){ const r=bar.getBoundingClientRect(); let h=DAY_FROM+(e.clientX-r.left)/r.width*(DAY_TO-DAY_FROM); h=Math.min(DAY_TO-1,Math.max(DAY_FROM,Math.round(h*2)/2));
    const s=new Date(bar.dataset.day+"T00:00:00").getTime()+h*3600e3; openShoot({user:bar.dataset.user,day:bar.dataset.day,start:s}); return }
  const b=e.target.closest("[data-sh]"); if(!b||!db) return;
  const act=b.dataset.sh, id=b.dataset.id, ref=id?db.collection(b.dataset.sh.startsWith("free")?"availability":"shoots").doc(id):null;
  try{
    if(act==="book") openShoot();
    else if(act==="edit") openShoot({id});
    else if(act==="cancel"){ if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="Tap again to cancel"; return } await ref.update({status:"cancelled"}); toast("Shoot cancelled. They’ll get a notification.") }
    else if(act==="confirm"){ await ref.update({status:"confirmed",reply:"",respondedBy:myId||"",respondedAt:Date.now()}); toast("Confirmed. Add it to your Google Calendar with the button.") }
    else if(act==="decline"||act==="undo"){ const inp=document.querySelector('[data-reply="'+id+'"]'); await ref.update({status:"declined",reply:inp?inp.value.trim().slice(0,200):"",respondedBy:myId||"",respondedAt:Date.now()}); toast("Sent. The content team will find another time.") }
    else if(act==="freeadd"){ const d=$("frDate").value, f=$("frFrom").value, t=$("frTo").value; if(!d||!f||!t){ toast("Pick a date and times."); return }
      const s=new Date(d+"T"+f+":00").getTime(), en=new Date(d+"T"+t+":00").getTime(); if(!(en>s)){ toast("The end time must be after the start."); return }
      await db.collection("availability").add({user:myId||"",start:s,end:en}); toast("Free time added.") }
    else if(act==="freedel"){ await db.collection("availability").doc(id).delete() }
    else if(act==="calsave"){ const u=$("calUrl").value.trim(); if(!/^(https|webcal):\/\/\S+\.ics(\?|$)|^(https|webcal):\/\/calendar\.google\.com\/\S+/i.test(u)){ toast("Paste the “Secret address in iCal format” from Google Calendar settings (it ends in .ics)."); return }
      if(/(#|%23)holiday(@|%40)|group\.v\.calendar\.google\.com/i.test(decodeURIComponent(u))){ toast("That’s Google’s holidays calendar, not yours. Open your own calendar (your name) in Google Calendar settings and copy its iCal address."); return }
      b.disabled=true; b.textContent="Connecting…"; await window.gzCal.save(u); calState=await window.gzCal.get(); renderShoots(); toast(calState.error&&calState.publicLink&&/404/.test(calState.error)?"Saved, but Google says it isn’t public yet. Tick “Make available to public” → “See only free/busy”, then press Read now.":calState.error?"Couldn’t read that calendar: "+calState.error:"Connected. Your busy times are shared with the studio.") }
    else if(act==="calsync"){ b.disabled=true; b.textContent="Reading…"; await window.gzCal.sync(); calState=await window.gzCal.get(); renderShoots(); toast("Calendar read.") }
    else if(act==="calremove"){ if(!b.dataset.armed){ b.dataset.armed="1"; b.textContent="Tap again to disconnect"; return } await window.gzCal.save(""); calState=await window.gzCal.get(); renderShoots(); toast("Disconnected. Your busy times were removed.") }
  }catch(err){ b.disabled=false; if(/calsave|calsync|calremove/.test(act)) toast("Something went wrong: "+(err.message||err)); else writeErr(err,"the shoot") }
});
let seenShoots=null;
function shootWatch(){
  const ids=new Set(shoots.map(x=>x.id+":"+x.status+":"+x.start));
  if(seenShoots===null){ seenShoots=ids; return }
  const fresh=shoots.filter(x=>!seenShoots.has(x.id+":"+x.status+":"+x.start)&&x.by!==myId&&x.status==="proposed"&&x.talent.includes(myId));
  seenShoots=ids;
  const n=shoots.filter(x=>x.talent.includes(myId)&&x.status==="proposed"&&x.end>Date.now()).length;
  $("shBadge").hidden=!n||!isHr(); $("shBadge").textContent=n;
  if(fresh.length){ chime(); catMove("hop"); catSays("Shoot request",who(fresh[0].by)+" wants to film with you "+shootWhen(fresh[0])+".",{label:"Reply",fn:()=>{location.hash="shoots"}}) }
}

/* Phase 2 wiring: type fields, references, team filter, owner preview */
$("fType").addEventListener("change",typeFields);
/* Content switching a request's team: swap social platforms for Shopee/Lazada/Website and back */
$("fTeam").addEventListener("change",()=>{
  const shop=$("fTeam").value==="ecomm", boxes=[...$("fPlatforms").querySelectorAll("input")];
  if(!boxes.some(b=>b.checked&&(shop?SHOP_P.includes(b.value):!SHOP_P.includes(b.value)))) boxes.forEach(b=>{ b.checked=shop?["shopee","lazada"].includes(b.value):b.value==="reel" });
  else boxes.forEach(b=>{ if(shop?!SHOP_P.includes(b.value):SHOP_P.includes(b.value)) b.checked=false });
  platVis();
});
$("refAtt").addEventListener("change",e=>{ addPending("refs",e.target.files); e.target.value="" });
$("dlg").addEventListener("click",e=>{ const rm=e.target.closest("#refsFiles [data-rm]"); if(rm){ const [k,i]=rm.dataset.rm.split(":"); pending[k].splice(Number(i),1); renderPending(k) } });
$("teamFilter").addEventListener("click",e=>{ const b=e.target.closest("button[data-t]"); if(!b) return; teamF=b.dataset.t; selId=null; render() });
function applyPreview(){
  const r=previewRole;
  if(raw.items) items=r?new Map([...raw.items].filter(([,it])=>["marketing","ecomm"].includes(r)&&it.team===r)):raw.items;
  const ok=id=>items.has(id);
  if(raw.versions) versions=r?raw.versions.filter(v=>ok(v.item)):raw.versions;
  if(raw.feedback) feedback=r?raw.feedback.filter(f=>ok(f.item)):raw.feedback;
  if(raw.tasks) tasks=r?raw.tasks.filter(t=>t.for===r):raw.tasks;
  if(raw.focus) focus=r==="hr"?[]:raw.focus;
  if(raw.inbox) inbox=r?[]:raw.inbox;
}
function setPreview(r){
  if(r&&!amOwner) return;
  if(r&&!previewRole) realRO=readOnly;
  previewRole=r||"";
  readOnly=previewRole?true:(realRO===null?readOnly:realRO);
  teamF=""; selId=null; deskFor=undefined;
  applyPreview();
  if($("roleDlg").open) $("roleDlg").close();
  if(location.hash!=="#home") location.hash="home";
  render(); window.scrollTo(0,0);
  toast(previewRole?"Previewing as "+ROLES[previewRole].name+".":"Back to your own view.");
}
$("roleDlg").addEventListener("click",e=>{ const b=e.target.closest("[data-pv]"); if(b) setPreview(b.dataset.pv) });
$("pvExit").onclick=()=>setPreview("");

buildForm(); loadCache(); setNote(); render(); renderNotifs(); connect();
})();
