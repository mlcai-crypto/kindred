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
const cfg = window.KINDRED_CONFIG || {};
// Read any sign-in result the email link put in the address bar before the client consumes it.
const LINK = (()=>{
  const h = new URLSearchParams(location.hash.replace(/^#/, "")), q = new URLSearchParams(location.search);
  const pick = k => h.get(k) || q.get(k) || "";
  return { hadToken: !!(h.get("access_token") || q.get("code") || q.get("token_hash")),
           errCode: pick("error_code") || (pick("error") ? pick("error") : ""), errDesc: pick("error_description").replace(/\+/g, " ") };
})();
const sb = (cfg.supabaseUrl && cfg.supabaseKey && window.supabase)
  ? window.supabase.createClient(String(cfg.supabaseUrl).trim().replace(/\/+$/, ""), String(cfg.supabaseKey).trim(),
      { auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } })
  : null;
const S = {
  session:null, myId:null, email:"", loaded:false, error:"",
  members:[], myDoc:null, waves:[], contacts:{},
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
function fromRow(r){
  const p = {id:r.id, name:r.name || "Someone", zip:r.zip || "", area:r.area || "", about:r.about || "", ideal:r.ideal || "",
    answers: r.answers || {}, ints: (r.ints || []).filter(x=>INTERESTS.includes(x)),
    size: SIZES[r.hang_size] ? r.hang_size : "small", time: TIMES[r.hang_time] ? r.hang_time : "day", freq: FREQS[r.hang_freq] ? r.hang_freq : "month"};
  p.tr = traitsOf(p.answers);
  let h = 0; for(const c of p.id) h = (h*31 + c.charCodeAt(0)) >>> 0;
  p.av = AVC[h % 6];
  return p;
}
const iWaved = id => S.waves.some(w=> w.from_id===S.myId && w.to_id===id);
const wavedAtMe = id => S.waves.some(w=> w.from_id===id && w.to_id===S.myId);
const isMutual = p => iWaved(p.id) && wavedAtMe(p.id);

async function refresh(){
  if(!sb || !S.myId){ S.members = []; S.waves = []; S.contacts = {}; S.myDoc = null; S.loaded = true; rerender(); return; }
  const [pr, wv, ct] = await Promise.all([
    sb.from("profiles").select("*").limit(2000),
    sb.from("waves").select("from_id,to_id"),
    sb.from("contacts").select("id,contact")
  ]);
  if(pr.error || wv.error || ct.error){ S.error = "Couldn't load members right now. Reload the page to try again."; rerender(); return; }
  S.error = "";
  const list = pr.data.map(fromRow);
  S.members = list.filter(p=>p.id !== S.myId);
  S.waves = wv.data;
  S.contacts = Object.fromEntries(ct.data.map(c=>[c.id, c.contact]));
  const mine = list.find(p=>p.id === S.myId);
  S.myDoc = mine || null;
  if(mine && S.view !== "quiz"){ me = structuredClone(mine); me.contact = S.contacts[S.myId] || ""; }
  S.loaded = true;
  // A quiz finished before signing in gets saved now.
  const pending = load("kindred.pending", null);
  if(pending){ drop("kindred.pending"); try{ await saveProfile(pending); me = pending; await refresh(); return; }catch(e){ S.error = "Your profile didn't save. Open the quiz and try again."; } }
  rerender();
}

async function saveProfile(p){
  const row = {id:S.myId, name:p.name, zip:p.zip, area:p.area, about:p.about, ideal:p.ideal, answers:p.answers, ints:p.ints,
    hang_size:p.size, hang_time:p.time, hang_freq:p.freq, updated_at:new Date().toISOString()};
  const a = await sb.from("profiles").upsert(row);
  if(a.error) throw a.error;
  const b = await sb.from("contacts").upsert({id:S.myId, contact:p.contact || ""});
  if(b.error) throw b.error;
  save("kindred.draft", p);
}
async function sendWave(id){
  if(!S.myId){ openSignIn("Sign in to wave at people."); return; }
  if(!S.myDoc){ S.error = "Save your profile first so they can see who waved."; rerender(); return; }
  S.waves.push({from_id:S.myId, to_id:id}); rerender();
  const r = await sb.from("waves").insert({from_id:S.myId, to_id:id});
  if(r.error && r.error.code !== "23505"){ S.waves = S.waves.filter(w=>!(w.from_id===S.myId && w.to_id===id)); S.error = "That wave didn't go through. Try again in a moment."; rerender(); return; }
  refresh();
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
  if(!sb) h += `<div class="notice" role="status"><b>Setup needed.</b> Add your Supabase URL and public key to config.js. See README.md for the steps.</div>`;
  if(S.error) h += `<div class="notice" role="status">${esc(S.error)}</div>`;
  if(sb && !S.myId) h += `<div class="banner"><span><b>Sign in to see members near you.</b> Take the quiz, then save your profile with a one-time email link.</span><button class="btn small" data-go="quiz">Take the quiz</button><button class="btn small ghost" data-signin="1">Sign in</button></div>`;
  else if(me.sample) h += `<div class="banner"><span><b>You're seeing sample answers.</b> Take the 3-minute quiz to find your own matches.</span><button class="btn small" data-go="quiz">Take the quiz</button></div>`;
  else if(S.myId && S.loaded && !S.myDoc) h += `<div class="banner"><span><b>Your profile isn't saved yet.</b> Finish the quiz so other members can match with you.</span><button class="btn small" data-go="quiz">Finish the quiz</button></div>`;
  return h;
}
function renderAuth(){
  const el = document.getElementById("auth");
  if(!sb){ el.innerHTML = `<span class="status">Not set up</span>`; return; }
  el.innerHTML = S.myId
    ? `<span class="status">${esc(S.email)}</span><button class="btn small ghost" type="button" id="signout">Sign out</button>`
    : `<button class="btn small ghost" type="button" data-signin="1">Sign in</button>`;
  document.getElementById("signout")?.addEventListener("click", async ()=>{ await sb.auth.signOut(); me = load("kindred.draft", null) || structuredClone(SAMPLE); go("matches"); });
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
    if(!sb){ err.textContent = "This site isn't connected to a database yet. Add your Supabase details to config.js."; return; }
    if(!S.myId){ save("kindred.pending", p); openSignIn("Almost done. Enter your email and we'll send a link that saves your profile."); return; }
    const btn = document.getElementById("qsubmit"); btn.disabled = true; btn.textContent = "Saving…";
    try{ await saveProfile(p); S.error = ""; await refresh(); go("matches"); window.scrollTo({top:0}); }
    catch(ex){ btn.disabled = false; btn.textContent = S.myDoc?"Save changes":"Join and see my matches"; err.textContent = "Your profile didn't save. Check your connection and try again."; }
  });
  const del = document.getElementById("qdelete");
  if(del){
    let armed = false;
    del.addEventListener("click", async ()=>{
      if(!armed){ armed = true; del.textContent = "Yes, delete it"; document.getElementById("qdelhint").textContent = "This removes your profile, contact info and waves."; return; }
      del.disabled = true;
      const rs = await Promise.all([
        sb.from("waves").delete().eq("from_id", S.myId),
        sb.from("contacts").delete().eq("id", S.myId),
        sb.from("profiles").delete().eq("id", S.myId)
      ]);
      if(rs.some(r=>r.error)){ del.disabled = false; document.getElementById("qdelhint").textContent = "Couldn't delete right now. Try again."; return; }
      drop("kindred.draft"); me = structuredClone(SAMPLE); S.myDoc = null; await refresh(); go("matches");
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
function openSignIn(msg, isError){
  openId = null;
  const last = load("kindred.lastEmail", "");
  panel.innerHTML = `
    <div class="top"><h2 id="p-name">Sign in to Kindred</h2><button class="close" id="pclose" aria-label="Close">×</button></div>
    ${isError ? `<p class="notice" role="alert" style="margin:0">${esc(msg)}</p>` : `<p class="bio">${esc(msg || "We'll email you a sign-in link and code. No password needed.")}</p>`}
    <form id="signin" class="quiz" novalidate style="gap:12px">
      <label class="t" for="semail" style="font-weight:600">Email</label>
      <input type="text" id="semail" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(last)}">
      <button class="btn" type="submit" id="ssend">Email me a sign-in link</button>
      <p class="err" id="serr" role="alert"></p>
    </form>
    <div id="sstep2"></div>`;
  showSheet();
  document.getElementById("semail").focus();
  document.getElementById("signin").addEventListener("submit", async e=>{
    e.preventDefault();
    const email = document.getElementById("semail").value.trim().toLowerCase(), errEl = document.getElementById("serr"), btn = document.getElementById("ssend");
    if(!/^\S+@\S+\.\S+$/.test(email)){ errEl.textContent = "Enter a valid email address."; return; }
    btn.disabled = true; btn.textContent = "Sending…"; errEl.textContent = "";
    const { error } = await sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
    btn.disabled = false; btn.textContent = "Send another email";
    if(error){
      btn.textContent = "Email me a sign-in link";
      errEl.textContent = error.status === 429 ? "Too many sign-in emails were sent recently. Wait a few minutes and try again."
        : /redirect/i.test(error.message||"") ? "Supabase rejected this site's address. Add it under Authentication → URL Configuration → Redirect URLs."
        : `We couldn't send the email: ${error.message || "unknown error"}`;
      return;
    }
    save("kindred.lastEmail", email);
    showCodeStep(email);
  });
}
function showCodeStep(email){
  const box = document.getElementById("sstep2");
  box.innerHTML = `
    <p class="quote">We sent an email to <b>${esc(email)}</b>. Click the link in it <b>in this same browser</b>, or type the code from the email below.</p>
    <form id="scode" class="quiz" novalidate style="gap:12px;margin-top:14px">
      <label class="t" for="scodein" style="font-weight:600">Code from the email</label>
      <input type="text" id="scodein" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456">
      <button class="btn" type="submit" id="scodebtn">Sign in with code</button>
      <p class="err" id="scodeerr" role="alert"></p>
    </form>`;
  document.getElementById("scode").addEventListener("submit", async e=>{
    e.preventDefault();
    const token = document.getElementById("scodein").value.replace(/\s/g,""), errEl = document.getElementById("scodeerr"), btn = document.getElementById("scodebtn");
    if(!/^\d{6,10}$/.test(token)){ errEl.textContent = "Enter the number code from the email. If the email has no code, use the link instead."; return; }
    btn.disabled = true; btn.textContent = "Checking…"; errEl.textContent = "";
    const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
    if(error){ btn.disabled = false; btn.textContent = "Sign in with code"; errEl.textContent = /expired|invalid/i.test(error.message||"") ? "That code is wrong or has expired. Request a new email and use the newest code." : `Sign-in failed: ${error.message}`; }
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
if(sb){
  sb.auth.onAuthStateChange((event, session)=>{
    const id = session?.user?.id || null;
    const changed = id !== S.myId;
    S.session = session; S.myId = id; S.email = session?.user?.email || "";
    if(changed){ if(!sheet.hidden && !openId && id) closeSheet(); setTimeout(refresh, 0); }
  });
  setInterval(()=>{ if(document.visibilityState === "visible" && S.myId) refresh(); }, 60000);
  sb.auth.getSession().then(({ data })=>{
    const signedIn = !!data?.session;
    if(LINK.errCode || LINK.errDesc){
      const expired = /otp_expired|expired|invalid/i.test(LINK.errCode + " " + LINK.errDesc);
      openSignIn(expired
        ? "That sign-in link has expired or was already used. This often happens when an email app or security scanner opens the link before you do. Send a new email, then type the code from it here instead of clicking the link."
        : `Sign-in didn't work: ${LINK.errDesc || LINK.errCode}. Send a new email and try again.`, true);
    } else if(LINK.hadToken && !signedIn){
      openSignIn("The sign-in link reached the site but didn't sign you in. Send a new email and type the code from it here instead.", true);
    }
    if(LINK.errCode || LINK.errDesc || LINK.hadToken){ try{ history.replaceState(null, "", location.pathname); }catch(e){} }
  });
}
