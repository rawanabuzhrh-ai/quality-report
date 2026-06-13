/* ============ تقرير جودة المكالمات — منطق اللوحة ============ */

let BUNDLE = null;        // encrypted data, loaded async before login
let MASTER = null; // holds manager payload (incl. creds) after master login

const SEV = {
  EUC: { ar:"حرج على العميل", full:"خطأ حرج يؤثر على العميل", color:"var(--euc)", rank:3 },
  BC:  { ar:"حرج على العمل",  full:"خطأ حرج يؤثر على العمل",  color:"var(--bc)",  rank:2 },
  NC:  { ar:"غير حرج",        full:"خطأ غير حرج",             color:"var(--nc)",  rank:1 },
};

/* خطة التطوير لكل ملاحظة معروفة */
const TIPS = [
  { m:"المعلومه الكاملة", t:"التأكد من إعطاء العميل المعلومة كاملة والتحقق من فهمه لها قبل إنهاء المكالمة." },
  { m:"المعلومه الصحيحة", t:"التحقق من صحة المعلومة من النظام/المصدر المعتمد قبل تزويد العميل بها." },
  { m:"اسلوب سلبي", t:"الحفاظ على نبرة إيجابية ومهنية، وتجنب أي أسلوب قد يؤثر على تجربة العميل." },
  { m:"الحل أو الإجابة", t:"التأكد من معالجة جميع استفسارات العميل والإجابة عليها قبل إغلاق المكالمة." },
  { m:"تعاطف", t:"إظهار التعاطف مع مشكلة العميل عندما يقتضي السياق ذلك." },
  { m:"الاسئلة الاستفهامية", t:"طرح الأسئلة الاستيضاحية لفهم طلب العميل بدقة قبل تقديم المعلومة." },
  { m:"الترحيب بالعميل وذكر اسم", t:"مخاطبة العميل بلقب مناسب (أستاذ/أستاذة) وعدم استخدام الاسم مجرّداً." },
  { m:"الرد على العميل خلال", t:"الرد على العميل خلال 5 ثوانٍ كحد أقصى." },
  { m:"انهاء المكالمة بالصيغة", t:"إغلاق المكالمة بالصيغة الموحّدة المعتمدة." },
  { m:"الاعتذار من العميل بعد العودة", t:"الاعتذار للعميل عند العودة من وضع الانتظار." },
  { m:"التحية كاملة", t:"ذكر التحية كاملة: السلام عليكم / اسم الشركة / اسم الموظف." },
  { m:"ادارة المكالمة باحترافية", t:"إدارة المكالمة باحترافية والحفاظ على التفاعل والحيوية طوال المكالمة." },
];
function tipFor(attr){
  for(const x of TIPS){ if(attr.includes(x.m)) return x.t; }
  return "مراجعة الملاحظة مع المشرف والعمل على تلافيها مستقبلاً.";
}

const MONTH_AR_DEFAULT = "مايو";
let MONTH_AR = MONTH_AR_DEFAULT;
function initials(name){
  const p = name.trim().split(/\s+/);
  return ((p[0]||"")[0] || "") + ((p[1]||"")[0] || "");
}
function arNum(n){ return String(n).replace(/\d/g, d=>"٠١٢٣٤٥٦٧٨٩"[d]); }

/* ===== globals set after login ===== */
let DATA = null, N = 0, TEAM = { avgErr:0, avgEuc:0 }, MODE = "manager";

/* ===== state ===== */
let state = { sort:"errors", q:"", selected:null };

/* ===== KPIs ===== */
function renderKPIs(){
  document.getElementById("meta-agents").textContent = arNum(N)+" موظفين";
  const row = document.getElementById("kpiRow");
  if(MODE==="agent"){ row.innerHTML=""; row.style.display="none"; return; }
  const t = DATA.totals;
  const items = [
    { v:t.pass, l:"مكالمات ناجحة", c:"pass" },
    { v:t.EUC,  l:"حرجة على العميل", c:"euc" },
    { v:t.BC,   l:"حرجة على العمل", c:"bc" },
    { v:t.NC,   l:"غير حرجة", c:"nc" },
    { v:t.EUC+t.BC+t.NC, l:"إجمالي الأخطاء", c:"" },
  ];
  row.innerHTML = items.map(i=>
    `<div class="kpi ${i.c}"><div class="v">${i.v}</div><div class="l">${i.l}</div></div>`).join("");
}

/* ===== sorting + filtering ===== */
function sortedAgents(){
  let list = DATA.agents.filter(a => a.display.toLowerCase().includes(state.q.toLowerCase()));
  if(state.sort==="errors") list = [...list].sort((a,b)=> b.totalErrors-a.totalErrors || b.counts.EUC-a.counts.EUC);
  else if(state.sort==="euc") list = [...list].sort((a,b)=> b.counts.EUC-a.counts.EUC || b.totalErrors-a.totalErrors);
  else list = [...list].sort((a,b)=> a.display.localeCompare(b.display,"ar"));
  return list;
}

/* ===== agent list ===== */
function renderList(){
  const list = sortedAgents();
  const el = document.getElementById("agentList");
  if(!list.length){ el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--faint);font-size:13px;">لا توجد نتائج</div>`; return; }
  el.innerHTML = list.map(a=>{
    const sel = state.selected===agentKey(a) ? "active":"";
    const pillClass = a.totalErrors===0 ? "zero" : (a.counts.EUC>0 ? "has":"");
    return `<div class="agent-row ${sel}" data-key="${agentKey(a)}">
      <div class="ava">${initials(a.display)}</div>
      <div class="nm"><div class="n1">${a.display}</div><div class="n2">${a.ext?("#"+a.ext):"—"}</div></div>
      <div class="err-pill ${pillClass}" title="إجمالي الأخطاء">${a.totalErrors}</div>
    </div>`;
  }).join("");
  el.querySelectorAll(".agent-row").forEach(r=>r.addEventListener("click",()=>{ select(r.dataset.key); }));
}
function agentKey(a){ return (a.display+"|"+a.ext); }
function findAgent(k){ return DATA.agents.find(a=>agentKey(a)===k); }

/* ===== analysis text ===== */
function analyze(a){
  const c = a.counts;
  // verdict
  let verdict, vClass, vText;
  if(c.EUC>0 || c.BC>0){ verdict="crit"; vText="يحتاج إلى متابعة عاجلة"; }
  else if(c.NC>0){ verdict="warn"; vText="ملاحظات بسيطة قابلة للتحسين"; }
  else { verdict="ok"; vText="أداء ممتاز — بلا ملاحظات"; }

  // top recurring attribute
  const freq = {};
  a.errors.forEach(e=>{ freq[e.attribute]=(freq[e.attribute]||0)+1; });
  const top = Object.entries(freq).sort((x,y)=>y[1]-x[1]);
  const topAttr = top.length? top[0][0] : null;
  const topCount = top.length? top[0][1] : 0;

  // comparison
  const eucCmp = c.EUC>TEAM.avgEuc ? "أعلى" : (c.EUC<TEAM.avgEuc ? "أقل":"مساوٍ");
  const errCmp = a.totalErrors>TEAM.avgErr ? "أعلى" : (a.totalErrors<TEAM.avgErr ? "أقل":"مساوٍ");

  // paragraphs
  const paras = [];
  if(a.totalErrors===0){
    paras.push(`<p class="lead">سجّل ${a.display} ${a.pass} مكالمة ناجحة خلال مايو دون أي ملاحظات جودة — أداء مثالي يستحق الإشادة.</p>`);
  } else {
    paras.push(`<p class="lead">رُصدت ${arNum(a.totalErrors)} ملاحظة على ${a.display} خلال مايو، مقابل ${a.pass} مكالمة ناجحة.</p>`);
    const sevParts = [];
    if(c.EUC) sevParts.push(`${c.EUC} حرجة على العميل`);
    if(c.BC)  sevParts.push(`${c.BC} حرجة على العمل`);
    if(c.NC)  sevParts.push(`${c.NC} غير حرجة`);
    paras.push(`<p>توزيع الملاحظات: ${sevParts.join("، ")}. عدد الأخطاء لديه <b>${errCmp}</b> من متوسط الفريق (${TEAM.avgErr.toFixed(1)})، والأخطاء الحرجة على العميل <b>${eucCmp}</b> من المتوسط (${TEAM.avgEuc.toFixed(1)}).</p>`);
    if(topCount>1){
      paras.push(`<p>أكثر ملاحظة تكراراً: «${topAttr}» بواقع ${arNum(topCount)} مرات — وهي نقطة التركيز الأهم في التطوير.</p>`);
    }
  }

  // recommendations: unique tips for their attributes, prioritized by severity then frequency
  const ordered = [...a.errors].sort((x,y)=> SEV[y.type].rank-SEV[x.type].rank);
  const seenTips = new Set(); const recs = [];
  for(const e of ordered){ const t = tipFor(e.attribute); if(!seenTips.has(t)){ seenTips.add(t); recs.push(t); } }

  return { verdict, vText, paras, recs };
}

/* ===== breakdown bars ===== */
function breakdownHTML(a){
  const max = Math.max(a.counts.EUC, a.counts.BC, a.counts.NC, 1);
  const rows = ["EUC","BC","NC"].filter(k=>a.counts[k]>0).map(k=>{
    const v = a.counts[k]; const w = Math.round(v/max*100);
    return `<div class="bd-item">
      <span class="badge ${k}">${SEV[k].ar}</span>
      <div class="lbl"></div>
      <div class="bd-track"><div class="bd-fill" style="width:${w}%;background:${SEV[k].color}"></div></div>
      <span class="cnt">${v}</span></div>`;
  }).join("");
  return rows;
}

/* ===== per-call storage keys ===== */
function errId(e){
  return (e.code && !e.codeBad) ? ('c'+e.code) : ('d'+(e.day||'')+'_'+((e.attribute||'').replace(/\s+/g,'').slice(0,14)));
}
function lsKey(kind, agentKey, e){
  return kind+'::'+((BUNDLE&&BUNDLE.project)||'DAW')+'::'+agentKey+'::'+errId(e);
}
function lget(k){ try{ return localStorage.getItem(k)||''; }catch(_){ return ''; } }
function lset(k,v){ try{ if(v) localStorage.setItem(k,v); else localStorage.removeItem(k); }catch(_){} }

function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function isValidUrl(u){ return /^https?:\/\/\S+$/i.test((u||'').trim()); }

/* ===== error cards (interactive) ===== */
function errorsHTML(a){
  const ak = agentKey(a);
  const ordered = [...a.errors].sort((x,y)=> SEV[y.type].rank-SEV[x.type].rank || (+x.day)-(+y.day));
  return ordered.map((e)=>{
    const eidAttr = errId(e);
    const codeBad = e.codeBad;
    const codeDisp = codeBad ? "غير مكتمل" : e.code;
    const copyBtn = codeBad
      ? `<span class="mini-copy" title="الكود غير مكتمل — يُرجى السحب من النظام بتاريخ ${e.day} ${MONTH_AR}" style="cursor:help;">⚠</span>`
      : `<button class="mini-copy" data-copy="${e.code}" title="نسخ كود المكالمة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg></button>`;

    // link: from data (published) or local draft (manager unsaved)
    const link = e.link || lget(lsKey('lnk',ak,e));
    const note = e.note || lget(lsKey('note',ak,e));
    const comment = lget(lsKey('cmt',ak,e));
    const heard = lget(lsKey('heard',ak,e))==='1';
    const audio = e.audio || '';

    let linkBlock, noteBlock, commentBlock = '', audioBlock = '';
    if(MODE==="manager"){
      linkBlock = `<div class="efield">
        <label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg> رابط تسجيل المكالمة</label>
        <div class="input-row">
          <input type="url" dir="ltr" placeholder="https://…" value="${escapeHtml(link)}" data-eid="${eidAttr}" data-field="lnk" />
          <button class="save-btn" data-save="lnk" data-eid="${eidAttr}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><path d="M17 21v-8H7v8M7 3v5h8"></path></svg> حفظ</button>
        </div>
      </div>`;
      audioBlock = `<div class="efield">
        <label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"></path></svg> أو ارفع تسجيل المكالمة صوتياً (اختياري)</label>
        <div class="audio-ctl" data-audwrap="${eidAttr}">
          ${audio
            ? `<audio controls src="${audio}" class="aud"></audio><button class="rm-aud" data-rmaud="${eidAttr}" title="حذف التسجيل"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"></path></svg> حذف</button>`
            : `<label class="upload-aud"><input type="file" accept="audio/*" data-aud="${eidAttr}" hidden /><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M7 9l5-5 5 5"></path><path d="M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"></path></svg> رفع ملف صوتي</label>`}
        </div>
      </div>`;
      noteBlock = `<div class="efield">
        <label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> ملاحظة المدير (تظهر للموظف)</label>
        <textarea placeholder="اكتب توجيهك للموظف حول هذه المكالمة…" data-eid="${eidAttr}" data-field="note">${escapeHtml(note)}</textarea>
        <button class="save-btn" data-save="note" data-eid="${eidAttr}" style="align-self:flex-start;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><path d="M17 21v-8H7v8M7 3v5h8"></path></svg> حفظ الملاحظة</button>
      </div>`;
      // manager can see the agent's comment only if stored on this browser
      if(comment){
        commentBlock = `<div class="agent-cmt"><span class="nh">تعليق الموظف</span>${escapeHtml(comment)}</div>`;
      }
    } else {
      // AGENT view
      const listenBtn = isValidUrl(link)
        ? `<a class="listen-btn" href="${escapeHtml(link)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg> استماع للمكالمة</a>`
        : (audio ? '' : `<span class="no-link"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v4M12 16h.01"></path></svg> لم يُضَف رابط التسجيل بعد</span>`);
      const heardBlock = `<label class="heard-toggle ${heard?'on':''}" data-eid="${eidAttr}">
        <span class="hbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"></path></svg></span>
        <span class="htxt">سمعت المكالمة</span>
      </label>`;
      linkBlock = `<div class="listen-row">${listenBtn}${heardBlock}</div>`;
      audioBlock = audio ? `<audio controls src="${audio}" class="aud aud-agent"></audio>` : '';
      noteBlock = note ? `<div class="mgr-note"><span class="nh">ملاحظة المدير</span>${escapeHtml(note)}</div>` : '';
      commentBlock = `<div class="efield">
        <label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> تعليقك على هذه المكالمة</label>
        <textarea placeholder="اكتب ملاحظتك أو ردّك بعد الاستماع…" data-eid="${eidAttr}" data-field="cmt">${escapeHtml(comment)}</textarea>
        <button class="save-btn" data-save="cmt" data-eid="${eidAttr}" style="align-self:flex-start;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><path d="M17 21v-8H7v8M7 3v5h8"></path></svg> حفظ تعليقي</button>
      </div>`;
    }

    return `<div class="ecard" data-eid="${eidAttr}">
      <div class="ecard-top">
        <span class="badge ${e.type}">${SEV[e.type].ar}</span>
        <span class="ecard-date"><b>${e.day}</b> ${MONTH_AR}</span>
        ${heard?`<span class="heard-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12"><path d="M20 6 9 17l-5-5"></path></svg> تم الاستماع</span>`:""}
        <span class="ecard-code ${codeBad?'bad':''}"><span class="code mono">${codeDisp}</span>${copyBtn}</span>
      </div>
      <div class="ecard-body">
        <div class="ecard-attr">${e.attribute}</div>
        ${linkBlock}
        ${audioBlock}
        ${noteBlock}
        ${commentBlock}
      </div>
    </div>`;
  }).join("");
}

/* ===== pass calls + tickets ===== */
function passHTML(a){
  const calls = a.passCalls||[], tickets = a.passTickets||[], lost = a.passLost||0;
  if(!calls.length && !tickets.length && !lost) return "";
  const callChips = calls.map(c=>
    `<span class="pass-chip"><span class="t mono">${c}</span><button class="mini-copy" data-copy="${c}" title="نسخ الكود"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg></button></span>`).join("");
  const tkChips = tickets.map(t=>
    `<span class="pass-chip tk"><span class="t mono">${t}</span><button class="mini-copy" data-copy="${t}" title="نسخ التذكرة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg></button></span>`).join("");
  return `<details class="pass-details">
    <summary><span class="caret">▶</span> المكالمات والتذاكر الناجحة <span class="cnt-tag">${a.pass}</span></summary>
    <div class="pass-content">
      ${calls.length?`<div class="sub-h"><span class="pass-dot" style="background:var(--pass)"></span> مكالمات ناجحة (${calls.length})</div><div class="chip-grid">${callChips}</div>`:""}
      ${tickets.length?`<div class="sub-h"><span class="pass-dot" style="background:var(--brand)"></span> تذاكر بريد إلكتروني (${tickets.length})</div><div class="chip-grid">${tkChips}</div>`:""}
      ${lost?`<p class="pass-note">⚠ ${lost} ${lost===1?"مكالمة ناجحة كودها":"مكالمات ناجحة أكوادها"} غير مكتمل (فُقد أثناء التصدير من Excel).</p>`:""}
    </div>
  </details>`;
}

/* ===== detail render ===== */
function renderDetail(){
  const el = document.getElementById("detail");
  if(!state.selected){ renderOverview(); return; }
  const a = findAgent(state.selected);
  if(!a){ renderOverview(); return; }
  const an = analyze(a);

  el.innerHTML = `
    <div class="det-head">
      <div class="ava">${initials(a.display)}</div>
      <div class="namecol">
        <h2>${a.display}</h2>
        <div class="sub">
          ${a.ext?`<span class="mono">#${a.ext}</span><span style="color:var(--line-strong)">|</span>`:""}
          <span class="verdict ${an.verdict}">${an.vText}</span>
        </div>
      </div>
      <div class="det-actions">
        ${MODE==="manager" ? `<button class="btn primary" id="sendBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"></path></svg>
          إرسال للموظف
        </button>` : ""}
        <button class="btn" onclick="window.print()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
          طباعة
        </button>
      </div>
    </div>

    <div class="stat-strip">
      <div class="stat pass"><div class="v">${a.pass}</div><div class="l">مكالمات ناجحة</div></div>
      <div class="stat"><div class="v">${a.totalErrors}</div><div class="l">إجمالي الأخطاء</div></div>
      <div class="stat euc"><div class="v">${a.counts.EUC}</div><div class="l">حرجة على العميل</div></div>
      <div class="stat bc"><div class="v">${a.counts.BC}</div><div class="l">حرجة على العمل</div></div>
      <div class="stat nc"><div class="v">${a.counts.NC}</div><div class="l">غير حرجة</div></div>
    </div>

    <div class="det-body">
      <h4 class="section-title">تحليل الأداء</h4>
      <div class="analysis">
        ${an.paras.join("")}
        ${a.totalErrors>0 ? `<div class="rec-box"><div class="rh">خطة التطوير</div><ul>${an.recs.map(r=>`<li>${r}</li>`).join("")}</ul></div>` : ""}
      </div>

      ${a.totalErrors>0 ? `
      <h4 class="section-title">توزيع الأخطاء حسب الخطورة</h4>
      <div class="bd-list">${breakdownHTML(a)}</div>

      <h4 class="section-title" style="margin-top:26px;">سجل الملاحظات (${arNum(a.totalErrors)})</h4>
      <div class="ecards">${errorsHTML(a)}</div>
      <p style="font-size:12px;color:var(--faint);margin-top:12px;">${MODE==="manager"
        ? "الصق رابط التسجيل لكل مكالمة واضغط حفظ، ثم اضغط «حفظ ونشر» في الأسفل لتظهر الروابط والملاحظات للموظفين."
        : "اضغط «استماع للمكالمة» لفتح التسجيل، ثم اكتب تعليقك واحفظه. الأكواد المعلَّمة «غير مكتمل» يلزم سحبها يدوياً من النظام بالتاريخ."}</p>
      ${MODE==="manager"
        ? `<div class="publish-bar" id="publishBar"><span class="pmsg">لديك تعديلات غير منشورة. اضغط «حفظ ونشر» لتنزيل <b>data.json</b> ثم ارفعه إلى GitHub.</span><button id="publishBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12M7 11l5 5 5-5"></path><path d="M5 20h14"></path></svg> حفظ ونشر</button></div>`
        : `<div class="send-cmt-bar"><span class="scm">بعد كتابة تعليقاتك، أرسلها للمدير ليطّلع عليها:</span><button class="btn wa" id="sendCmtWa"><svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2z"></path></svg> واتساب</button><button class="btn" id="sendCmtCopy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg> نسخ</button></div>`}
      ` : `<div style="text-align:center;padding:30px 24px 14px;color:var(--pass);font-weight:600;">لا توجد ملاحظات جودة على هذا الموظف خلال الشهر. 👏</div>`}
      ${passHTML(a)}
      ${MODE==="agent" ? `<div style="margin-top:30px;padding-top:6px;border-top:1px solid var(--line);">${errorTypesHTML()}</div>` : ""}
    </div>`;

  el.querySelectorAll(".mini-copy[data-copy]").forEach(b=>b.addEventListener("click",()=>{ copy(b.dataset.copy, "تم نسخ كود المكالمة"); }));
  const sb = document.getElementById("sendBtn");
  if(sb) sb.addEventListener("click",()=>openModal(a));
  wireCardActions(a);
}

/* ===== card save / publish / send wiring ===== */
let dirtyPublish = false;
function findErr(a, eid){ return a.errors.find(e=>errId(e)===eid); }

function wireCardActions(a){
  const ak = agentKey(a);
  const el = document.getElementById("detail");

  el.querySelectorAll(".save-btn[data-save]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const kind = btn.dataset.save;   // lnk | note | cmt
      const eid = btn.dataset.eid;
      const card = btn.closest(".ecard");
      const field = card.querySelector(`[data-field="${kind}"]`);
      const val = (field.value||"").trim();
      const e = findErr(a, eid);

      if(kind==="lnk"){
        if(val && !isValidUrl(val)){ toast("الرابط غير صالح — لازم يبدأ بـ https://"); return; }
        if(e) e.link = val;
        lset(lsKey('lnk',ak,e||{}), val);
        markDirty();
      } else if(kind==="note"){
        if(e) e.note = val;
        lset(lsKey('note',ak,e||{}), val);
        markDirty();
      } else if(kind==="cmt"){
        lset(lsKey('cmt',ak,e||{}), val);
      }
      btn.classList.add("saved");
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><path d="M20 6 9 17l-5-5"></path></svg> تم الحفظ';
      setTimeout(()=>{ btn.classList.remove("saved"); btn.innerHTML = orig; }, 1600);
    });
  });

  const pubBtn = document.getElementById("publishBtn");
  if(pubBtn){
    pubBtn.addEventListener("click", publishData);
    if(dirtyPublish){ const bar=document.getElementById("publishBar"); if(bar) bar.classList.add("show"); }
  }

  const waBtn = document.getElementById("sendCmtWa");
  const cpBtn = document.getElementById("sendCmtCopy");
  if(waBtn) waBtn.addEventListener("click",()=>sendComments(a,"wa"));
  if(cpBtn) cpBtn.addEventListener("click",()=>sendComments(a,"copy"));

  // listened-to-call toggles (agent)
  el.querySelectorAll(".heard-toggle").forEach(t=>{
    t.addEventListener("click",(ev)=>{
      ev.preventDefault();
      const eid = t.dataset.eid;
      const e = findErr(a, eid);
      const k = lsKey('heard', agentKey(a), e);
      const now = lget(k)==='1';
      lset(k, now ? '' : '1');
      t.classList.toggle("on", !now);
      // reflect badge in card top
      const card = t.closest(".ecard");
      const top = card && card.querySelector(".ecard-top");
      if(top){
        let badge = top.querySelector(".heard-badge");
        if(!now){
          if(!badge){
            badge = document.createElement("span");
            badge.className = "heard-badge";
            badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12"><path d="M20 6 9 17l-5-5"></path></svg> تم الاستماع';
            top.insertBefore(badge, top.querySelector(".ecard-code"));
          }
        } else if(badge){ badge.remove(); }
      }
    });
  });

  // audio upload (manager)
  el.querySelectorAll('input[data-aud]').forEach(inp=>{
    inp.addEventListener("change",()=>{
      const file = inp.files && inp.files[0];
      if(!file) return;
      if(!/^audio\//.test(file.type)){ toast("الرجاء اختيار ملف صوتي"); return; }
      if(file.size > 12*1024*1024){ toast("حجم الملف كبير — الحد ١٢ ميجابايت"); inp.value=""; return; }
      const eid = inp.dataset.aud;
      const e = findErr(a, eid);
      const wrap = inp.closest('.audio-ctl');
      if(wrap) wrap.innerHTML = '<span class="aud-loading">جارٍ التحميل…</span>';
      const reader = new FileReader();
      reader.onload = ()=>{
        if(e) e.audio = reader.result;
        markDirty();
        renderDetail();
      };
      reader.onerror = ()=>{ toast("تعذّر قراءة الملف"); renderDetail(); };
      reader.readAsDataURL(file);
    });
  });
  // audio remove (manager)
  el.querySelectorAll('[data-rmaud]').forEach(btn=>{
    btn.addEventListener("click",()=>{
      const e = findErr(a, btn.dataset.rmaud);
      if(e){ delete e.audio; markDirty(); renderDetail(); }
    });
  });
}

function markDirty(){
  dirtyPublish = true;
  const bar = document.getElementById("publishBar");
  if(bar) bar.classList.add("show");
}

async function publishData(){
  const btn = document.getElementById("publishBtn");
  if(btn){ btn.disabled=true; btn.textContent="جارٍ التحضير…"; }
  try{
    if(typeof window.__publishData !== "function") throw new Error("أداة النشر غير متاحة");
    await window.__publishData(DATA);
    dirtyPublish = false;
    const bar = document.getElementById("publishBar");
    if(bar){ bar.querySelector(".pmsg").innerHTML = "✓ تم تنزيل <b>data.json</b> — ارفعه الآن إلى GitHub (استبدل القديم)."; }
    toast("تم تنزيل data.json — ارفعه إلى GitHub");
  }catch(err){
    toast("تعذّر النشر: "+(err.message||err));
  }
  if(btn){ btn.disabled=false; btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12M7 11l5 5 5-5"></path><path d="M5 20h14"></path></svg> حفظ ونشر'; }
}

function sendComments(a, how){
  const ak = agentKey(a);
  const lines = [];
  const ordered = [...a.errors].sort((x,y)=> SEV[y.type].rank-SEV[x.type].rank || (+x.day)-(+y.day));
  let heardCount = 0;
  for(const e of ordered){
    const heard = lget(lsKey('heard',ak,e))==='1';
    if(heard) heardCount++;
    const c = lget(lsKey('cmt',ak,e));
    if(c || heard){
      lines.push(`• [${SEV[e.type].ar}] ${e.day} ${MONTH_AR} — كود: ${e.codeBad?'(غير مكتمل)':e.code}${heard?' ✅ سمعتها':''}`);
      if(c) lines.push(`  تعليق: ${c}`);
    }
  }
  if(!lines.length){ toast("لا توجد تعليقات أو مكالمات مسموعة للإرسال"); return; }
  const header = `${a.display} — متابعة تقرير جودة ${DATA.monthLabel||MONTH_AR} (مشروع ${(BUNDLE&&BUNDLE.project)||'DAW'})`;
  const summary = `سمعت ${heardCount} من ${a.totalErrors} مكالمة.`;
  const msg = header + "\n" + summary + "\n\n" + lines.join("\n");
  if(how==="wa") window.open("https://wa.me/?text="+encodeURIComponent(msg),"_blank");
  else copy(msg, "تم نسخ المتابعة — أرسلها للمدير");
}

/* ===== team error-type chart ===== */
function domType(e){
  let best="NC",max=-1;
  for(const k of ["EUC","BC","NC"]){ if(e[k]>max){max=e[k];best=k;} }
  return best;
}
function errorTypesHTML(){
  const list = DATA.errorTypes||[];
  if(!list.length) return "";
  const max = Math.max(...list.map(e=>e.total),1);
  const rows = list.map((e,i)=>{
    const dt = domType(e);
    const w = Math.round(e.total/max*100);
    const top = i===0 ? "top":"";
    return `<div class="etype ${top}" title="${e.attribute}">
      <span class="erank">${i+1}</span>
      <span class="el">${e.attribute}${i===0?' <span class="top-flag">الأكثر تكراراً</span>':''}</span>
      <span class="ebar"><i style="width:${w}%;background:${SEV[dt].color}"></i></span>
      <span class="ec">${e.total}</span>
    </div>`;
  }).join("");
  return `<h4 class="section-title">أكثر الأخطاء تكراراً في الفريق</h4>
    <div class="etype-list">${rows}</div>
    <p style="font-size:12px;color:var(--faint);margin:0 0 24px;">يُنصح بتركيز التدريب الجماعي على الملاحظة الأولى — وهي الأكثر تأثيراً وتكراراً على مستوى الفريق.</p>`;
}

/* ===== overview (no selection) ===== */
function renderOverview(){
  const el = document.getElementById("detail");
  const list = [...DATA.agents].sort((a,b)=> b.totalErrors-a.totalErrors || b.counts.EUC-a.counts.EUC);
  const maxErr = Math.max(...list.map(a=>a.totalErrors),1);
  const rows = list.map((a,i)=>{
    const segs = ["EUC","BC","NC"].map(k=>{
      const v=a.counts[k]; if(!v) return "";
      return `<i style="width:${v/maxErr*100}%;background:${SEV[k].color}"></i>`;
    }).join("");
    const cnt = a.totalErrors===0
      ? `<span style="color:var(--pass);font-weight:600">بلا ملاحظات</span>`
      : `<b>${a.totalErrors}</b> خطأ · ${a.counts.EUC} حرج`;
    return `<div class="ov-row" data-key="${agentKey(a)}">
      <span class="ov-rank-num">${i+1}</span>
      <span class="nm2">${a.display}</span>
      <div class="seg">${segs||'<i style="width:100%;background:#e4e8e2"></i>'}</div>
      <span class="ov-counts">${cnt}</span>
    </div>`;
  }).join("");

  el.innerHTML = `
    <div class="det-head">
      <div>
        <h2>نظرة عامة على الفريق</h2>
        <div class="sub">ترتيب الموظفين حسب عدد الملاحظات · اختر موظفاً لعرض تفاصيله</div>
      </div>
    </div>
    <div class="det-body">
      <div class="tag-row">
        <span class="badge EUC">حرج على العميل</span>
        <span class="badge BC">حرج على العمل</span>
        <span class="badge NC">غير حرج</span>
      </div>
      ${errorTypesHTML()}
      <h4 class="section-title">ترتيب الموظفين</h4>
      <div class="ov-rank">${rows}</div>
    </div>`;
  el.querySelectorAll(".ov-row").forEach(r=>r.addEventListener("click",()=>select(r.dataset.key)));
}

/* ===== select ===== */
function select(key){
  state.selected = (state.selected===key) ? state.selected : key;
  renderList(); renderDetail();
  if(window.innerWidth<=920){ document.getElementById("detail").scrollIntoView ? null : null; window.scrollTo({top:document.querySelector('.grid').offsetTop-60,behavior:'smooth'}); }
}

/* ===== message builder ===== */
function buildMessage(a){
  const L = [];
  L.push(`السلام عليكم ${a.display}، حفظكم الله 👋`);
  L.push(`فيما يلي نتيجة تقييم الجودة لشهر ${MONTH_AR} 2026 — مشروع ${DATA.project}.`);
  L.push("");
  L.push(`• مكالمات ناجحة: ${a.pass}`);
  L.push(`• إجمالي الملاحظات: ${a.totalErrors} (حرج على العميل: ${a.counts.EUC}، حرج على العمل: ${a.counts.BC}، غير حرج: ${a.counts.NC})`);
  if(a.totalErrors>0){
    L.push("");
    L.push("📞 الملاحظات المطلوب الاستماع إليها ومراجعتها:");
    const ordered = [...a.errors].sort((x,y)=> SEV[y.type].rank-SEV[x.type].rank || (+x.day)-(+y.day));
    ordered.forEach((e,i)=>{
      const code = e.codeBad ? `غير مكتمل (يُرجى السحب من النظام بتاريخ ${e.day} ${MONTH_AR})` : e.code;
      L.push(`${i+1}) [${SEV[e.type].ar}] ${e.day} ${MONTH_AR} — كود المكالمة: ${code}`);
      L.push(`    الملاحظة: ${e.attribute}`);
    });
    L.push("");
    L.push("نرجو الاستماع للمكالمات أعلاه ومراجعة الملاحظات والعمل على تلافيها مستقبلاً. شاكرين لكم تعاونكم 🌹");
  } else {
    L.push("");
    L.push("لا توجد ملاحظات على مكالماتك هذا الشهر، أداء مميز ونتمنى لك الاستمرار 🌟");
  }
  return L.join("\n");
}

let currentMsg = "";
function openModal(a){
  currentMsg = buildMessage(a);
  document.getElementById("modalTitle").textContent = "رسالة الموظف — " + a.display;
  document.getElementById("msgPre").textContent = currentMsg;
  document.getElementById("modalBg").classList.add("show");
}
function closeModal(){ document.getElementById("modalBg").classList.remove("show"); }

/* ===== copy + toast ===== */
function copy(text, msg){
  navigator.clipboard.writeText(text).then(()=>toast(msg||"تم النسخ")).catch(()=>{
    const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove(); toast(msg||"تم النسخ");
  });
}
let toastT;
function toast(m){
  const t=document.getElementById("toast"); t.textContent=m; t.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),1900);
}

/* ===== events ===== */
document.getElementById("search").addEventListener("input",e=>{ state.q=e.target.value; renderList(); });
document.getElementById("sortRow").addEventListener("click",e=>{
  const b=e.target.closest("button[data-sort]"); if(!b) return;
  state.sort=b.dataset.sort;
  document.querySelectorAll("#sortRow button").forEach(x=>x.classList.toggle("active",x===b));
  renderList();
});
document.getElementById("modalClose").addEventListener("click",closeModal);
document.getElementById("modalBg").addEventListener("click",e=>{ if(e.target.id==="modalBg") closeModal(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeModal(); });
document.getElementById("copyMsg").addEventListener("click",()=>copy(currentMsg,"تم نسخ الرسالة — جاهزة للإرسال"));
document.getElementById("waMsg").addEventListener("click",()=>window.open("https://wa.me/?text="+encodeURIComponent(currentMsg),"_blank"));
document.getElementById("mailMsg").addEventListener("click",()=>{
  const subj = "تقرير جودة المكالمات — مايو 2026";
  window.location.href = "mailto:?subject="+encodeURIComponent(subj)+"&body="+encodeURIComponent(currentMsg);
});
document.getElementById("lockBtn").addEventListener("click", lock);

/* ===== months infrastructure ===== */
let PAYLOAD = null, ALL_MONTHS = [], CUR_MONTH = 0;

/* Normalize any login payload (legacy single-month OR new multi-month) into {role, months:[...], creds?} */
function normalizeMonths(payload){
  if(Array.isArray(payload.months) && payload.months.length){ return payload; }
  if(payload.role==="manager"){
    const d = payload.data || {};
    return { role:"manager", creds:payload.creds, months:[{
      monthLabel: d.monthLabel || d.month || "", monthAr: d.monthAr || "", data: d
    }] };
  }
  return { role:"agent", project:payload.project, months:[{
    monthLabel: payload.monthLabel || payload.month || "", monthAr: payload.monthAr || "",
    agent: payload.agent, team: payload.team
  }] };
}

function buildMonthSelector(){
  const host = document.getElementById("monthSelectWrap");
  if(!host) return;
  if(ALL_MONTHS.length <= 1){ host.style.display = "none"; return; }
  host.style.display = "inline-flex";
  // latest first in the dropdown, value = real index
  const opts = ALL_MONTHS.map((m,i)=>({i, label:m.monthLabel||("شهر "+(i+1))}))
    .slice().reverse()
    .map(o=>`<option value="${o.i}">${o.label}</option>`).join("");
  host.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>
    <select id="monthSelect" aria-label="اختر الشهر">${opts}</select>`;
  document.getElementById("monthSelect").addEventListener("change", e=>{
    applyMonth(parseInt(e.target.value,10));
  });
}

/* ===== boot after successful login ===== */
function boot(payload){
  PAYLOAD = normalizeMonths(payload);
  MODE = PAYLOAD.role==="manager" ? "manager" : "agent";
  if(MODE==="manager"){ MASTER = payload; window.MASTER = payload; window.MASTER.months = PAYLOAD.months; }
  ALL_MONTHS = PAYLOAD.months.slice();
  CUR_MONTH = ALL_MONTHS.length - 1; // default to latest month

  // chrome adjustments (once)
  document.body.classList.add(MODE==="agent" ? "mode-agent" : "mode-manager");
  if(MODE==="agent"){
    document.querySelector("aside").style.display = "none";
    document.querySelector(".grid").style.gridTemplateColumns = "1fr";
  }
  const lbl = document.getElementById("sessionLabel");
  const agentName = MODE==="agent" ? (ALL_MONTHS[CUR_MONTH].agent.display) : "";
  if(lbl) lbl.textContent = (MODE==="manager") ? "وضع المدير — جميع الموظفين" : ("جلسة: " + agentName);
  document.getElementById("lockBtn").style.display = "inline-flex";
  if(MODE==="manager"){
    document.getElementById("updateBtn").style.display = "inline-flex";
    document.getElementById("credsBtn").style.display = "inline-flex";
  }
  buildMonthSelector();

  document.getElementById("appWrap").style.display = "";
  document.querySelector("header.topbar").style.display = "";

  applyMonth(CUR_MONTH);
}

/* ===== switch to a given month index ===== */
function applyMonth(idx){
  CUR_MONTH = idx;
  const m = ALL_MONTHS[idx];
  if(MODE==="manager"){
    DATA = m.data;
    // hydrate unpublished local drafts (recording links / manager notes) so edits survive reloads
    try{
      for(const ag of DATA.agents){
        const ak = agentKey(ag);
        for(const e of ag.errors){
          const dl = lget(lsKey('lnk',ak,e));
          const dn = lget(lsKey('note',ak,e));
          if(dl && dl!==(e.link||"")){ e.link = dl; dirtyPublish = true; }
          if(dn && dn!==(e.note||"")){ e.note = dn; dirtyPublish = true; }
        }
      }
    }catch(_){}
    N = DATA.agents.length;
    TEAM = { avgErr: DATA.agents.reduce((s,a)=>s+a.totalErrors,0)/(DATA.agents.length||1),
             avgEuc: DATA.agents.reduce((s,a)=>s+a.counts.EUC,0)/(DATA.agents.length||1) };
    // keep selection if that agent exists this month, else overview
    if(state.selected && !findAgent(state.selected)) state.selected = null;
  } else {
    DATA = {
      project: PAYLOAD.project, month: m.monthLabel, monthLabel: m.monthLabel, monthAr: m.monthAr,
      totals: m.team.totals, errorTypes: m.team.errorTypes, agents: [m.agent],
    };
    N = m.team.agentCount;
    TEAM = { avgErr: m.team.avgErr, avgEuc: m.team.avgEuc };
    state.selected = agentKey(m.agent);
  }
  MONTH_AR = m.monthAr || MONTH_AR_DEFAULT;
  const monthLabel = m.monthLabel || MONTH_AR;
  const mm = document.getElementById("metaMonth"); if(mm) mm.textContent = monthLabel;
  const sel = document.getElementById("monthSelect"); if(sel) sel.value = String(idx);

  renderKPIs(); renderList(); renderDetail();
}

/* called by the updater after a successful rebuild — refresh in-memory months live */
window.__applyNewMonths = function(months){
  if(!months || !months.length || !window.MASTER) return;
  window.MASTER.months = months.map(m=>({ monthLabel:m.monthLabel, monthAr:m.monthAr, data:m.data }));
  PAYLOAD.months = window.MASTER.months;
  ALL_MONTHS = PAYLOAD.months.slice();
  buildMonthSelector();
  CUR_MONTH = ALL_MONTHS.length - 1;
  applyMonth(CUR_MONTH);
};
const _enc = new TextEncoder(), _dec = new TextDecoder();
function _fromB64(s){ const bin=atob(s); const b=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i); return b; }
async function _deriveKey(pass){
  const salt = _fromB64(BUNDLE.salt);
  const base = await crypto.subtle.importKey("raw", _enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name:"PBKDF2", salt, iterations:BUNDLE.iter, hash:"SHA-256" },
    base, { name:"AES-GCM", length:256 }, false, ["decrypt"]
  );
}
async function attemptLogin(pass){
  if(!pass) return null;
  let key;
  try{ key = await _deriveKey(pass); }catch(e){ return null; }
  for(const blob of BUNDLE.blobs){
    try{
      const pt = await crypto.subtle.decrypt({ name:"AES-GCM", iv:_fromB64(blob.iv) }, key, _fromB64(blob.ct));
      return JSON.parse(_dec.decode(pt));
    }catch(e){ /* wrong key for this blob */ }
  }
  return null;
}

function lock(){
  // reload to clear all decrypted data from memory
  location.reload();
}

/* ===== login screen wiring ===== */
function initLogin(){
  const form = document.getElementById("loginForm");
  const input = document.getElementById("pwInput");
  const errEl = document.getElementById("loginErr");
  const btn = document.getElementById("loginBtn");
  const toggle = document.getElementById("pwToggle");

  toggle.addEventListener("click", ()=>{
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.classList.toggle("on", show);
  });

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const pass = input.value.trim();
    errEl.classList.remove("show");
    btn.disabled = true; btn.classList.add("loading");
    const payload = await attemptLogin(pass);
    btn.disabled = false; btn.classList.remove("loading");
    if(!payload){
      errEl.classList.add("show");
      input.value = ""; input.focus();
      form.classList.add("shake");
      setTimeout(()=>form.classList.remove("shake"), 450);
      return;
    }
    // success
    document.getElementById("loginScreen").style.display = "none";
    boot(payload);
  });

  input.focus();
  // reflect bundle month on the login screen
  try{
    const ls = document.getElementById("loginSub");
    if(ls && BUNDLE && BUNDLE.monthLabel) ls.textContent = BUNDLE.monthLabel + " · مشروع " + (BUNDLE.project||"DAW");
  }catch(e){}
}

/* ===== async boot: load data, then enable login ===== */
(async function start(){
  const form = document.getElementById("loginForm");
  const btn = document.getElementById("loginBtn");
  const errEl = document.getElementById("loginErr");
  // show a loading state on the button while data loads
  if(btn){ btn.disabled = true; btn.querySelector(".btn-label").textContent = "جارٍ التحميل…"; }
  BUNDLE = await window.__loadBundle();
  if(!BUNDLE){
    if(btn){ btn.querySelector(".btn-label").textContent = "دخول"; btn.disabled = false; }
    if(errEl){ errEl.textContent = "تعذّر تحميل بيانات التقرير. تأكد من الاتصال بالإنترنت ثم أعد تحميل الصفحة."; errEl.classList.add("show"); }
    return;
  }
  if(btn){ btn.disabled = false; btn.querySelector(".btn-label").textContent = "دخول"; }
  initLogin();
})();

