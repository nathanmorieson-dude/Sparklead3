import { useState, useEffect, useCallback } from "react";

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════
const STAGES = ["scraped","email_1","email_2","demo_booked","closed_won","closed_lost"];
const STAGE_META = {
  scraped:     { label:"New Lead",    color:"#f6c846", icon:"⚡" },
  email_1:     { label:"Touch 1 Sent",color:"#e88438", icon:"📧" },
  email_2:     { label:"Touch 2 Sent",color:"#38bdf8", icon:"🎯" },
  demo_booked: { label:"Demo Set",    color:"#34d399", icon:"📞" },
  closed_won:  { label:"Won",         color:"#22c55e", icon:"✅" },
  closed_lost: { label:"Lost",        color:"#525266", icon:"—" },
};
const AU_STATES = ["NSW","VIC","QLD","WA","SA","TAS","ACT","NT"];

const EMAIL_TEMPLATES = [
  {
    id:"warm_intro", stage:"email_1",
    name:"Touch 1 — Warm Intro",
    subject:"Saw you're hiring a receptionist, {{company}}",
    body:`Hi {{name}},

I came across your ad on {{source}} for a receptionist at {{company}} — looks like you're growing, nice one.

Quick thought: what if you could have every call answered 24/7 — after hours, weekends, when the crew's on site — without the $55K+ salary?

We've built an AI receptionist specifically for sparkies. It answers in a natural voice, books jobs on your calendar, handles quoting enquiries, and never calls in sick.

A few electrical businesses in {{state}} are already using it. Happy to share what they're seeing.

No pressure — just thought the timing was right given your ad.

Cheers,
{{sender_name}}
{{sender_title}}`,
  },
  {
    id:"demo_offer", stage:"email_2",
    name:"Touch 2 — Live Retell Demo",
    subject:"Re: Quick demo for {{company}}? (8 mins)",
    body:`Hi {{name}},

Following up on my note last week.

Rather than explain what the AI receptionist does — I'd love to just show you. I can ring your mobile with a live demo. You'll hear exactly how it sounds when a customer calls {{company}}.

It handles:
→ After-hours calls & emergency triage
→ Job booking & calendar scheduling
→ Quote requests & basic pricing info
→ Call screening (no more spam)

Takes about 8 minutes. If it's not for you, totally fine.

When suits this week? Or just reply "go" and I'll ring you.

Cheers,
{{sender_name}}`,
  },
];

// ═══════════════════════════════════════════════════════════
// DEMO DATA
// ═══════════════════════════════════════════════════════════
function generateLeads(state, source, count) {
  const cos = [
    "Bright Spark Electrical","PowerPoint Electric","All Spark Services","Ohm Electrical",
    "Current Solutions","LiveWire Group","Surge Electrical","Circuit Pro Electric",
    "FlashPoint Electrical","Redline Electric","BlueScope Electrical","TopNotch Sparks",
    "AusWire Electrical","TrueBlue Electric","Peak Power Electrical","Greenfield Electrical",
    "Metro Spark Services","Coastal Electrical","SafeSwitch Electric","Pacific Power Co",
  ];
  const fns = ["Matt","Josh","Steve","Dan","Chris","Bec","Sam","Luke","Tom","Jess","Dave","Mick","Nathan","Ryan","Ben"];
  const lns = ["Thompson","Williams","Brown","Smith","Taylor","Wilson","Anderson","Mitchell","Campbell","Clarke"];
  const subs = {
    NSW:["Parramatta","Penrith","Liverpool","Blacktown","Hornsby","Campbelltown"],
    VIC:["Dandenong","Ringwood","Frankston","Geelong","Ballarat","Werribee"],
    QLD:["Southport","Ipswich","Caboolture","Toowoomba","Cairns","Rockhampton"],
    WA:["Joondalup","Fremantle","Rockingham","Mandurah","Midland","Armadale"],
    SA:["Elizabeth","Salisbury","Marion","Prospect","Glenelg","Norwood"],
    TAS:["Launceston","Devonport","Burnie","Kingston","Glenorchy","Moonah"],
    ACT:["Belconnen","Tuggeranong","Woden","Gungahlin","Fyshwick","Mitchell"],
    NT:["Palmerston","Casuarina","Darwin CBD","Winnellie","Stuart Park","Berrimah"],
  };
  const titles = [
    "Receptionist / Admin Support","Front Desk & Phone Coordinator",
    "Office Administrator","Customer Service & Bookings",
    "Receptionist — Electrical Co","Phone Operator / Scheduler",
  ];
  const ss = subs[state]||subs.NSW;
  return Array.from({length:count},(_,i)=>{
    const fn=fns[Math.floor(Math.random()*fns.length)];
    const ln=lns[Math.floor(Math.random()*lns.length)];
    const co=cos[(i+Math.floor(Math.random()*5))%cos.length];
    return {
      id:`sl_${Date.now()}_${i}_${Math.random().toString(36).slice(2,6)}`,
      company:co, contact_name:`${fn} ${ln}`,
      email:`${fn.toLowerCase()}@${co.toLowerCase().replace(/[^a-z]/g,"")}.com.au`,
      phone:`04${String(Math.floor(Math.random()*100000000)).padStart(8,"0")}`,
      location:`${ss[Math.floor(Math.random()*ss.length)]}, ${state}`,
      state, source,
      job_title:titles[Math.floor(Math.random()*titles.length)],
      salary_range:`$${50+Math.floor(Math.random()*20)}K–$${65+Math.floor(Math.random()*15)}K`,
      posted_ago:`${1+Math.floor(Math.random()*14)}d ago`,
      stage:"scraped", emails_sent:0, last_action:null, notes:"",
      created:new Date().toISOString(),
      queued_template:null, // for auto-queue
    };
  });
}

// ═══════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════
async function load(k,fb){try{const r=await window.storage.get(k);return r?JSON.parse(r.value):fb}catch{return fb}}
async function save(k,v){try{await window.storage.set(k,JSON.stringify(v))}catch(e){console.error(e)}}

// ═══════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════
function todayKey(){ return new Date().toISOString().slice(0,10); }

// ═══════════════════════════════════════════════════════════
// UI PRIMITIVES
// ═══════════════════════════════════════════════════════════
const C = {
  bg:"#06060a", card:"#0e0e14", border:"#1a1a26", hover:"#14141e",
  text:"#e2e2ec", sub:"#7a7a90", dim:"#3a3a50",
  amber:"#f6c846", orange:"#e88438", blue:"#38bdf8",
  green:"#34d399", red:"#f43f5e", purple:"#a78bfa",
};

function Pill({color,children}){
  return <span style={{background:color+"1a",color,padding:"2px 9px",borderRadius:5,fontSize:10,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",whiteSpace:"nowrap"}}>{children}</span>;
}
function Stat({label,value,color,sub}){
  return <div style={{flex:1,minWidth:90,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"13px 15px"}}>
    <div style={{fontSize:9.5,color:C.sub,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:3}}>{label}</div>
    <div style={{fontSize:24,fontWeight:800,color:color||C.text,fontFamily:"'JetBrains Mono',monospace"}}>{value}</div>
    {sub && <div style={{fontSize:10,color:C.dim,marginTop:2}}>{sub}</div>}
  </div>;
}
function Inp({label,...p}){
  return <div style={{display:"flex",flexDirection:"column",gap:3}}>
    {label&&<label style={{fontSize:9.5,color:C.sub,fontWeight:700,letterSpacing:.8,textTransform:"uppercase"}}>{label}</label>}
    <input {...p} style={{background:"#111118",border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 11px",color:C.text,fontSize:13,outline:"none",fontFamily:"inherit",...(p.style||{})}}/>
  </div>;
}
function Sel({label,value,onChange,options}){
  return <div style={{display:"flex",flexDirection:"column",gap:3}}>
    {label&&<label style={{fontSize:9.5,color:C.sub,fontWeight:700,letterSpacing:.8,textTransform:"uppercase"}}>{label}</label>}
    <select value={value} onChange={onChange} style={{background:"#111118",border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 11px",color:C.text,fontSize:13,fontFamily:"inherit",outline:"none"}}>
      {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>;
}
function Btn({children,v="primary",sm,...p}){
  const vs={
    primary:{background:C.amber,color:"#000"},
    orange:{background:C.orange,color:"#fff"},
    blue:{background:C.blue,color:"#000"},
    green:{background:C.green,color:"#000"},
    red:{background:C.red,color:"#fff"},
    ghost:{background:"transparent",color:C.sub,border:`1px solid ${C.border}`},
  };
  return <button {...p} style={{border:"none",borderRadius:6,cursor:"pointer",fontWeight:700,fontFamily:"inherit",fontSize:sm?10.5:12.5,padding:sm?"5px 11px":"8px 16px",transition:"all .12s",display:"inline-flex",alignItems:"center",gap:5,opacity:p.disabled?.3:1,...vs[v],...(p.style||{})}}>{children}</button>;
}
function Modal({title,onClose,wide,children}){
  return <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.78)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:14}}>
    <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:13,padding:22,width:"100%",maxWidth:wide?700:460,maxHeight:"88vh",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h3 style={{margin:0,color:C.text,fontSize:15,fontWeight:800}}>{title}</h3>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.sub,fontSize:16,cursor:"pointer"}}>✕</button>
      </div>
      {children}
    </div>
  </div>;
}

// PROGRESS BAR
function DailyBar({sent,limit}){
  const pct = Math.min((sent/limit)*100,100);
  const clr = pct>=100?C.red:pct>=75?C.orange:C.green;
  return <div style={{marginBottom:4}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
      <span style={{fontSize:10,color:C.sub,fontWeight:700}}>TODAY'S SENDS</span>
      <span style={{fontSize:11,fontWeight:800,color:clr,fontFamily:"'JetBrains Mono',monospace"}}>{sent} / {limit}</span>
    </div>
    <div style={{height:6,background:C.border,borderRadius:3,overflow:"hidden"}}>
      <div style={{height:"100%",width:`${pct}%`,background:clr,borderRadius:3,transition:"width .4s ease"}}/>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════
export default function SparkLead() {
  const [view,setView] = useState("dash");
  const [leads,setLeads] = useState([]);
  const [cfg,setCfg] = useState({
    retell_key:"",email_key:"",email_service:"sendgrid",
    sender_name:"",sender_title:"",sender_email:"",
    retell_agent_id:"",
    daily_limit:15, // 10-20 range
    send_interval_sec:120, // seconds between sends
  });
  const [dailySends,setDailySends] = useState({date:"",count:0,log:[]});
  const [scrapeState,setScrapeState] = useState("NSW");
  const [scrapeSource,setScrapeSource] = useState("both");
  const [scraping,setScraping] = useState(false);
  const [emailModal,setEmailModal] = useState(null);
  const [voiceModal,setVoiceModal] = useState(null);
  const [detailModal,setDetailModal] = useState(null);
  const [toast,setToast] = useState(null);
  const [ready,setReady] = useState(false);
  const [bulkSelect,setBulkSelect] = useState(new Set());
  const [filterStage,setFilterStage] = useState("all");
  const [queueRunning,setQueueRunning] = useState(false);

  // LOAD
  useEffect(()=>{
    (async()=>{
      const l=await load("sl-leads",[]);
      const c=await load("sl-cfg",cfg);
      const d=await load("sl-daily",{date:todayKey(),count:0,log:[]});
      // Reset daily counter if new day
      if(d.date!==todayKey()) { d.date=todayKey(); d.count=0; d.log=[]; }
      setLeads(l);setCfg(c);setDailySends(d);setReady(true);
    })();
  },[]);

  // SAVE
  useEffect(()=>{if(ready) save("sl-leads",leads)},[leads,ready]);
  useEffect(()=>{if(ready) save("sl-daily",dailySends)},[dailySends,ready]);
  const saveCfg=async c=>{setCfg(c);await save("sl-cfg",c);flash("Settings saved")};

  const flash=(msg,type="ok")=>{setToast({msg,type});setTimeout(()=>setToast(null),3000)};
  const patch=(id,data)=>setLeads(p=>p.map(l=>l.id===id?{...l,...data}:l));
  const remove=id=>{setLeads(p=>p.filter(l=>l.id!==id));setBulkSelect(s=>{s.delete(id);return new Set(s)})};

  // DAILY LIMIT CHECK
  const canSendToday = dailySends.date===todayKey() ? dailySends.count < cfg.daily_limit : true;
  const todaySent = dailySends.date===todayKey() ? dailySends.count : 0;
  const remaining = Math.max(0, cfg.daily_limit - todaySent);

  const incrementDaily = (leadEmail) => {
    setDailySends(prev => {
      const d = prev.date===todayKey() ? prev : {date:todayKey(),count:0,log:[]};
      return {
        date: todayKey(),
        count: d.count + 1,
        log: [...d.log, {email:leadEmail, time:new Date().toISOString()}],
      };
    });
  };

  // ─── SCRAPE ──────────────────────────────────────────
  const handleScrape = async () => {
    setScraping(true);
    await new Promise(r=>setTimeout(r,2000));
    const sources = scrapeSource==="both"?["Indeed AU","Seek"]:[scrapeSource==="indeed"?"Indeed AU":"Seek"];
    let nl=[];
    sources.forEach(src=>nl.push(...generateLeads(scrapeState,src,4+Math.floor(Math.random()*6))));
    const existing=new Set(leads.map(l=>l.company));
    nl=nl.filter(l=>!existing.has(l.company));
    setLeads(p=>[...nl,...p]);
    setScraping(false);
    flash(`Found ${nl.length} electricians hiring receptionists in ${scrapeState}`);
    setView("leads");
  };

  // ─── SEND SINGLE EMAIL ──────────────────────────────
  const sendEmail = (lead, template) => {
    if(!canSendToday){
      flash(`Daily limit reached (${cfg.daily_limit}/day). Try tomorrow.`,"warn");
      return;
    }
    const fill=s=>s
      .replace(/\{\{company\}\}/g,lead.company)
      .replace(/\{\{name\}\}/g,lead.contact_name.split(" ")[0])
      .replace(/\{\{source\}\}/g,lead.source)
      .replace(/\{\{state\}\}/g,lead.state)
      .replace(/\{\{sender_name\}\}/g,cfg.sender_name||"[Your Name]")
      .replace(/\{\{sender_title\}\}/g,cfg.sender_title||"");
    const subject=fill(template.subject);
    const body=fill(template.body);

    // PRODUCTION: call SendGrid / Resend API here
    console.log("📧 SEND:",{to:lead.email,subject,body});

    patch(lead.id,{
      stage:template.stage,
      emails_sent:lead.emails_sent+1,
      last_action:`${template.name} → ${new Date().toLocaleDateString("en-AU")}`,
    });
    incrementDaily(lead.email);
    setEmailModal(null);
    flash(`Email sent → ${lead.email} (${remaining-1} left today)`);
  };

  // ─── QUEUE & AUTO-SEND ──────────────────────────────
  const queueLeads = (templateId) => {
    const tpl = EMAIL_TEMPLATES.find(t=>t.id===templateId);
    if(!tpl) return;
    // Queue all selected leads that haven't been sent this template yet
    const validStage = templateId==="warm_intro"?"scraped":"email_1";
    let queued = 0;
    setLeads(p=>p.map(l=>{
      if(bulkSelect.has(l.id) && l.stage===validStage){
        queued++;
        return {...l, queued_template:templateId};
      }
      return l;
    }));
    setBulkSelect(new Set());
    flash(`${queued} leads queued for ${tpl.name}. Hit "Run Queue" to start sending.`);
  };

  const runQueue = async () => {
    setQueueRunning(true);
    const queued = leads.filter(l=>l.queued_template);
    let sent = 0;
    for(const lead of queued){
      if(!canSendToday && (dailySends.date===todayKey() ? dailySends.count+sent >= cfg.daily_limit : sent >= cfg.daily_limit)){
        flash(`Daily limit hit after ${sent} sends. Remaining leads stay queued.`,"warn");
        break;
      }
      const tpl = EMAIL_TEMPLATES.find(t=>t.id===lead.queued_template);
      if(!tpl) continue;

      // Simulate send delay
      await new Promise(r=>setTimeout(r, Math.min(cfg.send_interval_sec*1000, 3000)));

      const fill=s=>s
        .replace(/\{\{company\}\}/g,lead.company)
        .replace(/\{\{name\}\}/g,lead.contact_name.split(" ")[0])
        .replace(/\{\{source\}\}/g,lead.source)
        .replace(/\{\{state\}\}/g,lead.state)
        .replace(/\{\{sender_name\}\}/g,cfg.sender_name||"[Your Name]")
        .replace(/\{\{sender_title\}\}/g,cfg.sender_title||"");
      console.log("📧 QUEUE SEND:",{to:lead.email,subject:fill(tpl.subject)});

      patch(lead.id,{
        stage:tpl.stage,
        emails_sent:lead.emails_sent+1,
        last_action:`${tpl.name} → ${new Date().toLocaleDateString("en-AU")}`,
        queued_template:null,
      });
      incrementDaily(lead.email);
      sent++;
    }
    setQueueRunning(false);
    if(sent>0) flash(`Queue complete — ${sent} emails sent`);
  };

  // ─── RETELL VOICE ────────────────────────────────────
  const triggerVoiceDemo = (lead) => {
    console.log("📞 RETELL:",{phone:lead.phone,agent_id:cfg.retell_agent_id});
    patch(lead.id,{stage:"demo_booked",last_action:`Retell demo call → ${new Date().toLocaleDateString("en-AU")}`});
    setVoiceModal(null);
    flash(`Voice demo initiated → ${lead.phone}`);
  };

  // ─── STATS ───────────────────────────────────────────
  const st={
    total:leads.length,
    fresh:leads.filter(l=>l.stage==="scraped").length,
    emailed:leads.filter(l=>l.emails_sent>0).length,
    demos:leads.filter(l=>l.stage==="demo_booked"||l.stage==="closed_won").length,
    queued:leads.filter(l=>l.queued_template).length,
  };
  const filtered = filterStage==="all"?leads:leads.filter(l=>l.stage===filterStage);

  if(!ready) return <div style={{background:C.bg,color:C.text,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Outfit',sans-serif"}}>Loading…</div>;

  return (
    <div style={{background:C.bg,color:C.text,minHeight:"100vh",fontFamily:"'Outfit','Segoe UI',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        tr:hover td{background:${C.hover}!important}
      `}</style>

      {toast&&<div style={{position:"fixed",top:14,right:14,zIndex:9999,background:toast.type==="ok"?C.green:C.orange,color:"#000",padding:"9px 16px",borderRadius:7,fontWeight:700,fontSize:11.5,boxShadow:"0 6px 28px rgba(0,0,0,.5)",animation:"fadeUp .2s ease"}}>{toast.msg}</div>}

      {/* ═══ NAV ═══ */}
      <div style={{borderBottom:`1px solid ${C.border}`,padding:"11px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:9}}>
          <div style={{width:28,height:28,borderRadius:6,background:`linear-gradient(135deg,${C.amber},${C.orange})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900}}>⚡</div>
          <div>
            <div style={{fontWeight:900,fontSize:15,letterSpacing:-.4,color:C.amber}}>SparkLead</div>
            <div style={{fontSize:8.5,color:C.dim,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase"}}>Electrician AI Outreach · AU</div>
          </div>
        </div>
        <div style={{display:"flex",gap:2,alignItems:"center"}}>
          <div style={{marginRight:10}}><DailyBar sent={todaySent} limit={cfg.daily_limit}/></div>
          {[["dash","Dashboard"],["scrape","Scrape"],["leads","Leads"],["queue","Queue"],["templates","Emails"],["settings","Settings"]].map(([k,l])=>(
            <button key={k} onClick={()=>setView(k)} style={{
              background:view===k?"#16161e":"transparent",
              border:view===k?`1px solid ${C.border}`:"1px solid transparent",
              borderRadius:6,padding:"6px 11px",color:view===k?C.text:C.sub,
              cursor:"pointer",fontWeight:700,fontSize:10.5,fontFamily:"inherit",
            }}>{l}{k==="queue"&&st.queued>0?` (${st.queued})`:""}</button>
          ))}
        </div>
      </div>

      <div style={{padding:18,maxWidth:1060,margin:"0 auto"}}>

        {/* ═══ DASHBOARD ═══ */}
        {view==="dash"&&<div style={{animation:"fadeUp .3s ease"}}>
          <h2 style={{fontWeight:900,fontSize:19,marginBottom:14}}>Pipeline</h2>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
            <Stat label="Total" value={st.total} color={C.amber}/>
            <Stat label="Fresh" value={st.fresh} color={C.orange}/>
            <Stat label="Emailed" value={st.emailed} color={C.blue}/>
            <Stat label="Demos" value={st.demos} color={C.green}/>
            <Stat label="Queued" value={st.queued} color={C.purple} sub="pending send"/>
          </div>
          <DailyBar sent={todaySent} limit={cfg.daily_limit}/>
          <div style={{marginTop:6,marginBottom:20,fontSize:10,color:C.dim}}>
            {remaining>0?`${remaining} sends remaining today · resets at midnight`:"Daily limit reached — queue resumes tomorrow"}
          </div>

          {/* KANBAN */}
          <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:6}}>
            {STAGES.map(sg=>{
              const m=STAGE_META[sg]; const items=leads.filter(l=>l.stage===sg);
              return <div key={sg} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:12,minWidth:145,flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:10}}>
                  <span style={{fontSize:11}}>{m.icon}</span>
                  <span style={{fontSize:9.5,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:.7}}>{m.label}</span>
                  <span style={{marginLeft:"auto",fontSize:9.5,fontWeight:800,color:C.dim}}>{items.length}</span>
                </div>
                {items.slice(0,4).map(l=>(
                  <div key={l.id} onClick={()=>setDetailModal(l)} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:"7px 9px",marginBottom:5,cursor:"pointer",transition:"border-color .1s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=m.color}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:1}}>{l.company}</div>
                    <div style={{fontSize:9.5,color:C.sub}}>{l.location}</div>
                    {l.queued_template&&<Pill color={C.purple}>queued</Pill>}
                  </div>
                ))}
                {items.length>4&&<div style={{fontSize:9.5,color:C.dim,textAlign:"center",paddingTop:2}}>+{items.length-4}</div>}
                {items.length===0&&<div style={{fontSize:10,color:C.dim,textAlign:"center",padding:14}}>—</div>}
              </div>;
            })}
          </div>
        </div>}

        {/* ═══ SCRAPE ═══ */}
        {view==="scrape"&&<div style={{animation:"fadeUp .3s ease"}}>
          <h2 style={{fontWeight:900,fontSize:19,marginBottom:5}}>Scrape Job Boards</h2>
          <p style={{color:C.sub,fontSize:11.5,marginBottom:18,lineHeight:1.5}}>
            Find electricians posting receptionist / front desk / admin jobs on Indeed AU &amp; Seek.
          </p>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:18,display:"flex",gap:12,alignItems:"flex-end",flexWrap:"wrap",marginBottom:16}}>
            <Sel label="State" value={scrapeState} onChange={e=>setScrapeState(e.target.value)} options={AU_STATES.map(s=>({value:s,label:s}))}/>
            <Sel label="Source" value={scrapeSource} onChange={e=>setScrapeSource(e.target.value)} options={[{value:"both",label:"Indeed + Seek"},{value:"indeed",label:"Indeed AU"},{value:"seek",label:"Seek"}]}/>
            <Btn onClick={handleScrape} disabled={scraping}>
              {scraping?<><span style={{animation:"pulse 1s infinite"}}>⏳</span> Scraping…</>:"⚡ Scrape Now"}
            </Btn>
          </div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:14}}>
            <h4 style={{fontSize:10.5,fontWeight:700,color:C.sub,marginBottom:6}}>Production wiring</h4>
            <div style={{fontSize:11,color:C.dim,lineHeight:1.9}}>
              <div><strong style={{color:C.text}}>1.</strong> Puppeteer scrapes Indeed AU + Seek for <Pill color={C.orange}>electrician receptionist {scrapeState}</Pill></div>
              <div><strong style={{color:C.text}}>2.</strong> Extracts company, location, salary, posting date</div>
              <div><strong style={{color:C.text}}>3.</strong> Enriches via Hunter.io / Apollo for email + phone</div>
              <div><strong style={{color:C.text}}>4.</strong> Deduplicates, adds to pipeline</div>
            </div>
          </div>
        </div>}

        {/* ═══ LEADS ═══ */}
        {view==="leads"&&<div style={{animation:"fadeUp .3s ease"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <h2 style={{fontWeight:900,fontSize:19}}>Leads ({filtered.length})</h2>
            <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
              {bulkSelect.size>0&&<>
                <span style={{fontSize:10,color:C.sub,fontWeight:700}}>{bulkSelect.size} selected</span>
                <Btn sm v="orange" onClick={()=>queueLeads("warm_intro")}>Queue Touch 1</Btn>
                <Btn sm v="blue" onClick={()=>queueLeads("demo_offer")}>Queue Touch 2</Btn>
                <Btn sm v="ghost" onClick={()=>setBulkSelect(new Set())}>Clear</Btn>
              </>}
              <Sel value={filterStage} onChange={e=>setFilterStage(e.target.value)}
                options={[{value:"all",label:"All stages"},...STAGES.map(s=>({value:s,label:STAGE_META[s].label}))]}/>
            </div>
          </div>

          {filtered.length===0?(
            <div style={{textAlign:"center",padding:44,color:C.dim}}>
              <div style={{fontSize:32,marginBottom:8}}>🔌</div>
              <div style={{fontSize:12,fontWeight:600}}>No leads — go scrape some job boards</div>
            </div>
          ):(
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11.5}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${C.border}`}}>
                    <th style={{padding:"7px 9px",textAlign:"left"}}>
                      <input type="checkbox" checked={bulkSelect.size===filtered.length&&filtered.length>0}
                        onChange={e=>setBulkSelect(e.target.checked?new Set(filtered.map(l=>l.id)):new Set())}/>
                    </th>
                    {["Company","Job Ad","Source","Stage","Emails","Actions"].map(h=>(
                      <th key={h} style={{textAlign:"left",padding:"7px 9px",color:C.sub,fontWeight:700,fontSize:9.5,textTransform:"uppercase",letterSpacing:.7,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(l=>(
                    <tr key={l.id} style={{borderBottom:`1px solid ${C.border}15`,cursor:"pointer"}} onClick={()=>setDetailModal(l)}>
                      <td style={{padding:"7px 9px"}} onClick={e=>e.stopPropagation()}>
                        <input type="checkbox" checked={bulkSelect.has(l.id)} onChange={e=>{const s=new Set(bulkSelect);e.target.checked?s.add(l.id):s.delete(l.id);setBulkSelect(s)}}/>
                      </td>
                      <td style={{padding:"7px 9px"}}>
                        <div style={{fontWeight:700}}>{l.company}</div>
                        <div style={{fontSize:10,color:C.sub}}>{l.contact_name} · {l.location}</div>
                      </td>
                      <td style={{padding:"7px 9px",color:C.sub}}>
                        <div style={{fontSize:10.5}}>{l.job_title}</div>
                        <div style={{fontSize:9.5,color:C.dim}}>{l.salary_range} · {l.posted_ago}</div>
                      </td>
                      <td style={{padding:"7px 9px"}}><Pill color={l.source.includes("Indeed")?C.blue:C.purple}>{l.source}</Pill></td>
                      <td style={{padding:"7px 9px"}}>
                        <Pill color={STAGE_META[l.stage].color}>{STAGE_META[l.stage].label}</Pill>
                        {l.queued_template&&<Pill color={C.purple}>queued</Pill>}
                      </td>
                      <td style={{padding:"7px 9px",fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:11}}>{l.emails_sent}</td>
                      <td style={{padding:"7px 9px"}} onClick={e=>e.stopPropagation()}>
                        <div style={{display:"flex",gap:3}}>
                          <Btn sm v="orange" onClick={()=>setEmailModal(l)}>📧</Btn>
                          <Btn sm v="green" onClick={()=>setVoiceModal(l)}>📞</Btn>
                          <Btn sm v="ghost" onClick={()=>remove(l.id)}>✕</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>}

        {/* ═══ QUEUE ═══ */}
        {view==="queue"&&<div style={{animation:"fadeUp .3s ease"}}>
          <h2 style={{fontWeight:900,fontSize:19,marginBottom:5}}>Send Queue</h2>
          <p style={{color:C.sub,fontSize:11.5,marginBottom:16}}>
            Queued leads send at {cfg.send_interval_sec}s intervals, up to {cfg.daily_limit}/day. Respects daily limit automatically.
          </p>
          <DailyBar sent={todaySent} limit={cfg.daily_limit}/>
          <div style={{marginTop:12,marginBottom:18,display:"flex",gap:8,alignItems:"center"}}>
            <Btn v="primary" onClick={runQueue} disabled={queueRunning||st.queued===0||!canSendToday}>
              {queueRunning?<><span style={{animation:"pulse 1s infinite"}}>⏳</span> Sending…</>:`▶ Run Queue (${st.queued} leads)`}
            </Btn>
            {!canSendToday&&<span style={{fontSize:11,color:C.red,fontWeight:700}}>Daily limit reached</span>}
          </div>

          {st.queued===0?(
            <div style={{textAlign:"center",padding:40,color:C.dim}}>
              <div style={{fontSize:28,marginBottom:6}}>✉️</div>
              <div style={{fontSize:12,fontWeight:600}}>Queue empty — select leads and queue them from the Leads tab</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {leads.filter(l=>l.queued_template).map(l=>{
                const tpl=EMAIL_TEMPLATES.find(t=>t.id===l.queued_template);
                return <div key={l.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:12}}>{l.company}</div>
                    <div style={{fontSize:10,color:C.sub}}>{l.email} · <Pill color={C.purple}>{tpl?.name||l.queued_template}</Pill></div>
                  </div>
                  <Btn sm v="ghost" onClick={()=>patch(l.id,{queued_template:null})}>Remove</Btn>
                </div>;
              })}
            </div>
          )}

          {/* TODAY'S SEND LOG */}
          {dailySends.log.length>0&&<div style={{marginTop:24}}>
            <h3 style={{fontSize:11,fontWeight:700,color:C.sub,marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>Today's send log</h3>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:12}}>
              {dailySends.log.map((entry,i)=>(
                <div key={i} style={{fontSize:10.5,color:C.dim,padding:"3px 0",borderBottom:i<dailySends.log.length-1?`1px solid ${C.border}10`:"none"}}>
                  <span style={{color:C.green,fontWeight:700}}>✓</span> {entry.email} <span style={{color:C.dim}}>· {new Date(entry.time).toLocaleTimeString("en-AU",{hour:"2-digit",minute:"2-digit"})}</span>
                </div>
              ))}
            </div>
          </div>}
        </div>}

        {/* ═══ TEMPLATES ═══ */}
        {view==="templates"&&<div style={{animation:"fadeUp .3s ease"}}>
          <h2 style={{fontWeight:900,fontSize:19,marginBottom:5}}>Email Sequence</h2>
          <p style={{color:C.sub,fontSize:11.5,marginBottom:18}}>2-touch: warm intro referencing their job ad → live Retell demo offer</p>
          {EMAIL_TEMPLATES.map((t,i)=>(
            <div key={t.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:16,marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}>
                <Pill color={i===0?C.orange:C.blue}>Touch {i+1}</Pill>
                <span style={{fontWeight:700,fontSize:12.5}}>{t.name}</span>
              </div>
              <div style={{fontSize:11,color:C.sub,marginBottom:5}}><strong>Subject:</strong> {t.subject}</div>
              <pre style={{fontSize:11,color:C.dim,whiteSpace:"pre-wrap",fontFamily:"'Outfit',sans-serif",lineHeight:1.7,margin:0,padding:12,background:C.bg,borderRadius:7,border:`1px solid ${C.border}`}}>{t.body}</pre>
            </div>
          ))}
        </div>}

        {/* ═══ SETTINGS ═══ */}
        {view==="settings"&&<div style={{animation:"fadeUp .3s ease",maxWidth:460}}>
          <h2 style={{fontWeight:900,fontSize:19,marginBottom:14}}>Settings</h2>

          {/* SEND LIMITS */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:16,marginBottom:12}}>
            <h3 style={{fontSize:10.5,fontWeight:700,color:C.sub,marginBottom:12,textTransform:"uppercase",letterSpacing:1}}>Daily Send Limits</h3>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1}}>
                <Inp label={`Emails per day (${cfg.daily_limit})`} type="range" min={10} max={20} value={cfg.daily_limit} onChange={e=>setCfg({...cfg,daily_limit:parseInt(e.target.value)})} style={{width:"100%"}}/>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.dim,marginTop:2}}><span>10</span><span>20</span></div>
              </div>
              <Inp label="Interval (sec)" type="number" value={cfg.send_interval_sec} onChange={e=>setCfg({...cfg,send_interval_sec:parseInt(e.target.value)||60})} style={{width:80}}/>
            </div>
            <div style={{fontSize:10,color:C.dim,marginTop:8}}>
              Keep under 20/day to avoid spam filters on a new domain. Increase gradually over 2-4 weeks.
            </div>
          </div>

          {[
            {title:"Retell AI",fields:[
              {k:"retell_key",l:"API Key",ph:"key_...",pw:true},
              {k:"retell_agent_id",l:"Agent ID",ph:"agent_..."},
            ]},
            {title:"Email Service",fields:[
              {k:"email_service",l:"Provider",sel:[{value:"sendgrid",label:"SendGrid"},{value:"resend",label:"Resend"},{value:"mailgun",label:"Mailgun"}]},
              {k:"email_key",l:"API Key",ph:"SG.xxx",pw:true},
            ]},
            {title:"Sender",fields:[
              {k:"sender_name",l:"Your Name",ph:"Josh Taylor"},
              {k:"sender_title",l:"Title",ph:"AI Solutions Consultant"},
              {k:"sender_email",l:"From Email",ph:"josh@yourdomain.com.au"},
            ]},
          ].map(sec=>(
            <div key={sec.title} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:16,marginBottom:12}}>
              <h3 style={{fontSize:10.5,fontWeight:700,color:C.sub,marginBottom:12,textTransform:"uppercase",letterSpacing:1}}>{sec.title}</h3>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {sec.fields.map(f=>f.sel?
                  <Sel key={f.k} label={f.l} value={cfg[f.k]} onChange={e=>setCfg({...cfg,[f.k]:e.target.value})} options={f.sel}/>
                  :<Inp key={f.k} label={f.l} placeholder={f.ph} type={f.pw?"password":"text"} value={cfg[f.k]} onChange={e=>setCfg({...cfg,[f.k]:e.target.value})}/>
                )}
              </div>
            </div>
          ))}
          <Btn onClick={()=>saveCfg(cfg)}>Save Settings</Btn>
        </div>}
      </div>

      {/* ═══ MODALS ═══ */}
      {emailModal&&<Modal title={`Email → ${emailModal.company}`} onClose={()=>setEmailModal(null)} wide>
        {!canSendToday&&<div style={{background:C.red+"20",border:`1px solid ${C.red}40`,borderRadius:7,padding:10,marginBottom:12,fontSize:11,color:C.red,fontWeight:700}}>
          Daily limit reached ({cfg.daily_limit}/day). Queue this lead or try tomorrow.
        </div>}
        <p style={{fontSize:11,color:C.sub,marginBottom:14}}>Pick a template — placeholders auto-fill with lead data.</p>
        {EMAIL_TEMPLATES.map(t=>(
          <div key={t.id} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:7,padding:12,marginBottom:8,transition:"border-color .1s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.amber}
            onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{fontWeight:700,fontSize:12}}>{t.name}</span>
              <Btn sm v="orange" onClick={()=>sendEmail(emailModal,t)} disabled={!canSendToday}>Send</Btn>
            </div>
            <div style={{fontSize:10.5,color:C.sub}}>
              <strong>To:</strong> {emailModal.email} · <strong>Subject:</strong> {t.subject.replace(/\{\{company\}\}/g,emailModal.company).replace(/\{\{name\}\}/g,emailModal.contact_name.split(" ")[0])}
            </div>
          </div>
        ))}
      </Modal>}

      {voiceModal&&<Modal title={`Retell Demo → ${voiceModal.company}`} onClose={()=>setVoiceModal(null)}>
        <div style={{fontSize:11.5,color:C.sub,marginBottom:14}}>Triggers an outbound Retell AI call. They'll experience your AI receptionist live.</div>
        <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:7,padding:12,marginBottom:14}}>
          {[["Contact",voiceModal.contact_name],["Phone",voiceModal.phone],["Agent",cfg.retell_agent_id||"Not set"]].map(([k,v])=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:11.5}}>
              <span style={{color:C.sub}}>{k}</span>
              <span style={{fontWeight:700,color:!cfg.retell_agent_id&&k==="Agent"?C.red:C.text}}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:6}}>
          <Btn v="green" onClick={()=>triggerVoiceDemo(voiceModal)} disabled={!cfg.retell_agent_id}>📞 Call Now</Btn>
          <Btn v="ghost" onClick={()=>setVoiceModal(null)}>Cancel</Btn>
        </div>
      </Modal>}

      {detailModal&&<Modal title={detailModal.company} onClose={()=>setDetailModal(null)} wide>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          {[["Contact",detailModal.contact_name],["Email",detailModal.email],["Phone",detailModal.phone],["Location",detailModal.location],["Source",detailModal.source],["Job",detailModal.job_title],["Salary",detailModal.salary_range],["Posted",detailModal.posted_ago],["Emails",detailModal.emails_sent],["Stage",STAGE_META[detailModal.stage].label]].map(([k,v])=>(
            <div key={k}><div style={{fontSize:9.5,color:C.sub,fontWeight:700,textTransform:"uppercase",letterSpacing:.7,marginBottom:1}}>{k}</div><div style={{fontSize:12,fontWeight:600}}>{v}</div></div>
          ))}
        </div>
        {detailModal.last_action&&<div style={{fontSize:10.5,color:C.sub,marginBottom:10}}>Last: {detailModal.last_action}</div>}
        <div style={{display:"flex",gap:5,marginBottom:14}}>
          <Sel value={detailModal.stage} onChange={e=>{patch(detailModal.id,{stage:e.target.value});setDetailModal({...detailModal,stage:e.target.value})}}
            options={STAGES.map(s=>({value:s,label:STAGE_META[s].label}))}/>
        </div>
        <div style={{display:"flex",gap:6}}>
          <Btn v="orange" onClick={()=>{setDetailModal(null);setEmailModal(detailModal)}}>📧 Email</Btn>
          <Btn v="green" onClick={()=>{setDetailModal(null);setVoiceModal(detailModal)}}>📞 Retell Demo</Btn>
          <Btn v="red" onClick={()=>{remove(detailModal.id);setDetailModal(null)}}>Delete</Btn>
        </div>
      </Modal>}
    </div>
  );
}
