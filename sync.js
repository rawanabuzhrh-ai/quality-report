/* ============================================================
   QASync — طبقة المزامنة اللحظية عبر Firebase Firestore.
   تتزامن الحقول التعاونية فقط: رابط المكالمة، ملاحظة المدير،
   تعليق الموظف، وحالة «سمعت المكالمة».
   بيانات التقرير نفسها (المشفّرة) تبقى في data.json.
   إذا كانت إعدادات Firebase فارغة، تعمل المزامنة بوضع «معطّل»
   وكل الدوال تبقى موجودة (no-op) فلا يتأثّر باقي التطبيق.
   ============================================================ */
(function(){
  "use strict";

  const cfg = window.FIREBASE_CONFIG || {};
  const hasConfig = !!(cfg && cfg.projectId && cfg.apiKey);

  // ---- helpers ----
  function clean(s){ return String(s||"").replace(/[\/\.\#\$\[\]]/g,"_"); }

  const QASync = {
    active: false,
    ready: false,
    configured: hasConfig,
    project: "DAW",
    month: "",
    _db: null,
    _unsub: null,
    _pending: null,
    _writeQueue: [],

    _docId(agentKey){ return clean(this.project + "__" + this.month + "__" + agentKey); },
    _ref(agentKey){ return this._db.collection("qa_entries").doc(this._docId(agentKey)); },

    setContext(project, month){
      this.project = project || "DAW";
      this.month = month || "";
    },

    // write one collaborative field for one error
    write(agentKey, errId, field, value){
      if(!hasConfig) return;                       // local mode → no-op
      if(!this.active || !this._db){ this._writeQueue.push({agentKey, errId, field, value}); return; }
      const key = clean(errId);
      const patch = {
        project: this.project, month: this.month, agentKey: agentKey,
        data: { [key]: { [field]: value } },
        updatedAt: Date.now()
      };
      this._ref(agentKey).set(patch, { merge:true }).catch(e=>console.warn("sync write failed", e));
    },

    // subscribe to one agent's live doc; cb gets {errKey:{link,note,comment,heard}}
    subscribe(agentKey, cb){
      this.unsubscribe();
      if(!hasConfig) return;                       // local mode → no-op
      if(!this.active || !this._db){ this._pending = { agentKey, cb }; return; }
      this._unsub = this._ref(agentKey).onSnapshot(
        snap => { const d = snap.data(); cb((d && d.data) || {}); },
        err => console.warn("sync listen failed", err)
      );
    },

    unsubscribe(){
      if(this._unsub){ try{ this._unsub(); }catch(_){} this._unsub = null; }
    },

    // normalize an errId the same way writes do
    keyOf(errId){ return clean(errId); },
  };
  window.QASync = QASync;

  function setStatus(state, text){
    const el = document.getElementById("syncStatus");
    if(!el) return;
    el.style.display = "inline-flex";
    el.className = "sync-status " + state;
    const t = el.querySelector(".sync-txt"); if(t) t.textContent = text;
  }
  QASync._setStatus = setStatus;

  // ---- local mode: nothing else to do ----
  if(!hasConfig){ return; }

  // ---- load Firebase SDK dynamically, then init ----
  function loadScript(src){
    return new Promise((res,rej)=>{
      const s=document.createElement("script");
      s.src=src; s.onload=res; s.onerror=()=>rej(new Error("load "+src));
      document.head.appendChild(s);
    });
  }

  async function init(){
    try{
      setStatus("connecting","يتصل…");
      await loadScript("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
      await loadScript("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js");
      firebase.initializeApp(cfg);
      QASync._db = firebase.firestore();
      QASync.active = true;
      QASync.ready = true;
      setStatus("on","المزامنة مفعّلة");
      // flush queued writes
      const q = QASync._writeQueue.splice(0);
      for(const w of q){ QASync.write(w.agentKey, w.errId, w.field, w.value); }
      // run pending subscription
      if(QASync._pending){ const p=QASync._pending; QASync._pending=null; QASync.subscribe(p.agentKey, p.cb); }
    }catch(err){
      QASync.active = false;
      setStatus("off","تعذّر الاتصال");
      console.warn("Firebase init failed:", err);
    }
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
