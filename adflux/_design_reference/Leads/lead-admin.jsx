/* Admin Lead List + Lead Detail + Create + CSV Import + Modals */
const { useState: useStateA } = React;

// Stat strip
const StatStrip = () => (
  <div className="stat-strip">
    {[
      { e: "Total Leads", n: "247", m: "this month" },
      { e: "Open", n: "142", m: "New + Contacted + Nurture" },
      { e: "Qualified", n: "47", m: "→ rep ready" },
      { e: "Won", n: "32", m: "62% win rate" },
    ].map(s => (
      <div className="stat-card" key={s.e}>
        <div className="stat-eyebrow">{s.e}</div>
        <div className="stat-num">{s.n}</div>
        <div className="stat-meta">{s.m}</div>
      </div>
    ))}
  </div>
);

// AI briefing
const AIBriefingLeads = () => (
  <div className="ai-card">
    <div className="ai-icon"><window.LIcon n="spark" s={20} /></div>
    <div>
      <div className="ai-eyebrow"><span className="pulse" /> AI briefing · leads</div>
      <p className="ai-recap">
        <b>5 hot leads</b> idle &gt; 24h · <b>3 SLA breaches</b> on hand-offs · <b>12 imported</b> from Cronberry overnight, 2 ready to qualify.
      </p>
      <div className="ai-list">
        <div className="ai-item"><span className="heat-dot heat-hot" /><span><b>Dr. Mehta</b> · Sunrise Diagnostics · awaiting rep call-back since yesterday</span><span className="meta">Brahmbhatt</span></div>
        <div className="ai-item"><span className="heat-dot heat-hot" /><span><b>3 SalesReady</b> leads past 24h SLA · Vishnu × 2, Nikhil × 1</span><span className="meta">overdue</span></div>
        <div className="ai-item"><span className="heat-dot heat-warm" /><span>12 stale Cronberry imports auto-Lost overnight</span><span className="meta">cleanup</span></div>
      </div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
      <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>updated 4m ago</span>
      <button className="btn"><span>Open queue</span><window.LIcon n="arr" s={12} /></button>
    </div>
  </div>
);

// Filter row
const FilterRow = () => {
  const [tab, setTab] = useStateA("Open");
  return (
    <div className="filter-row">
      <div className="adm-search filter-search">
        <window.LIcon n="search" s={14} />
        <input placeholder="Name, company, phone, email" />
      </div>
      <div className="filter-tabs">
        {["All","Open","Qualified","Won","Lost"].map(t => (
          <span key={t} className={`filter-tab ${tab===t?"active":""}`} onClick={() => setTab(t)}>{t}</span>
        ))}
      </div>
      <button className="filter-select">Segment: All <window.LIcon n="cd" s={12} /></button>
      <button className="filter-select">Source: Any <window.LIcon n="cd" s={12} /></button>
      <button className="filter-select">City: All <window.LIcon n="cd" s={12} /></button>
      <button className="filter-select">Assigned: Anyone <window.LIcon n="cd" s={12} /></button>
    </div>
  );
};

// Lead row
const LeadRow = ({ l, checked, onCheck }) => (
  <tr>
    <td style={{ width: 32 }}><input type="checkbox" checked={!!checked} onChange={(e)=>onCheck?.(e.target.checked)} /></td>
    <td style={{ width: 18 }}><window.HeatDot h={l.heat} /></td>
    <td>
      <div className="name-cell">
        <div>
          <div className="name">{l.name}</div>
          <div className="company">{l.co}</div>
        </div>
      </div>
    </td>
    <td className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>{l.phone}</td>
    <td><window.StageChip s={l.stage} /></td>
    <td><window.SegChip s={l.seg} /></td>
    <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{l.source}</td>
    <td>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <window.Avatar name={l.assigned} av={l.av} />
        <span style={{ fontSize: 12 }}>{l.assigned}</span>
      </div>
    </td>
    <td className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>{l.last}</td>
    <td className="mono" style={{ fontWeight: 600, fontFamily: "Space Grotesk", textAlign: "right" }}>{l.val}</td>
  </tr>
);

// Lead List screen
const AdminLeadList = ({ withModal }) => {
  const [sel, setSel] = useStateA(new Set([]));
  const toggle = (id) => {
    const s = new Set(sel);
    s.has(id) ? s.delete(id) : s.add(id);
    setSel(s);
  };
  return (
    <div className="adm-shell">
      <window.AdminSidebar active="leads" />
      <div>
        <window.AdminTopbar theme="night" onTheme={()=>{}} />
        <div className="adm-main">
          <div className="page-head">
            <div>
              <div className="page-eyebrow">Pipeline · across all sources</div>
              <div className="page-title">Leads</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn"><window.LIcon n="upload" s={14} /> Upload CSV</button>
              <button className="btn btn-primary"><window.LIcon n="plus" s={14} /> New Lead</button>
            </div>
          </div>
          <AIBriefingLeads />
          <StatStrip />
          <FilterRow />
          <div className="lead-card">
            <table className="lead-table">
              <thead>
                <tr>
                  <th></th><th></th><th>Lead</th><th>Phone</th><th>Stage</th><th>Segment</th><th>Source</th><th>Assigned</th><th>Last</th><th style={{ textAlign:"right" }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {window.LEADS.map(l => <LeadRow key={l.id} l={l} checked={sel.has(l.id)} onCheck={()=>toggle(l.id)} />)}
              </tbody>
            </table>
          </div>
          {sel.size > 0 && (
            <div style={{ position: "sticky", bottom: 12, marginTop: 16, background: "var(--surface)", border: "1px solid var(--accent)", borderRadius: 999, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 24px rgba(0,0,0,.3)" }}>
              <span style={{ fontWeight: 600 }}>{sel.size} selected</span>
              <div style={{ flex: 1 }} />
              <button className="btn btn-sm">Reassign</button>
              <button className="btn btn-sm">Export CSV</button>
              <button className="btn btn-sm" onClick={()=>setSel(new Set())}>Cancel</button>
            </div>
          )}
        </div>
        {withModal}
      </div>
    </div>
  );
};

// Lead Detail
const AdminLeadDetail = ({ withModal }) => (
  <div className="adm-shell">
    <window.AdminSidebar active="leads" />
    <div>
      <window.AdminTopbar theme="night" onTheme={()=>{}} />
      <div className="adm-main">
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 12, marginBottom: 12 }}>
          <window.LIcon n="chev" s={12} /><span>Back to leads</span>
        </div>
        <div className="lead-card lead-card-pad" style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: "Space Grotesk", fontSize: 24, fontWeight: 600 }}>Dr. Mehta</div>
            <div style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 2 }}>Sunrise Diagnostics</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <window.StageChip s="SalesReady" />
              <window.HeatDot h="hot" /> <span style={{ fontSize: 11, color: "var(--text-muted)" }}>HOT</span>
              <window.SegChip s="Private" />
              <span style={{ height: 14, width: 1, background: "var(--border)" }} />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Source · IndiaMart</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· Assigned <b style={{ color: "var(--text)" }}>Brahmbhatt</b> · Surat</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· Telecaller <b style={{ color: "var(--text)" }}>Pooja N.</b></span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· last contact 2h ago</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-subtle)" }}>Expected value</div>
              <div style={{ fontFamily: "Space Grotesk", fontSize: 24, fontWeight: 600, color: "var(--accent)" }}>₹3,80,000</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-sm"><window.LIcon n="phone" s={12} /> Call</button>
              <button className="btn btn-sm"><window.LIcon n="cal" s={12} /> Meeting</button>
              <button className="btn btn-sm"><window.LIcon n="edit" s={12} /> Note</button>
              <button className="btn btn-sm"><window.LIcon n="msg" s={12} /> WA</button>
              <button className="btn btn-sm btn-primary"><window.LIcon n="refresh" s={12} /> Stage</button>
              <button className="btn btn-sm btn-primary"><window.LIcon n="file" s={12} /> Convert</button>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
          {/* Activity */}
          <div className="lead-card">
            <div className="lead-card-head">
              <div>
                <div className="card-title">Activity timeline</div>
                <div className="card-sub">9 entries · last 14 days</div>
              </div>
              <span className="card-link">Filter <window.LIcon n="cd" s={11} /></span>
            </div>
            <div className="timeline">
              {[
                { i: "phone", c: "blue", t: "Call · 4m 12s", o: "pos", body: "Demo scheduled. Asked for HSN-coded quote.", time: "2h", next: "Send quote · 03 May", gps: "23.0225, 72.5714 · ±12m" },
                { i: "msg", c: "blue", t: "WhatsApp template sent", o: null, body: "Catalog PDF + welcome message via Cronberry WABA.", time: "5h" },
                { i: "refresh", c: "purple", t: "Stage moved to SalesReady", o: null, body: "Pooja N. → Brahmbhatt · BANT confirmed (₹3.8L, May, owner contact, Diagnostic Hood)", time: "1d" },
                { i: "phone", c: "blue", t: "Call · 8m 02s", o: "pos", body: "Owner is decision maker. Budget tentatively confirmed.", time: "1d" },
                { i: "edit", c: "amber", t: "Note", o: null, body: "Visited last Diwali, brand-recall driven by competitor's auto-rickshaw campaign.", time: "2d" },
                { i: "phone", c: "blue", t: "Call · No answer", o: "neu", body: "Tried at 11:42, will retry afternoon.", time: "3d" },
                { i: "spark", c: "purple", t: "Imported from IndiaMart", o: null, body: "Auto-created via API connector.", time: "4d" },
              ].map((r, i) => (
                <div className="tl-row" key={i}>
                  <div className={`tl-icon ${r.c}`}><window.LIcon n={r.i} s={14} /></div>
                  <div>
                    <div className="tl-head">
                      <span className="tl-title">{r.t}</span>
                      {r.o ? <span className={`outcome outcome-${r.o}`}>{r.o === "pos" ? "Positive" : r.o === "neu" ? "Neutral" : "Negative"}</span> : null}
                      <span className="tl-time">{r.time} ago</span>
                    </div>
                    <div className="tl-body">{r.body}</div>
                    {r.next ? <div className="tl-next"><window.LIcon n="clock" s={11} /> Next: {r.next}</div> : null}
                    {r.gps ? <div className="tl-gps"><window.LIcon n="map" s={10} /> {r.gps}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Detail panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="lead-card">
              <div className="lead-card-head"><div className="card-title">Lead details</div></div>
              <div className="lead-card-pad" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12 }}>
                {[
                  ["Phone","+91 98250 11234"],["Email","drm@sunrise.in"],["City","Surat"],["Industry","Diagnostics"],
                  ["Sub-industry","Healthcare"],["Source","IndiaMart"],
                ].map(([k,v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 4 }}>{k}</div>
                    <div>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="lead-card">
              <div className="lead-card-head"><div className="card-title">Ownership</div></div>
              <div className="lead-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--text-muted)" }}>Assigned to</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}><window.Avatar name="Brahmbhatt" av="r4" /> Brahmbhatt</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--text-muted)" }}>Telecaller</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}><window.Avatar name="Pooja N" av="r6" /> Pooja N.</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--text-muted)" }}>Hand-off SLA</span>
                  <span className="pill pill-warn">3h left · due 18:00</span>
                </div>
              </div>
            </div>
            <div className="lead-card">
              <div className="lead-card-head"><div className="card-title">Stage history</div></div>
              <div className="lead-card-pad" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                {[
                  ["Created","New","04 Apr"],
                  ["Contacted","Pooja N.","22 Apr"],
                  ["Qualified","Pooja N.","30 Apr"],
                  ["SalesReady","Brahmbhatt","02 May"],
                ].map((r,i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{r[0]}</span>
                    <span style={{ color: "var(--text-muted)" }}>{r[1]} · <span className="mono">{r[2]}</span></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {withModal}
    </div>
  </div>
);

// Lead Create
const AdminLeadCreate = () => (
  <div className="adm-shell">
    <window.AdminSidebar active="leads" />
    <div>
      <window.AdminTopbar theme="night" onTheme={()=>{}} />
      <div className="adm-main" style={{ maxWidth: 760, margin: "0 auto" }}>
        <div className="page-head">
          <div>
            <div className="page-eyebrow">Add to pipeline</div>
            <div className="page-title">New Lead</div>
            <div className="page-sub">30 seconds · all fields can be edited later</div>
          </div>
        </div>

        {[
          { t: "Identity", fields: [
            ["Name *", "e.g. Dr. Mehta"], ["Company", "e.g. Sunrise Diagnostics"],
            ["Phone", "+91 98XXXX XXXXX"], ["Email", "name@company.com"], ["City", "Surat"],
          ]},
          { t: "Classification", custom: (
            <>
              <div><div className="fld-label">Source *</div><select className="inp"><option>IndiaMart</option><option>Justdial</option><option>Cronberry WABA</option><option>Excel Upload</option><option>Manual</option><option>Referral</option><option>Walk-in</option><option>Website</option><option>Other</option></select></div>
              <div>
                <div className="fld-label">Segment *</div>
                <div className="radio-grp">
                  <span className="opt on">Government</span>
                  <span className="opt">Private</span>
                </div>
              </div>
              <div><div className="fld-label">Industry</div><input className="inp" placeholder="e.g. Healthcare" /></div>
            </>
          )},
          { t: "Money & Temperature", custom: (
            <>
              <div><div className="fld-label">Expected value (₹)</div><input className="inp" placeholder="3,80,000" /></div>
              <div>
                <div className="fld-label">Heat</div>
                <div className="radio-grp">
                  <span className="opt">🔥 Hot</span>
                  <span className="opt on">⚡ Warm</span>
                  <span className="opt">❄ Cold</span>
                </div>
              </div>
            </>
          )},
          { t: "Ownership", custom: (
            <>
              <div><div className="fld-label">Assigned to</div><select className="inp"><option>Brahmbhatt</option><option>Sondarva</option><option>Patel D.</option><option>Vishnu K.</option></select></div>
              <div><div className="fld-label">Telecaller</div><select className="inp"><option>Pooja N.</option><option>Asha M.</option><option>Riya P.</option></select></div>
            </>
          )},
        ].map((s, i) => (
          <div className="lead-card" key={i} style={{ marginBottom: 14 }}>
            <div className="lead-card-head"><div className="card-title">{s.t}</div></div>
            <div className="lead-card-pad" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {s.fields ? s.fields.map(([k,p]) => (
                <div key={k}>
                  <div className="fld-label">{k}</div>
                  <input className="inp" placeholder={p} />
                </div>
              )) : s.custom}
            </div>
          </div>
        ))}

        <div className="lead-card lead-card-pad" style={{ marginBottom: 14 }}>
          <div className="fld-label">Notes</div>
          <textarea className="inp" rows={3} placeholder="Visited last Diwali, owner met us at the trade fair…" />
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn">Cancel</button>
          <button className="btn">Save & open</button>
          <button className="btn btn-primary">Save Lead</button>
        </div>
      </div>
    </div>
  </div>
);

// CSV Import
const AdminCSVImport = () => (
  <div className="adm-shell">
    <window.AdminSidebar active="leads" />
    <div>
      <window.AdminTopbar theme="night" onTheme={()=>{}} />
      <div className="adm-main" style={{ maxWidth: 920, margin: "0 auto" }}>
        <div className="page-head">
          <div>
            <div className="page-eyebrow">Bulk import · admin only</div>
            <div className="page-title">Upload CSV</div>
            <div className="page-sub">Cronberry / Excel exports · auto-classifies stage from Remarks</div>
          </div>
        </div>

        {/* Step strip */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18, alignItems: "center" }}>
          {["Pick file","Preview","Map columns","Import"].map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", color: i <= 2 ? "var(--text)" : "var(--text-subtle)" }}>
                <span style={{
                  width: 22, height: 22, borderRadius: "50%",
                  background: i < 2 ? "var(--success)" : i === 2 ? "var(--accent)" : "var(--surface-2)",
                  color: i === 2 ? "var(--accent-ink)" : i < 2 ? "white" : "var(--text-muted)",
                  display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600
                }}>{i < 2 ? "✓" : i + 1}</span>
                <span style={{ fontSize: 12, fontWeight: i === 2 ? 600 : 500 }}>{s}</span>
              </div>
              {i < 3 ? <div style={{ flex: 1, height: 1, background: "var(--border)" }} /> : null}
            </React.Fragment>
          ))}
        </div>

        {/* Step 3 — Map columns active */}
        <div className="lead-card" style={{ marginBottom: 14 }}>
          <div className="lead-card-head">
            <div>
              <div className="card-title">Map columns</div>
              <div className="card-sub"><span className="mono">cronberry-export-may-02.csv</span> · 142 rows</div>
            </div>
            <span className="pill pill-success">5 of 7 auto-mapped</span>
          </div>
          <div style={{ padding: "8px 0" }}>
            {[
              { f: "Name *", c: "Name", auto: true },
              { f: "Phone *", c: "Mobile", auto: true },
              { f: "Email", c: "Email", auto: true },
              { f: "City", c: "City", auto: true },
              { f: "Source", c: "Lead Source", auto: true },
              { f: "Industry", c: "— pick column —", auto: false },
              { f: "Remarks", c: "Notes / Remarks", auto: false },
            ].map((r,i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "180px 1fr 120px", gap: 14, alignItems: "center", padding: "10px 18px", borderBottom: "1px solid var(--border-soft)" }}>
                <span style={{ fontWeight: 500, fontSize: 12 }}>{r.f}</span>
                <select className="inp" defaultValue={r.c}><option>{r.c}</option></select>
                {r.auto ? <span className="pill pill-success">✓ auto-mapped</span> : <span className="pill pill-warn">needs map</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="lead-card" style={{ marginBottom: 14 }}>
          <div className="lead-card-head"><div className="card-title">Import settings</div></div>
          <div className="lead-card-pad" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div className="fld-label">Default segment *</div>
              <div className="radio-grp">
                <span className="opt">Government</span>
                <span className="opt on">Private</span>
              </div>
            </div>
            <div>
              <div className="fld-label">Default source</div>
              <select className="inp"><option>Cronberry WABA</option></select>
            </div>
            <div>
              <div className="fld-label">Stale cutoff (days)</div>
              <input className="inp" defaultValue="90" />
            </div>
            <div>
              <div className="fld-label">Mark stale as Lost</div>
              <div className="radio-grp">
                <span className="opt on">On</span>
                <span className="opt">Off</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn">Back</button>
          <button className="btn btn-primary"><window.LIcon n="upload" s={12} /> Import 142 leads</button>
        </div>
      </div>
    </div>
  </div>
);

window.AdminLeadList = AdminLeadList;
window.AdminLeadDetail = AdminLeadDetail;
window.AdminLeadCreate = AdminLeadCreate;
window.AdminCSVImport = AdminCSVImport;
