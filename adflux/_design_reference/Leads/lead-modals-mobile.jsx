/* Modals + mobile screens + telecaller + main app */
const { useState: useStateM } = React;

// ───── Log Activity Modal ─────
const LogActivityModal = ({ inline }) => (
  <div className={inline ? "" : "modal-back"}>
    <div className="modal">
      <div className="modal-head">
        <div>
          <div className="modal-title">Log Call</div>
          <div className="card-sub">Dr. Mehta · Sunrise Diagnostics</div>
        </div>
        <button className="btn btn-sm"><window.LIcon n="x" s={14} /></button>
      </div>
      <div className="modal-body">
        <div>
          <div className="fld-label">Outcome</div>
          <div className="radio-grp">
            <span className="opt on pos">Positive</span>
            <span className="opt">Neutral</span>
            <span className="opt">Negative</span>
          </div>
        </div>
        <div>
          <div className="fld-label">Duration (mm:ss)</div>
          <input className="inp" defaultValue="04:12" />
        </div>
        <div>
          <div className="fld-label">Notes</div>
          <textarea className="inp" rows={3} defaultValue="Demo scheduled. Asked for HSN-coded quote, owner is decision-maker."/>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div className="fld-label">Next action</div>
            <input className="inp" defaultValue="Send quote" />
          </div>
          <div>
            <div className="fld-label">Date</div>
            <input className="inp" type="date" defaultValue="2026-05-03" />
          </div>
        </div>
        <div className="pill" style={{ alignSelf: "flex-start" }}><window.LIcon n="map" s={11} /> &nbsp;GPS captured · 23.0225, 72.5714 · ±12m</div>
      </div>
      <div className="modal-foot">
        <button className="btn">Cancel</button>
        <button className="btn btn-primary">Save activity</button>
      </div>
    </div>
  </div>
);

// ───── Change Stage Modal ─────
const ChangeStageModal = () => (
  <div className="modal-back">
    <div className="modal" style={{ width: "min(480px, 100%)" }}>
      <div className="modal-head">
        <div>
          <div className="modal-title">Move stage</div>
          <div className="card-sub">Currently <window.StageChip s="Qualified" /> &nbsp;→ Sales Ready</div>
        </div>
      </div>
      <div className="modal-body">
        <div>
          <div className="fld-label">Target stage</div>
          <select className="inp" defaultValue="SalesReady"><option>SalesReady</option></select>
        </div>
        <div className="lead-card" style={{ background: "var(--surface-2)" }}>
          <div className="lead-card-pad">
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Qualification checklist</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" defaultChecked /> Budget confirmed (₹3.8L)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" defaultChecked /> Timeline confirmed (May)
              </label>
              <div>
                <div className="fld-label">Decision-maker contact</div>
                <input className="inp" defaultValue="Dr. Mehta (owner)" />
              </div>
              <div>
                <div className="fld-label">Service interest</div>
                <input className="inp" defaultValue="Auto Hood — 50 units, Surat city" />
              </div>
              <div>
                <div className="fld-label">Hand off to</div>
                <select className="inp"><option>Brahmbhatt · Surat</option></select>
              </div>
            </div>
          </div>
        </div>
        <div>
          <div className="fld-label">Note (optional)</div>
          <textarea className="inp" rows={2} placeholder="Pooja N. → Brahmbhatt"/>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn">Cancel</button>
        <button className="btn btn-primary">Move to SalesReady</button>
      </div>
    </div>
  </div>
);

// ───── Reassign + Bulk Reassign ─────
const ReassignModal = () => (
  <div className="modal-back">
    <div className="modal">
      <div className="modal-head">
        <div className="modal-title">Reassign lead</div>
      </div>
      <div className="modal-body">
        <div>
          <div className="fld-label">Pick rep</div>
          <select className="inp"><option>Brahmbhatt · Surat (3 active)</option><option>Sondarva · Vadodara</option><option>Patel D. · Surat</option></select>
        </div>
        <div>
          <div className="fld-label">Reason (optional)</div>
          <textarea className="inp" rows={2} placeholder="Brahmbhatt covers Surat"/>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn">Cancel</button>
        <button className="btn btn-primary">Reassign</button>
      </div>
    </div>
  </div>
);
const BulkReassignModal = () => (
  <div className="modal-back">
    <div className="modal">
      <div className="modal-head">
        <div className="modal-title">Bulk reassign · 14 leads</div>
      </div>
      <div className="modal-body">
        <div className="pill pill-warn" style={{ alignSelf: "flex-start" }}>14 leads will be re-routed</div>
        <div>
          <div className="fld-label">From</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><window.Avatar name="Vishnu K" av="r1"/> Vishnu K. · 14 leads</div>
        </div>
        <div>
          <div className="fld-label">To</div>
          <select className="inp"><option>Arvind R. · Govt (12 active)</option></select>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn">Cancel</button>
        <button className="btn btn-primary">Reassign 14</button>
      </div>
    </div>
  </div>
);

// ───── Mobile (Sales /work flow) ─────
const MWorkPlan = () => (
  <div className="m-screen">
    <div className="m-greet">
      <div>
        <div className="hello">Good morning, Brahmbhatt</div>
        <div className="date">Saturday · 02 May</div>
      </div>
      <span className="avatar av-4" style={{ width: 36, height: 36, fontSize: 13 }}>BR</span>
    </div>

    <div className="m-card">
      <div className="m-card-title">Today's plan <span className="pill">Step 1 of 3</span></div>
      <div className="fld-label">Planned meetings</div>
      {[
        ["10:30","Sunrise Diagnostics","Surat · Adajan"],
        ["13:00","Patel Auto Hub","Vadodara"],
        ["16:00","Reliance Trends Surat","Surat · Athwa"],
      ].map((r,i)=>(
        <div key={i} className="m-meeting-row">
          <span className="time">{r[0]}</span>
          <div className="info"><div className="who">{r[1]}</div><div className="where">{r[2]}</div></div>
          <button className="btn btn-sm"><window.LIcon n="x" s={12}/></button>
        </div>
      ))}
      <button className="btn btn-sm" style={{ marginTop: 8 }}><window.LIcon n="plus" s={12}/> Add another</button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
        <div><div className="fld-label">Calls planned</div><input className="inp" defaultValue="20"/></div>
        <div><div className="fld-label">New leads target</div><input className="inp" defaultValue="10"/></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="fld-label">Focus area</div>
        <input className="inp" defaultValue="Close Sunrise · push 2 quotes"/>
      </div>
    </div>

    <button className="m-cta">Submit plan</button>
  </div>
);

const MWorkActive = () => (
  <div className="m-screen">
    <div className="m-greet">
      <div>
        <div className="hello">Day 3 active</div>
        <div className="date">Checked in · 09:14 · Adajan</div>
      </div>
      <span className="pill pill-success">● live</span>
    </div>

    <div className="m-counters">
      <div className="m-count"><div className="num">2<span className="target">/3</span></div><div className="lbl">Meetings</div></div>
      <div className="m-count"><div className="num">11<span className="target">/20</span></div><div className="lbl">Calls</div></div>
      <div className="m-count"><div className="num">4<span className="target">/10</span></div><div className="lbl">New leads</div></div>
    </div>

    <div className="m-quick">
      <div className="tile"><div className="ti"><window.LIcon n="phone" s={16}/></div>Log call</div>
      <div className="tile"><div className="ti"><window.LIcon n="cal" s={16}/></div>Log meet</div>
      <div className="tile"><div className="ti"><window.LIcon n="plus" s={16}/></div>New lead</div>
      <div className="tile"><div className="ti"><window.LIcon n="users" s={16}/></div>My leads</div>
    </div>

    <div className="m-card">
      <div className="m-card-title">Today's meetings</div>
      {[
        { t: "10:30", who: "Sunrise Diagnostics", where: "Surat · Adajan", st: "done" },
        { t: "13:00", who: "Patel Auto Hub", where: "Vadodara", st: "upcoming" },
        { t: "16:00", who: "Reliance Trends", where: "Surat · Athwa", st: "upcoming" },
      ].map((r,i)=>(
        <div key={i} className="m-meeting-row">
          <span className="time">{r.t}</span>
          <div className="info"><div className="who">{r.who}</div><div className="where">{r.where}</div></div>
          {r.st === "done" ? <span className="pill pill-success">✓ done</span> : <button className="btn btn-sm btn-primary">Mark done</button>}
        </div>
      ))}
    </div>

    <button className="m-cta">Submit evening report</button>
    <button className="m-cta m-cta-ghost"><window.LIcon n="map" s={14}/> Check out</button>
  </div>
);

// Sales mobile lead detail
const MLeadDetail = () => (
  <div className="m-screen">
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <window.LIcon n="chev" s={14}/><span style={{ fontSize: 12, color: "var(--text-muted)" }}>Back</span>
    </div>
    <div className="m-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontFamily: "Space Grotesk", fontSize: 20, fontWeight: 600 }}>Dr. Mehta</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Sunrise Diagnostics</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "Space Grotesk", fontSize: 18, fontWeight: 600, color: "var(--accent)" }}>₹3.8L</div>
          <div style={{ fontSize: 10, color: "var(--text-subtle)", letterSpacing: ".12em", textTransform: "uppercase" }}>Expected</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <window.StageChip s="SalesReady" sm/>
        <window.HeatDot h="hot"/>
        <window.SegChip s="Private"/>
        <span className="pill pill-warn" style={{ marginLeft: "auto" }}>3h SLA</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 14 }}>
        {[
          ["phone","Call"],["msg","WA"],["cal","Meet"],["edit","Note"],
        ].map(([i,l])=>(
          <button key={l} className="btn" style={{ flexDirection: "column", padding: "10px 4px", fontSize: 10, gap: 4 }}><window.LIcon n={i} s={16}/>{l}</button>
        ))}
      </div>
      <button className="m-cta">Convert to Quote</button>
    </div>

    <div className="m-card">
      <div className="m-card-title">Activity</div>
      {[
        { i: "phone", c: "blue", t: "Call · 4m 12s · positive", body: "Demo scheduled. Asked for HSN-coded quote.", time: "2h" },
        { i: "msg", c: "blue", t: "WhatsApp sent", body: "Catalog PDF.", time: "5h" },
        { i: "refresh", c: "purple", t: "Stage → SalesReady", body: "BANT confirmed by Pooja N.", time: "1d" },
      ].map((r,i)=>(
        <div className="tl-row" key={i} style={{ padding: "10px 0", borderBottom: i < 2 ? "1px solid var(--border-soft)" : 0 }}>
          <div className={`tl-icon ${r.c}`}><window.LIcon n={r.i} s={12} /></div>
          <div>
            <div className="tl-head"><span className="tl-title" style={{ fontSize: 12 }}>{r.t}</span><span className="tl-time">{r.time}</span></div>
            <div className="tl-body" style={{ fontSize: 11 }}>{r.body}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// Sales mobile complete day
const MWorkDone = () => (
  <div className="m-screen">
    <div className="m-greet">
      <div>
        <div className="hello">Day done. 👏</div>
        <div className="date">Saturday · check-out 19:42</div>
      </div>
    </div>
    <div className="m-counters">
      <div className="m-count"><div className="num" style={{ color: "var(--success)" }}>3<span className="target">/3</span></div><div className="lbl">Meetings ✓</div></div>
      <div className="m-count"><div className="num" style={{ color: "var(--warning)" }}>17<span className="target">/20</span></div><div className="lbl">Calls</div></div>
      <div className="m-count"><div className="num" style={{ color: "var(--success)" }}>11<span className="target">/10</span></div><div className="lbl">Leads ✓</div></div>
    </div>
    <div className="m-card">
      <div className="m-card-title">Evening summary</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        2 quotes sent · ₹6.2L pipeline added · Sunrise Diagnostics likely close next week. Blocker: Bisleri renewal still waiting on Sondarva's site survey.
      </div>
    </div>
    <button className="m-cta m-cta-ghost">View report</button>
  </div>
);

// ───── Telecaller dashboard (desktop) ─────
const TelecallerDash = () => (
  <div className="adm-shell">
    <window.AdminSidebar active="tc"/>
    <div>
      <window.AdminTopbar theme="night" onTheme={()=>{}}/>
      <div className="adm-main">
        <div className="page-head">
          <div>
            <div className="page-eyebrow">Inside-sales · queue</div>
            <div className="page-title">Pooja N.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span className="pill pill-blue">11 calls · today</span>
            <button className="btn btn-primary"><window.LIcon n="plus" s={14}/> New Lead</button>
          </div>
        </div>

        {/* AI briefing slim */}
        <div className="ai-card" style={{ padding: "14px 18px", marginBottom: 16 }}>
          <div className="ai-icon" style={{ width: 36, height: 36 }}><window.LIcon n="spark" s={16}/></div>
          <div>
            <div className="ai-eyebrow"><span className="pulse"/> AI · queue</div>
            <p className="ai-recap" style={{ fontSize: 13 }}>Dr. Mehta is your hottest lead — 18h since last touch, owner picked up yesterday. Call now to keep BANT warm.</p>
          </div>
          <div></div>
        </div>

        {/* Hero call */}
        <div className="tc-hero" style={{ marginBottom: 16 }}>
          <div className="tc-hero-head">
            <div className="tc-big-av">DM<span className="heat" style={{ background: "var(--danger)" }}/></div>
            <div>
              <div className="tc-hero-name">Dr. Mehta</div>
              <div className="tc-hero-co">Sunrise Diagnostics · Private</div>
            </div>
            <div style={{ marginLeft: "auto" }}>
              <window.StageChip s="Qualified"/>
            </div>
          </div>
          <div className="tc-hero-meta">
            <span className="it"><window.LIcon n="phone" s={12}/> +91 98250 11234</span>
            <span className="it"><window.LIcon n="map" s={12}/> Surat</span>
            <span className="it">Source · IndiaMart</span>
            <span className="it" style={{ marginLeft: "auto" }}><window.LIcon n="clock" s={12}/> 18h since last touch</span>
          </div>
          <div className="tc-hero-actions">
            <button className="tc-call-cta"><window.LIcon n="phone" s={16}/> Call now</button>
            <button className="tc-open-ghost">Open lead</button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="stat-strip">
          {[
            { e: "Today's calls", n: "11", m: "target 20" },
            { e: "Qualified today", n: "3", m: "+2 vs avg" },
            { e: "Open queue", n: "47", m: "12 hot · 21 warm" },
            { e: "Pending hand-offs", n: "5", m: "1 overdue" },
          ].map(s => (
            <div className="stat-card" key={s.e}>
              <div className="stat-eyebrow">{s.e}</div>
              <div className="stat-num">{s.n}</div>
              <div className="stat-meta">{s.m}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginTop: 4 }}>
          {/* Hand-offs */}
          <div className="lead-card">
            <div className="lead-card-head">
              <div>
                <div className="card-title">Pending hand-offs</div>
                <div className="card-sub">5 SalesReady · 1 SLA overdue</div>
              </div>
            </div>
            {[
              { name: "Dr. Mehta", co: "Sunrise Diagnostics", rep: "Brahmbhatt", av: "r4", sla: "3h left", tone: "warn" },
              { name: "Rajesh Patel", co: "Patel Auto Hub", rep: "Sondarva", av: "r2", sla: "12h left", tone: "" },
              { name: "GSRTC Surat", co: "Govt", rep: "Arvind R.", av: "r5", sla: "6h left", tone: "warn" },
              { name: "Acme Pharma", co: "Priya Shah", rep: "Patel D.", av: "r6", sla: "18h left", tone: "" },
              { name: "Mehul Joshi", co: "Globex Foods", rep: "Vishnu K.", av: "r1", sla: "Overdue 4h", tone: "danger" },
            ].map((r,i)=>(
              <div key={i} style={{ padding: "12px 18px", borderBottom: "1px solid var(--border-soft)", display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>{r.co}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <window.Avatar name={r.rep} av={r.av}/>
                  <span>{r.rep}</span>
                </div>
                <span className={`pill ${r.tone==="danger"?"pill-danger":r.tone==="warn"?"pill-warn":"pill-success"}`}>{r.sla}</span>
              </div>
            ))}
          </div>

          {/* Queue */}
          <div className="lead-card">
            <div className="lead-card-head">
              <div>
                <div className="card-title">Call queue</div>
                <div className="card-sub">47 in queue · sorted by heat</div>
              </div>
              <span className="card-link">View all <window.LIcon n="arr" s={11}/></span>
            </div>
            {window.LEADS.slice(0, 8).map((l,i) => (
              <div key={l.id} style={{ padding: "10px 18px", display: "grid", gridTemplateColumns: "10px 1fr auto", gap: 10, alignItems: "center", borderBottom: i < 7 ? "1px solid var(--border-soft)" : 0 }}>
                <window.HeatDot h={l.heat}/>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{l.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-subtle)" }}>{l.phone}</div>
                </div>
                <window.StageChip s={l.stage} sm/>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ───── Telecaller mobile (call queue) ─────
const TCMobile = () => (
  <div className="m-screen">
    <div className="m-greet">
      <div>
        <div className="hello">Pooja, 11 calls in</div>
        <div className="date">Saturday · 14:22 IST</div>
      </div>
      <span className="avatar av-6" style={{ width: 36, height: 36, fontSize: 13 }}>PN</span>
    </div>

    <div className="tc-hero" style={{ marginBottom: 14, padding: 16 }}>
      <div className="tc-hero-head">
        <div className="tc-big-av" style={{ width: 48, height: 48, fontSize: 16 }}>DM<span className="heat" style={{ background: "var(--danger)", width: 12, height: 12 }}/></div>
        <div>
          <div className="tc-hero-name" style={{ fontSize: 18 }}>Dr. Mehta</div>
          <div className="tc-hero-co">Sunrise Diagnostics</div>
        </div>
      </div>
      <div className="tc-hero-meta" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="it"><window.LIcon n="phone" s={11}/> +91 98250 11234</span>
        <span className="it"><window.LIcon n="map" s={11}/> Surat</span>
      </div>
      <div className="tc-hero-actions">
        <button className="tc-call-cta"><window.LIcon n="phone" s={16}/> Call now</button>
      </div>
    </div>

    <div className="m-counters">
      <div className="m-count"><div className="num">11<span className="target">/20</span></div><div className="lbl">Calls</div></div>
      <div className="m-count"><div className="num">3</div><div className="lbl">Qualified</div></div>
      <div className="m-count"><div className="num">47</div><div className="lbl">Queue</div></div>
    </div>

    <div className="m-card">
      <div className="m-card-title">Queue · next up</div>
      {window.LEADS.slice(0, 5).map((l,i)=>(
        <div key={l.id} style={{ display: "grid", gridTemplateColumns: "10px 1fr auto", gap: 8, padding: "10px 0", borderBottom: i < 4 ? "1px solid var(--border-soft)" : 0, alignItems: "center" }}>
          <window.HeatDot h={l.heat}/>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>{l.name}</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--text-subtle)" }}>{l.phone}</div>
          </div>
          <window.StageChip s={l.stage} sm/>
        </div>
      ))}
    </div>
  </div>
);

window.LogActivityModal = LogActivityModal;
window.ChangeStageModal = ChangeStageModal;
window.ReassignModal = ReassignModal;
window.BulkReassignModal = BulkReassignModal;
window.MWorkPlan = MWorkPlan;
window.MWorkActive = MWorkActive;
window.MWorkDone = MWorkDone;
window.MLeadDetail = MLeadDetail;
window.TelecallerDash = TelecallerDash;
window.TCMobile = TCMobile;
