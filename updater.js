/* ============ لوحة تحديث البيانات (للمدير فقط) ============ */
/* ترفع ملفات الإكسل الجديدة → يُعاد بناء التقرير وتشفيره → تنزيل ملف محدّث جاهز للتوزيع.
   كلمات المرور للموظفين القدامى تبقى ثابتة (محفوظة بشكل مشفّر مع المدير). */

(function(){
  "use strict";

  /* ---------- XLSX reading (browser, no libs) ---------- */
  function up_dec(s){ return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"); }
  function up_colToNum(col){ let n=0; for(const c of col) n=n*26+(c.charCodeAt(0)-64); return n-1; }

  async function up_unzip(arrayBuffer){
    const buf=new Uint8Array(arrayBuffer); const dv=new DataView(buf.buffer);
    let eocd=-1;
    for(let i=buf.length-22;i>=0;i--){ if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;} }
    if(eocd<0) throw new Error('ملف غير صالح');
    const cdCount=dv.getUint16(eocd+10,true); let p=dv.getUint32(eocd+16,true);
    const out={};
    for(let n=0;n<cdCount;n++){
      if(dv.getUint32(p,true)!==0x02014b50) break;
      const method=dv.getUint16(p+10,true);
      const compSize=dv.getUint32(p+20,true);
      const nameLen=dv.getUint16(p+28,true);
      const extraLen=dv.getUint16(p+30,true);
      const commentLen=dv.getUint16(p+32,true);
      const localOff=dv.getUint32(p+42,true);
      const name=new TextDecoder().decode(buf.slice(p+46,p+46+nameLen));
      const lhNameLen=dv.getUint16(localOff+26,true);
      const lhExtraLen=dv.getUint16(localOff+28,true);
      const dataStart=localOff+30+lhNameLen+lhExtraLen;
      const compData=buf.slice(dataStart,dataStart+compSize);
      let text='';
      if(method===0) text=new TextDecoder().decode(compData);
      else if(method===8){
        const ds=new DecompressionStream('deflate-raw');
        const ab=await new Response(new Blob([compData]).stream().pipeThrough(ds)).arrayBuffer();
        text=new TextDecoder().decode(new Uint8Array(ab));
      }
      out[name]=text;
      p+=46+nameLen+extraLen+commentLen;
    }
    return out;
  }
  function up_parseShared(xml){
    const arr=[]; if(!xml) return arr;
    const re=/<si>([\s\S]*?)<\/si>/g; let m;
    while((m=re.exec(xml))){ const ts=[...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1]); arr.push(up_dec(ts.join(''))); }
    return arr;
  }
  function up_parseSheet(xml,shared){
    const rows=[];
    const rowRe=/<(?:x:)?row[^>]*>([\s\S]*?)<\/(?:x:)?row>/g; let rm;
    while((rm=rowRe.exec(xml))){
      const cells=[]; let cursor=0;
      const cellRe=/<(?:x:)?c\s*([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:x:)?c>)/g; let cm;
      while((cm=cellRe.exec(rm[1]))){
        const attrs=cm[1]||''; const inner=cm[2]||'';
        const rMatch=attrs.match(/r="([A-Z]+)\d+"/);
        const tMatch=attrs.match(/t="([^"]+)"/);
        const colIdx=rMatch?up_colToNum(rMatch[1]):cursor; cursor=colIdx+1;
        let val='';
        const vMatch=inner.match(/<(?:x:)?v>([\s\S]*?)<\/(?:x:)?v>/);
        const tInner=[...inner.matchAll(/<(?:x:)?t[^>]*>([\s\S]*?)<\/(?:x:)?t>/g)].map(x=>x[1]);
        if(tMatch && tMatch[1]==='s' && vMatch) val=shared[parseInt(vMatch[1])]||'';
        else if((tMatch && tMatch[1]==='inlineStr') || tInner.length) val=tInner.join('');
        else if(vMatch) val=vMatch[1];
        cells[colIdx]=up_dec(val);
      }
      rows.push(cells);
    }
    return rows;
  }
  async function up_readXlsx(file){
    const ab=await file.arrayBuffer();
    const files=await up_unzip(ab);
    const shared=up_parseShared(files['xl/sharedStrings.xml']);
    const sk=Object.keys(files).find(k=>/worksheets\/sheet1\.xml$/.test(k)) || Object.keys(files).find(k=>/worksheets\/sheet\d+\.xml$/.test(k));
    if(!sk) throw new Error('لا توجد ورقة بيانات');
    return up_parseSheet(files[sk],shared).filter(r=>r.some(c=>c&&String(c).trim()));
  }

  /* ---------- column detection ---------- */
  function findCol(header, res){
    for(let i=0;i<header.length;i++){
      const h=(header[i]||'').toString().trim().toLowerCase();
      for(const re of res){ if(re.test(h)) return i; }
    }
    return -1;
  }
  function detect(fileName, header){
    const fn=(fileName||'').toLowerCase();
    const joined=header.map(h=>(h||'').toString().toLowerCase()).join(' | ');
    // pass file?
    if(/final score|\bscore\b|pass/.test(joined) || /pass/.test(fn)){
      return { type:'PASS',
        name: findCol(header,[/agent|name|اسم|الموظف/]),
        code: findCol(header,[/كود|code/]) };
    }
    // error file -> determine severity by count column or filename
    let type=null;
    const countIdx=findCol(header,[/count$/]);
    if(countIdx>=0){
      const ch=(header[countIdx]||'').toLowerCase();
      if(/ec|euc/.test(ch)) type='EUC'; else if(/bc/.test(ch)) type='BC'; else if(/nc/.test(ch)) type='NC';
    }
    if(!type){ if(/euc|ec/.test(fn)) type='EUC'; else if(/bc/.test(fn)) type='BC'; else if(/nc/.test(fn)) type='NC'; }
    return { type: type||'NC',
      name: findCol(header,[/agent|name|اسم|الموظف/]),
      attr: findCol(header,[/attribute|الملاحظة|البند|attr/]),
      day:  findCol(header,[/day|اليوم/]),
      code: findCol(header,[/كود|code/]) };
  }

  /* ---------- normalize ---------- */
  function normName(n){ return (n||'').toString().replace(/\s+/g,' ').trim(); }
  function splitName(n){
    n=normName(n);
    const m=n.match(/^(.*?)[\s-]*[-–]\s*(\d{2,4})\s*$/);
    if(m) return { display:m[1].replace(/[-–\s]+$/,'').trim(), ext:m[2] };
    return { display:n, ext:'' };
  }
  function badCode(c){
    if(!c) return true; c=c.toString();
    if(/E\+/i.test(c)) return true;
    if(/@/.test(c)) return true;
    if(!/^\d{14,}/.test(c)) return true;
    return false;
  }
  function classifyPass(v){
    if(!v) return 'lost'; v=v.toString();
    if(/@/.test(v)) return 'ticket';
    if(/E\+/i.test(v)) return 'lost';
    if(/^\d{14,}/.test(v)) return 'call';
    return 'lost';
  }
  function isJunk(nm){ return !nm || /^total$/i.test(nm) || /عوامل التصفية/.test(nm); }

  /* ---------- build dataset from parsed files ---------- */
  function buildDataset(parsed, opts){
    // parsed: [{name, role, cols, rows}]
    const agents={};
    function key(d,e){ return (d+'|'+e).toLowerCase(); }
    function getAgent(rawName){
      const {display,ext}=splitName(rawName);
      const k=key(display,ext);
      if(!agents[k]) agents[k]={display,ext,pass:0,passCodes:[],passCalls:[],passTickets:[],passLost:0,errors:[]};
      return agents[k];
    }
    for(const f of parsed){
      const rows=f.rows.slice(1);
      if(f.role.type==='PASS'){
        for(const r of rows){
          const nm=r[f.role.name]; if(isJunk(nm)) continue;
          const a=getAgent(nm); a.pass++;
          const v=(r[f.role.code]||'').toString().trim();
          const c=classifyPass(v);
          if(c==='call') a.passCalls.push(v);
          else if(c==='ticket') a.passTickets.push(v.toLowerCase());
          else a.passLost++;
        }
      } else {
        for(const r of rows){
          const nm=r[f.role.name]; if(isJunk(nm)) continue;
          const a=getAgent(nm);
          const code=(r[f.role.code]||'').toString();
          a.errors.push({
            type:f.role.type,
            attribute: normName(r[f.role.attr]),
            day: (r[f.role.day]||'').toString().trim(),
            code, codeBad: badCode(code)
          });
        }
      }
    }
    const list=Object.values(agents).map(a=>{
      const c={EUC:0,BC:0,NC:0}; a.errors.forEach(e=>c[e.type]++);
      return {...a, counts:c, totalErrors:a.errors.length};
    }).sort((x,y)=> y.totalErrors-x.totalErrors || y.counts.EUC-x.counts.EUC);

    const totals={
      agents:list.length,
      pass:list.reduce((s,a)=>s+a.pass,0),
      EUC:list.reduce((s,a)=>s+a.counts.EUC,0),
      BC:list.reduce((s,a)=>s+a.counts.BC,0),
      NC:list.reduce((s,a)=>s+a.counts.NC,0),
    };
    const agg={};
    for(const a of list) for(const e of a.errors){
      if(!agg[e.attribute]) agg[e.attribute]={attribute:e.attribute,EUC:0,BC:0,NC:0,total:0};
      agg[e.attribute][e.type]++; agg[e.attribute].total++;
    }
    const errorTypes=Object.values(agg).sort((x,y)=>y.total-x.total);
    return {
      project: opts.project, month: opts.monthLabel,
      monthAr: opts.monthAr, monthLabel: opts.monthLabel,
      totals, agents:list, errorTypes
    };
  }

  /* ---------- crypto (re-encrypt) ---------- */
  const _enc=new TextEncoder();
  function _b64(buf){ let s=''; const b=new Uint8Array(buf); for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s); }
  function _fromB64(s){ const bin=atob(s); const b=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i); return b; }
  async function deriveEnc(pass, salt){
    const base=await crypto.subtle.importKey('raw',_enc.encode(pass),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt']);
  }
  async function encBlob(pass, obj, salt){
    const key=await deriveEnc(pass,salt);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,_enc.encode(JSON.stringify(obj)));
    return { iv:_b64(iv), ct:_b64(ct) };
  }
  const PW_ALPHA='ABCDEFGHJKMNPQRSTUVWXYZ', PW_NUM='23456789';
  function genPass(used){
    let p; do{
      p=''; for(let i=0;i<4;i++) p+=PW_ALPHA[Math.floor(Math.random()*PW_ALPHA.length)];
      p+='-'; for(let i=0;i<3;i++) p+=PW_NUM[Math.floor(Math.random()*PW_NUM.length)];
    }while(used.has(p)); used.add(p); return p;
  }

  async function rebuildBundle(newData){
    // ----- gather existing months (each {monthLabel, monthAr, data}) -----
    let months = [];
    if(window.MASTER){
      if(Array.isArray(window.MASTER.months)){
        months = window.MASTER.months
          .filter(m=>m && m.data)
          .map(m=>({ monthLabel:m.monthLabel, monthAr:m.monthAr, data:m.data }));
      } else if(window.MASTER.data){
        const d=window.MASTER.data;
        months = [{ monthLabel:d.monthLabel||d.month, monthAr:d.monthAr, data:d }];
      }
    }
    // ----- merge the new/edited month: replace if same label, else append -----
    const newEntry = { monthLabel:newData.monthLabel, monthAr:newData.monthAr, data:newData };
    const exIdx = months.findIndex(m=>m.monthLabel===newEntry.monthLabel);
    if(exIdx>=0) months[exIdx] = newEntry; else months.push(newEntry);

    // ----- passwords (preserve by name) -----
    const oldCreds = (window.MASTER && window.MASTER.creds) ? window.MASTER.creds : [];
    const masterEntry = oldCreds.find(c=>c.who==='المدير (كل الموظفين)') || { who:'المدير (كل الموظفين)', ext:'—', pass:'ZNVB-766' };
    const passByName={}; for(const c of oldCreds){ if(c.who!=='المدير (كل الموظفين)') passByName[c.who]=c.pass; }
    const used=new Set(oldCreds.map(c=>c.pass));

    // ----- all agents across all months (by display name) -----
    const allAgents=[]; const seen=new Set();
    for(const m of months){ for(const a of m.data.agents){ if(!seen.has(a.display)){ seen.add(a.display); allAgents.push({display:a.display, ext:a.ext||''}); } } }

    const newCreds=[masterEntry];
    for(const an of allAgents){
      let pass=passByName[an.display]; if(!pass) pass=genPass(used);
      newCreds.push({ who:an.display, ext:an.ext||'—', pass });
    }
    const credMap={}; for(const c of newCreds) credMap[c.who]=c.pass;

    function teamOf(data){
      const N=data.agents.length;
      return { agentCount:N, totals:data.totals, errorTypes:data.errorTypes,
        avgErr:N?data.agents.reduce((s,a)=>s+a.totalErrors,0)/N:0,
        avgEuc:N?data.agents.reduce((s,a)=>s+a.counts.EUC,0)/N:0,
        avgPass:N?data.agents.reduce((s,a)=>s+a.pass,0)/N:0 };
    }

    const salt=crypto.getRandomValues(new Uint8Array(16));
    const blobs=[];
    // manager blob: ALL months + creds
    const mgrMonths = months.map(m=>({ monthLabel:m.monthLabel, monthAr:m.monthAr, data:m.data }));
    const mBlob=await encBlob(masterEntry.pass,{ role:'manager', months:mgrMonths, creds:newCreds }, salt); mBlob.role='manager'; blobs.push(mBlob);
    // each agent blob: only the months where they appear
    for(const an of allAgents){
      const agentMonths=[];
      for(const m of months){
        const a=m.data.agents.find(x=>x.display===an.display);
        if(a) agentMonths.push({ monthLabel:m.monthLabel, monthAr:m.monthAr, agent:a, team:teamOf(m.data) });
      }
      const payload={ role:'agent', project:newData.project, months:agentMonths };
      const blob=await encBlob(credMap[an.display], payload, salt); blob.role='agent'; blobs.push(blob);
    }
    const bundle={ salt:_b64(salt), iter:150000, project:newData.project,
      monthAr:newData.monthAr, monthLabel:newData.monthLabel, month:newData.monthLabel,
      monthsList: months.map(m=>m.monthLabel), blobs };
    return { bundle, creds:newCreds, data:newData, months:mgrMonths };
  }

  /* ---------- download the data file (data.json) ---------- */
  function downloadDataFile(bundle, filename){
    const blob=new Blob([JSON.stringify(bundle)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=filename||'data.json'; document.body.appendChild(a); a.click();
    setTimeout(()=>{ a.remove(); URL.revokeObjectURL(url); },1000);
  }

  /* ---------- UI ---------- */
  let lastResult=null;

  function buildModal(){
    if(document.getElementById('updModalBg')) return;
    const wrap=document.createElement('div');
    wrap.innerHTML = `
    <div class="modal-bg" id="updModalBg">
      <div class="modal upd-modal">
        <div class="modal-head">
          <h3>تحديث بيانات التقرير</h3>
          <button class="close" id="updClose" aria-label="إغلاق">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"></path></svg>
          </button>
        </div>
        <div class="modal-body" id="updBody">
          <ol class="upd-steps">
            <li>اكتب اسم الشهر الجديد (مثلاً «يونيو 2026»).</li>
            <li>ارفع ملفات الإكسل (PASS و BC و NC و EUC) — يكفي ما عندك منها.</li>
            <li>اضغط «إعادة بناء التقرير» — الشهر الجديد <b>يُضاف</b> للشهور السابقة (لا تُحذف).</li>
            <li>نزّل ملف <b>data.json</b> وارفعه إلى GitHub (استبدل القديم) — يتحدّث عند الجميع تلقائياً.</li>
          </ol>
          <div class="upd-field">
            <label>اسم الشهر (يظهر في التقرير)</label>
            <input type="text" id="updMonth" placeholder="مثال: يونيو 2026" />
          </div>
          <div class="upd-field">
            <label>اختصار الشهر (للتواريخ داخل الجداول)</label>
            <input type="text" id="updMonthAr" placeholder="مثال: يونيو" />
          </div>
          <div class="upd-drop" id="updDrop">
            <input type="file" id="updFiles" accept=".xlsx" multiple hidden />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4M7 9l5-5 5 5"></path><path d="M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"></path></svg>
            <div class="upd-drop-t">اسحب ملفات الإكسل هنا أو اضغط للاختيار</div>
            <div class="upd-drop-s">صيغة .xlsx — يمكن اختيار عدة ملفات دفعة واحدة</div>
          </div>
          <div id="updFileList" class="upd-filelist"></div>
          <div id="updStatus" class="upd-status"></div>
          <div id="updSummary"></div>
        </div>
        <div class="modal-foot">
          <button class="btn primary" id="updRebuild" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"></path><path d="M21 3v5h-5"></path></svg>
            إعادة بناء التقرير
          </button>
          <button class="btn" id="updDownload" style="display:none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12M7 11l5 5 5-5"></path><path d="M5 20h14"></path></svg>
            تنزيل ملف البيانات (data.json)
          </button>
        </div>
      </div>
    </div>

    <div class="modal-bg" id="credModalBg">
      <div class="modal">
        <div class="modal-head">
          <h3>كلمات المرور</h3>
          <button class="close" id="credClose" aria-label="إغلاق">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"></path></svg>
          </button>
        </div>
        <div class="modal-body" id="credBody"></div>
        <div class="modal-foot">
          <button class="btn primary" id="credCopy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>
            نسخ القائمة كاملة
          </button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    wireModal();
  }

  let chosenFiles=[];
  function wireModal(){
    const bg=document.getElementById('updModalBg');
    document.getElementById('updClose').addEventListener('click',()=>bg.classList.remove('show'));
    bg.addEventListener('click',e=>{ if(e.target===bg) bg.classList.remove('show'); });

    const drop=document.getElementById('updDrop');
    const input=document.getElementById('updFiles');
    drop.addEventListener('click',()=>input.click());
    drop.addEventListener('dragover',e=>{ e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
    drop.addEventListener('drop',e=>{ e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
    input.addEventListener('change',()=>addFiles(input.files));

    document.getElementById('updRebuild').addEventListener('click',doRebuild);
    document.getElementById('updDownload').addEventListener('click',()=>{
      if(!lastResult) return;
      downloadDataFile(lastResult.bundle, 'data.json');
    });

    const cbg=document.getElementById('credModalBg');
    document.getElementById('credClose').addEventListener('click',()=>cbg.classList.remove('show'));
    cbg.addEventListener('click',e=>{ if(e.target===cbg) cbg.classList.remove('show'); });
    document.getElementById('credCopy').addEventListener('click',()=>{
      const creds=(window.MASTER&&window.MASTER.creds)||[];
      const txt=creds.map(c=>`${c.pass}\t${c.who}${c.ext&&c.ext!=='—'?' ('+c.ext+')':''}`).join('\n');
      copy(txt,'تم نسخ قائمة كلمات المرور');
    });
  }

  function addFiles(fileList){
    for(const f of fileList){ if(/\.xlsx$/i.test(f.name)) chosenFiles.push(f); }
    renderFileList();
  }
  function renderFileList(){
    const el=document.getElementById('updFileList');
    el.innerHTML = chosenFiles.map((f,i)=>
      `<div class="upd-fileitem"><span class="fn">${f.name}</span><button data-i="${i}" class="rm" title="إزالة">✕</button></div>`).join('');
    el.querySelectorAll('.rm').forEach(b=>b.addEventListener('click',()=>{ chosenFiles.splice(+b.dataset.i,1); renderFileList(); }));
    document.getElementById('updRebuild').disabled = chosenFiles.length===0;
  }

  function status(msg, kind){
    const el=document.getElementById('updStatus');
    el.className='upd-status '+(kind||'');
    el.textContent=msg;
  }

  async function doRebuild(){
    const btn=document.getElementById('updRebuild');
    btn.disabled=true; status('جارٍ قراءة الملفات…');
    document.getElementById('updSummary').innerHTML='';
    document.getElementById('updDownload').style.display='none';
    try{
      const monthLabel=(document.getElementById('updMonth').value||'').trim() || (BUNDLE.monthLabel||'محدّث');
      const monthAr=(document.getElementById('updMonthAr').value||'').trim() || (BUNDLE.monthAr||monthLabel.split(' ')[0]||'');
      const parsed=[];
      for(const f of chosenFiles){
        const rows=await up_readXlsx(f);
        if(!rows.length) throw new Error('ملف فارغ: '+f.name);
        const role=detect(f.name, rows[0]);
        if(role.name<0) throw new Error('تعذّر إيجاد عمود اسم الموظف في: '+f.name);
        parsed.push({ name:f.name, role, rows });
      }
      status('جارٍ إعادة البناء والتشفير…');
      const data=buildDataset(parsed,{ project:BUNDLE.project||'DAW', monthLabel, monthAr });
      if(!data.agents.length) throw new Error('لم يتم العثور على أي موظف في الملفات المرفوعة');
      const result=await rebuildBundle(data);
      lastResult={ bundle:result.bundle, creds:result.creds, data };
      showSummary(data, result.creds, parsed, result.months);
      // apply the new month live so the manager can browse it immediately
      try{ if(typeof window.__applyNewMonths==='function') window.__applyNewMonths(result.months); }catch(_){}
      status('تم بنجاح ✓ — نزّل ملف data.json وارفعه إلى GitHub.', 'ok');
      document.getElementById('updDownload').style.display='inline-flex';
    }catch(err){
      status('خطأ: '+(err&&err.message?err.message:err), 'err');
    }
    btn.disabled=chosenFiles.length===0;
  }

  function showSummary(data, creds, parsed, months){
    const detected = parsed.map(p=>p.role.type==='PASS'?'الناجحة':p.role.type).join('، ');
    const newOnes = creds.filter(c=>c.who!=='المدير (كل الموظفين)').filter(c=>{
      const old=(window.MASTER&&window.MASTER.creds)||[];
      return !old.some(o=>o.who===c.who);
    });
    const monthsList = (months||[]).map(m=>m.monthLabel).filter(Boolean);
    let html=`<div class="upd-summary">
      <div class="upd-sum-row"><span>الشهر المُضاف</span><b>${data.monthLabel}</b></div>
      <div class="upd-sum-row"><span>الملفات المقروءة</span><b>${detected||'—'}</b></div>
      <div class="upd-sum-row"><span>عدد الموظفين</span><b>${data.agents.length}</b></div>
      <div class="upd-sum-row"><span>مكالمات ناجحة</span><b>${data.totals.pass}</b></div>
      <div class="upd-sum-row"><span>إجمالي الأخطاء</span><b>${data.totals.EUC+data.totals.BC+data.totals.NC}</b> <span class="upd-sub">(حرج على العميل ${data.totals.EUC}، حرج على العمل ${data.totals.BC}، غير حرج ${data.totals.NC})</span></div>
      ${monthsList.length>1?`<div class="upd-sum-row"><span>كل الشهور بالملف</span><b>${monthsList.length}</b> <span class="upd-sub">(${monthsList.join('، ')})</span></div>`:''}
      ${newOnes.length?`<div class="upd-sum-row"><span>موظفون جدد</span><b>${newOnes.length}</b> <span class="upd-sub">(أُنشئت لهم كلمات مرور جديدة)</span></div>`:''}
    </div>
    <p class="upd-note">الشهور السابقة محفوظة — هذا الشهر يُضاف إليها. كلمات المرور للموظفين القدامى بقيت كما هي. لمراجعة القائمة كاملة استخدم زر «كلمات المرور».</p>`;
    document.getElementById('updSummary').innerHTML=html;
  }

  function renderCreds(){
    const creds=(window.MASTER&&window.MASTER.creds)||[];
    const rows=creds.map(c=>{
      const isM=c.who==='المدير (كل الموظفين)';
      return `<tr class="${isM?'cred-master':''}">
        <td><span class="code mono">${c.pass}</span><button class="mini-copy" data-copy="${c.pass}" title="نسخ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg></button></td>
        <td>${c.who}${c.ext&&c.ext!=='—'?` <span class="mono" style="color:var(--faint)">#${c.ext}</span>`:''}</td>
      </tr>`;
    }).join('');
    document.getElementById('credBody').innerHTML=`
      <p class="upd-note" style="margin-top:0;">وزّع لكل موظف كلمته فقط. كلمة المدير تفتح كل شيء — احتفظ بها بسرّية.</p>
      <div class="tbl-wrap"><table class="cred-tbl">
        <thead><tr><th>كلمة المرور</th><th>الموظف</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    document.getElementById('credBody').querySelectorAll('.mini-copy[data-copy]').forEach(b=>b.addEventListener('click',()=>copy(b.dataset.copy,'تم نسخ كلمة المرور')));
  }

  /* ---------- open handlers (wired once DOM ready) ---------- */
  function init(){
    const ub=document.getElementById('updateBtn');
    const cb=document.getElementById('credsBtn');
    if(ub) ub.addEventListener('click',()=>{
      buildModal();
      document.getElementById('updMonth').value=(BUNDLE.monthLabel&&/\d/.test(BUNDLE.monthLabel))?'':'';
      document.getElementById('updModalBg').classList.add('show');
    });
    if(cb) cb.addEventListener('click',()=>{
      buildModal(); renderCreds();
      document.getElementById('credModalBg').classList.add('show');
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();

  // expose for testing / integration
  async function publishData(data){
    const result = await rebuildBundle(data);
    downloadDataFile(result.bundle, 'data.json');
    return result;
  }
  window.__publishData = publishData;
  window.__upd = { getLast:()=>lastResult, addFiles, detect, buildDataset, downloadDataFile, publishData };
})();
