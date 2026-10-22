import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, onSnapshot, query, where, limit, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const TRAITS = [
  {k:"O", name:"Curiosity",     lo:"Familiar", hi:"New & novel"},
  {k:"C", name:"Planning",      lo:"Wing it",  hi:"Plan ahead"},
  {k:"E", name:"Social energy", lo:"Quiet nights", hi:"Big crowds"},
  {k:"A", name:"Easygoing",     lo:"Loves a debate", hi:"Keeps the peace"},
  {k:"S", name:"Steadiness",    lo:"Feels it all", hi:"Calm under fire"}
];
const QUESTIONS = [
  {id:"q1", t:"O", rev:false, text:"I'd happily try a restaurant I've never heard of."},
  {id:"q2", t:"O", rev:true,  text:"I'd rather stick with what I know works."},
  {id:"q3", t:"C", rev:false, text:"My calendar is planned weeks ahead."},
  {id:"q4", t:"C", rev:true,  text:"Showing up late is fine if the vibe is right."},
  {id:"q5", t:"E", rev:false, text:"A packed party gives me energy."},
  {id:"q6", t:"E", rev:true,  text:"After a busy week I want a quiet night in."},
  {id:"q7", t:"A", rev:false, text:"I'll go along with a plan to keep the peace."},
  {id:"q8", t:"A", rev:true,  text:"I enjoy a good debate, even a heated one."},
  {id:"q9", t:"S", rev:false, text:"I stay calm when plans fall apart."},
  {id:"q10",t:"S", rev:true,  text:"Small setbacks can sour my whole day."}
];
const INTERESTS = ["Hiking","Board games","Cooking","Live music","Reading","Running","Film","Art museums","Coffee","Gaming","Climbing","Gardening","Photography","Volunteering","Trivia","Tech","Dancing","Travel"];
const SIZES = {one:"One-on-one", small:"Small group", big:"Big group"};
const TIMES = {early:"Early bird", day:"Daytime", night:"Night owl"};
const FREQS = {weekly:"Every week", month:"A few times a month", now:"Now and then"};
const AVC = ["--av1","--av2","--av3","--av4","--av5","--av6"];
const SAMPLE = {sample:true, name:"", zip:"", area:"", about:"", ideal:"", contact:"",
  answers:{q1:4,q2:2,q3:3,q4:3,q5:3,q6:3,q7:4,q8:2,q9:4,q10:2},
  ints:["Hiking","Cooking","Board games","Coffee","Reading"], size:"small", time:"day", freq:"month"};

// ---------- storage ----------
function load(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function drop(k){ try{ localStorage.removeItem(k); }catch(e){} }

// ---------- state ----------
const cfg = window.KINDRED_FIREBASE || {};
let fb = null, setupError = "";
if(cfg.apiKey && cfg.projectId && cfg.authDomain){
  try{ const app = initializeApp(cfg); fb = { auth:getAuth(app), db:getFirestore(app) }; }
  catch(e){ console.error(e); setupError = "config.js has a problem. Copy the firebaseConfig values again from Firebase (README Part D)."; }
}
const S = {
  myId:null, email:"", loaded:false, error:"",
  members:[], myDoc:null, wavesOut:new Set(), wavesIn:new Set(), contacts:{}, unsub:[],
  zips:null, view:"matches",
  ui:{radius: load("kindred.radius", 10), sort:"score", filter:"All"}
};
let me = load("kindred.draft", null) || structuredClone(SAMPLE);

// ---------- matching ----------
function traitsOf(answers){
  const t = {O:0,C:0,E:0,A:0,S:0}, n = {O:0,C:0,E:0,A:0,S:0};
  QUESTIONS.forEach(q=>{ const v = +answers?.[q.id]; if(v>=1 && v<=5){ t[q.t] += q.rev ? 6 - v : v; n[q.t]++; } });
  TRAITS.forEach(({k})=> t[k] = n[k] ? t[k]/n[k] : 3);
  return t;
}
const ll = zip => (S.zips && zip && S.zips[zip]) || null;
function miles(a,b){
  const R = 3958.8, r = x => x*Math.PI/180;
  const dLat = r(b[0]-a[0]), dLon = r(b[1]-a[1]);
  const h = Math.sin(dLat/2)**2 + Math.cos(r(a[0]))*Math.cos(r(b[0]))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function distance(p){ const a = ll(me.zip), b = ll(p.zip); return a && b ? Math.max(0.2, miles(a,b)) : null; }
const W = {O:1.2, C:1, E:1.1, A:.8, S:.7};
function score(p){
  const t = traitsOf(me.answers);
  let wsum = 0, tsim = 0;
  TRAITS.forEach(({k})=>{ tsim += W[k]*(1 - Math.abs(t[k]-p.tr[k])/4); wsum += W[k]; });
  tsim /= wsum;
  const shared = p.ints.filter(x=>me.ints.includes(x));
  const isim = me.ints.length && p.ints.length ? Math.min(1, shared.length / Math.sqrt(me.ints.length*p.ints.length) * 1.4) : 0;
  const order = {one:0,small:1,big:2}, tOrder = {early:0,day:1,night:2}, fOrder = {weekly:0,month:1,now:2};
  const near = (o,a,b)=> (o[a]==null||o[b]==null) ? .5 : 1 - Math.abs(o[a]-o[b])/2;
  const lsim = (near(order,me.size,p.size) + near(tOrder,me.time,p.time) + near(fOrder,me.freq,p.freq))/3;
  return {total: Math.round((0.45*tsim + 0.35*isim + 0.20*lsim) * 100), shared, reasons: reasons(t,p,shared)};
}
function reasons(t,p,shared){
  const r = [];
  if(shared.length >= 2) r.push(`You both enjoy ${shared.slice(0,2).join(" and ").toLowerCase()}${shared.length>2?` (+${shared.length-2} more)`:""}`);
  else if(shared.length === 1) r.push(`You share an interest in ${shared[0].toLowerCase()}`);
  const both = k => (t[k]>=3.75 && p.tr[k]>=3.75) ? "hi" : (t[k]<=2.25 && p.tr[k]<=2.25) ? "lo" : null;
  const lines = {
    E:{hi:"You both get energy from a crowd", lo:"You both recharge with quiet nights in"},
    O:{hi:"Equally up for trying something new", lo:"You both like the tried-and-true spots"},
    C:{hi:"You both plan ahead, so plans actually happen", lo:"You're both happy to wing it"},
    A:{hi:"You both keep things low-drama", lo:"You'll both enjoy a lively debate"},
    S:{hi:"You both stay steady when plans fall apart", lo:null}
  };
  for(const k of ["E","O","C","A","S"]){ const b = both(k); if(b && lines[k][b]){ r.push(lines[k][b]); if(r.length>=3) break; } }
  if(r.length < 3 && me.time === p.time && TIMES[p.time]) r.push(`You're both ${TIMES[p.time].toLowerCase()}s`);
  if(r.length < 3 && me.size === p.size && SIZES[p.size]) r.push(`You both prefer ${SIZES[p.size].toLowerCase()} hangouts`);
  let gap = null, g = 0;
  TRAITS.forEach(tr=>{ const d = Math.abs(t[tr.k]-p.tr[tr.k]); if(d>g){ g=d; gap=tr; } });
  let heads = null;
  if(g >= 2.5){ const mine = t[gap.k] > p.tr[gap.k]; heads = `Heads-up: you differ on ${gap.name.toLowerCase()} (${(mine?gap.hi:gap.lo).toLowerCase()} vs. ${(mine?gap.lo:gap.hi).toLowerCase()})`; }
  return {good:r.slice(0,3), heads};
}

// ---------- data ----------
function fromDoc(id, r){
  if(!r) return null;
  const p = {id, name:r.name || "Someone", zip:r.zip || "", area:r.area || "", about:r.about || "", ideal:r.ideal || "",
    answers: r.answers || {}, ints: (r.ints || []).filter(x=>INTERESTS.includes(x)),
    size: SIZES[r.hangSize] ? r.hangSize : "small", time: TIMES[r.hangTime] ? r.hangTime : "day", freq: FREQS[r.hangFreq] ? r.hangFreq : "month"};
  p.tr = traitsOf(p.answers);
  let h = 0; for(const c of id) h = (h*31 + c.charCodeAt(0)) >>> 0;
  p.av = AVC[h % 6];
  return p;
}
const iWaved = id => S.wavesOut.has(id);
const wavedAtMe = id => S.wavesIn.has(id);
const isMutual = p => iWaved(p.id) && wavedAtMe(p.id);

function dbFail(e){
  console.error(e);
  S.error = e?.code === "permission-denied"
    ? "The database refused the request. Make sure you published the rules from firestore.rules (README Part C)."
    : "Couldn't load members right now. Reload the page to try again.";
  rerender();
}
function listen(){
  S.unsub.forEach(u=>{ try{ u(); }catch(e){} }); S.unsub = [];
  S.members = []; S.myDoc = null; S.wavesOut = new Set(); S.wavesIn = new Set(); S.contacts = {}; S.loaded = false;
  if(!fb || !S.myId){ S.loaded = true; rerender(); return; }
  const { db } = fb, uid = S.myId;
  S.unsub.push(onSnapshot(query(collection(db, "profiles"), limit(2000)), snap=>{
    const list = snap.docs.map(d=>fromDoc(d.id, d.data())).filter(Boolean);
    S.members = list.filter(p=>p.id !== uid);
    const mine = list.find(p=>p.id === uid);
    S.myDoc = mine || null;
    if(mine && S.view !== "quiz"){ me = structuredClone(mine); me.contact = S.contacts[uid] || ""; }
    S.loaded = true; S.error = "";
    savePending(); rerender();
  }, dbFail));
  S.unsub.push(onSnapshot(query(collection(db, "waves"), where("from", "==", uid)), snap=>{
    S.wavesOut = new Set(snap.docs.map(d=>d.data().to)); loadContacts(); rerender();
  }, dbFail));
  S.unsub.push(onSnapshot(query(collection(db, "waves"), where("to", "==", uid)), snap=>{
    S.wavesIn = new Set(snap.docs.map(d=>d.data().from)); loadContacts(); rerender();
  }, dbFail));
  getDoc(doc(db, "contacts", uid)).then(d=>{
    S.contacts[uid] = d.exists() ? (d.data().contact || "") : "";
    if(S.myDoc && S.view !== "quiz") me.contact = S.contacts[uid];
  }).catch(()=>{});
}
async function loadContacts(){
  for(const id of S.wavesOut){
    if(!S.wavesIn.has(id) || id in S.contacts) continue;
    S.contacts[id] = "";
    try{ const d = await getDoc(doc(fb.db, "contacts", id)); S.contacts[id] = d.exists() ? (d.data().contact || "") : ""; }
    catch(e){ delete S.contacts[id]; }
    rerender();
  }
}
let pendingBusy = false;
async function savePending(){
  const pending = load("kindred.pending", null);
  if(!pending || pendingBusy || !S.myId) return;
  pendingBusy = true; drop("kindred.pending");
  try{ await saveProfile(pending); me = pending; S.error = ""; }
  catch(e){ console.error(e); S.error = "Your profile didn't save. Open the quiz and try again."; }
  pendingBusy = false; rerender();
}
async function saveProfile(p){
  const uid = S.myId, batch = writeBatch(fb.db);
  batch.set(doc(fb.db, "profiles", uid), {name:p.name, zip:p.zip, area:p.area, about:p.about, ideal:p.ideal, answers:p.answers, ints:p.ints,
    hangSize:p.size, hangTime:p.time, hangFreq:p.freq, updatedAt:serverTimestamp()});
  batch.set(doc(fb.db, "contacts", uid), {contact:p.contact || ""});
  await batch.commit();
  S.contacts[uid] = p.contact || "";
  save("kindred.draft", p);
}
async function deleteProfile(){
  const uid = S.myId;
  const out = await getDocs(query(collection(fb.db, "waves"), where("from", "==", uid)));
  const batch = writeBatch(fb.db);
  out.forEach(d=> batch.delete(d.ref));
  batch.delete(doc(fb.db, "contacts", uid));
  batch.delete(doc(fb.db, "profiles", uid));
  await batch.commit();
}
async function sendWave(id){
  if(!S.myId){ openSignIn("Sign in to wave at people."); return; }
  if(!S.myDoc){ S.error = "Save your profile first so they can see who waved."; rerender(); return; }
  S.wavesOut.add(id); rerender();
  try{ await setDoc(doc(fb.db, "waves", S.myId + "_" + id), {from:S.myId, to:id, at:serverTimestamp()}); }
  catch(e){ console.error(e); S.wavesOut.delete(id); S.error = "That wave didn't go through. Try again in a moment."; rerender(); }
}

// ---------- helpers ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const first = n => esc(String(n).trim().split(/\s+/)[0] || "Someone");
const initials = n => esc(String(n).trim().split(/\s+/).map(x=>x[0]||"").join("").slice(0,2).toUpperCase() || "?");
const av = (p,lg) => `<div class="av${lg?" lg":""}" style="background:var(${p.av})" aria-hidden="true">${initials(p.name)}</div>`;
function ring(pct){
  const c = 2*Math.PI*22;
  return `<div class="ring" aria-label="${pct}% compatible"><svg viewBox="0 0 54 54"><circle class="track" cx="27" cy="27" r="22" fill="none" stroke-width="6"/><circle class="val" cx="27" cy="27" r="22" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c*pct/100} ${c}"/></svg><span>${pct}</span></div>`;
}
function traitBars(t, them){
  return `<div class="traits">${TRAITS.map(tr=>{
    const x = v => ((v-1)/4*100).toFixed(1)+"%";
    return `<div class="trait"><div class="lbl"><span>${tr.name}</span></div>
      <div class="bar">${them?`<i class="them" style="left:${x(them[tr.k])}"></i>`:""}<i style="left:${x(t[tr.k])}"></i></div>
      <div class="ends"><span>${tr.lo}</span><span>${tr.hi}</span></div></div>`;}).join("")}</div>`;
}
const fmtDist = d => d == null ? "Distance after you add your ZIP" : `${d.toFixed(1)} mi away`;
const badge = p => isMutual(p) ? `<span class="badge mutual">Mutual wave</span>` : "";
function waveBtn(p, cls){
  const w = iWaved(p.id);
  return `<button class="btn small ${cls||""}" data-wave="${esc(p.id)}" ${w?"disabled":""}>${w ? "Wave sent" : wavedAtMe(p.id) ? "Wave back" : "Wave hello"}</button>`;
}
function card(p, s){
  return `<article class="card">
    <div class="top">${av(p)}<div class="who"><h3>${first(p.name)}${badge(p)}</h3>
      <div class="meta">${p.area?esc(p.area)+" · ":""}${fmtDist(distance(p))}</div></div>${ring(s.total)}</div>
    ${p.about?`<p class="tagline">${esc(p.about)}</p>`:""}
    <ul class="reasons">${s.reasons.good.map(r=>`<li>${esc(r)}</li>`).join("")}${s.reasons.heads?`<li class="heads">${esc(s.reasons.heads)}</li>`:""}</ul>
    <div class="chips">${p.ints.map(i=>`<span class="chip${s.shared.includes(i)?" shared":""}">${esc(i)}</span>`).join("")}</div>
    <div class="actions"><button class="btn small" data-open="${esc(p.id)}">View profile</button>${waveBtn(p,"ghost")}</div>
  </article>`;
}
function notices(){
  let h = "";
  if(!fb) h += `<div class="notice" role="status"><b>Setup needed.</b> ${esc(setupError || "Paste your Firebase settings into config.js. See README.md, Part D.")}</div>`;
  if(S.error) h += `<div class="notice" role="status">${esc(S.error)}</div>`;
  if(fb && !S.myId) h += `<div class="banner"><span><b>Sign in to see members near you.</b> Use your Google account or an email and password.</span><button class="btn small" data-go="quiz">Take the quiz</button><button class="btn small ghost" data-signin="1">Sign in</button></div>`;
  else if(me.sample) h += `<div class="banner"><span><b>You're seeing sample answers.</b> Take the 3-minute quiz to find your own matches.</span><button class="btn small" data-go="quiz">Take the quiz</button></div>`;
  else if(S.myId && S.loaded && !S.myDoc) h += `<div class="banner"><span><b>Your profile isn't saved yet.</b> Finish the quiz so other members can match with you.</span><button class="btn small" data-go="quiz">Finish the quiz</button></div>`;
  return h;
}
function renderAuth(){
  const el = document.getElementById("auth");
  if(!fb){ el.innerHTML = `<span class="status">Not set up</span>`; return; }
  el.innerHTML = S.myId
    ? `<span class="status">${esc(S.email)}</span><button class="btn small ghost" type="button" id="signout">Sign out</button>`
    : `<button class="btn small ghost" type="button" data-signin="1">Sign in</button>`;
  document.getElementById("signout")?.addEventListener("click", async ()=>{ await signOut(fb.auth); drop("kindred.draft"); me = structuredClone(SAMPLE); go("matches"); });
}

// ---------- views ----------
function renderMatches(){
  const t = traitsOf(me.answers);
  const scored = S.members.map(p=>({p, s:score(p), d:distance(p)})).filter(x=> x.d == null || x.d <= S.ui.radius);
  scored.sort((a,b)=> S.ui.sort==="near" ? (a.d??1e9)-(b.d??1e9) : b.s.total-a.s.total);
  const top = scored[0];
  const incoming = S.members.filter(p=> wavedAtMe(p.id));
  const emptyMsg = !S.myId ? "Sign in to see who's here." : S.members.length ? `No members within ${S.ui.radius} mi yet. Widen the distance to see more people.` : "You're one of the first people here. Share the link, and matches will appear as others take the quiz.";
  document.getElementById("v-matches").innerHTML = `
    <div class="intro"><div><h1>${top?`${first(top.p.name)} could be your next good friend.`:"Your matches will show up here."}</h1>
      <p>Ranked by personality fit, shared interests, and how you like to spend time together.${S.myId?` ${S.members.length} other member${S.members.length===1?"":"s"} so far.`:""}</p></div></div>
    ${notices()}
    ${incoming.length?`<div class="inbox"><div class="eyebrow">Waved at you</div>${incoming.map(p=>`<div class="item">${av(p)}<b>${esc(p.name)}${badge(p)}</b><button class="btn small ghost" data-open="${esc(p.id)}">View profile</button>${iWaved(p.id)?"":waveBtn(p)}</div>`).join("")}</div>`:""}
    <div class="layout">
      <aside class="rail">
        <div><div class="eyebrow">${me.sample?"Sample profile":S.myDoc?"Your profile":"Your draft"}</div><h2>${esc(me.name || (me.sample?"Sample person":"You"))}</h2></div>
        ${traitBars(t)}
        <div><div class="eyebrow" style="margin-bottom:6px">Into</div><div class="chips">${me.ints.map(i=>`<span class="chip">${esc(i)}</span>`).join("")}</div></div>
        <dl class="facts"><dt>Hangouts</dt><dd>${SIZES[me.size]}</dd><dt>Best time</dt><dd>${TIMES[me.time]}</dd><dt>How often</dt><dd>${FREQS[me.freq]}</dd>${me.zip?`<dt>Home base</dt><dd>${esc(me.area||me.zip)}</dd>`:""}</dl>
        <button class="btn ghost small" data-go="quiz">${me.sample?"Take the quiz":"Edit answers"}</button>
      </aside>
      <div style="min-width:0">
        <div class="toolbar">
          <label for="radius">Within <input type="range" id="radius" min="1" max="50" step="1" value="${S.ui.radius}"><output id="rout">${S.ui.radius} mi</output></label>
          <label for="sort">Sort <select id="sort"><option value="score" ${S.ui.sort==="score"?"selected":""}>Best match</option><option value="near" ${S.ui.sort==="near"?"selected":""}>Closest</option></select></label>
          <span class="count">${scored.length} ${scored.length===1?"person":"people"}</span>
        </div>
        ${scored.length ? `<div class="list">${scored.map(x=>card(x.p,x.s)).join("")}</div>` : `<div class="empty">${emptyMsg}</div>`}
      </div>
    </div>`;
  const r = document.getElementById("radius");
  r.addEventListener("input", e=>{ document.getElementById("rout").textContent = e.target.value+" mi"; });
  r.addEventListener("change", e=>{ S.ui.radius = +e.target.value; save("kindred.radius", S.ui.radius); renderMatches(); });
  document.getElementById("sort").addEventListener("change", e=>{ S.ui.sort = e.target.value; renderMatches(); });
}

function renderEveryone(){
  const list = S.members.filter(p=> S.ui.filter==="All" || p.ints.includes(S.ui.filter)).map(p=>({p,s:score(p)})).sort((a,b)=> a.p.name.localeCompare(b.p.name));
  const emptyMsg = !S.myId ? "Sign in to see who's here." : S.members.length ? `No one lists ${esc(S.ui.filter.toLowerCase())} yet.` : "No one else has joined yet. Share the link so friends can take the quiz.";
  document.getElementById("v-everyone").innerHTML = `
    <div class="intro"><div><h1>The Kindred community</h1><p>Everyone at any distance${S.myId?`: ${S.members.length} member${S.members.length===1?"":"s"} besides you`:""}.</p></div></div>
    ${notices()}
    <div class="toolbar"><label for="ifilter">Interest <select id="ifilter"><option>All</option>${INTERESTS.map(i=>`<option ${S.ui.filter===i?"selected":""}>${i}</option>`).join("")}</select></label>
      <span class="count">${list.length} ${list.length===1?"person":"people"}</span></div>
    ${list.length?`<div class="list">${list.map(x=>card(x.p,x.s)).join("")}</div>`:`<div class="empty">${emptyMsg}</div>`}`;
  document.getElementById("ifilter").addEventListener("change", e=>{ S.ui.filter = e.target.value; renderEveryone(); });
}

function renderQuiz(){
  const blank = me.sample;
  const src = me, a = blank ? {} : src.answers, pre = blank ? {ints:[], size:"", time:"", freq:""} : src;
  const likert = q => `<div class="q"><p id="l-${q.id}">${q.text}</p>
    <div class="likert" role="radiogroup" aria-labelledby="l-${q.id}"><span class="end">Not me</span>
    ${[1,2,3,4,5].map(v=>`<input type="radio" name="${q.id}" id="${q.id}-${v}" value="${v}" ${+a[q.id]===v?"checked":""}><label for="${q.id}-${v}">${v}</label>`).join("")}
    <span class="end">So me</span></div></div>`;
  const radios = (name, opts, cur) => `<div class="pick" role="radiogroup">${Object.entries(opts).map(([k,v])=>`<input type="radio" name="${name}" id="${name}-${k}" value="${k}" ${cur===k?"checked":""}><label for="${name}-${k}">${v}</label>`).join("")}</div>`;
  const val = k => blank ? "" : esc(src[k] || "");
  document.getElementById("v-quiz").innerHTML = `
    <div class="intro"><div><h1>${S.myDoc?"Update your profile.":"Tell us how you friend."}</h1><p>Ten quick statements, a few interests, and how you like to hang out. Signed-in members can see your profile so they can match with you.</p></div></div>
    ${S.error?`<div class="notice" role="status">${esc(S.error)}</div>`:""}
    <form class="quiz" id="quiz" novalidate>
      <fieldset><legend>About you</legend>
        <div class="row"><div><label class="t" for="fname">First name</label><input type="text" id="fname" value="${val("name")}" maxlength="30" autocomplete="given-name"></div>
        <div><label class="t" for="fzip">ZIP code</label><input type="text" id="fzip" value="${val("zip")}" inputmode="numeric" maxlength="5" placeholder="e.g. 60614" autocomplete="postal-code"><p class="field-hint">Used to work out distance. Signed-in members can see it.</p></div></div>
        <div class="row"><div><label class="t" for="farea">Neighborhood or town</label><input type="text" id="farea" value="${val("area")}" maxlength="40" placeholder="Shown on your card"></div></div>
        <div class="row"><div><label class="t" for="fabout">One line about you</label><textarea id="fabout" maxlength="200" placeholder="What would a new friend want to know?">${val("about")}</textarea></div></div>
        <div class="row"><div><label class="t" for="fideal">Your ideal hangout</label><input type="text" id="fideal" value="${val("ideal")}" maxlength="200" placeholder="Optional"></div></div>
        <div class="row"><div><label class="t" for="fcontact">How to reach you</label><input type="text" id="fcontact" value="${val("contact")}" maxlength="100" placeholder="Optional, e.g. an Instagram handle">
          <p class="field-hint">Only shown to people you've both waved at.</p></div></div>
      </fieldset>
      <fieldset><legend>Your personality</legend><p class="hint">How well does each statement describe you?</p>${QUESTIONS.map(likert).join("")}</fieldset>
      <fieldset><legend>What you're into</legend><p class="hint">Pick 3 to 6.</p>
        <div class="pick" id="ints">${INTERESTS.map((i,n)=>`<input type="checkbox" id="int-${n}" value="${i}" ${pre.ints.includes(i)?"checked":""}><label for="int-${n}">${i}</label>`).join("")}</div></fieldset>
      <fieldset><legend>How you like to hang out</legend>
        <div class="q"><p>Group size</p>${radios("size",SIZES,pre.size)}</div>
        <div class="q"><p>Best time of day</p>${radios("time",TIMES,pre.time)}</div>
        <div class="q"><p>How often you want to meet up</p>${radios("freq",FREQS,pre.freq)}</div>
      </fieldset>
      <div class="submitrow"><button class="btn" type="submit" id="qsubmit">${S.myDoc?"Save changes":"Join and see my matches"}</button><p class="err" id="qerr" role="alert"></p></div>
      ${S.myDoc?`<div class="submitrow"><button class="btn small ghost danger" type="button" id="qdelete">Delete my profile</button><span class="field-hint" id="qdelhint"></span></div>`:""}
    </form>`;
  const form = document.getElementById("quiz"), err = document.getElementById("qerr");
  form.addEventListener("change", e=>{
    if(e.target.closest("#ints")){
      const on = form.querySelectorAll("#ints input:checked");
      if(on.length > 6){ e.target.checked = false; err.textContent = "You can pick up to 6 interests."; } else err.textContent = "";
    }
  });
  form.addEventListener("submit", async e=>{
    e.preventDefault();
    const answers = {}; let missing = 0;
    QUESTIONS.forEach(q=>{ const c = form.querySelector(`input[name=${q.id}]:checked`); if(c) answers[q.id] = +c.value; else missing++; });
    const ints = [...form.querySelectorAll("#ints input:checked")].map(i=>i.value);
    const pick = n => (form.querySelector(`input[name=${n}]:checked`)||{}).value;
    const name = document.getElementById("fname").value.trim(), zip = document.getElementById("fzip").value.trim();
    if(!name){ err.textContent = "Add your first name so matches know who you are."; return; }
    if(!/^\d{5}$/.test(zip)){ err.textContent = "Enter a 5-digit US ZIP code."; return; }
    if(S.zips && !S.zips[zip]){ err.textContent = `We don't recognize ZIP ${zip}. Check it and try again.`; return; }
    if(missing){ err.textContent = `Answer all ten statements (${missing} left).`; return; }
    if(ints.length < 3){ err.textContent = "Pick at least 3 interests."; return; }
    if(!pick("size") || !pick("time") || !pick("freq")){ err.textContent = "Choose a group size, time of day, and how often."; return; }
    const p = {sample:false, name, zip, area:document.getElementById("farea").value.trim(), about:document.getElementById("fabout").value.trim(),
      ideal:document.getElementById("fideal").value.trim(), contact:document.getElementById("fcontact").value.trim(),
      answers, ints, size:pick("size"), time:pick("time"), freq:pick("freq")};
    me = p; save("kindred.draft", p);
    if(!fb){ err.textContent = "This site isn't connected to Firebase yet. Paste your Firebase settings into config.js."; return; }
    if(!S.myId){ save("kindred.pending", p); openSignIn("Almost done. Sign in, and your profile saves automatically."); return; }
    const btn = document.getElementById("qsubmit"); btn.disabled = true; btn.textContent = "Saving…";
    try{ await saveProfile(p); S.error = ""; go("matches"); window.scrollTo({top:0}); }
    catch(ex){ console.error(ex); btn.disabled = false; btn.textContent = S.myDoc?"Save changes":"Join and see my matches";
      err.textContent = ex?.code === "permission-denied" ? "The database refused your profile. Make sure firestore.rules is published (README Part C)." : "Your profile didn't save. Check your connection and try again."; }
  });
  const del = document.getElementById("qdelete");
  if(del){
    let armed = false;
    del.addEventListener("click", async ()=>{
      if(!armed){ armed = true; del.textContent = "Yes, delete it"; document.getElementById("qdelhint").textContent = "This removes your profile, contact info and waves."; return; }
      del.disabled = true;
      try{ await deleteProfile(); }
      catch(e){ console.error(e); del.disabled = false; document.getElementById("qdelhint").textContent = "Couldn't delete right now. Try again."; return; }
      drop("kindred.draft"); me = structuredClone(SAMPLE); S.myDoc = null; go("matches");
    });
  }
}

// ---------- sheets ----------
const sheet = document.getElementById("sheet"), panel = document.getElementById("panel");
let lastFocus = null, openId = null;
function showSheet(){ lastFocus = document.activeElement; sheet.hidden = false; document.getElementById("pclose")?.focus(); }
function closeSheet(){ sheet.hidden = true; openId = null; if(lastFocus && document.contains(lastFocus)) lastFocus.focus(); }
function renderProfile(){
  const p = S.members.find(x=>x.id===openId);
  if(!p){ closeSheet(); return; }
  const s = score(p), t = traitsOf(me.answers), mutual = isMutual(p), contact = S.contacts[p.id];
  panel.innerHTML = `
    <div class="top">${av(p,true)}<div class="who"><h2 id="p-name">${esc(p.name)}${badge(p)}</h2>
      <div class="meta">${p.area?esc(p.area)+" · ":""}${fmtDist(distance(p))}</div></div>
      <button class="close" id="pclose" aria-label="Close">×</button></div>
    <div style="display:flex;gap:14px;align-items:center">${ring(s.total)}<div><b>${s.total}% compatible</b><div style="color:var(--muted);font-size:calc(15px*var(--ts))">${s.shared.length} shared interest${s.shared.length===1?"":"s"}</div></div></div>
    ${p.about?`<p class="bio">${esc(p.about)}</p>`:""}
    ${p.ideal?`<div><div class="eyebrow" style="margin-bottom:6px">Ideal hangout</div><p class="quote">${esc(p.ideal)}</p></div>`:""}
    ${mutual && contact?`<div><div class="eyebrow" style="margin-bottom:6px">You both waved. Reach ${first(p.name)} at</div><p class="contact">${esc(contact)}</p></div>`
      : mutual?`<p class="quote">You both waved! ${first(p.name)} hasn't added contact info yet.</p>`
      : wavedAtMe(p.id)?`<p class="quote">${first(p.name)} waved at you. Wave back to see how to reach them.</p>`:""}
    <div><div class="eyebrow" style="margin-bottom:6px">Why you'd click</div>
      <ul class="reasons">${s.reasons.good.map(r=>`<li>${esc(r)}</li>`).join("")}${s.reasons.heads?`<li class="heads">${esc(s.reasons.heads)}</li>`:""}</ul></div>
    <div><div class="eyebrow" style="margin-bottom:8px">Personality side by side</div>
      <div class="legend" style="margin-bottom:10px"><span><i></i>You</span><span><i class="them"></i>${first(p.name)}</span></div>
      ${traitBars(t, p.tr)}</div>
    <div><div class="eyebrow" style="margin-bottom:6px">Interests</div><div class="chips">${p.ints.map(i=>`<span class="chip${s.shared.includes(i)?" shared":""}">${esc(i)}</span>`).join("")}</div></div>
    <dl class="facts"><dt>Hangouts</dt><dd>${SIZES[p.size]}</dd><dt>Best time</dt><dd>${TIMES[p.time]}</dd><dt>How often</dt><dd>${FREQS[p.freq]}</dd></dl>
    ${waveBtn(p)}`;
}
function openProfile(id){ openId = id; renderProfile(); showSheet(); }
function authMsg(e){
  const c = e?.code || "";
  if(c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request" || c === "auth/user-cancelled") return "";
  const map = {
    "auth/unauthorized-domain": `Firebase hasn't approved this website's address yet. In Firebase, go to Authentication → Settings → Authorized domains and add ${location.hostname}.`,
    "auth/operation-not-allowed": "This sign-in method isn't turned on. In Firebase, go to Authentication → Sign-in method and enable it (README Part B).",
    "auth/email-already-in-use": "An account with this email already exists. Click Sign in instead.",
    "auth/invalid-credential": "Email or password is wrong. If you're new here, click Create account.",
    "auth/invalid-login-credentials": "Email or password is wrong. If you're new here, click Create account.",
    "auth/wrong-password": "Email or password is wrong.",
    "auth/user-not-found": "No account uses this email. Click Create account.",
    "auth/weak-password": "Use a password with at least 6 characters.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/missing-password": "Enter a password.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed": "Couldn't reach Firebase. Check your internet connection.",
    "auth/account-exists-with-different-credential": "This email already has an account that uses a different sign-in method. Try the other option.",
    "auth/invalid-api-key": "The apiKey in config.js is wrong. Copy it again from Firebase (README Part D).",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "The apiKey in config.js is wrong. Copy it again from Firebase (README Part D)."
  };
  return map[c] || `Sign-in didn't work (${c || e?.message || "unknown error"}).`;
}
const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function openSignIn(msg, isError){
  openId = null;
  const last = load("kindred.lastEmail", "");
  panel.innerHTML = `
    <div class="top"><h2 id="p-name">Sign in to Kindred</h2><button class="close" id="pclose" aria-label="Close">×</button></div>
    ${isError ? `<p class="notice" role="alert" style="margin:0">${esc(msg)}</p>` : `<p class="bio">${esc(msg || "Use your Google account, or an email and password.")}</p>`}
    <button class="btn ghost" type="button" id="sgoogle" style="display:flex;align-items:center;justify-content:center;gap:10px;padding-block:11px">${GOOGLE_G} Continue with Google</button>
    <div class="eyebrow" style="text-align:center">or use email</div>
    <form id="signin" class="quiz" novalidate style="gap:10px">
      <label class="t" for="semail" style="font-weight:600">Email</label>
      <input type="text" id="semail" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(last)}">
      <label class="t" for="spass" style="font-weight:600">Password</label>
      <input type="password" id="spass" autocomplete="current-password" placeholder="At least 6 characters" style="font:inherit;padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink)">
      <div class="submitrow"><button class="btn" type="submit" id="slogin">Sign in</button><button class="btn ghost" type="button" id="screate">Create account</button></div>
      <button type="button" id="sforgot" style="align-self:flex-start;border:0;background:none;color:var(--accent);font-weight:600;padding:0;text-decoration:underline">Forgot password?</button>
      <p class="err" id="serr" role="alert"></p>
    </form>`;
  showSheet();
  const errEl = document.getElementById("serr");
  const emailIn = document.getElementById("semail"), passIn = document.getElementById("spass");
  const busy = on => panel.querySelectorAll("button:not(#pclose)").forEach(b=> b.disabled = on);
  const fail = e => { busy(false); const m = authMsg(e); errEl.textContent = m; };
  document.getElementById("sgoogle").addEventListener("click", async ()=>{
    errEl.textContent = ""; busy(true);
    const provider = new GoogleAuthProvider();
    try{ await signInWithPopup(fb.auth, provider); }
    catch(e){
      if(e?.code === "auth/popup-blocked" || e?.code === "auth/operation-not-supported-in-this-environment"){
        try{ await signInWithRedirect(fb.auth, provider); return; }catch(e2){ fail(e2); return; }
      }
      fail(e);
    }
  });
  const creds = () => {
    const email = emailIn.value.trim(), pass = passIn.value;
    if(!/^\S+@\S+\.\S+$/.test(email)){ errEl.textContent = "Enter a valid email address."; return null; }
    if(pass.length < 6){ errEl.textContent = "Use a password with at least 6 characters."; return null; }
    save("kindred.lastEmail", email);
    return { email, pass };
  };
  document.getElementById("signin").addEventListener("submit", async e=>{
    e.preventDefault(); errEl.textContent = "";
    const c = creds(); if(!c) return;
    busy(true);
    try{ await signInWithEmailAndPassword(fb.auth, c.email, c.pass); }catch(e){ fail(e); }
  });
  document.getElementById("screate").addEventListener("click", async ()=>{
    errEl.textContent = "";
    const c = creds(); if(!c) return;
    busy(true);
    try{ await createUserWithEmailAndPassword(fb.auth, c.email, c.pass); }catch(e){ fail(e); }
  });
  document.getElementById("sforgot").addEventListener("click", async ()=>{
    const email = emailIn.value.trim();
    if(!/^\S+@\S+\.\S+$/.test(email)){ errEl.textContent = "Type your email above first, then click Forgot password."; emailIn.focus(); return; }
    busy(true);
    try{ await sendPasswordResetEmail(fb.auth, email); busy(false); errEl.textContent = ""; 
      errEl.insertAdjacentHTML("beforebegin", `<p class="quote" id="sreset">If an account uses ${esc(email)}, a password reset email is on its way. Check spam too.</p>`); }
    catch(e){ fail(e); }
  });
}
sheet.addEventListener("click", e=>{ if(e.target===sheet || e.target.id==="pclose") closeSheet(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !sheet.hidden) closeSheet(); });

// ---------- navigation ----------
function go(view){
  S.view = view;
  document.querySelectorAll("nav button").forEach(b=>{ if(b.dataset.view===view) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current"); });
  ["matches","quiz","everyone"].forEach(v=> document.getElementById("v-"+v).hidden = v!==view);
  ({matches:renderMatches, quiz:renderQuiz, everyone:renderEveryone})[view]();
  renderAuth();
}
function rerender(){
  renderAuth();
  if(S.view !== "quiz") ({matches:renderMatches, everyone:renderEveryone})[S.view]();
  if(!sheet.hidden && openId) renderProfile();
}
document.addEventListener("click", e=>{
  const n = e.target.closest("[data-view],[data-go],[data-open],[data-wave],[data-signin]");
  if(!n) return;
  if(n.dataset.view) go(n.dataset.view);
  else if(n.dataset.go){ closeSheet(); go(n.dataset.go); }
  else if(n.dataset.open) openProfile(n.dataset.open);
  else if(n.dataset.wave) sendWave(n.dataset.wave);
  else if(n.dataset.signin) openSignIn();
});


// ---------- display preferences: text size and light/dark ----------
(function(){
  const root = document.documentElement;
  const SIZES_OK = ["0.9","1","1.15","1.3"];
  const get = (k,d) => { try{ return localStorage.getItem(k) ?? d; }catch(e){ return d; } };
  const set = (k,v) => { try{ localStorage.setItem(k,v); }catch(e){} };
  const sizeBtn = document.getElementById("sizebtn"), menu = document.getElementById("sizemenu"), themeBtn = document.getElementById("themebtn");
  const items = [...menu.querySelectorAll("[data-size]")];
  function applySize(v){
    if(!SIZES_OK.includes(v)) v = "1";
    root.style.setProperty("--ts", v);
    items.forEach(b=> b.setAttribute("aria-checked", String(b.dataset.size === v)));
  }
  function openMenu(){ menu.hidden = false; sizeBtn.setAttribute("aria-expanded","true"); (items.find(b=>b.getAttribute("aria-checked")==="true")||items[0]).focus(); }
  function closeMenu(focus){ if(menu.hidden) return; menu.hidden = true; sizeBtn.setAttribute("aria-expanded","false"); if(focus) sizeBtn.focus(); }
  sizeBtn.addEventListener("click", ()=> menu.hidden ? openMenu() : closeMenu());
  items.forEach(b=> b.addEventListener("click", ()=>{ applySize(b.dataset.size); set("kindred.textSize", b.dataset.size); closeMenu(true); }));
  menu.addEventListener("keydown", e=>{
    const i = items.indexOf(document.activeElement);
    if(e.key==="ArrowDown"){ e.preventDefault(); items[(i+1)%items.length].focus(); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); items[(i-1+items.length)%items.length].focus(); }
    else if(e.key==="Escape"){ e.stopPropagation(); closeMenu(true); }
    else if(e.key==="Tab") closeMenu();
  });
  document.addEventListener("click", e=>{ if(!menu.hidden && !e.target.closest(".tools")) closeMenu(); });

  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  function effective(){
    const m = root.getAttribute("data-mode");
    if(m === "dark" || m === "light") return m;
    const t = root.getAttribute("data-theme");
    if(t === "dark" || t === "light") return t;
    return mq && mq.matches ? "dark" : "light";
  }
  function paintThemeBtn(){
    const dark = effective() === "dark";
    themeBtn.innerHTML = dark ? SUN : MOON;
    themeBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    themeBtn.title = dark ? "Light mode" : "Dark mode";
  }
  function applyMode(m){ if(m === "dark" || m === "light") root.setAttribute("data-mode", m); else root.removeAttribute("data-mode"); paintThemeBtn(); }
  themeBtn.addEventListener("click", ()=>{ const next = effective() === "dark" ? "light" : "dark"; applyMode(next); set("kindred.mode", next); });
  if(mq && mq.addEventListener) mq.addEventListener("change", paintThemeBtn);
  new MutationObserver(paintThemeBtn).observe(root, {attributes:true, attributeFilter:["data-theme"]});

  applySize(get("kindred.textSize","1"));
  applyMode(get("kindred.mode",""));
})();

go("matches");
fetch("zips.json").then(r=>r.ok?r.json():null).then(z=>{ if(z){ S.zips = z; rerender(); } }).catch(()=>{});
if(fb){
  getRedirectResult(fb.auth).catch(e=>{ const m = authMsg(e); if(m) openSignIn(m, true); });
  onAuthStateChanged(fb.auth, user=>{
    const id = user?.uid || null;
    const changed = id !== S.myId;
    S.myId = id; S.email = user?.email || "";
    if(changed){ if(!sheet.hidden && !openId && id) closeSheet(); listen(); }
    else rerender();
  });
}
