/* Voice-first redesign: louder Admin lead dashboard + Team dashboard + voice screens */
const { useState: useStateV } = React;

// ───── Voice transcript card (re-usable) ─────
const VoiceCard = ({ guj, en, by, time, dur, tags = [] }) => (
  <div className="voice-card" style={{ marginBottom: 10 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <span className="voice-pill"><span className="mic" /> Voice · Gujarati</span>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{by} · {dur}</span>
      <div className="wave" style={{ marginLeft: "auto" }}>
        {[...Array(8)].map((_, i) => <span key={i} />)}
      </div>
      <span style={{ fontSize: 11, color: "var(--text-subtle)", fontFamily: "JetBrains Mono" }}>{time}</span>
    </div>
    <div className="guj-quote">
      {guj}
      <span className="en">EN · {en}</span>
    </div>
    {tags.length ? (
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {tags.map(t => <span key={t} className="pill" style={{ fontSize: 10 }}>AI · {t}</span>)}
      </div>
    ) : null}
  </div>
);

// ───── Bold Admin Lead Dashboard (replaces old AdminLeadList) ─────
const AdminLeadDash = () => {
  const stages = [
    { k: "s-new", n: 64, t: "New", s: "+12 today" },
    { k: "s-cont", n: 38, t: "Contacted", s: "21 hot" },
    { k: "s-qual", n: 27, t: "Qualified", s: "BANT done" },
    { k: "s-sr", n: 13, t: "SalesReady", s: "5 SLA risk" },
    { k: "s-won", n: 32, t: "Won", s: "₹68L value" },
    { k: "s-lost", n: 73, t: "Lost", s: "auto-closed" },
  ];
  return (
    <div className="adm-shell">
      <window.AdminSidebar active="leads" />
      <div>
        <window.AdminTopbar theme="night" onTheme={()=>{}} />
        <div className="adm-main">
          <div className="page-head">
            <div>
              <div className="page-eyebrow">Lead pipeline · 247 active</div>
              <div className="page-title">Leads</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn"><window.LIcon n="upload" s={14} /> Upload CSV</button>
              <button className="btn"><span className="voice-pill" style={{ padding: "1px 8px" }}><span className="mic"/> Voice search</span></button>
              <button className="btn btn-primary"><window.LIcon n="plus" s={14} /> New Lead</button>
            </div>
          </div>

          {/* Hero strip */}
          <div className="hero-strip">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "rgba(255,255,255,.7)" }}>
                <span style={{ color: "var(--accent)" }}>●</span> &nbsp;PIPELINE PULSE · LIVE
              </div>
              <span className="voice-pill" style={{ background: "rgba(255,255,255,.1)", color: "white", borderColor: "rgba(255,255,255,.2)" }}>
                <span className="mic" /> 23 voice logs today
              </span>
            </div>
            <div className="hero-strip-stats">
              {[
                { l: "Total leads", v: "247", d: "+38 this week", up: true },
                { l: "Hot · idle 24h", v: "5", d: "needs action", down: true, acc: true },
                { l: "SLA breaches", v: "3", d: "Vishnu × 2 · Nikhil × 1", down: true },
                { l: "Pipeline ₹", v: "₹2.1Cr", d: "+18% MoM", up: true },
                { l: "Win rate", v: "62%", d: "vs 54% last mo", up: true },
              ].map(s => (
                <div className="hero-strip-stat" key={s.l}>
                  <div className="lbl">{s.l}</div>
                  <div className={`val ${s.acc ? "acc" : ""}`}>{s.v}</div>
                  <div className={`delta ${s.up ? "up" : s.down ? "down" : ""}`}>{s.d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Stage rail */}
          <div className="stage-rail">
            {stages.map((s, i) => (
              <div className={`stage-col ${s.k}`} key={s.t}>
                <div className="top">{s.t}</div>
                <div className="num">{s.n}</div>
                <div className="sub">{s.s}</div>
                {i < stages.length - 1 ? <span className="arrow"><window.LIcon n="chev" s={14} /></span> : null}
              </div>
            ))}
          </div>

          {/* AI briefing with voice */}
          <div className="ai-card" style={{ marginBottom: 16 }}>
            <div className="ai-icon"><window.LIcon n="spark" s={20}/></div>
            <div>
              <div className="ai-eyebrow"><span className="pulse" /> AI · briefing · today</div>
              <p className="ai-recap">
                <b>5 hot leads</b> idle &gt; 24h · <b>3 SLA breaches</b> · <b>23 voice-logs</b> processed overnight (Gujarati → structured). <b>Brahmbhatt logged 9 calls hands-free</b> while driving Surat → Vadodara.
              </p>
              <div className="ai-list" style={{ marginTop: 6 }}>
                <div className="ai-item"><span className="heat-dot heat-hot"/><span><b>Dr. Mehta</b> · Sunrise · awaiting rep call-back since yesterday</span><span className="meta">Brahmbhatt</span></div>
                <div className="ai-item"><span className="heat-dot heat-hot"/><span><b>3 SalesReady</b> past 24h SLA · auto-reassign suggested</span><span className="meta">act now</span></div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              <span className="voice-pill"><span className="mic"/> Listen briefing</span>
              <button className="btn btn-primary btn-sm">Open queue <window.LIcon n="arr" s={11}/></button>
            </div>
          </div>

          {/* Two-up: voice activity + lead table */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 16 }}>
            <div className="lead-card">
              <div className="lead-card-head">
                <div>
                  <div className="card-title"><span className="voice-pill" style={{ marginRight: 8 }}><span className="mic"/> live</span>Voice activity</div>
                  <div className="card-sub">Reps speaking Gujarati · auto-logged</div>
                </div>
              </div>
              <div className="lead-card-pad" style={{ paddingBottom: 14 }}>
                <VoiceCard
                  guj="Mehta sahebne mali aavyo, demo set thai gayo. ₹3.8 lakh nu quote mokalvaanu chhe."
                  en="Met Mehta, demo set. Need to send ₹3.8L quote."
                  by="Brahmbhatt"
                  time="2m"
                  dur="0:24"
                  tags={["Outcome: Positive", "Next: Send quote", "Stage: SalesReady"]}
                />
                <VoiceCard
                  guj="Patel saheb thodu vichare chhe. Bhaav vadhare lage chhe. Aaver athvaadiya phari milisu."
                  en="Patel hesitant — price seems high. Will meet next week."
                  by="Sondarva"
                  time="14m"
                  dur="0:18"
                  tags={["Outcome: Neutral", "Concern: Price"]}
                />
                <VoiceCard
                  guj="GSRTC depot manager ne file aapi didhi. Bhau rate confirm karva juvai."
                  en="Submitted file to GSRTC. Awaiting rate confirmation."
                  by="Arvind R."
                  time="32m"
                  dur="0:31"
                  tags={["Govt", "Outcome: Positive"]}
                />
              </div>
            </div>
            <div className="lead-card">
              <div className="lead-card-head">
                <div>
                  <div className="card-title">Hot leads · top 6</div>
                  <div className="card-sub">Sorted by heat × SLA risk</div>
                </div>
                <span className="card-link">View all <window.LIcon n="arr" s={11}/></span>
              </div>
              <table className="lead-table">
                <thead>
                  <tr><th></th><th>Lead</th><th>Stage</th><th>Assigned</th><th>Last</th><th style={{ textAlign: "right" }}>Value</th></tr>
                </thead>
                <tbody>
                  {window.LEADS.slice(0, 6).map(l => (
                    <tr key={l.id}>
                      <td style={{ width: 16 }}><window.HeatDot h={l.heat}/></td>
                      <td><div className="name-cell"><div><div className="name">{l.name}</div><div className="company">{l.co}</div></div></div></td>
                      <td><window.StageChip s={l.stage} sm/></td>
                      <td><div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}><window.Avatar name={l.assigned} av={l.av}/><span>{l.assigned}</span></div></td>
                      <td className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{l.last}</td>
                      <td className="mono" style={{ fontWeight: 600, fontFamily: "Space Grotesk", textAlign: "right" }}>{l.val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ───── Team Dashboard ─────
const AdminTeamDash = () => {
  const reps = [
    { id: "BR", name: "Brahmbhatt", role: "Surat · Sr Sales", av: "av-4", live: true, m: [3,3], c: [17,20], q: [4,5], voice: 9, won: "₹6.2L", trend: 100 },
    { id: "AR", name: "Arvind R.", role: "Govt · GSRTC", av: "av-5", live: true, m: [2,3], c: [11,20], q: [2,3], voice: 5, won: "₹4.8L", trend: 80 },
    { id: "PD", name: "Patel D.", role: "Surat · Sales", av: "av-6", live: true, m: [2,2], c: [14,15], q: [3,3], voice: 7, won: "₹3.1L", trend: 95 },
    { id: "SO", name: "Sondarva", role: "Vadodara", av: "av-2", live: false, m: [1,3], c: [8,20], q: [1,3], voice: 3, won: "₹1.4L", trend: 45 },
    { id: "NK", name: "Nikhil M.", role: "Surat · Jr", av: "av-3", live: true, m: [0,2], c: [6,15], q: [0,3], voice: 2, won: "₹0.8L", trend: 30 },
    { id: "VK", name: "Vishnu K.", role: "Govt · AMC", av: "av-1", live: false, m: [0,2], c: [3,15], q: [0,2], voice: 1, won: "₹0.4L", trend: 18 },
  ];
  return (
    <div className="adm-shell">
      <window.AdminSidebar active="team"/>
      <div>
        <window.AdminTopbar theme="night" onTheme={()=>{}}/>
        <div className="adm-main">
          <div className="page-head">
            <div>
              <div className="page-eyebrow">Field force · 6 active reps · live</div>
              <div className="page-title">Team Dashboard</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn"><span className="voice-pill" style={{ padding: "1px 8px" }}><span className="mic"/> 27 voice logs today</span></button>
              <button className="btn btn-primary"><window.LIcon n="users" s={14}/> Reassign queue</button>
            </div>
          </div>

          <div className="hero-strip" style={{ background: "radial-gradient(700px 220px at 100% 0%, rgba(192,132,252,.22), transparent 60%), linear-gradient(120deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%)", borderColor: "#4338ca" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "rgba(255,255,255,.7)" }}>
                <span className="live-dot" /> &nbsp;FIELD ACTIVITY · LIVE
              </div>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,.7)" }}>Saturday · 14:42 IST</span>
            </div>
            <div className="hero-strip-stats">
              {[
                { l: "Reps active now", v: "4 / 6", d: "2 not checked-in", down: true },
                { l: "Calls today", v: "59", d: "target 105", down: true },
                { l: "Voice logs", v: "27", d: "+340% vs old form", up: true, acc: true },
                { l: "New leads added", v: "11", d: "8 from voice", up: true },
                { l: "Pipeline added", v: "₹16.2L", d: "today", up: true },
              ].map(s => (
                <div className="hero-strip-stat" key={s.l}>
                  <div className="lbl">{s.l}</div>
                  <div className={`val ${s.acc ? "acc" : ""}`}>{s.v}</div>
                  <div className={`delta ${s.up ? "up" : s.down ? "down" : ""}`}>{s.d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Rep grid */}
          <div className="team-grid">
            {reps.map(r => {
              const cPct = Math.round(r.c[0] / r.c[1] * 100);
              const cls = cPct >= 80 ? "" : cPct >= 50 ? "warn" : "dng";
              return (
                <div className={`rep-card ${r.live ? "live" : ""}`} key={r.id}>
                  <div className="rep-head">
                    <div className={`rep-big-av ${r.av}`}>{r.id}</div>
                    <div>
                      <div className="rep-name">{r.name}</div>
                      <div className="rep-meta">{r.role}</div>
                    </div>
                    <div className="rep-status">
                      {r.live
                        ? <span className="pill pill-success" style={{ fontSize: 10 }}><span className="live-dot" style={{ marginRight: 5, width: 6, height: 6 }}/> in field</span>
                        : <span className="pill" style={{ fontSize: 10 }}>off</span>}
                    </div>
                  </div>
                  <div className="rep-kpis">
                    <div className="rep-kpi"><div className={`num ${r.m[0]>=r.m[1]?"suc":"dng"}`}>{r.m[0]}/{r.m[1]}</div><div className="lbl">Meet</div></div>
                    <div className="rep-kpi"><div className={`num ${cPct>=80?"suc":cPct>=50?"":"dng"}`}>{r.c[0]}/{r.c[1]}</div><div className="lbl">Calls</div></div>
                    <div className="rep-kpi"><div className="num acc">{r.voice}</div><div className="lbl">Voice</div></div>
                  </div>
                  <div className="rep-progress"><span className={cls} style={{ width: `${r.trend}%` }}/></div>
                  <div className="rep-foot">
                    <window.LIcon n="map" s={11}/>
                    <span>{r.role.split("·")[0].trim()}</span>
                    <span style={{ marginLeft: "auto" }}>Won today: <b style={{ color: "var(--accent)" }}>{r.won}</b></span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ height: 16 }}/>

          {/* Live voice feed */}
          <div className="lead-card">
            <div className="lead-card-head">
              <div>
                <div className="card-title"><span className="voice-pill" style={{ marginRight: 8 }}><span className="mic"/> live</span>Live voice feed · all reps</div>
                <div className="card-sub">27 logs today · auto-translated · auto-classified</div>
              </div>
              <span className="card-link">Filter by rep <window.LIcon n="cd" s={11}/></span>
            </div>
            <div className="lead-card-pad" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <VoiceCard guj="Mehta sahebne mali aavyo, demo set thai gayo. ₹3.8 lakh nu quote mokalvaanu chhe." en="Met Mehta. Demo set. Send ₹3.8L quote." by="Brahmbhatt · Surat" time="2m" dur="0:24" tags={["Positive","Next: Quote"]}/>
              <VoiceCard guj="Patel saheb thodu vichare chhe. Bhaav vadhare lage chhe." en="Patel hesitant — price high." by="Sondarva · Vadodara" time="14m" dur="0:18" tags={["Neutral","Concern: Price"]}/>
              <VoiceCard guj="GSRTC depot ma file aapi didhi, rate confirm karva juvai." en="Submitted GSRTC file. Awaiting rate." by="Arvind R. · Govt" time="32m" dur="0:31" tags={["Govt","Positive"]}/>
              <VoiceCard guj="Bisleri renewal ma site survey baki chhe, Monday e jaisu." en="Bisleri renewal: site survey pending. Monday." by="Patel D. · Surat" time="48m" dur="0:22" tags={["Renewal","Action pending"]}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ───── Voice-log mobile screens ─────
const MVoiceListening = () => (
  <div className="m-screen">
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <window.LIcon n="chev" s={14}/><span style={{ fontSize: 12, color: "var(--text-muted)" }}>Logging call · Dr. Mehta</span>
    </div>
    <div className="voice-card" style={{ textAlign: "center", padding: 18 }}>
      <span className="voice-pill"><span className="mic"/> Listening · Gujarati</span>
      <div className="voice-mic live" style={{ width: 80, height: 80, margin: "20px auto 14px" }}>
        <window.LIcon n="phone" s={32}/>
      </div>
      <div className="wave-big">
        {[...Array(20)].map((_,i)=><span key={i}/>)}
      </div>
      <div style={{ fontFamily: "Space Grotesk", fontSize: 22, fontWeight: 600, color: "var(--purple)" }}>0:24</div>
      <div style={{ fontSize: 11, color: "var(--text-subtle)", marginTop: 4, letterSpacing: ".12em", textTransform: "uppercase" }}>Tap to stop</div>
    </div>

    <div className="m-card" style={{ marginTop: 12 }}>
      <div className="m-card-title">Live transcript</div>
      <div className="guj-quote" style={{ fontSize: 13 }}>
        Mehta sahebne mali aavyo, demo set thai gayo…
        <span className="en">Met Mehta. Demo set…</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>Speak naturally — system understands Gujarati, Hindi, English</div>
    </div>
  </div>
);

const MVoiceConfirm = () => (
  <div className="m-screen">
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <window.LIcon n="chev" s={14}/><span style={{ fontSize: 12, color: "var(--text-muted)" }}>Confirm log · Dr. Mehta</span>
    </div>

    <div className="voice-card" style={{ marginBottom: 12 }}>
      <span className="voice-pill" style={{ marginBottom: 8 }}><window.LIcon n="check" s={11}/> Transcribed · 0:24</span>
      <div className="guj-quote">
        Mehta sahebne mali aavyo, demo set thai gayo. ₹3.8 lakh nu quote mokalvaanu chhe.
        <span className="en">Met Mehta. Demo scheduled. Need to send ₹3.8L quote.</span>
      </div>
    </div>

    <div className="m-card">
      <div className="m-card-title">AI extracted · review</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div className="fld-label">Outcome</div>
          <div className="radio-grp">
            <span className="opt on pos">Positive</span><span className="opt">Neutral</span><span className="opt">Negative</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><div className="fld-label">Next action</div><input className="inp" defaultValue="Send quote"/></div>
          <div><div className="fld-label">Amount</div><input className="inp" defaultValue="₹3,80,000"/></div>
        </div>
        <div><div className="fld-label">Move stage to</div><select className="inp"><option>SalesReady</option></select></div>
        <div className="pill" style={{ alignSelf: "flex-start" }}><window.LIcon n="map" s={11}/> &nbsp;GPS · Surat · Adajan · ±12m</div>
      </div>
    </div>

    <button className="m-cta">Looks good · save log</button>
    <button className="m-cta m-cta-ghost">Re-record</button>
  </div>
);

const MEveningReport = () => (
  <div className="m-screen">
    <div className="m-greet">
      <div>
        <div className="hello">Evening report</div>
        <div className="date">Saturday · 19:42 · check-out</div>
      </div>
      <span className="voice-pill"><span className="mic"/> AI</span>
    </div>

    <div className="voice-card" style={{ marginBottom: 12 }}>
      <span className="voice-pill" style={{ marginBottom: 10 }}><span className="mic"/> Speak summary · 30s</span>
      <div className="voice-mic live" style={{ width: 64, height: 64, margin: "10px auto" }}>
        <window.LIcon n="phone" s={24}/>
      </div>
      <div className="guj-quote">
        Aaje 3 meetings karya, Sunrise close thavaani randami. Bisleri renewal ma site survey Monday e karvi.
        <span className="en">3 meetings today, Sunrise close to closing. Bisleri site survey on Monday.</span>
      </div>
    </div>

    <div className="m-card">
      <div className="m-card-title">AI summary <span className="pill pill-success">approved</span></div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        <b style={{ color: "var(--text)" }}>Highlights:</b> 3 meetings completed · Sunrise Diagnostics → SalesReady · ₹6.2L pipeline added.<br/>
        <b style={{ color: "var(--text)" }}>Blockers:</b> Bisleri renewal site survey pending — scheduled Monday.<br/>
        <b style={{ color: "var(--text)" }}>Tomorrow:</b> Send Sunrise quote · close Patel Auto Hub.
      </div>
    </div>

    <button className="m-cta">Submit report</button>
  </div>
);

window.AdminLeadDash = AdminLeadDash;
window.AdminTeamDash = AdminTeamDash;
window.MVoiceListening = MVoiceListening;
window.MVoiceConfirm = MVoiceConfirm;
window.MEveningReport = MEveningReport;
