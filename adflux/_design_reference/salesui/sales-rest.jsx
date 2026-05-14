/* Sales Module — remaining mobile + desktop screens */

const { useState: useStateD } = React;

// ============================================================
// /voice — listening
// ============================================================
const VoiceListen = () => (
  <window.Screen title="Voice log" on="more">
    <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}>
      <window.SIco n="cleft" s={14}/> Cancel
    </div>

    <window.Hero
      eyebrow="Voice · live · Gujarati"
      value="0:24"
      label="logging for Dr. Mehta · Sunrise"
      accent
      chip="Listening"
    />

    <div className="voice-mic-card">
      <div className="eyebrow" style={{ marginBottom: 12, color: "var(--danger)" }}>Listening · Gujarati</div>
      <div className="voice-mic live"><window.SIco n="mic" s={44}/></div>
      <div className="voice-wave">{[...Array(10)].map((_, i) => <span key={i}/>)}</div>
      <div className="voice-timer">0:24</div>
      <div style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 6 }}>Tap mic to stop</div>
    </div>

    <div className="card transcript-card">
      <div className="eyebrow" style={{ marginBottom: 8 }}>Live transcript</div>
      <div className="guj">મહેતા સાહેબને મળી આવ્યો, ડેમો સેટ થઈ ગયો…</div>
      <div className="en">Met Mehta. Demo scheduled…</div>
    </div>
  </window.Screen>
);

// ============================================================
// /voice — confirm
// ============================================================
const VoiceConfirm = () => (
  <window.Screen title="Confirm log" on="more">
    <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}>
      <window.SIco n="cleft" s={14}/> Re-record
    </div>

    <window.Hero
      eyebrow="Voice · transcribed"
      value="₹3,80,000"
      label="AI extracted · positive outcome · stage SalesReady"
      accent
      chip="0:24 ✓"
    />

    <div className="card transcript-card" style={{ background: "linear-gradient(135deg, rgba(124,58,237,.08), rgba(37,99,235,.06))", borderColor: "var(--tint-purple)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="pill pill-purple"><window.SIco n="check" s={10}/> Transcribed · 0:24</span>
      </div>
      <div className="guj">મહેતા સાહેબને મળી આવ્યો, ડેમો સેટ થઈ ગયો. ₹3.8 લાખનું ક્વોટ મોકલવાનું છે.</div>
      <div className="en">EN · Met Mehta. Demo scheduled. Need to send ₹3.8L quote.</div>
    </div>

    <div className="eyebrow" style={{ margin: "16px 0 8px" }}>AI extracted</div>
    <div className="ai-extract">
      <div className="row">
        <div><div className="k">Outcome</div><div className="v" style={{ color: "var(--success)" }}>Positive</div></div>
        <span className="edit">Edit</span>
      </div>
      <div className="row">
        <div><div className="k">Next action</div><div className="v">Send quote · today</div></div>
        <span className="edit">Edit</span>
      </div>
      <div className="row">
        <div><div className="k">Amount</div><div className="v money">₹3,80,000</div></div>
        <span className="edit">Edit</span>
      </div>
      <div className="row">
        <div><div className="k">Move stage</div><div className="v">SalesReady</div></div>
        <span className="edit">Edit</span>
      </div>
      <div className="row">
        <div><div className="k">GPS</div><div className="v" style={{ fontSize: 12 }}>Surat · Adajan · ±12m</div></div>
      </div>
    </div>

    <button className="primary-action" style={{ marginTop: 16 }}>
      <window.SIco n="check"/> Save & log
    </button>
    <button className="secondary-action" style={{ marginTop: 8 }}>Edit details</button>
  </window.Screen>
);

// ============================================================
// /my-performance
// ============================================================
const Performance = () => {
  const [tab, setTab] = useStateD("Forecast");
  const amounts = { Forecast: "14,550", Pending: "26,000", Earned: "8,400" };
  const subs = {
    Forecast: <>₹65,000 <b>open</b> + ₹26,000 <b>won-not-settled</b></>,
    Pending: <>₹26,000 across <b>4 won quotes</b> awaiting payment</>,
    Earned: <>₹8,400 earned MTD · paid 30 May</>,
  };
  return (
  <window.Screen title="Performance" on="more">
    <window.Hero
      eyebrow="May · day 13 of 22"
      value="64"
      label="/100 · rank 3 of 6 · streak 5 days"
      accent
      chip="+8 vs Apr"
      right={{ text: <>Projected <b>₹38.3K</b></> }}
    />

    {/* Proposed Incentive — re-themed */}
    <div className="inc-card">
      <span className="inc-eyebrow">Proposed incentive</span>
      <div className="inc-tabs">
        {["Forecast","Pending","Earned"].map(x => (
          <span key={x} className={`inc-tab ${tab===x?"on":""}`} onClick={()=>setTab(x)}>{x}</span>
        ))}
      </div>
      <div className="inc-big"><span className="sign">+</span>₹{amounts[tab]}</div>
      <div className="inc-sub">{subs[tab]}</div>
      <button className="inc-cta">Breakdown <window.SIco n="chev" s={11}/></button>
    </div>

    <div className="page-h" style={{ paddingTop: 0 }}>
      <div className="l">
        <div className="t">Salary forecast</div>
        <div className="s">Close 1 more Won → +₹4,200 incentive</div>
      </div>
    </div>

    <div className="card salary-card">
      <div className="eyebrow" style={{ marginBottom: 6 }}>Salary forecast · May</div>
      <div className="salary-row"><span className="k">Base · 70% (score 64)</span><span className="v">₹24,500</span></div>
      <div className="salary-row"><span className="k">Variable · 5 won @ ₹2k</span><span className="v">₹10,000</span></div>
      <div className="salary-row"><span className="k">Slab bonus</span><span className="v">₹3,800</span></div>
      <div className="salary-row total"><span className="k">Projected total</span><span className="v">₹38,300</span></div>
    </div>

    <div className="card card-pad">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Daily targets · this week</div>
      <div className="stats-inline" style={{ borderTop: 0, marginTop: 0, paddingTop: 4 }}>
        <div className="it"><div className="num" style={{ color: "var(--success)" }}>14/15</div><div className="lbl">Meet</div></div>
        <div className="it"><div className="num" style={{ color: "var(--warning)" }}>87/100</div><div className="lbl">Calls</div></div>
        <div className="it"><div className="num" style={{ color: "var(--danger)" }}>3/5</div><div className="lbl">Quotes</div></div>
      </div>
    </div>

    <div className="card chart-card">
      <div className="eyebrow" style={{ marginBottom: 4 }}>Revenue · 6 months</div>
      <div className="bars">
        {[ {m:"Dec",h:38,v:"2.4L"},{m:"Jan",h:54,v:"3.2L"},{m:"Feb",h:62,v:"4.1L"},{m:"Mar",h:46,v:"3.0L"},{m:"Apr",h:72,v:"4.6L"},{m:"May",h:58,v:"3.8L",now:true}
        ].map((b,i) => (
          <div className={`bar ${b.now?"now":""}`} style={{ height: `${b.h}%` }} key={i}>
            <div className="lbl">{b.m}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 18 }}/>
    </div>
  </window.Screen>
  );
};

// ============================================================
// /telecaller (mobile)
// ============================================================
const TelecallerMobile = () => (
  <window.Screen title="Queue" on="today">
    <window.Hero
      eyebrow="Telecaller · Pooja N."
      value="11/20"
      label="calls today · 3 qualified · 47 in queue"
      accent
      chip="5h left"
    />
    <div className="milestones">
      <window.RingMilestone value={11} target={20} lbl="Calls"/>
      <window.RingMilestone value={3} target={5} lbl="Qualified"/>
      <window.RingMilestone value={2} target={5} lbl="Hand-offs"/>
    </div>

    <div className="tc-hero">
      <div className="lbl">Next call</div>
      <div className="num">+91 98250 11234</div>
      <div className="who">Dr. Mehta</div>
      <div className="co">Sunrise Diagnostics · IndiaMart</div>
      <div className="meta">
        <span><window.SIco n="clock" s={11}/> Aging 18h</span>
        <span><window.SIco n="map" s={11}/> Surat</span>
        <span>🔥 Hot</span>
      </div>
      <button className="tc-call"><window.SIco n="phone" s={18}/> Call now</button>
    </div>

    <div className="card">
      <div className="card-head">
        <span className="t">Queue · next 4</span>
        <span className="link">All 47 <window.SIco n="chev" s={12}/></span>
      </div>
      {[
        { n: "Rajesh Patel", co: "Patel Auto Hub", st: "quote", stl: "Negotiating", age: "Aging 12h", hot: true },
        { n: "GSRTC Surat", co: "Govt", st: "working", stl: "Qualified", age: "Aging 8h" },
        { n: "Priya Shah", co: "Acme Pharma", st: "quote", stl: "QuoteSent", age: "Aging 6h", hot: true },
        { n: "Vinod Joshi", co: "Globex Foods", st: "working", stl: "Working", age: "Aging 4h" },
      ].map((r, i) => (
        <div className="lead-row" key={i}>
          {r.hot ? <span className="hot-dot"/> : <span style={{ width: 8 }}/>}
          <div>
            <div className="lname">{r.n} <span className="co">· {r.co}</span></div>
            <div className="lmeta">
              <span className={`stage ${r.st}`}>{r.stl}</span>
              <span>{r.age}</span>
            </div>
          </div>
          <button className="btn-pill primary" style={{ padding: "6px 12px", fontSize: 12 }}><window.SIco n="phone" s={12}/></button>
        </div>
      ))}
    </div>
  </window.Screen>
);

// ============================================================
// /quotes (mobile)
// ============================================================
const QuotesList = () => {
  const [t, setT] = useStateD("Sent");
  const rows = [
    { ref: "UA/PR/2026-27/0078", c: "Sunrise Diagnostics", amt: "₹3,80,000", st: "Draft", date: "today" },
    { ref: "UA/PR/2026-27/0077", c: "Patel Auto Hub", amt: "₹2,40,000", st: "Sent", date: "2d ago" },
    { ref: "UA/AUTO/2026-27/0042", c: "GSRTC Surat", amt: "₹6,40,000", st: "Negotiating", date: "5d ago" },
    { ref: "UA/PR/2026-27/0075", c: "Reliance Trends", amt: "₹3,20,000", st: "Won", date: "1w ago" },
  ];
  return (
    <window.Screen title="Quotes" on="quotes" fab>
      <window.Hero
        eyebrow="Quotes · my pipeline"
        value="₹62L"
        label="23 active · 4 won · 11 awaiting follow-up"
        accent
        chip="3 this week"
      />
      <div className="page-h">
        <div className="l"><div className="t">Quotes</div><div className="s">23 active · ₹62L pipeline</div></div>
      </div>
      <div className="fpills">
        {["All","Draft","Sent","Won","Lost"].map(x => (
          <span key={x} className={`p ${t===x?"on":""}`} onClick={()=>setT(x)}>{x}</span>
        ))}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {rows.map((r, i) => {
          const stCls = r.st === "Won" ? "won" : r.st === "Draft" ? "" : r.st === "Sent" ? "working" : "quote";
          return (
            <div className="q-card" key={i}>
              <div className="top">
                <span className="qref">{r.ref}</span>
                <span className={`stage ${stCls}`}>{r.st}</span>
              </div>
              <div className="client">{r.c}</div>
              <div className="bot">
                <span className="amount">{r.amt}</span>
                <span style={{ fontSize: 12, color: "var(--text-subtle)" }}>{r.date}</span>
              </div>
            </div>
          );
        })}
      </div>
    </window.Screen>
  );
};

// ============================================================
// More menu
// ============================================================
const MoreMenu = () => (
  <window.Screen title="More" on="more">
    <window.Hero
      eyebrow="May · day 13"
      value="64"
      label="score · ₹38.3K projected salary"
      accent
      chip="Rank 3 / 6"
    />
    <div className="page-h">
      <div className="l">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="sm-avatar" style={{ width: 48, height: 48, fontSize: 17 }}>B</div>
          <div>
            <div className="t" style={{ fontSize: 22 }}>Brijesh</div>
            <div className="s">Sales rep · Surat · score 64</div>
          </div>
        </div>
      </div>
    </div>

    <div className="card" style={{ padding: 0 }}>
      {[
        { i: "mic", l: "Voice log", s: "Speak in Gujarati", to: "purple" },
        { i: "target", l: "My performance", s: "Score · salary · streak" },
        { i: "users", l: "Clients", s: "All won clients" },
        { i: "map", l: "TA payouts", s: "GPS-based travel" },
        { i: "cal", l: "Request leave", s: "Plan a day off" },
        { i: "settings", l: "Settings", s: "Theme · profile" },
      ].map((it, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "40px 1fr auto", gap: 12, alignItems: "center", padding: "14px 16px", borderBottom: i < 5 ? "1px solid var(--border-soft)" : 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: it.to === "purple" ? "linear-gradient(135deg, var(--purple), var(--blue))" : "var(--surface-2)", color: it.to === "purple" ? "white" : "var(--text-muted)", display: "grid", placeItems: "center" }}>
            <window.SIco n={it.i} s={18}/>
          </div>
          <div>
            <div style={{ fontWeight: 500, fontSize: 14 }}>{it.l}</div>
            <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>{it.s}</div>
          </div>
          <window.SIco n="chev" s={14}/>
        </div>
      ))}
    </div>
  </window.Screen>
);

// ============================================================
// Desktop /quotes/:id
// ============================================================
const QuoteDetail = () => (
  <div className="sm-root" style={{ background: "var(--bg)", height: "100%", overflowY: "auto" }}>
    <div className="q-shell">
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 13, marginBottom: 14 }}>
        <window.SIco n="cleft" s={14}/> Quotes
      </div>

      <div className="q-head">
        <div>
          <div className="qname">Sunrise Diagnostics</div>
          <div className="qmeta">Private · Surat · Dr. Mehta · drm@sunrise.in</div>
          <div className="qref">UA/PR/2026-27/0078</div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <span className="stage working">Sent</span>
            <span className="pill"><window.SIco n="clock" s={11}/> Sent 2 days ago</span>
            <span className="pill pill-warn">Follow-up Fri</span>
          </div>
        </div>
        <div className="qtotal">
          <div className="l">Grand total</div>
          <div className="v">₹3,80,000</div>
          <div className="q-actions" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="btn-pill"><window.SIco n="msg" s={13}/> WhatsApp</button>
            <button className="btn-pill"><window.SIco n="file" s={13}/> PDF</button>
            <button className="btn-pill success"><window.SIco n="check" s={13}/> Mark Won</button>
          </div>
        </div>
      </div>

      {/* Incentive forecast */}
      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div className="incentive-card">
          <div className="ico"><window.SIco n="spark" s={18}/></div>
          <div>
            <div className="t">If you close this</div>
            <div className="sub">3% private LED slab · paid next month</div>
          </div>
          <div className="v">+₹11,400</div>
        </div>
      </div>

      {/* Items */}
      <div className="q-section">
        <div className="q-section-head">
          <span className="t">Cities · 4 line items</span>
          <button className="btn-pill"><window.SIco n="pen" s={12}/> Edit</button>
        </div>
        <div className="row" style={{ background: "var(--surface-2)", fontWeight: 500, color: "var(--text-muted)", fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase" }}>
          <span>City · Site</span><span>Qty</span><span>Days</span><span style={{ textAlign: "right" }}>Amount</span>
        </div>
        {[
          { c: "Surat · Adajan", q: 4, d: 30, a: "₹1,20,000" },
          { c: "Surat · Athwa", q: 2, d: 30, a: "₹80,000" },
          { c: "Vadodara · Alkapuri", q: 2, d: 30, a: "₹60,000" },
          { c: "Ahmedabad · CG Road", q: 1, d: 30, a: "₹60,000" },
        ].map((r, i) => (
          <div className="row" key={i}>
            <span>{r.c}</span>
            <span className="mono">{r.q}</span>
            <span className="mono">{r.d}</span>
            <span className="money">{r.a}</span>
          </div>
        ))}
        <div className="q-totals">
          <div className="tr"><span>Subtotal</span><span className="money">₹3,20,000</span></div>
          <div className="tr"><span>GST 18%</span><span className="money">₹57,600</span></div>
          <div className="tr"><span>Production charges</span><span className="money">₹2,400</span></div>
          <div className="tr gr"><span>Grand total</span><span className="money">₹3,80,000</span></div>
        </div>
      </div>

      {/* Payments */}
      <div className="q-section">
        <div className="q-section-head">
          <span className="t">Payments</span>
          <button className="btn-pill"><window.SIco n="plus" s={12}/> Log payment</button>
        </div>
        <div style={{ padding: "12px 20px", color: "var(--text-muted)", fontSize: 13 }}>
          No payments yet · advance due on Won
        </div>
      </div>

      {/* Activity */}
      <div className="q-section">
        <div className="q-section-head"><span className="t">Activity</span></div>
        {[
          { i: "msg", c: "blue", t: "Quote sent on WhatsApp", b: "Brijesh · auto-template", time: "2 days" },
          { i: "edit", c: "purple", t: "Quote draft saved", b: "Brijesh · added 4 cities", time: "2 days" },
          { i: "spark", c: "purple", t: "Copied from UA/PR/2026-27/0061", b: "Brijesh", time: "2 days" },
        ].map((r, i) => (
          <div className="act-row" key={i}>
            <div className={`act-ico ${r.c}`}><window.SIco n={r.i} s={12}/></div>
            <div><div className="act-title">{r.t}</div><div className="act-body">{r.b}</div></div>
            <div className="act-time">{r.time}</div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ============================================================
// Desktop quote wizard
// ============================================================
const QuoteWizard = () => (
  <div className="sm-root" style={{ background: "var(--bg)", height: "100%", overflowY: "auto" }}>
    <div className="wizard-shell">
      <div className="wizard-h">
        <div>
          <div className="eyebrow">New quote · Private LED</div>
          <div className="h1" style={{ marginTop: 4 }}>Cities & rates</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-pill">Cancel</button>
          <button className="btn-pill primary"><window.SIco n="check" s={12}/> Save draft</button>
        </div>
      </div>

      <div className="wizard-step-row">
        <div className="wizard-step done"/>
        <div className="wizard-step now"/>
        <div className="wizard-step"/>
        <div className="wizard-step"/>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-subtle)", marginTop: -16, marginBottom: 24 }}>
        <span>1 · Client ✓</span>
        <span style={{ color: "var(--text)" }}>2 · Campaign</span>
        <span>3 · Review</span>
        <span>4 · Send</span>
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Sunrise Diagnostics</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Dr. Mehta · Private · Surat</div>
          </div>
          <span className="pill pill-blue"><window.SIco n="spark" s={11}/> Copied from UA/PR/2026-27/0061</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="t">Cities & rates</span>
          <button className="btn-pill"><window.SIco n="plus" s={12}/> Add city</button>
        </div>
        <div style={{ padding: "0 16px 16px" }}>
          {[
            { c: "Surat · Adajan", rate: "₹1,000", q: 4, d: 30, a: "₹1,20,000" },
            { c: "Surat · Athwa", rate: "₹1,333", q: 2, d: 30, a: "₹80,000" },
            { c: "Vadodara · Alkapuri", rate: "₹1,000", q: 2, d: 30, a: "₹60,000" },
            { c: "Ahmedabad · CG Road", rate: "₹2,000", q: 1, d: 30, a: "₹60,000" },
          ].map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 60px 60px 1fr 30px", gap: 10, alignItems: "center", padding: "12px 0", borderBottom: i < 3 ? "1px solid var(--border-soft)" : 0, fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>{r.c}</span>
              <span className="mono" style={{ color: "var(--text-muted)" }}>{r.rate}/day</span>
              <input className="mono" defaultValue={r.q} style={{ width: 50, padding: 6, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface-2)", color: "var(--text)", textAlign: "center", fontFamily: "JetBrains Mono" }}/>
              <input className="mono" defaultValue={r.d} style={{ width: 50, padding: 6, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface-2)", color: "var(--text)", textAlign: "center", fontFamily: "JetBrains Mono" }}/>
              <span style={{ fontFamily: "Space Grotesk", fontWeight: 600, textAlign: "right" }}>{r.a}</span>
              <button style={{ color: "var(--text-subtle)", padding: 4 }}><window.SIco n="x" s={14}/></button>
            </div>
          ))}
        </div>
        <div style={{ padding: "14px 20px", background: "var(--surface-2)", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontSize: 14 }}>
          <span>Subtotal · 4 cities · 30 days</span>
          <span style={{ fontFamily: "Space Grotesk", fontWeight: 600, fontSize: 18 }}>₹3,20,000</span>
        </div>
      </div>

      <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between" }}>
        <button className="btn-pill"><window.SIco n="cleft" s={12}/> Back</button>
        <button className="btn-pill primary">Next · review <window.SIco n="arrow" s={12}/></button>
      </div>
    </div>
  </div>
);

window.VoiceListen = VoiceListen;
window.VoiceConfirm = VoiceConfirm;
window.Performance = Performance;
window.TelecallerMobile = TelecallerMobile;
window.QuotesList = QuotesList;
window.MoreMenu = MoreMenu;
window.QuoteDetail = QuoteDetail;
window.QuoteWizard = QuoteWizard;
