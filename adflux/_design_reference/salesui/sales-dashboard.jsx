/* Sales Dashboard — icon-led desktop view */
const { useState: useStateSD } = React;

// Sparkline component
const Spark = ({ data, color = "currentColor", w = 120, h = 36 }) => {
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [i * step, h - ((v - min) / range) * (h - 4) - 2]);
  const line = pts.map((p, i) => `${i ? "L" : "M"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
      <path d={area} className="sd-spark-area" fill={color}/>
      <path d={line} className="sd-spark-line" stroke={color}/>
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="3" fill={color}/>
    </svg>
  );
};

// Big ring meter
const BigRing = ({ value, target, color = "var(--success)", size = 84 }) => {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, value / target);
  const off = c * (1 - pct);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} stroke="var(--surface-3)" strokeWidth="8" fill="none"/>
      <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth="8" fill="none"
              strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}/>
    </svg>
  );
};

// KPI tile
const KPI = ({ tone, icon, lbl, val, tg, delta, deltaTone = "up", spark, sparkColor }) => (
  <div className="sd-kpi">
    <div className="sd-kpi-head">
      <div className={`sd-kpi-ico ${tone}`}><window.SIco n={icon} s={20}/></div>
      {delta ? <span className={`sd-kpi-delta ${deltaTone}`}>{delta}</span> : null}
    </div>
    <div className="sd-kpi-lbl">{lbl}</div>
    <div className="sd-kpi-val">{val}{tg ? <span className="tg"> /{tg}</span> : null}</div>
    {spark ? (
      <div className="sd-kpi-spark">
        <Spark data={spark} color={sparkColor}/>
      </div>
    ) : null}
  </div>
);

// ─────────────────────────────────────────────────────────────
// THE DASHBOARD
// ─────────────────────────────────────────────────────────────
const SalesDashboard = () => {
  const [tab, setTab] = useStateSD("Today");
  return (
    <div className="sd-shell" data-screen-label="Sales Dashboard">
      {/* Topbar */}
      <div className="sd-topbar">
        <div className="sd-brand">
          <div className="mark">A</div>
          <div><div className="nm">Adflux</div><div className="sb">Sales</div></div>
        </div>
        <div className="sd-nav">
          <a className="on"><window.SIco n="home" s={14}/> Today</a>
          <a><window.SIco n="users" s={14}/> Leads</a>
          <a><window.SIco n="clock" s={14}/> Follow-ups</a>
          <a><window.SIco n="file" s={14}/> Quotes</a>
          <a><window.SIco n="target" s={14}/> Performance</a>
          <a><window.SIco n="mic" s={14}/> Voice</a>
        </div>
        <div className="sd-search">
          <window.SIco n="search" s={14}/>
          <input placeholder="Search leads, quotes, refs…"/>
          <kbd>⌘K</kbd>
        </div>
        <button className="sd-iconbtn"><window.SIco n="bell" s={16}/><span className="dot"/></button>
        <button className="sd-iconbtn"><window.SIco n="settings" s={16}/></button>
      </div>

      <div className="sd-main">
        {/* Hero */}
        <div className="sd-hero">
          <div className="sd-hero-left">
            <div className="sd-hero-av">BR</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "rgba(255,255,255,.6)" }}>Good afternoon</div>
              <div className="sd-hero-name">Brahmbhatt · day 3 live</div>
              <div className="sd-hero-meta">
                <span><span className="live-d"/> &nbsp;in field · 5h 42m left</span>
                <span className="pill"><window.SIco n="map" s={11}/> &nbsp;Adajan, Surat</span>
                <span className="pill"><window.SIco n="flame" s={11}/> &nbsp;Streak · 5 days</span>
              </div>
              <div className="sd-hero-actions">
                <button className="sd-hero-btn primary"><window.SIco n="cal" s={13}/> Log meeting</button>
                <button className="sd-hero-btn"><window.SIco n="mic" s={13}/> Voice log · Gujarati</button>
                <button className="sd-hero-btn"><window.SIco n="plus" s={13}/> New lead</button>
              </div>
            </div>
          </div>
          <div className="sd-hero-right">
            <div className="sd-hero-stat">
              <div className="l">Today added</div>
              <div className="v acc">₹3.8L</div>
              <div className="d up">+₹1.2L vs avg</div>
            </div>
            <div className="sd-hero-stat">
              <div className="l">May score</div>
              <div className="v">64<span style={{ opacity: .5, fontSize: 18 }}> /100</span></div>
              <div className="d up">+8 vs Apr · rank 3 / 6</div>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="sd-kpis">
          <KPI tone="blue" icon="phone" lbl="Calls today" val="11" tg="20" delta="+3" spark={[5,7,4,8,11,9,11]} sparkColor="var(--blue)"/>
          <KPI tone="purple" icon="cal" lbl="Meetings today" val="1" tg="3" delta="-1" deltaTone="down" spark={[2,1,3,2,1,2,1]} sparkColor="var(--purple)"/>
          <KPI tone="green" icon="money" lbl="Pipeline added" val="₹3.8L" delta="+18%" spark={[1.2,2.1,1.8,2.6,3.2,2.9,3.8]} sparkColor="var(--success)"/>
          <KPI tone="yellow" icon="file" lbl="Quotes sent" val="1" tg="2" delta="on pace" deltaTone="flat" spark={[0,1,0,1,1,0,1]} sparkColor="var(--accent)"/>
        </div>

        {/* Row: plan + rings + voice */}
        <div className="sd-row cols-3">
          {/* Today's plan */}
          <div className="sd-card">
            <div className="sd-cd-head">
              <div className="t"><div className="ic"><window.SIco n="map" s={14}/></div> Today's route · 4 stops</div>
              <a className="link">Open in maps <window.SIco n="arrow" s={11}/></a>
            </div>
            <div className="sd-plan">
              <div className="sd-stop">
                <div className="sd-stop-pin done"><window.SIco n="check" s={18}/><span className="step">1</span></div>
                <div>
                  <div className="nm" style={{ textDecoration: "line-through", color: "var(--text-muted)" }}>Sunrise Diagnostics</div>
                  <div className="sb">Dr. Mehta · Adajan <span className="seg">Private</span></div>
                </div>
                <div className="v" style={{ color: "var(--success)" }}>₹3.8L</div>
                <div className="t">10:30 ✓</div>
              </div>
              <div className="sd-stop">
                <div className="sd-stop-pin now"><window.SIco n="map" s={18}/><span className="step">2</span></div>
                <div>
                  <div className="nm">Patel Auto Hub</div>
                  <div className="sb">Rajesh Patel · Vadodara · 18 km <span className="seg">Private</span></div>
                </div>
                <div className="v">₹2.4L</div>
                <div className="t now">in 34m</div>
              </div>
              <div className="sd-stop">
                <div className="sd-stop-pin next"><window.SIco n="map" s={18}/><span className="step">3</span></div>
                <div>
                  <div className="nm">Reliance Trends Surat</div>
                  <div className="sb">Athwa · close visit <span className="seg" style={{ background: "var(--tint-success)", color: "var(--success)" }}>Hot</span></div>
                </div>
                <div className="v">₹3.2L</div>
                <div className="t">16:00</div>
              </div>
              <div className="sd-stop">
                <div className="sd-stop-pin late"><window.SIco n="alert" s={18}/><span className="step">4</span></div>
                <div>
                  <div className="nm">Bisleri Gujarat · renewal</div>
                  <div className="sb">Site survey overdue 2d <span className="seg" style={{ background: "var(--tint-danger)", color: "var(--danger)" }}>SLA risk</span></div>
                </div>
                <div className="v">₹6.4L</div>
                <div className="t late">17:30</div>
              </div>
            </div>
          </div>

          {/* Daily milestones */}
          <div className="sd-card sd-ring-card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="t" style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <div className="ic" style={{ width: 28, height: 28, borderRadius: 8, background: "var(--tint-warning)", color: "var(--warning)", display: "grid", placeItems: "center" }}>
                  <window.SIco n="target" s={14}/>
                </div>
                Daily milestones
              </div>
              <span className="sb" style={{ fontSize: 11, color: "var(--text-subtle)" }}>5h 42m left</span>
            </div>
            <div className="sd-ring-grid">
              {[
                { v: 3, t: 5, lbl: "Visits", ic: "map", color: "var(--success)" },
                { v: 5, t: 10, lbl: "Leads", ic: "users", color: "var(--accent)" },
                { v: 3, t: 20, lbl: "Follow-ups", ic: "clock", color: "var(--danger)" },
              ].map((r, i) => {
                const pct = Math.round(r.v / r.t * 100);
                const done = r.v >= r.t;
                return (
                  <div key={i} className={`sd-ring ${done ? "done" : ""}`}>
                    <div className="wrap">
                      <BigRing value={r.v} target={r.t} color={r.color}/>
                      <div className="num">{r.v}<span className="tg">/{r.t}</span></div>
                    </div>
                    <div className="lbl"><span className="ic"><window.SIco n={r.ic} s={11}/></span> {r.lbl}</div>
                    <div className="pct">{pct}%</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="pill pill-warn" style={{ justifyContent: "center", padding: 8 }}><window.SIco n="clock" s={11}/> 14 follow-ups left</div>
              <div className="pill pill-success" style={{ justifyContent: "center", padding: 8 }}><window.SIco n="check" s={11}/> 60% Visits</div>
            </div>
          </div>

          {/* Voice quick */}
          <div className="sd-voice-card">
            <div className="sd-voice-head">
              <div className="ic"><window.SIco n="mic" s={18}/></div>
              <div>
                <div className="ttl">Voice · last log</div>
                <div className="sb">Brahmbhatt · 12 min ago</div>
              </div>
            </div>
            <div className="sd-voice-quote">
              મહેતા સાહેબને મળી આવ્યો, ડેમો સેટ થઈ ગયો. ₹3.8 લાખનું ક્વોટ મોકલવાનું છે.
              <span className="en">Met Mehta. Demo scheduled. Send ₹3.8L quote.</span>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <span className="pill pill-success" style={{ fontSize: 10 }}>Positive</span>
              <span className="pill pill-blue" style={{ fontSize: 10 }}>Next: Quote</span>
              <span className="pill" style={{ fontSize: 10 }}>SalesReady</span>
            </div>
            <button className="sd-voice-cta"><window.SIco n="mic" s={14}/> Log another call</button>
          </div>
        </div>

        {/* Up next leads */}
        <div className="sd-card" style={{ marginBottom: 14 }}>
          <div className="sd-cd-head">
            <div className="t"><div className="ic"><window.SIco n="flame" s={14}/></div> Hot leads · act now</div>
            <a className="link">View all 5 <window.SIco n="arrow" s={11}/></a>
          </div>
          <div className="sd-up-grid">
            {[
              { n: "Dr. Mehta", co: "Sunrise Diagnostics", v: "₹3.8L", ic: "phone", tone: "blue", st: "SalesReady" },
              { n: "Rajesh Patel", co: "Patel Auto Hub", v: "₹2.4L", ic: "msg", tone: "green", st: "Negotiating" },
              { n: "Priya Shah", co: "Acme Pharma", v: "₹1.2L", ic: "phone", tone: "amber", st: "QuoteSent" },
            ].map((r, i) => (
              <div className="sd-up-card" key={i}>
                <div className="sd-up-head">
                  <div className={`ic sd-feed-ico ${r.tone}`}><window.SIco n={r.ic} s={14}/></div>
                  <span className="pill" style={{ fontSize: 10 }}>{r.st}</span>
                </div>
                <div className="nm">{r.n}</div>
                <div className="co">{r.co}</div>
                <div className="foot">
                  <span className="v">{r.v}</span>
                  <button className="pill pill-success" style={{ fontSize: 11, padding: "4px 10px" }}><window.SIco n={r.ic} s={11}/> {r.ic === "phone" ? "Call" : "Reply"}</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Row: Activity feed + Leaderboard */}
        <div className="sd-row cols-2">
          <div className="sd-card">
            <div className="sd-cd-head">
              <div className="t"><div className="ic"><window.SIco n="spark" s={14}/></div> Live activity</div>
              <a className="link">All reps <window.SIco n="cdown" s={11}/></a>
            </div>
            {[
              { ic: "phone", tone: "blue", who: "Brahmbhatt", at: "called Dr. Mehta", body: <><span className="tag">positive</span><span className="tag">SalesReady</span> Owner is decision maker. Demo scheduled.</>, tt: "2m" },
              { ic: "mic", tone: "purple", who: "Sondarva", at: "voice-logged", body: <><span className="tag">neutral</span><span className="tag">concern: price</span> Patel sahebne thoda vichare chhe…</>, tt: "12m" },
              { ic: "file", tone: "amber", who: "Arvind R.", at: "submitted GSRTC file", body: <><span className="tag">govt</span><span className="tag">awaiting rate</span> Depot manager has documents.</>, tt: "32m" },
              { ic: "check", tone: "green", who: "Patel D.", at: "marked Won", body: <><span className="tag">+₹3.2L</span><span className="tag">paid 30%</span> Reliance Trends signed off.</>, tt: "45m" },
              { ic: "alert", tone: "red", who: "Vishnu K.", at: "SLA breach", body: <><span className="tag">overdue 4h</span> Mehul Joshi awaiting first call.</>, tt: "1h" },
              { ic: "refresh", tone: "purple", who: "Pooja N.", at: "qualified lead", body: <><span className="tag">SalesReady</span> Acme Pharma → Patel D.</>, tt: "1h" },
              { ic: "msg", tone: "blue", who: "Brahmbhatt", at: "WhatsApp template", body: <><span className="tag">catalog</span> Sent to Sunrise Diagnostics.</>, tt: "2h" },
            ].map((r, i) => (
              <div className="sd-feed-row" key={i}>
                <div className={`sd-feed-ico ${r.tone}`}><window.SIco n={r.ic} s={14}/></div>
                <div>
                  <div className="who">{r.who} <span className="at">{r.at}</span></div>
                  <div className="body">{r.body}</div>
                </div>
                <div className="tt">{r.tt}</div>
              </div>
            ))}
          </div>

          {/* Leaderboard */}
          <div className="sd-card">
            <div className="sd-cd-head">
              <div className="t"><div className="ic"><window.SIco n="target" s={14}/></div> Team · May</div>
              <a className="link">Report <window.SIco n="arrow" s={11}/></a>
            </div>
            {[
              { r: 1, av: "av-4", nm: "Brahmbhatt", rl: "Surat · Sr", v: "₹24K", pct: 100 },
              { r: 2, av: "av-5", nm: "Arvind R.", rl: "Govt", v: "₹15K", pct: 78 },
              { r: 3, av: "av-6", nm: "Patel D.", rl: "Surat", v: "₹12.5K", pct: 61 },
              { r: 4, av: "av-2", nm: "Sondarva", rl: "Vadodara", v: "₹9.5K", pct: 48 },
              { r: 5, av: "av-3", nm: "Nikhil M.", rl: "Surat · Jr", v: "₹6.2K", pct: 32 },
              { r: 6, av: "av-1", nm: "Vishnu K.", rl: "Govt", v: "₹3.8K", pct: 18 },
            ].map(r => {
              const cls = r.pct >= 80 ? "" : r.pct >= 50 ? "warn" : "red";
              return (
                <div className="sd-lb-row" key={r.r}>
                  <span className={`sd-lb-rank ${r.r <= 3 ? `r${r.r}` : ""}`}>{r.r <= 3 ? ["🥇","🥈","🥉"][r.r-1] : r.r}</span>
                  <div className="sd-lb-who">
                    <span className={`sd-lb-av ${r.av}`}>{r.nm.split(" ").map(n=>n[0]).join("").slice(0,2)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="sd-lb-nm">{r.nm}</div>
                      <div className="sd-lb-rl">{r.rl}</div>
                    </div>
                  </div>
                  <div className="sd-lb-num">{r.v}</div>
                  <div className="sd-lb-bar">
                    <div className="track"><span className={cls} style={{ width: `${r.pct}%` }}/></div>
                    <span style={{ width: 30, textAlign: "right" }}>{r.pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Funnel */}
        <div className="sd-card">
          <div className="sd-cd-head">
            <div className="t"><div className="ic"><window.SIco n="users" s={14}/></div> Pipeline funnel · all-time</div>
            <a className="link">Filter by rep <window.SIco n="cdown" s={11}/></a>
          </div>
          <div className="sd-funnel">
            {[
              { ic: "users", t: "var(--text-muted)", b: "var(--text-subtle)", nm: "New", sb: "imports + manual", w: 100, c: 247, v: "₹6.8Cr", pct: "—" },
              { ic: "phone", t: "var(--blue)", b: "var(--blue)", nm: "Working", sb: "first contact made", w: 62, c: 152, v: "₹4.2Cr", pct: "62%" },
              { ic: "file", t: "var(--warning)", b: "var(--warning)", nm: "Quote Sent", sb: "proposal out", w: 38, c: 94, v: "₹2.6Cr", pct: "38%" },
              { ic: "spark", t: "var(--purple)", b: "var(--purple)", nm: "Nurture", sb: "follow + revisit", w: 22, c: 53, v: "₹1.4Cr", pct: "22%" },
              { ic: "check", t: "var(--success)", b: "var(--success)", nm: "Won", sb: "62% win rate", w: 13, c: 32, v: "₹68L", pct: "13%" },
              { ic: "x", t: "var(--danger)", b: "var(--danger)", nm: "Lost", sb: "auto-closed + manual", w: 18, c: 44, v: "₹52L", pct: "18%" },
            ].map((r, i) => (
              <div className="sd-funnel-row" key={i}>
                <div className="ic" style={{ background: `color-mix(in oklab, ${r.t} 14%, transparent)`, color: r.t }}>
                  <window.SIco n={r.ic} s={14}/>
                </div>
                <div>
                  <div className="nm">{r.nm}<span className="sb">· {r.sb}</span></div>
                  <div className="bar" style={{ marginTop: 6 }}><span style={{ width: `${r.w}%`, background: r.b }}/></div>
                </div>
                <div className="cnt">{r.c}</div>
                <div className="val">{r.v}</div>
                <div className="pct">{r.pct}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

window.SalesDashboard = SalesDashboard;
