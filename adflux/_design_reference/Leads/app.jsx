/* global React */
const { useState, useMemo } = React;

// ---------- Icons ----------
const Icon = ({ name, size = 16, stroke = 2 }) => {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    home: <><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    check: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></>,
    map: <><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><path d="M8 2v16M16 6v16"/></>,
    bus: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 12h18"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></>,
    train: <><rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16"/><path d="M8 19l-2 3M16 19l2 3"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/></>,
    layers: <><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></>,
    award: <><circle cx="12" cy="8" r="6"/><path d="M15.5 13.5L17 22l-5-3-5 3 1.5-8.5"/></>,
    refresh: <><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15A9 9 0 0 1 5.64 18.36L1 14"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></>,
    search: <><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    sun: <><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></>,
    moon: <><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
    chevron: <><path d="M9 18l6-6-6-6"/></>,
    chevronDown: <><path d="M6 9l6 6 6-6"/></>,
    arrowRight: <><path d="M5 12h14M12 5l7 7-7 7"/></>,
    sparkle: <><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></>,
    alert: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></>,
    clock: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></>,
    rupee: <><path d="M6 3h12M6 8h12M6 13l9 9M6 13a4 4 0 0 0 4 4h2"/></>,
    trend: <><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></>,
    dollar: <><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
    target: <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
    inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>,
    flame: <><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></>,
    refresh2: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></>,
    coin: <><circle cx="12" cy="12" r="9"/><path d="M9 9h4.5a2 2 0 0 1 0 4H9l5 5"/></>
  };
  return <svg {...props}>{paths[name]}</svg>;
};

// ---------- Sidebar ----------
const Sidebar = ({ active, onChange }) => {
  const items = [
    { group: "MAIN", entries: [
      { id: "dashboard", label: "Dashboard", icon: "home" },
      { id: "quotes", label: "Quotes", icon: "file" },
      { id: "clients", label: "Clients", icon: "user" },
      { id: "approvals", label: "Approvals", icon: "check", badge: 5 },
    ]},
    { group: "DIRECTORY", entries: [
      { id: "cities", label: "Cities", icon: "map" },
      { id: "auto", label: "Auto Districts", icon: "bus" },
      { id: "gsrtc", label: "GSRTC Stations", icon: "train" },
      { id: "master", label: "Master", icon: "layers" },
    ]},
    { group: "PEOPLE", entries: [
      { id: "team", label: "Team", icon: "users" },
      { id: "hr", label: "HR", icon: "user" },
      { id: "renewals", label: "Renewals", icon: "refresh" },
      { id: "incentives", label: "Incentives", icon: "award" },
    ]},
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div>
          <div className="brand-name">Adflux</div>
          <div className="brand-role">Admin</div>
        </div>
      </div>
      {items.map((g) => (
        <div className="nav-group" key={g.group}>
          <div className="nav-label">{g.group}</div>
          {g.entries.map((it) => (
            <a key={it.id} className={`nav-item ${active === it.id ? "active" : ""}`} onClick={() => onChange?.(it.id)}>
              <Icon name={it.icon} />
              <span>{it.label}</span>
              {it.badge ? <span className="nav-badge">{it.badge}</span> : null}
            </a>
          ))}
        </div>
      ))}
      <div className="sidebar-foot">
        <div className="nav-group">
          <a className="nav-item"><Icon name="settings" /><span>Settings</span></a>
          <a className="nav-item"><Icon name="logout" /><span>Log out</span></a>
        </div>
      </div>
    </aside>
  );
};

// ---------- Topbar ----------
const Topbar = ({ segment, setSegment, theme, setTheme }) => (
  <div className="topbar">
    <div className="search">
      <Icon name="search" size={14} />
      <input placeholder="Search quotes, clients, ref numbers…" />
      <kbd>⌘K</kbd>
    </div>
    <div className="tb-spacer" />
    <button className="period-picker">
      <Icon name="calendar" size={14} />
      <span>May 2026</span>
      <Icon name="chevronDown" size={12} />
    </button>
    <div className="segment">
      {["All", "Private", "Govt"].map((s) => (
        <button key={s} className={`seg-btn ${segment === s ? "active" : ""}`} onClick={() => setSegment(s)}>{s}</button>
      ))}
    </div>
    <button className="cta"><Icon name="plus" size={14} /> Create Quote</button>
    <button className="icon-btn" title="Theme" onClick={() => setTheme(theme === "night" ? "day" : "night")}>
      <Icon name={theme === "night" ? "sun" : "moon"} size={16} />
    </button>
    <button className="icon-btn" title="Notifications">
      <Icon name="bell" size={16} />
      <span className="dot" />
    </button>
    <button className="avatar-btn">
      <span className="avatar">BJ</span>
      <span>
        <div className="avatar-name">Brijesh</div>
        <div className="avatar-role">Admin</div>
      </span>
    </button>
  </div>
);

// ---------- AI Briefing ----------
const AIBriefing = () => (
  <div className="ai-briefing">
    <div className="ai-icon"><Icon name="sparkle" size={22} /></div>
    <div>
      <div className="ai-eyebrow"><span className="pulse" /> AI briefing · today</div>
      <p className="ai-recap">
        Yesterday: <b>8 quotes sent</b>, <b>2 won (₹3.2L)</b>, <b>₹86K collected</b>. You're on pace to hit May target by the 28th if Sondarva closes Kalap this week.
      </p>
      <div className="ai-list">
        <div className="ai-item">
          <span className="dot" style={{ background: "var(--red)" }} />
          <span><b>Kalap Hospital</b> stale 18d · last touch by Vishnu</span>
          <span className="chip red">Act now</span>
          <span className="meta">Quote UA-2026-0042</span>
        </div>
        <div className="ai-item">
          <span className="dot" style={{ background: "var(--amber)" }} />
          <span><b>Vishnu</b> missed quote target 3 days in a row</span>
          <span className="chip amber">Coach</span>
          <span className="meta">0/2 today</span>
        </div>
        <div className="ai-item">
          <span className="dot" style={{ background: "var(--blue)" }} />
          <span>2 govt OC copies awaiting upload</span>
          <span className="chip govt">Govt</span>
          <span className="meta">due today</span>
        </div>
        <div className="ai-item">
          <span className="dot" style={{ background: "var(--green)" }} />
          <span>5 payment approvals waiting your call · ₹1.4L</span>
          <span className="chip green">Approve</span>
          <span className="meta">5 min</span>
        </div>
      </div>
    </div>
    <div className="ai-cta">
      <div className="ai-time">Updated 4 min ago</div>
      <a href="#queue">View action queue <Icon name="arrowRight" size={12} /></a>
    </div>
  </div>
);

// ---------- Hero ----------
const Hero = () => {
  const stats = [
    { label: "Today", value: "₹14,200", delta: "+₹2.1K vs avg", up: true },
    { label: "MTD", value: "₹3,86,500", delta: "44% of target", up: true, accent: true },
    { label: "Won value", value: "₹87,61,500", delta: "12 quotes", up: true },
    { label: "Pipeline", value: "₹1,72,64,580", delta: "21 open", up: true },
    { label: "Outstanding", value: "₹86,71,500", delta: "2 over 45d", up: false },
  ];
  return (
    <div className="hero">
      <button className="hero-cta">View quotes <Icon name="arrowRight" size={12} /></button>
      <div className="hero-head">
        <div className="hero-eyebrow"><span className="accent">●</span> REVENUE · MAY 2026</div>
      </div>
      <div className="hero-stats">
        {stats.map((s) => (
          <div className="hero-stat" key={s.label}>
            <div className="label">{s.label}</div>
            <div className={`value ${s.accent ? "accent" : ""}`}>{s.value}</div>
            <div className={`delta ${s.up ? "up" : "down"}`}>{s.delta}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------- Banner ----------
const Banner = () => (
  <div className="banner">
    <span className="ico-circ"><Icon name="alert" size={14} /></span>
    <div className="body">
      <b>3 reps below today's target:</b>{" "}
      <span className="names">Vishnu · Sondarva · Nikhil</span>
    </div>
    <a href="#team">details →</a>
  </div>
);

// ---------- Action Queue ----------
const ActionQueue = () => {
  const items = [
    { count: 5, label: "Payment approvals waiting", sub: "Total ₹1,42,500 · oldest 2h ago", icon: "coin", tone: "red" },
    { count: 12, label: "Follow-ups due today", sub: "Spread across 6 reps", icon: "clock", tone: "amber" },
    { count: 4, label: "Govt proposals awaiting OC copy", sub: "GSRTC, Surat-AMC, Vadodara-AMC", icon: "upload", tone: "amber" },
    { count: 3, label: "Stale won quotes >60 days", sub: "₹46K + ₹13K + ₹8K outstanding", icon: "flame", tone: "red" },
    { count: 9, label: "Won quotes paid this week", sub: "Cash collected: ₹86,000", icon: "check", tone: "green" },
  ];
  return (
    <div className="card" id="queue">
      <div className="card-head">
        <div>
          <div className="card-title">Action queue</div>
          <div className="card-sub">Sorted by priority · click to act</div>
        </div>
        <a className="card-link">View all <Icon name="arrowRight" size={11} /></a>
      </div>
      <div className="action-list">
        {items.map((i) => (
          <div className="action-row" key={i.label}>
            <span className={`action-icon ${i.tone}`}><Icon name={i.icon} size={14} /></span>
            <span className={`count ${i.tone}`}>{i.count}</span>
            <div>
              <div className="label">{i.label}</div>
              <div className="sub">{i.sub}</div>
            </div>
            <span className="arrow"><Icon name="chevron" size={14} /></span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------- Team Today ----------
const TeamToday = () => {
  const reps = [
    { id: "VK", name: "Vishnu K.", role: "Govt", q: [0,2], f: [0,5], p: 0, stale: 3, below: true, av: "r1" },
    { id: "SO", name: "Sondarva", role: "Private", q: [1,2], f: [3,5], p: 1, stale: 0, below: true, av: "r2" },
    { id: "NK", name: "Nikhil M.", role: "Private", q: [0,2], f: [2,5], p: 0, stale: 1, below: true, av: "r3" },
    { id: "BR", name: "Brahmbhatt", role: "Private", q: [2,2], f: [5,5], p: 2, stale: 0, below: false, av: "r4" },
    { id: "AR", name: "Arvind R.", role: "Govt", q: [2,2], f: [4,5], p: 1, stale: 0, below: false, av: "r5" },
    { id: "PD", name: "Patel D.", role: "Private", q: [3,2], f: [4,5], p: 1, stale: 0, below: false, av: "r6" },
  ];
  return (
    <div className="card" id="team">
      <div className="card-head">
        <div>
          <div className="card-title">Team today</div>
          <div className="card-sub">Q = quotes sent · F = follow-ups · P = paid</div>
        </div>
        <a className="card-link">All reps <Icon name="arrowRight" size={11} /></a>
      </div>
      <table className="compact">
        <thead><tr><th>Rep</th><th>Q</th><th>F</th><th>P</th><th>Stale</th></tr></thead>
        <tbody>
          {reps.map((r) => {
            const qMet = r.q[0] >= r.q[1];
            const fMet = r.f[0] >= r.f[1];
            return (
              <tr key={r.id} className={r.below ? "below" : ""}>
                <td>
                  <div className="rep-cell">
                    <span className={`rep-avatar ${r.av}`}>{r.id}</span>
                    <div>
                      <div style={{ fontWeight: 500 }}>{r.name}</div>
                      <div style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>{r.role}</div>
                    </div>
                  </div>
                </td>
                <td className={`target-cell ${qMet ? "met" : "miss"}`}>{r.q[0]}/{r.q[1]} {qMet ? "✓" : ""}</td>
                <td className={`target-cell ${fMet ? "met" : "miss"}`}>{r.f[0]}/{r.f[1]} {fMet ? "✓" : ""}</td>
                <td className="target-cell">{r.p}</td>
                <td><span className={`stale-pill ${r.stale === 0 ? "zero" : ""}`}>{r.stale === 0 ? "0 ✓" : `${r.stale} ⚠`}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ---------- Pipeline Funnel ----------
const Pipeline = () => {
  const stages = [
    { stage: "Draft", count: 4, value: "₹46,87,500", pct: 18, cls: "draft" },
    { stage: "Sent", count: 18, value: "₹1,72,64,580", pct: 100, cls: "sent" },
    { stage: "Negotiating", count: 3, value: "₹64,12,000", pct: 38, cls: "neg" },
    { stage: "Won", count: 12, value: "₹87,61,500", pct: 52, cls: "won" },
    { stage: "Lost", count: 2, value: "₹6,40,000", pct: 8, cls: "lost" },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Pipeline funnel</div>
          <div className="card-sub">All-time quote status mix</div>
        </div>
        <a className="card-link">By rep <Icon name="chevronDown" size={11} /></a>
      </div>
      <div className="card-pad">
        <div className="funnel">
          {stages.map((s) => (
            <div className="funnel-row" key={s.stage}>
              <div className={`stage ${s.cls}`}>{s.stage}</div>
              <div className={`funnel-bar ${s.cls}`}><span style={{ width: `${s.pct}%` }} /></div>
              <div className="count">{s.count}</div>
              <div className="value">{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------- Trend ----------
const Trend = () => {
  const months = [
    { m: "Dec", h: 38, v: "₹2.4L" },
    { m: "Jan", h: 52, v: "₹3.2L" },
    { m: "Feb", h: 64, v: "₹4.1L" },
    { m: "Mar", h: 48, v: "₹3.0L" },
    { m: "Apr", h: 72, v: "₹4.6L" },
    { m: "May", h: 58, v: "₹3.8L", current: true },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Revenue trend · 6mo</div>
          <div className="card-sub">Approved payments per month</div>
        </div>
        <span className="chip green">+18% YoY</span>
      </div>
      <div className="card-pad">
        <div className="trend">
          {months.map((mo) => (
            <div className={`trend-col ${mo.current ? "is-current" : ""}`} key={mo.m}>
              <div className="trend-bar-wrap">
                <div className={`trend-bar ${mo.current ? "current" : ""}`} style={{ height: `${mo.h}%` }}>
                  <span className="tip">{mo.v}</span>
                </div>
              </div>
              <div className="trend-label">{mo.m}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------- Outstanding ----------
const Outstanding = () => {
  const [sort, setSort] = useState("age");
  const rows = [
    { client: "ABC Clinic, Surat", id: "UA-2026-0042", amount: "₹46,87,500", age: 45, tone: "old" },
    { client: "Kalap Hospital", id: "UA-2026-0038", amount: "₹38,84,000", age: 38, tone: "warn" },
    { client: "XYZ Corp Pvt Ltd", id: "UA-2026-0061", amount: "₹13,15,000", age: 18, tone: "warn" },
    { client: "Saraswati Group", id: "UA-2026-0069", amount: "₹8,62,000", age: 12, tone: "" },
    { client: "Patel Auto Hub", id: "UA-2026-0072", amount: "₹4,40,000", age: 9, tone: "" },
    { client: "GreenLeaf Foods", id: "UA-2026-0074", amount: "₹3,18,000", age: 5, tone: "" },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Outstanding payments</div>
          <div className="card-sub">Top 6 unpaid won quotes</div>
        </div>
        <div className="segment">
          {["age","amount"].map((s) => (
            <button key={s} className={`seg-btn ${sort === s ? "active" : ""}`} onClick={() => setSort(s)}>By {s}</button>
          ))}
        </div>
      </div>
      <div>
        {rows.map((r) => (
          <div className="outs-row" key={r.id}>
            <div className="outs-client">
              <span className="action-icon red"><Icon name="alert" size={12} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="outs-name">{r.client}</div>
                <div className="outs-id">{r.id}</div>
              </div>
            </div>
            <div className="outs-amt">{r.amount}</div>
            <div className={`outs-age ${r.tone}`}>{r.age}d</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------- Leaderboard ----------
const Leaderboard = () => {
  const reps = [
    { rank: 1, av: "r4", name: "Brahmbhatt", role: "Private", earned: "₹24,000", proposed: "₹38,000", pct: 100 },
    { rank: 2, av: "r5", name: "Arvind R.", role: "Govt", earned: "₹15,000", proposed: "₹24,500", pct: 78 },
    { rank: 3, av: "r6", name: "Patel D.", role: "Private", earned: "₹12,500", proposed: "₹19,000", pct: 61 },
    { rank: 4, av: "r2", name: "Sondarva", role: "Private", earned: "₹9,500", proposed: "₹14,200", pct: 48 },
    { rank: 5, av: "r3", name: "Nikhil M.", role: "Private", earned: "₹6,200", proposed: "₹10,500", pct: 32 },
    { rank: 6, av: "r1", name: "Vishnu K.", role: "Govt", earned: "₹3,800", proposed: "₹6,400", pct: 18 },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Team leaderboard · May</div>
          <div className="card-sub">Proposed incentive · earned shown inline</div>
        </div>
        <a className="card-link">Full report <Icon name="arrowRight" size={11} /></a>
      </div>
      <div>
        {reps.map((r) => {
          const cls = r.pct >= 80 ? "" : r.pct >= 50 ? "amber" : "red";
          const rankClass = r.rank <= 3 ? `r${r.rank}` : "";
          const medal = ["", "🥇", "🥈", "🥉"][r.rank] || `${r.rank}`;
          return (
            <div className="lb-row" key={r.rank}>
              <span className={`lb-rank ${rankClass}`}>{r.rank <= 3 ? medal : `#${r.rank}`}</span>
              <div className="lb-name">
                <span className={`rep-avatar ${r.av}`}>{r.name.split(" ").map(n=>n[0]).join("").slice(0,2)}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="lb-name-text">{r.name}</div>
                  <div className="lb-name-role">{r.role} · earned {r.earned}</div>
                </div>
              </div>
              <div className="lb-num">{r.proposed}</div>
              <div className="lb-pct">
                <div className="lb-pct-bar"><span className={cls} style={{ width: `${r.pct}%` }} /></div>
                <span style={{ minWidth: 30, textAlign: "right" }}>{r.pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------- Campaigns ----------
const Campaigns = () => {
  const cards = [
    { name: "Reliance Trends Surat", medium: "Auto-rickshaw · 50 units", rep: "Brahmbhatt", days: 12, total: 30, value: "₹3,20,000", state: "live" },
    { name: "Tata Motors Vadodara", medium: "GSRTC · 8 stations", rep: "Arvind R.", days: 22, total: 45, value: "₹4,80,000", state: "live" },
    { name: "Bisleri Gujarat", medium: "Hoarding · 12 sites", rep: "Sondarva", days: 5, total: 60, value: "₹6,40,000", state: "ending" },
    { name: "Kotak Mahindra", medium: "Auto-rickshaw · 80 units", rep: "Patel D.", days: 18, total: 30, value: "₹2,90,000", state: "live" },
    { name: "Cadbury Dairy Milk", medium: "GSRTC · 14 stations", rep: "Nikhil M.", days: 9, total: 30, value: "₹3,60,000", state: "soon" },
    { name: "Asian Paints Surat", medium: "Hoarding · 6 sites", rep: "Brahmbhatt", days: 4, total: 30, value: "₹1,80,000", state: "ending" },
    { name: "HDFC Life", medium: "Auto-rickshaw · 40 units", rep: "Sondarva", days: 26, total: 30, value: "₹1,60,000", state: "live" },
    { name: "Mahindra Tractors", medium: "GSRTC · 6 stations", rep: "Vishnu K.", days: 14, total: 45, value: "₹2,10,000", state: "live" },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Active campaigns</div>
          <div className="card-sub">Running right now · {cards.length} live</div>
        </div>
        <a className="card-link">Calendar view <Icon name="arrowRight" size={11} /></a>
      </div>
      <div className="campaigns">
        {cards.map((c) => {
          const pct = Math.max(0, Math.min(100, ((c.total - c.days) / c.total) * 100));
          const barCls = c.state === "ending" ? "red" : c.state === "soon" ? "amber" : "";
          return (
            <div className="cmp-card" key={c.name}>
              <div className="cmp-head">
                <span className={`cmp-pill ${c.state}`}>{c.state}</span>
                <span className="cmp-days">{c.days}d left</span>
              </div>
              <div className="cmp-medium">{c.medium}</div>
              <div className="cmp-name">{c.name}</div>
              <div className="cmp-rep">{c.rep}</div>
              <div className="cmp-foot">
                <div className="cmp-amt">{c.value}</div>
              </div>
              <div className="cmp-progress"><span className={barCls} style={{ width: `${pct}%` }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------- Stale Won ----------
const StaleWon = () => {
  const rows = [
    { id: "UA-2025-0901", client: "ABC Clinic, Surat", rep: "Vishnu K.", age: 78, bal: "₹46,87,500", tone: "severe" },
    { id: "UA-2025-0942", client: "Kalap Hospital", rep: "Vishnu K.", age: 72, bal: "₹38,84,000", tone: "severe" },
    { id: "UA-2025-0988", client: "XYZ Corp Pvt Ltd", rep: "Nikhil M.", age: 64, bal: "₹13,15,000", tone: "high" },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Stale won quotes <span className="chip red" style={{ marginLeft: 8 }}>{rows.length}</span></div>
          <div className="card-sub">Won &gt; 60 days, balance still due</div>
        </div>
        <a className="card-link">Send reminders <Icon name="arrowRight" size={11} /></a>
      </div>
      <table className="stale-table">
        <thead><tr><th>Quote</th><th>Client</th><th>Rep</th><th>Age</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="qid">{r.id}</td>
              <td>{r.client}</td>
              <td>{r.rep}</td>
              <td className={`age ${r.tone}`}>{r.age}d</td>
              <td className="bal">{r.bal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ---------- Mini cards row ----------
const MiniRow = () => (
  <div className="mini-grid">
    <div className="card card-pad">
      <div className="card-title">Incentive liability</div>
      <div className="card-sub" style={{ marginTop: 2 }}>Proposed payouts if all close</div>
      <div className="mini-stat-row">
        <span className="num">₹1,12,100</span>
        <span className="pill">0/6 above target</span>
      </div>
      <div className="mini-meta">
        <div className="m"><b>6</b> active staff</div>
        <div className="m"><b>₹71,000</b> earned MTD</div>
        <div className="m"><b>₹41,100</b> projected</div>
      </div>
    </div>
    <div className="card card-pad">
      <div className="card-title">Renewal opportunities</div>
      <div className="card-sub" style={{ marginTop: 2 }}>Campaigns ending in 30 days</div>
      <div className="mini-stat-row">
        <span className="num">4</span>
        <span className="pill" style={{ background: "var(--tint-green-bg)", borderColor: "var(--tint-green-bd)", color: "var(--green)" }}>₹14.6L est. renewal</span>
      </div>
      <div className="mini-meta">
        <div className="m"><b>2</b> already renewed</div>
        <div className="m"><b>1</b> at risk</div>
        <div className="m"><a className="card-link" style={{ color: "var(--accent)" }}>Plan outreach →</a></div>
      </div>
    </div>
  </div>
);

// ---------- Activity ----------
const Activity = () => {
  const items = [
    { t: "won", icon: "check", cls: "green", text: <>Quote marked <b>Won 🎉</b> · <b>Arvin Sir</b> · <span className="mono">UA-2026-0064</span> · Sondarva</>, time: "2h ago" },
    { t: "paid", icon: "coin", cls: "blue", text: <>Payment received <b>₹15,000</b> · <span className="mono">UA-2026-0061</span> · Brahmbhatt</>, time: "4h ago" },
    { t: "sent", icon: "file", cls: "blue", text: <>Quote sent · <b>Reliance Trends</b> · <span className="mono">UA-2026-0078</span> · Patel D.</>, time: "5h ago" },
    { t: "oc", icon: "upload", cls: "purple", text: <>Govt OC uploaded · <b>GSRTC Surat</b> · <span className="mono">UA-2026-0070</span> · Arvind R.</>, time: "6h ago" },
    { t: "follow", icon: "clock", cls: "amber", text: <>Follow-up logged · <b>Kalap Hospital</b> · Vishnu K.</>, time: "8h ago" },
    { t: "won", icon: "check", cls: "green", text: <>Quote marked <b>Won</b> · <b>Asian Paints</b> · <span className="mono">UA-2026-0066</span> · Brahmbhatt</>, time: "11h ago" },
    { t: "paid", icon: "coin", cls: "blue", text: <>Payment received <b>₹71,000</b> · <span className="mono">UA-2026-0058</span> · Arvind R.</>, time: "14h ago" },
    { t: "approve", icon: "check", cls: "green", text: <>Approval granted · <b>Bisleri Gujarat</b> renewal · Brijesh</>, time: "16h ago" },
    { t: "alert", icon: "alert", cls: "red", text: <>Quote went stale · <b>XYZ Corp</b> · <span className="mono">UA-2026-0061</span> · Nikhil M.</>, time: "18h ago" },
    { t: "sent", icon: "file", cls: "blue", text: <>Quote sent · <b>Tata Motors</b> · <span className="mono">UA-2026-0077</span> · Arvind R.</>, time: "22h ago" },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Recent activity</div>
          <div className="card-sub">Last 24 hours · all reps</div>
        </div>
        <a className="card-link">View all <Icon name="arrowRight" size={11} /></a>
      </div>
      <div className="activity">
        {items.map((it, idx) => (
          <div className="act-row" key={idx}>
            <span className={`act-icon ${it.cls}`}><Icon name={it.icon} size={12} /></span>
            <span className="act-text">{it.text}</span>
            <span className="act-time">{it.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------- App ----------
const App = () => {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "theme": "night",
    "segment": "All",
    "showBanner": true,
    "showAI": true,
    "density": "comfortable"
  }/*EDITMODE-END*/;
  const [tweaks, setTweak] = window.useTweaks ? window.useTweaks(TWEAK_DEFAULTS) : [TWEAK_DEFAULTS, () => {}];
  const [active, setActive] = useState("dashboard");

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", tweaks.theme);
  }, [tweaks.theme]);

  const setTheme = (t) => setTweak({ theme: t });
  const setSegment = (s) => setTweak({ segment: s });

  return (
    <div className="app">
      <Sidebar active={active} onChange={setActive} />
      <div>
        <Topbar
          segment={tweaks.segment}
          setSegment={setSegment}
          theme={tweaks.theme}
          setTheme={setTheme}
        />
        <div className="main">
          <div className="greet">
            <div>
              <div className="greet-eyebrow">Good morning</div>
              <div className="greet-name">Brijesh 👋</div>
            </div>
            <div className="greet-meta">Saturday · 2 May 2026 · {tweaks.segment} segment</div>
          </div>

          {tweaks.showAI && <AIBriefing />}
          <Hero />
          {tweaks.showBanner && <Banner />}

          <div className="row two">
            <ActionQueue />
            <TeamToday />
          </div>

          <div className="row two">
            <Pipeline />
            <Trend />
          </div>

          <div className="row two">
            <Outstanding />
            <Leaderboard />
          </div>

          <Campaigns />
          <div style={{ height: 16 }} />
          <StaleWon />
          <div style={{ height: 16 }} />
          <MiniRow />
          <div style={{ height: 16 }} />
          <Activity />

          <div className="foot">
            <span>v2 · admin · 2 May 2026</span>
            <span>build 26.05.02 · adflux dashboard</span>
          </div>
        </div>

        {window.TweaksPanel ? (
          <window.TweaksPanel title="Tweaks">
            <window.TweakSection title="Theme">
              <window.TweakRadio
                label="Mode"
                value={tweaks.theme}
                options={[{ value: "night", label: "Night" }, { value: "day", label: "Day" }]}
                onChange={(v) => setTweak({ theme: v })}
              />
            </window.TweakSection>
            <window.TweakSection title="Filters">
              <window.TweakRadio
                label="Segment"
                value={tweaks.segment}
                options={[
                  { value: "All", label: "All" },
                  { value: "Private", label: "Private" },
                  { value: "Govt", label: "Govt" },
                ]}
                onChange={(v) => setTweak({ segment: v })}
              />
            </window.TweakSection>
            <window.TweakSection title="Sections">
              <window.TweakToggle label="AI briefing" value={tweaks.showAI} onChange={(v) => setTweak({ showAI: v })} />
              <window.TweakToggle label="Missed-target banner" value={tweaks.showBanner} onChange={(v) => setTweak({ showBanner: v })} />
            </window.TweakSection>
          </window.TweaksPanel>
        ) : null}
      </div>
    </div>
  );
};

window.AdfluxApp = App;
