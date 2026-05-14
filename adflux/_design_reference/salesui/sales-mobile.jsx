/* Sales Module — mobile screens (daily drivers) */
const { useState: useStateS } = React;

// ---------- Icons (Lucide-style, stroke 1.6) ----------
const SIco = ({ n, s = 18 }) => {
  const p = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  const P = {
    home: <><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    clock: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>,
    menu: <><path d="M3 12h18M3 6h18M3 18h18"/></>,
    search: <><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,
    bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    chev: <><path d="M9 18l6-6-6-6"/></>,
    cleft: <><path d="M15 18l-6-6 6-6"/></>,
    cdown: <><path d="M6 9l6 6 6-6"/></>,
    phone: <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></>,
    msg: <><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M19 11a7 7 0 0 1-14 0M12 18v4M8 22h8"/></>,
    map: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>,
    pin: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>,
    cal: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    pen: <><path d="M12 20h9M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></>,
    check: <><path d="M20 6L9 17l-5-5"/></>,
    play: <><polygon points="5 3 19 12 5 21 5 3"/></>,
    stop: <><rect x="6" y="6" width="12" height="12" rx="2"/></>,
    sun: <><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></>,
    moon: <><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>,
    spark: <><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></>,
    money: <><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
    lock: <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    flame: <><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></>,
    arrow: <><path d="M5 12h14M12 5l7 7-7 7"/></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    x: <><path d="M18 6L6 18M6 6l12 12"/></>,
    cam: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></>,
    refresh: <><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15A9 9 0 0 1 5.64 18.36L1 14"/></>,
    note: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></>,
    target: <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  };
  return <svg {...p}>{P[n]}</svg>;
};

// ---------- Mobile chrome ----------
const Topbar = ({ title }) => (
  <div className="sm-topbar">
    <button className="iconbtn"><SIco n="search" s={16}/></button>
    <span className="title">{title}</span>
    <button className="iconbtn"><SIco n="bell" s={16}/></button>
    <div className="sm-avatar">B</div>
  </div>
);

// ---------- Reusable Hero ----------
const Hero = ({ eyebrow, value, label, right, chip, accent }) => (
  <div className="sm-hero">
    <div className="eyebrow"><span className="ydot"/> {eyebrow}</div>
    <div className="row">
      <div className="lhs">
        <div className={`v ${accent ? "acc" : ""}`}>{value}</div>
        <div className="l">{label}</div>
      </div>
      <div className={`rhs ${right?.tone === "down" ? "down" : ""}`}>
        {chip ? <span className="chip"><span className="ydot"/> {chip}</span> : null}
        {right ? <div style={{ marginTop: chip ? 6 : 0 }}>{right.text}</div> : null}
      </div>
    </div>
  </div>
);

// ---------- Milestones (3 rings) ----------
const RingMilestone = ({ value, target, lbl, sub }) => {
  const r = 26, c = 2 * Math.PI * r;
  const pct = Math.min(1, value / target);
  const off = c * (1 - pct);
  const cls = pct >= 1 ? "done" : pct >= .5 ? "" : pct >= .2 ? "warn" : "bad";
  return (
    <div className="milestone">
      <div className="ring">
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} className="bg" strokeWidth="6" fill="none"/>
          <circle cx="32" cy="32" r={r} className={`fg ${cls}`} strokeWidth="6" fill="none"
                  strokeDasharray={c} strokeDashoffset={off}/>
        </svg>
        <div className="num">{value}<span className="tg">/{target}</span></div>
      </div>
      <div className="lbl">{lbl}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
};
const Milestones = ({ visits = [3,5], leads = [5,10], follow = [3,20] }) => (
  <div className="milestones">
    <RingMilestone value={visits[0]} target={visits[1]} lbl="Visits"/>
    <RingMilestone value={leads[0]} target={leads[1]} lbl="Leads"/>
    <RingMilestone value={follow[0]} target={follow[1]} lbl="Follow-ups"/>
  </div>
);

const Bnav = ({ on = "today" }) => {
  const it = [
    { id: "today", l: "Today", i: "home" },
    { id: "leads", l: "Leads", i: "users" },
    { id: "follow", l: "Follow-ups", i: "clock" },
    { id: "quotes", l: "Quotes", i: "file" },
    { id: "more", l: "More", i: "menu" },
  ];
  return (
    <div className="sm-bnav">
      {it.map(x => (
        <a key={x.id} className={`it ${on === x.id ? "on" : ""}`}>
          <span className="dot"><SIco n={x.i} s={20}/></span>
          <span>{x.l}</span>
        </a>
      ))}
    </div>
  );
};

const Screen = ({ title, on, children, fab, toast }) => (
  <div className="sm-mobile">
    <Topbar title={title}/>
    <div className="sm-content">{children}</div>
    {fab ? <button className="fab"><SIco n="plus" s={22}/></button> : null}
    {toast ? <div className="toast"><SIco n="check" s={14}/> {toast}</div> : null}
    <Bnav on={on}/>
  </div>
);

// ============================================================
// /work — 3 simplified states
// ============================================================
const WorkMorning = () => (
  <Screen title="Today" on="today">
    <div className="greeting">
      <div>
        <div className="hello">Good morning, Brijesh</div>
        <div className="date">Wed · 13 May · shift starts 9:30</div>
      </div>
      <span className="shift-pill"><span className="live-dot"/> Shift in 12m</span>
    </div>

    <Hero
      eyebrow="Today · day 13 of May"
      value="₹0"
      label="ready to add — target ₹40K/day"
      chip="Score 64"
      right={{ text: <>Rank <b>3</b> of 6</> }}
    />

    <Milestones visits={[0,5]} leads={[0,10]} follow={[0,20]}/>

    <button className="primary-action accent" style={{ marginBottom: 14 }}>
      <SIco n="map"/> Start Day · Check in
    </button>

    <div className="ai-brief">
      <div className="glyph"><SIco n="spark" s={16}/></div>
      <div className="body">
        <b>3 hot leads idle &gt; 24h.</b> Open Sunrise first — owner picked up yesterday.
      </div>
    </div>

    <div className="card">
      <div className="card-head">
        <span className="t">Today's plan · 4 stops</span>
        <span className="link"><SIco n="pen" s={12}/> Edit</span>
      </div>
      <div className="task-list">
        {[
          { t: "10:30", n: "Sunrise Diagnostics", m: "Dr. Mehta · Adajan", urg: true },
          { t: "13:00", n: "Patel Auto Hub", m: "Vadodara · 1h drive" },
          { t: "16:00", n: "Reliance Trends", m: "Athwa · close visit" },
          { t: "17:30", n: "Bisleri Gujarat", m: "Renewal site survey" },
        ].map((r, i) => (
          <div className="task-row" key={i}>
            <div className={`tico ${r.urg ? "urg" : ""}`}><SIco n="map" s={16}/></div>
            <div>
              <div className="tname">{r.n}</div>
              <div className="tmeta">{r.m}</div>
            </div>
            <div className={`ttime ${r.urg ? "urg" : ""}`}>{r.t}</div>
          </div>
        ))}
      </div>
    </div>

    <button className="secondary-action" style={{ marginBottom: 12 }}>
      <SIco n="mic" s={16}/> Voice plan in Gujarati
    </button>
  </Screen>
);

const WorkActive = () => (
  <Screen title="Today" on="today">
    <div className="greeting">
      <div>
        <div className="hello">Day 3 active</div>
        <div className="date">Checked in 09:14 · Adajan</div>
      </div>
      <span className="shift-pill"><span className="live-dot"/> 5h 42m left</span>
    </div>

    <Hero
      eyebrow="Live · in field"
      value="₹3.8L"
      label="pipeline added · 1 quote sent"
      chip="Score 64"
      accent
      right={{ text: <>vs avg <b>+₹1.2L</b></> }}
    />

    <Milestones visits={[3,5]} leads={[5,10]} follow={[3,20]}/>

    <button className="primary-action" style={{ marginBottom: 14 }}>
      <SIco n="cal"/> Log meeting
    </button>

    <div className="ai-brief">
      <div className="glyph"><SIco n="spark" s={16}/></div>
      <div className="body">
        Patel meeting in <b>34 min</b>. Last contact: 9 days ago. Walk in with last quote.
      </div>
    </div>

    <div className="card">
      <div className="card-head">
        <span className="t">Up next</span>
        <span className="link">All 4 stops <SIco n="chev" s={12}/></span>
      </div>
      <div className="task-list">
        {[
          { t: "13:00", n: "Patel Auto Hub", m: "in 34 min · 18 km", urg: true },
          { t: "16:00", n: "Reliance Trends", m: "Athwa · close visit" },
          { t: "17:30", n: "Bisleri Gujarat", m: "Renewal site survey" },
        ].map((r, i) => (
          <div className="task-row" key={i}>
            <div className={`tico ${r.urg ? "urg" : ""}`}><SIco n="map" s={16}/></div>
            <div><div className="tname">{r.n}</div><div className="tmeta">{r.m}</div></div>
            <div className={`ttime ${r.urg ? "urg" : ""}`}>{r.t}</div>
          </div>
        ))}
        <div className="task-row">
          <div className="tico"><SIco n="check" s={16}/></div>
          <div>
            <div className="tname" style={{ color: "var(--text-muted)", textDecoration: "line-through" }}>Sunrise Diagnostics</div>
            <div className="tmeta">Done · ₹3.8L quote sent</div>
          </div>
          <div className="ttime">10:30</div>
        </div>
      </div>
    </div>
  </Screen>
);

const WorkWrap = () => (
  <Screen title="Today" on="today" toast="Day saved · scorecard sent">
    <div className="greeting">
      <div>
        <div className="hello">Wrap-up · 19:42</div>
        <div className="date">Saturday · day done 👏</div>
      </div>
      <span className="shift-pill" style={{ color: "var(--success)", borderColor: "var(--tint-success)", background: "var(--tint-success)" }}>
        <SIco n="check" s={12}/> Checked out
      </span>
    </div>

    <Hero
      eyebrow="Day done · 09:14 → 19:42"
      value="₹6.2L"
      label="added today · 3 meetings · 17 calls"
      chip="Score +8"
      accent
      right={{ text: <>vs avg <b>+₹2.4L</b></> }}
    />

    <Milestones visits={[3,3]} leads={[11,10]} follow={[17,20]}/>

    <button className="primary-action" style={{ marginBottom: 12 }}>
      <SIco n="mic"/> Speak evening report
    </button>

    <div className="card">
      <div className="card-head"><span className="t">AI day summary</span><span className="pill pill-success">approved</span></div>
      <div className="card-pad" style={{ paddingTop: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
        <b style={{ color: "var(--text)" }}>Highlights:</b> Sunrise → SalesReady · ₹6.2L pipeline added.<br/>
        <b style={{ color: "var(--text)" }}>Blockers:</b> Bisleri renewal survey pending — Monday.<br/>
        <b style={{ color: "var(--text)" }}>Tomorrow:</b> Send Sunrise quote · close Patel Auto Hub.
      </div>
    </div>

    <button className="secondary-action">View full day report</button>
  </Screen>
);

// ============================================================
// /leads
// ============================================================
const Leads = () => {
  const [f, setF] = useStateS("Hot");
  const rows = [
    { n: "Dr. Mehta", co: "Sunrise Diagnostics", st: "working", stl: "SalesReady", last: "2h ago", due: "Send quote · today", hot: true, urgent: true, val: "₹3.8L" },
    { n: "Rajesh Patel", co: "Patel Auto Hub", st: "quote", stl: "Negotiating", last: "5h ago", due: "Meeting · 13:00", hot: true, val: "₹2.4L" },
    { n: "GSRTC Surat", co: "Govt of Gujarat", st: "working", stl: "Qualified", last: "1d ago", due: "OC copy · tomorrow", val: "₹6.4L" },
    { n: "Priya Shah", co: "Acme Pharma", st: "quote", stl: "QuoteSent", last: "3h ago", due: "Follow up · Fri", hot: true, val: "₹1.2L" },
    { n: "Kalap Hospital", co: "—", st: "nurture", stl: "Nurture", last: "18d ago", due: "Revisit · overdue", urgent: true, val: "₹4.8L" },
    { n: "Saraswati Group", co: "Saraswati Builders", st: "won", stl: "Won", last: "2d ago", due: "Payment due · Mon", val: "₹8.6L" },
    { n: "Reliance Trends", co: "Reliance Retail", st: "working", stl: "Working", last: "8h ago", due: "Close visit · 16:00", val: "₹3.2L" },
  ];
  return (
    <Screen title="Leads" on="leads" fab>
      <Hero
        eyebrow="Pipeline · my leads"
        value="₹2.1Cr"
        label="247 total · 5 hot · ₹68L won this month"
        accent
        chip="3 overdue"
      />
      <div className="page-h">
        <div className="l">
          <div className="t">My Leads</div>
          <div className="s">247 total · 5 hot · 3 overdue</div>
        </div>
      </div>

      <div className="sm-search">
        <SIco n="search" s={16}/>
        <input placeholder="Name, company, phone"/>
        <SIco n="mic" s={16}/>
      </div>

      <div className="fpills">
        <span className={`p ${f==="All"?"on":""}`} onClick={()=>setF("All")}>All <span className="count">247</span></span>
        <span className={`p ${f==="Hot"?"on":""}`} onClick={()=>setF("Hot")}>🔥 Hot <span className="count">5</span></span>
        <span className={`p danger ${f==="Overdue"?"on":""}`} onClick={()=>setF("Overdue")}>Overdue <span className="count">3</span></span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.map((r, i) => (
          <div className="lead-row" key={i}>
            {r.hot ? <span className="hot-dot"/> : <span style={{ width: 8 }}/>}
            <div>
              <div className="lname">{r.n} <span className="co">· {r.co}</span></div>
              <div className="lmeta">
                <span className={`stage ${r.st}`}>{r.stl}</span>
                <span className="ok">{r.last}</span>
                <span className={r.urgent ? "urgent" : "ok"}>· {r.due}</span>
              </div>
            </div>
            <div className="lval">{r.val}</div>
          </div>
        ))}
      </div>
    </Screen>
  );
};

// ============================================================
// /leads/:id
// ============================================================
const LeadDetail = () => (
  <Screen title="Lead" on="leads">
    <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 13, marginBottom: 6 }}>
      <SIco n="cleft" s={14}/> Back
    </div>

    <Hero
      eyebrow="SalesReady · Sunrise Diagnostics"
      value="₹3,80,000"
      label="expected · 18h since last touch"
      accent
      chip="🔥 HOT"
      right={{ text: <>SLA <b style={{ color: "#fbbf24" }}>3h left</b></>, tone: "down" }}
    />

    <div className="action-bar">
      <button className="act call"><SIco n="phone" s={20}/> Call</button>
      <button className="act wa"><SIco n="msg" s={20}/> WhatsApp</button>
      <button className="act log"><SIco n="note" s={20}/> Log</button>
    </div>

    <div className="card info-card">
      <div className="card-head">
        <span className="t">Lead info</span>
        <span className="link"><SIco n="pen" s={12}/> Edit</span>
      </div>
      <div className="info-row"><span className="k">Phone</span><span className="v">+91 98250 11234 <SIco n="pen" s={12}/></span></div>
      <div className="info-row"><span className="k">Email</span><span className="v">drm@sunrise.in <SIco n="pen" s={12}/></span></div>
      <div className="info-row"><span className="k">City</span><span className="v">Surat · Adajan</span></div>
      <div className="info-row"><span className="k">Source</span><span className="v">IndiaMart</span></div>
    </div>

    <div className="card">
      <div className="card-head"><span className="t">Activity · latest 3</span><span className="link">View all (9) <SIco n="cdown" s={12}/></span></div>
      <div className="act-list">
        <div className="act-row">
          <div className="act-ico blue"><SIco n="phone" s={12}/></div>
          <div>
            <div className="act-title">Call · 4m 12s · positive</div>
            <div className="act-body">Demo scheduled. Owner is decision maker. Asked for HSN-coded quote.</div>
          </div>
          <div className="act-time">2h</div>
        </div>
        <div className="act-row">
          <div className="act-ico blue"><SIco n="msg" s={12}/></div>
          <div>
            <div className="act-title">WhatsApp sent</div>
            <div className="act-body">Catalog PDF · welcome template</div>
          </div>
          <div className="act-time">5h</div>
        </div>
        <div className="act-row">
          <div className="act-ico purple"><SIco n="refresh" s={12}/></div>
          <div>
            <div className="act-title">Stage → SalesReady</div>
            <div className="act-body">Pooja N. → Brahmbhatt</div>
          </div>
          <div className="act-time">1d</div>
        </div>
      </div>
    </div>

    <div className="card card-pad" style={{ background: "var(--tint-success)", borderColor: "rgba(15,157,88,.20)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--success)", color: "white", display: "grid", placeItems: "center" }}>
          <SIco n="file" s={16}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Latest quote · UA-2026-0078</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Draft · ₹3,80,000</div>
        </div>
        <SIco n="chev" s={14}/>
      </div>
    </div>

    <button className="secondary-action">
      <SIco n="map" s={16}/> Mark as on-site · 10-min timer
    </button>
  </Screen>
);

// ============================================================
// /follow-ups
// ============================================================
const FollowUps = () => {
  const [t, setT] = useStateS("Overdue");
  const rows = [
    { n: "Kalap Hospital", due: "Overdue 4 days", urgent: true, last: "Call · no answer", st: "Nurture" },
    { n: "ABC Clinic", due: "Overdue 2 days", urgent: true, last: "Quote sent", st: "QuoteSent" },
    { n: "Dr. Mehta", due: "Today · 14:00", last: "Demo scheduled", st: "SalesReady" },
    { n: "Patel Auto Hub", due: "Today · 13:00", last: "Site visit", st: "Negotiating" },
    { n: "Priya Shah", due: "Tomorrow", last: "Quote follow-up", st: "QuoteSent" },
    { n: "GSRTC Surat", due: "Friday", last: "OC copy upload", st: "Qualified" },
  ];
  return (
    <Screen title="Follow-ups" on="follow">
      <Hero
        eyebrow="Follow-ups · today"
        value="12"
        label="due today · 2 overdue · 3 hot"
        chip="2 overdue"
        right={{ text: <>Done <b>17</b></> }}
      />
      <div className="page-h">
        <div className="l">
          <div className="t">Follow-ups</div>
          <div className="s">12 due · 2 overdue</div>
        </div>
      </div>

      <div className="fpills">
        <span className={`p danger ${t==="Overdue"?"on":""}`} onClick={()=>setT("Overdue")}>Overdue <span className="count">2</span></span>
        <span className={`p ${t==="Today"?"on":""}`} onClick={()=>setT("Today")}>Today <span className="count">5</span></span>
        <span className={`p ${t==="Tomorrow"?"on":""}`} onClick={()=>setT("Tomorrow")}>Tomorrow <span className="count">3</span></span>
        <span className={`p ${t==="Week"?"on":""}`} onClick={()=>setT("Week")}>This week <span className="count">12</span></span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ padding: "14px 16px", borderBottom: i < rows.length - 1 ? "1px solid var(--border-soft)" : 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{r.n}</div>
              <div style={{ fontSize: 12, color: r.urgent ? "var(--danger)" : "var(--text-muted)", fontWeight: r.urgent ? 500 : 400 }}>{r.due}</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-subtle)", margin: "4px 0 10px" }}>{r.last}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn-pill" style={{ flex: 1, justifyContent: "center", padding: "8px 10px", fontSize: 12 }}><SIco n="phone" s={13}/> Call</button>
              <button className="btn-pill" style={{ flex: 1, justifyContent: "center", padding: "8px 10px", fontSize: 12 }}><SIco n="msg" s={13}/> WA</button>
              <button className="btn-pill primary" style={{ flex: 1, justifyContent: "center", padding: "8px 10px", fontSize: 12 }}><SIco n="check" s={13}/> Done</button>
              <button className="btn-pill" style={{ padding: "8px 10px", fontSize: 12 }}><SIco n="clock" s={13}/></button>
            </div>
          </div>
        ))}
      </div>
    </Screen>
  );
};

window.SIco = SIco;
window.Topbar = Topbar;
window.Hero = Hero;
window.Milestones = Milestones;
window.RingMilestone = RingMilestone;
window.Bnav = Bnav;
window.Screen = Screen;
window.WorkMorning = WorkMorning;
window.WorkActive = WorkActive;
window.WorkWrap = WorkWrap;
window.Leads = Leads;
window.LeadDetail = LeadDetail;
window.FollowUps = FollowUps;
