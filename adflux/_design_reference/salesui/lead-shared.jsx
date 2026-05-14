/* global React */
const { useState } = React;

// ───── Icons ─────
const LIcon = ({ n, s = 16 }) => {
  const p = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  const P = {
    home: <><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    phone: <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></>,
    mail: <><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></>,
    msg: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
    cal: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
    map: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    refresh: <><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15A9 9 0 0 1 5.64 18.36L1 14"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,
    chev: <><path d="M9 18l6-6-6-6"/></>,
    cd: <><path d="M6 9l6 6 6-6"/></>,
    arr: <><path d="M5 12h14M12 5l7 7-7 7"/></>,
    bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    sun: <><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></>,
    moon: <><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>,
    spark: <><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></>,
    alert: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></>,
    check: <><path d="M20 6L9 17l-5-5"/></>,
    clock: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
    target: <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
    flame: <><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></>,
    x: <><path d="M18 6L6 18M6 6l12 12"/></>,
    layers: <><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></>,
    drag: <><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></>,
    log: <><path d="M9 11l3 3 8-8"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  };
  return <svg {...p}>{P[n]}</svg>;
};

// ───── Stage helpers ─────
const STAGE_NAMES = {
  New: "New", Contacted: "Contacted", Qualified: "Qualified", SalesReady: "Sales Ready",
  MeetingScheduled: "Meeting", QuoteSent: "Quote Sent", Negotiating: "Negotiating",
  Won: "Won", Lost: "Lost", Nurture: "Nurture",
};
const StageChip = ({ s, sm }) => {
  const cls = `stage-chip stage-${s.toLowerCase()}`;
  return (
    <span className={cls} style={sm ? { fontSize: 10, padding: "2px 7px" } : null}>
      {s === "SalesReady" ? <span className="pulse-dot" /> : null}
      {STAGE_NAMES[s] || s}
    </span>
  );
};
const HeatDot = ({ h }) => <span className={`heat-dot heat-${h}`} title={h} />;
const SegChip = ({ s }) => <span className={`seg-chip ${s === "Government" ? "seg-govt" : "seg-priv"}`}>{s === "Government" ? "Govt" : "Private"}</span>;
const Avatar = ({ name, av }) => <span className={`avatar av-${av}`}>{name.split(" ").map(p=>p[0]).join("").slice(0,2)}</span>;

// ───── Mock data ─────
const LEADS = [
  { id: "L-2426", name: "Dr. Mehta", co: "Sunrise Diagnostics", phone: "+91 98250 11234", email: "drm@sunrise.in", city: "Surat", seg: "Private", stage: "SalesReady", heat: "hot", source: "IndiaMart", assigned: "Brahmbhatt", av: "r4", last: "2h ago", val: "₹3,80,000" },
  { id: "L-2425", name: "Rajesh Patel", co: "Patel Auto Hub", phone: "+91 99098 76543", email: "rajesh@patelauto.com", city: "Vadodara", seg: "Private", stage: "Negotiating", heat: "hot", source: "Justdial", assigned: "Sondarva", av: "r2", last: "5h ago", val: "₹2,40,000" },
  { id: "L-2424", name: "GSRTC Surat Div.", co: "Govt of Gujarat", phone: "+91 26123 4500", email: "depot@gsrtc.gov", city: "Surat", seg: "Government", stage: "Qualified", heat: "warm", source: "Referral", assigned: "Arvind R.", av: "r5", last: "1d ago", val: "₹6,40,000" },
  { id: "L-2423", name: "Priya Shah", co: "Acme Pharma", phone: "+91 99999 00012", email: "priya@acme.io", city: "Ahmedabad", seg: "Private", stage: "QuoteSent", heat: "warm", source: "Website", assigned: "Patel D.", av: "r6", last: "3h ago", val: "₹1,20,000" },
  { id: "L-2422", name: "Kalap Hospital", co: "—", phone: "+91 26500 11890", email: "ho@kalap.in", city: "Surat", seg: "Private", stage: "Nurture", heat: "warm", source: "Cronberry WABA", assigned: "Vishnu K.", av: "r1", last: "18d ago", val: "₹4,80,000" },
  { id: "L-2421", name: "Vinod Joshi", co: "Globex Foods", phone: "+91 90909 12121", email: "vj@globex.in", city: "Vadodara", seg: "Private", stage: "Contacted", heat: "warm", source: "IndiaMart", assigned: "Nikhil M.", av: "r3", last: "8h ago", val: "₹2,80,000" },
  { id: "L-2420", name: "AMC Ahmedabad", co: "Surat-AMC", phone: "+91 79123 4567", email: "ads@amc.gov.in", city: "Ahmedabad", seg: "Government", stage: "New", heat: "cold", source: "Walk-in", assigned: "Arvind R.", av: "r5", last: "12h ago", val: "₹5,20,000" },
  { id: "L-2419", name: "Saraswati Group", co: "Saraswati Builders", phone: "+91 99876 12345", email: "ho@saraswati.in", city: "Surat", seg: "Private", stage: "Won", heat: "hot", source: "Referral", assigned: "Brahmbhatt", av: "r4", last: "2d ago", val: "₹8,62,000" },
  { id: "L-2418", name: "Reliance Trends", co: "Reliance Retail", phone: "+91 80800 80800", email: "trends@ril.com", city: "Surat", seg: "Private", stage: "Won", heat: "hot", source: "Website", assigned: "Brahmbhatt", av: "r4", last: "4d ago", val: "₹3,20,000" },
  { id: "L-2417", name: "Bisleri Gujarat", co: "Bisleri Intl", phone: "+91 22222 33333", email: "guj@bisleri.com", city: "Vadodara", seg: "Private", stage: "Lost", heat: "cold", source: "Justdial", assigned: "Sondarva", av: "r2", last: "9d ago", val: "₹6,40,000" },
];

// ───── Sidebar (admin) ─────
const AdminSidebar = ({ active = "leads" }) => {
  const items = [
    { g: "MAIN", e: [
      { id: "dash", l: "Dashboard", i: "home" },
      { id: "leads", l: "Leads", i: "users", b: 47 },
      { id: "quotes", l: "Quotes", i: "file" },
      { id: "clients", l: "Clients", i: "user" },
    ]},
    { g: "PEOPLE", e: [
      { id: "team", l: "Team", i: "users" },
      { id: "tc", l: "Telecallers", i: "phone" },
    ]},
  ];
  return (
    <aside className="adm-side">
      <div className="adm-brand">
        <div className="adm-mark">A</div>
        <div>
          <div className="adm-brand-name">Adflux</div>
          <div className="adm-brand-sub">Lead module</div>
        </div>
      </div>
      {items.map(g => (
        <div className="adm-nav-grp" key={g.g}>
          <div className="adm-nav-lbl">{g.g}</div>
          {g.e.map(it => (
            <a key={it.id} className={`adm-nav-item ${active === it.id ? "active" : ""}`}>
              <LIcon n={it.i} s={16} />
              <span>{it.l}</span>
              {it.b ? <span className="adm-nav-badge">{it.b}</span> : null}
            </a>
          ))}
        </div>
      ))}
      <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
        <a className="adm-nav-item"><LIcon n="settings" /><span>Settings</span></a>
      </div>
    </aside>
  );
};

// ───── Topbar ─────
const AdminTopbar = ({ theme, onTheme }) => (
  <div className="adm-topbar">
    <div className="adm-search">
      <LIcon n="search" s={14} />
      <input placeholder="Search leads, phone, company…" />
    </div>
    <div style={{ flex: 1 }} />
    <button className="btn"><LIcon n="cal" s={14} /> May 2026 <LIcon n="cd" s={12} /></button>
    <button className="btn" onClick={() => onTheme(theme === "night" ? "day" : "night")}>
      <LIcon n={theme === "night" ? "sun" : "moon"} s={14} />
    </button>
    <button className="btn" style={{ position: "relative" }}>
      <LIcon n="bell" s={14} />
      <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, background: "var(--danger)", borderRadius: "50%", border: "2px solid var(--bg)" }} />
    </button>
    <button className="btn" style={{ paddingLeft: 4 }}>
      <span className="avatar av-1">BJ</span>
      <span style={{ paddingRight: 4 }}>Brijesh</span>
    </button>
  </div>
);

window.LIcon = LIcon;
window.StageChip = StageChip;
window.HeatDot = HeatDot;
window.SegChip = SegChip;
window.Avatar = Avatar;
window.LEADS = LEADS;
window.AdminSidebar = AdminSidebar;
window.AdminTopbar = AdminTopbar;
