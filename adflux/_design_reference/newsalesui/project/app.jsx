// Sales Dashboard — mobile (dark)
// Fonts
const F = {
  sans: "'DM Sans', -apple-system, system-ui, sans-serif",
  display: "'Space Grotesk', -apple-system, system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
};

// Tokens
const T = {
  bg: '#0A0E18',
  surface: '#141A28',
  surface2: '#1B2233',
  hairline: 'rgba(255,255,255,0.06)',
  line: 'rgba(255,255,255,0.09)',
  text: '#F5F7FA',
  muted: 'rgba(245,247,250,0.62)',
  dim: 'rgba(245,247,250,0.42)',
  yellow: '#F5D90A',
  yellowSoft: 'rgba(245,217,10,0.14)',
  green: '#2BD8A0',
  greenSoft: 'rgba(43,216,160,0.14)',
  blue: '#5AB0FF',
  blueSoft: 'rgba(90,176,255,0.14)',
  red: '#FF6F61',
  redSoft: 'rgba(255,111,97,0.14)',
  orange: '#FFB152',
  orangeSoft: 'rgba(255,177,82,0.14)',
  purple: '#A88BFF',
  purpleSoft: 'rgba(168,139,255,0.14)',
};

// ── Icons (line, 1.6 stroke, currentColor) ──────────────────────────────
const Ico = {
  menu: (s=22)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>),
  bell: (s=22)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2H4.5L6 16Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M10 21a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>),
  moon: (s=22)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M20 15.5A8 8 0 1 1 8.5 4a6.5 6.5 0 0 0 11.5 11.5Z" fill="#F5D90A"/></svg>),
  clock: (s=20)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6"/><path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>),
  doc: (s=20)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13.5 3.5V8h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9 13h6M9 16.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>),
  rupee: (s=20)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M7 5h10M7 9h10M9 5c3 0 4.5 1.5 4.5 4S12 13 9 13H8l7 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  cal: (s=20)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="4" y="5.5" width="16" height="14.5" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M4 10h16M8 3.5v4M16 3.5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>),
  calClock: (s=20)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M3.5 10h13M7.5 3.5v4M13 3.5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="17.5" cy="16.5" r="4" fill={T.surface} stroke="currentColor" strokeWidth="1.6"/><path d="M17.5 14.5v2l1.3 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>),
  refresh: (s=20)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M4 11a8 8 0 0 1 14-5l2 2M20 5v4h-4M20 13a8 8 0 0 1-14 5l-2-2M4 19v-4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  phone: (s=18)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M5 5.5a2 2 0 0 1 2-2h1.8a1 1 0 0 1 .97.76l.9 3.6a1 1 0 0 1-.5 1.13L8.5 10.2a12 12 0 0 0 5.3 5.3l1.2-1.67a1 1 0 0 1 1.13-.5l3.6.9a1 1 0 0 1 .76.97V17a2 2 0 0 1-2 2A15 15 0 0 1 5 5.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>),
  plus: (s=18)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>),
  spark: (s=16)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" fill="currentColor"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" fill="currentColor"/></svg>),
  mic: (s=18)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.7"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>),
  play: (s=16)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M7 5l11 7-11 7V5Z" fill="currentColor"/></svg>),
  pin: (s=18)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 1 1 13 0c0 5-6.5 11-6.5 11Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6"/></svg>),
  chevron: (s=18)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  arrowDownRight: (s=16)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 9v8h-8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  arrowRight: (s=14)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  close: (s=14)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>),
  check: (s=14)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4 4 10-10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  inbox: (s=22)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M4 13l2.5-7a1 1 0 0 1 1-.7h9a1 1 0 0 1 1 .7L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M4 13h4l1.5 2.5h5L16 13h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>),
  list: (s=22)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/></svg>),
  sun: (s=22)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>),
  arrow: (s=22)=>(<svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M5 12l4-4M5 12l4 4M5 12h13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>),
};

// ── Reusable bits ─────────────────────────────────────────────────────
function Pill({ children, active, bg, fg, style }) {
  return (
    <div style={{
      height: 28, padding: '0 12px', borderRadius: 999,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 12, fontWeight: 600, letterSpacing: 0.2,
      background: active ? '#fff' : (bg || 'transparent'),
      color: active ? '#3B1A66' : (fg || 'rgba(255,255,255,0.78)'),
      ...style,
    }}>{children}</div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: T.surface, borderRadius: 22, padding: 18,
      border: `1px solid ${T.hairline}`, ...style,
    }}>{children}</div>
  );
}

// ── Header ────────────────────────────────────────────────────────────
function Header() {
  return (
    <div style={{
      padding: '8px 20px 14px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <button style={{
        width: 40, height: 40, borderRadius: 12, background: T.surface,
        border: `1px solid ${T.hairline}`, color: T.text,
        display: 'grid', placeItems: 'center', cursor: 'pointer',
      }}>{Ico.menu(20)}</button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: F.mono, fontSize: 10.5, color: T.dim, fontWeight: 500, letterSpacing: 0.6, textTransform: 'uppercase' }}>TUE · 16 MAY</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontFamily: F.display, fontSize: 22, fontWeight: 600, color: T.text, letterSpacing: -0.4 }}>Good evening, RR</div>
            {Ico.moon(18)}
          </div>
        </div>
      </div>
      <button style={{
        position: 'relative', width: 40, height: 40, borderRadius: 12,
        background: T.surface, border: `1px solid ${T.hairline}`, color: T.text,
        display: 'grid', placeItems: 'center', cursor: 'pointer',
      }}>
        {Ico.bell(20)}
        <div style={{
          position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, padding: '0 5px',
          borderRadius: 999, background: T.yellow, color: '#1A1300',
          fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center',
          border: `2px solid ${T.bg}`,
        }}>6</div>
      </button>
    </div>
  );
}

// ── Incentive (purple) ────────────────────────────────────────────────
function Incentive() {
  const tabs = ['Forecast', 'Pending', 'Earned'];
  const [active, setActive] = React.useState('Forecast');
  return (
    <div style={{
      borderRadius: 22, padding: 20, margin: '0 20px',
      background: 'radial-gradient(120% 140% at 100% 0%, #E36BD6 0%, #A656E8 40%, #6A35C9 100%)',
      position: 'relative', overflow: 'hidden',
      boxShadow: '0 18px 40px -18px rgba(150, 80, 230, 0.55)',
    }}>
      {/* sheen */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 50% at 10% 0%, rgba(255,255,255,0.18), transparent 60%)', pointerEvents: 'none' }}/>
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,0.78)', textTransform: 'uppercase' }}>Proposed Incentive</div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#FFD89A',
            background: 'rgba(255,255,255,0.12)', padding: '4px 9px', borderRadius: 999,
          }}>{Ico.spark(12)} On track</div>
        </div>

        {/* segmented tabs */}
        <div style={{
          marginTop: 14, padding: 3, borderRadius: 999, display: 'flex',
          background: 'rgba(0,0,0,0.18)',
        }}>
          {tabs.map(t => {
            const a = active === t;
            return (
              <button key={t} onClick={() => setActive(t)} style={{
                flex: 1, height: 30, borderRadius: 999, border: 0, cursor: 'pointer',
                fontSize: 12.5, fontWeight: 700,
                background: a ? '#fff' : 'transparent',
                color: a ? '#3B1A66' : 'rgba(255,255,255,0.78)',
                boxShadow: a ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
              }}>{t}</button>
            );
          })}
        </div>

        <div style={{ marginTop: 18, display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontFamily: F.display, fontSize: 46, fontWeight: 600, color: '#fff', letterSpacing: -1.8, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>+₹35,375</span>
        </div>

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.84)' }}>
            <span style={{ fontFamily: F.mono, color: '#fff', fontWeight: 600 }}>₹3,82,500</span> open
          </span>
          <span style={{ width: 3, height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.4)' }}/>
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.84)' }}>
            <span style={{ fontFamily: F.mono, color: '#fff', fontWeight: 600 }}>₹3,25,000</span> won, not settled
          </span>
        </div>

        {/* progress to next tier */}
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'rgba(0,0,0,0.22)', overflow: 'hidden' }}>
            <div style={{ width: '64%', height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,#FFE680,#FFD061)' }}/>
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}><span style={{ fontFamily: F.mono }}>₹14.6k</span> to Gold</div>
        </div>
      </div>
    </div>
  );
}

// ── Today progress (green) ────────────────────────────────────────────
function Progress() {
  return (
    <div style={{
      margin: '14px 20px 0', borderRadius: 22, padding: 18,
      background: 'linear-gradient(135deg, #1B3A35 0%, #214B3F 60%, #2E6650 100%)',
      border: `1px solid rgba(43,216,160,0.18)`, position: 'relative', overflow: 'hidden',
    }}>
      {/* aurora */}
      <div style={{ position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle, rgba(43,216,160,0.35), transparent 65%)' }}/>

      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: T.green, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: T.green, boxShadow: `0 0 0 4px rgba(43,216,160,0.18)` }}/>
            <span>TODAY · <span style={{ fontFamily: F.mono }}>13:05</span></span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: F.display, fontSize: 42, fontWeight: 600, color: '#fff', letterSpacing: -1.2, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>3</span>
            <span style={{ fontFamily: F.display, fontSize: 22, fontWeight: 500, color: 'rgba(255,255,255,0.55)' }}>/ 5</span>
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>meetings logged</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {/* ring */}
          <div style={{ position: 'relative', width: 62, height: 62 }}>
            <svg width="62" height="62" viewBox="0 0 62 62">
              <circle cx="31" cy="31" r="26" stroke="rgba(255,255,255,0.12)" strokeWidth="6" fill="none"/>
              <circle cx="31" cy="31" r="26" stroke="url(#g)" strokeWidth="6" fill="none"
                strokeDasharray={`${(3/5)*2*Math.PI*26} ${2*Math.PI*26}`} strokeLinecap="round"
                transform="rotate(-90 31 31)"/>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#7BE3BD"/>
                  <stop offset="100%" stopColor="#2BD8A0"/>
                </linearGradient>
              </defs>
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: F.display, fontSize: 13, fontWeight: 600, color: '#fff' }}>60%</div>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.72)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {Ico.arrowDownRight(13)} 2 to go
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', marginTop: 14, paddingTop: 14, borderTop: '1px dashed rgba(255,255,255,0.12)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: T.yellow }}/>
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.86)' }}><span style={{ fontFamily: F.display, color: '#fff', fontWeight: 600 }}>7</span> calls</span>
          <span style={{ width: 3, height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.3)' }}/>
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.86)' }}><span style={{ fontFamily: F.display, color: '#fff', fontWeight: 600 }}>2</span> new leads</span>
        </div>
        <span style={{ fontSize: 12.5, color: T.green, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          View pipeline {Ico.arrowRight(12)}
        </span>
      </div>
    </div>
  );
}

// ── Stats grid ────────────────────────────────────────────────────────
function Stats() {
  const items = [
    { n: 4, l: 'Follow-up',  icon: Ico.clock(18), color: T.orange,  soft: T.orangeSoft },
    { n: 1, l: 'Quote',      icon: Ico.doc(18),   color: T.blue,    soft: T.blueSoft },
    { n: 2, l: 'Payment',    icon: Ico.rupee(18), color: T.red,     soft: T.redSoft },
    { n: 0, l: 'Today',      icon: Ico.cal(18),   color: T.dim,     soft: 'rgba(255,255,255,0.05)', dim: true },
    { n: 2, l: 'Scheduled',  icon: Ico.calClock(18), color: T.blue, soft: T.blueSoft },
    { n: 4, l: 'Renewal',    icon: Ico.refresh(18), color: T.green, soft: T.greenSoft },
  ];
  return (
    <div style={{ margin: '14px 20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 2px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: 1, textTransform: 'uppercase' }}>Pipeline · this week</div>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: T.yellow, fontWeight: 500 }}>13 OPEN</div>
      </div>
      <Card style={{ padding: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {items.map((it, i) => {
            const col = i % 3, row = Math.floor(i / 3);
            return (
              <div key={i} style={{
                padding: '16px 12px',
                borderRight: col < 2 ? `1px solid ${T.hairline}` : 'none',
                borderTop:  row > 0 ? `1px solid ${T.hairline}` : 'none',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
                opacity: it.dim ? 0.55 : 1,
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 9, background: it.soft, color: it.color,
                  display: 'grid', placeItems: 'center',
                }}>{it.icon}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontFamily: F.display, fontSize: 26, fontWeight: 600, color: T.text, letterSpacing: -0.6, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{it.n}</span>
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: T.muted, letterSpacing: 0.3, textTransform: 'uppercase' }}>{it.l}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── Gradient options for Log lead ─────────────────────────────────────
// Grouped: "Theme" matches the dashboard palette (purple incentive, green progress, yellow primary, blue accents).
// "Vivid" gives more saturated alternatives.
const LEAD_GRADS = [
  // ── Theme-aligned (pull from purple/green/blue/yellow already on screen) ──
  { id: 'aurora',    group: 'Theme', name: 'Aurora',    grad: 'linear-gradient(135deg, #7BE3BD 0%, #2BD8A0 50%, #2B6FE0 100%)', text: '#03201A', glow: 'rgba(43,216,160,0.55)' },
  { id: 'iridescent',group: 'Theme', name: 'Iridescent',grad: 'linear-gradient(135deg, #A88BFF 0%, #5AB0FF 50%, #2BD8A0 100%)', text: '#0E0A2A', glow: 'rgba(168,139,255,0.55)' },
  { id: 'violet',    group: 'Theme', name: 'Violet',    grad: 'linear-gradient(135deg, #C9A4FF 0%, #A656E8 50%, #6A35C9 100%)', text: '#fff',    glow: 'rgba(166,86,232,0.6)' },
  { id: 'amethyst',  group: 'Theme', name: 'Amethyst',  grad: 'linear-gradient(135deg, #E36BD6 0%, #A656E8 50%, #6A35C9 100%)', text: '#fff',    glow: 'rgba(168,86,232,0.6)' },
  { id: 'cobalt',    group: 'Theme', name: 'Cobalt',    grad: 'linear-gradient(135deg, #7CD4FF 0%, #5AB0FF 50%, #1E3A8A 100%)', text: '#fff',    glow: 'rgba(90,176,255,0.55)' },
  { id: 'forest',    group: 'Theme', name: 'Forest',    grad: 'linear-gradient(135deg, #6EE7B7 0%, #2BD8A0 50%, #064E3B 100%)', text: '#fff',    glow: 'rgba(43,216,160,0.55)' },
  { id: 'lagoon',    group: 'Theme', name: 'Lagoon',    grad: 'linear-gradient(135deg, #5EE7E0 0%, #06B6D4 40%, #214B3F 100%)', text: '#fff',    glow: 'rgba(6,182,212,0.55)' },
  { id: 'twilight',  group: 'Theme', name: 'Twilight',  grad: 'linear-gradient(135deg, #5AB0FF 0%, #6A35C9 50%, #1B2233 100%)', text: '#fff',    glow: 'rgba(106,53,201,0.55)' },
  { id: 'orchid',    group: 'Theme', name: 'Orchid',    grad: 'linear-gradient(135deg, #FFB4F0 0%, #E36BD6 45%, #A656E8 100%)', text: '#2A0A24', glow: 'rgba(227,107,214,0.55)' },
  { id: 'slate',     group: 'Theme', name: 'Slate',     grad: 'linear-gradient(135deg, #2A3346 0%, #1B2233 50%, #0F1320 100%)', text: '#F5F7FA', glow: 'rgba(27,34,51,0.7)' },
  { id: 'graphiteY', group: 'Theme', name: 'Graphite Y',grad: 'linear-gradient(135deg, #2A3346 0%, #1B2233 60%, #0F1320 100%)', text: '#F5D90A', glow: 'rgba(245,217,10,0.35)' },
  { id: 'ember',     group: 'Theme', name: 'Ember',     grad: 'linear-gradient(135deg, #FFD89A 0%, #FFB152 45%, #C13B2E 100%)', text: '#2A0A0A', glow: 'rgba(255,177,82,0.55)' },

  // ── Vivid alternatives ──
  { id: 'teal',    group: 'Vivid', name: 'Teal',    grad: 'linear-gradient(135deg, #5EE7E0 0%, #1FB6B0 45%, #0F766E 100%)', text: '#062825', glow: 'rgba(31,182,176,0.6)' },
  { id: 'emerald', group: 'Vivid', name: 'Emerald', grad: 'linear-gradient(135deg, #7BE3BD 0%, #2BD8A0 50%, #0F8459 100%)', text: '#06231A', glow: 'rgba(43,216,160,0.6)' },
  { id: 'sky',     group: 'Vivid', name: 'Sky',     grad: 'linear-gradient(135deg, #7CD4FF 0%, #3B82F6 50%, #1B3A95 100%)', text: '#fff',    glow: 'rgba(59,130,246,0.6)' },
  { id: 'coral',   group: 'Vivid', name: 'Coral',   grad: 'linear-gradient(135deg, #FFB37A 0%, #FF6F61 50%, #C1342B 100%)', text: '#fff',    glow: 'rgba(255,111,97,0.6)' },
  { id: 'rose',    group: 'Vivid', name: 'Rose',    grad: 'linear-gradient(135deg, #FFB4A2 0%, #FF6F91 50%, #C9184A 100%)', text: '#fff',    glow: 'rgba(255,111,145,0.6)' },
  { id: 'plum',    group: 'Vivid', name: 'Plum',    grad: 'linear-gradient(135deg, #C9A4FF 0%, #8B5CF6 50%, #4C1D95 100%)', text: '#fff',    glow: 'rgba(139,92,246,0.6)' },
  { id: 'magenta', group: 'Vivid', name: 'Magenta', grad: 'linear-gradient(135deg, #FFB4F0 0%, #E36BD6 50%, #7B1FA2 100%)', text: '#fff',    glow: 'rgba(227,107,214,0.6)' },
  { id: 'lime',    group: 'Vivid', name: 'Lime',    grad: 'linear-gradient(135deg, #E6FF7A 0%, #BEF264 50%, #65A30D 100%)', text: '#1A2400', glow: 'rgba(190,242,100,0.6)' },
  { id: 'mint',    group: 'Vivid', name: 'Mint',    grad: 'linear-gradient(135deg, #B8FFF0 0%, #6EE7B7 50%, #047857 100%)', text: '#03201A', glow: 'rgba(110,231,183,0.6)' },
  { id: 'sunset',  group: 'Vivid', name: 'Sunset',  grad: 'linear-gradient(135deg, #FFD89A 0%, #FF8A65 50%, #C9184A 100%)', text: '#2A0A14', glow: 'rgba(255,138,101,0.65)' },
  { id: 'ocean',   group: 'Vivid', name: 'Ocean',   grad: 'linear-gradient(135deg, #5EE7E0 0%, #06B6D4 40%, #1E3A8A 100%)', text: '#fff',    glow: 'rgba(6,182,212,0.6)' },
  { id: 'graphite',group: 'Vivid', name: 'Graphite',grad: 'linear-gradient(135deg, #6B7280 0%, #374151 50%, #111827 100%)', text: '#fff',    glow: 'rgba(55,65,81,0.65)' },
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "leadGradient": "graphiteY"
}/*EDITMODE-END*/;

// ── Action row ────────────────────────────────────────────────────────
function Actions({ leadGrad }) {
  const g = LEAD_GRADS.find(x => x.id === leadGrad) || LEAD_GRADS[0];
  return (
    <div style={{ margin: '14px 20px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <button style={{
        position: 'relative', height: 56, borderRadius: 16,
        background: 'linear-gradient(135deg, #FFE140 0%, #F5D90A 45%, #FFB152 100%)',
        color: '#1A1300', border: 0, fontFamily: F.sans, fontWeight: 700, fontSize: 15, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        boxShadow: '0 14px 30px -14px rgba(245,217,10,0.65), inset 0 1px 0 rgba(255,255,255,0.5)',
        overflow: 'hidden',
      }}>
        <span style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 50% at 20% 0%, rgba(255,255,255,0.45), transparent 60%)', pointerEvents: 'none' }}/>
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {Ico.cal(18)} Log meeting
        </span>
      </button>
      <button style={{
        position: 'relative', height: 56, borderRadius: 16,
        background: g.grad,
        color: g.text, border: 0, fontFamily: F.sans, fontWeight: 700, fontSize: 15, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        boxShadow: `0 14px 30px -14px ${g.glow}, inset 0 1px 0 rgba(255,255,255,0.35)`,
        overflow: 'hidden',
      }}>
        <span style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 50% at 20% 0%, rgba(255,255,255,0.4), transparent 60%)', pointerEvents: 'none' }}/>
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {Ico.plus(18)} Log lead
        </span>
      </button>
    </div>
  );
}

// ── Next up card ──────────────────────────────────────────────────────
function NextUp() {
  return (
    <div style={{ margin: '16px 20px 0', position: 'relative' }}>
      <Card style={{
        padding: 0, border: `1px solid rgba(245,217,10,0.35)`,
        background: `linear-gradient(180deg, rgba(245,217,10,0.06), rgba(245,217,10,0) 40%), ${T.surface}`,
      }}>
        <div style={{ padding: '16px 18px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.yellow, letterSpacing: 0.8, textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: T.yellow, boxShadow: '0 0 0 4px rgba(245,217,10,0.18)' }}/>
              <span>NEXT UP · <span style={{ fontFamily: F.mono }}>22 MIN</span></span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                height: 22, padding: '0 8px', borderRadius: 999,
                background: T.purpleSoft, color: T.purple,
                fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
              }}>{Ico.spark(11)} Smart task</div>
              <button style={{ width: 22, height: 22, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: 0, color: T.muted, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>{Ico.close(12)}</button>
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 14,
              background: 'linear-gradient(135deg,#F5D90A,#FFB152)',
              color: '#1A1300', display: 'grid', placeItems: 'center',
              fontFamily: F.display, fontWeight: 700, fontSize: 17,
            }}>K</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: F.display, fontSize: 17, fontWeight: 600, color: T.text, letterSpacing: -0.2 }}>Kajal Mehta</span>
                <span style={{ fontSize: 12, color: T.dim }}>· Solar 5kW</span>
              </div>
              <div style={{ marginTop: 2, fontSize: 12.5, color: T.muted }}>Quote sent 2 days ago · <span style={{ fontFamily: F.mono, color: 'rgba(245,247,250,0.78)' }}>₹1,82,000</span></div>
            </div>
          </div>

          <div style={{
            marginTop: 14, padding: '10px 12px', borderRadius: 12,
            background: 'rgba(43,216,160,0.06)',
            border: `1px solid rgba(43,216,160,0.18)`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              padding: '3px 7px', borderRadius: 6, background: T.green, color: '#06231A',
              fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
            }}>WHATSAPP</div>
            <div style={{ fontSize: 12.5, color: 'rgba(245,247,250,0.86)', flex: 1, minWidth: 0 }}>
              Auto: <span style={{ color: T.text }}>"Got the quote? Any questions?"</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 14 }}>
          <button style={{
            height: 46, borderRadius: 13, background: T.yellow, color: '#1A1300',
            border: 0, fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>{Ico.phone(16)} Call now</button>
          <button style={{
            height: 46, borderRadius: 13, background: 'transparent', color: T.text,
            border: `1px solid ${T.line}`, fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>Open deal {Ico.arrowRight(12)}</button>
        </div>
      </Card>
    </div>
  );
}

// ── Today's tasks ─────────────────────────────────────────────────────
function Tasks() {
  const rows = [
    { time: '17:30', name: 'Rahul Sharma', sub: 'Follow up · Solar 3kW · UA-2026-0042', state: 'due', dot: T.yellow },
    { time: '18:00', name: 'Ayesha Khan',  sub: 'Send revised quote · ₹95,000', state: 'queued', dot: T.blue },
    { time: '19:15', name: 'Priya Nair',   sub: 'Schedule site visit', state: 'queued', dot: T.purple },
  ];
  return (
    <div style={{ margin: '18px 20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 2px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: T.yellow, letterSpacing: 0.8, textTransform: 'uppercase' }}>
          {Ico.spark(13)} Today's tasks · 3
        </div>
        <div style={{ fontSize: 11.5, color: T.muted, fontWeight: 600 }}>See all</div>
      </div>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
            borderTop: i ? `1px solid ${T.hairline}` : 'none', position: 'relative',
          }}>
            <div style={{ position: 'absolute', left: 0, top: i ? 12 : 8, bottom: 8, width: 3, borderRadius: 999, background: r.dot, opacity: i === 0 ? 1 : 0.45 }}/>
            <div style={{
              width: 52, textAlign: 'center', fontFamily: F.mono, fontSize: 12, fontWeight: 500, color: T.muted,
              fontVariantNumeric: 'tabular-nums',
            }}>{r.time}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: F.display, fontSize: 15, fontWeight: 500, color: T.text, letterSpacing: -0.1 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 1 }}>{
                r.sub.split(/(₹[\d,]+|[A-Z]{2,3}-\d{4}-\d{4})/g).map((part, idx) => (
                  /^₹[\d,]+$/.test(part) || /^[A-Z]{2,3}-\d{4}-\d{4}$/.test(part)
                    ? <span key={idx} style={{ fontFamily: F.mono, color: 'rgba(245,247,250,0.78)' }}>{part}</span>
                    : <React.Fragment key={idx}>{part}</React.Fragment>
                ))
              }</div>
            </div>
            {i === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button style={btnGhost(34)}>{Ico.phone(14)}</button>
                <button style={btnGhost(34, T.yellowSoft, T.yellow)}>{Ico.check(14)}</button>
              </div>
            ) : (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: T.muted, padding: '4px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.04)' }}>
                Queued
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

function btnGhost(size, bg='rgba(255,255,255,0.06)', col=T.text) {
  return {
    width: size, height: size, borderRadius: 999, border: 0, cursor: 'pointer',
    background: bg, color: col, display: 'grid', placeItems: 'center',
  };
}

// ── Map preview ───────────────────────────────────────────────────────
function MapBlock() {
  return (
    <div style={{ margin: '16px 20px 0' }}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: T.text, fontSize: 14, fontWeight: 600 }}>
            <span style={{ color: T.green, display: 'inline-flex' }}>{Ico.pin(16)}</span>
            This week on the map
            <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 700, color: T.dim, letterSpacing: 0.6 }}>· 9 stops</span>
          </div>
          <span style={{ color: T.muted, display: 'inline-flex', transform: 'rotate(-90deg)' }}>{Ico.chevron(16)}</span>
        </div>
        {/* faux map */}
        <div style={{ height: 110, position: 'relative', margin: '0 12px 12px', borderRadius: 14, overflow: 'hidden',
          background: 'linear-gradient(180deg,#172033,#10182A)' }}>
          {/* grid */}
          <svg width="100%" height="100%" viewBox="0 0 320 110" preserveAspectRatio="none">
            <defs>
              <pattern id="gp" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M32 0H0V32" stroke="rgba(255,255,255,0.05)" fill="none"/>
              </pattern>
            </defs>
            <rect width="320" height="110" fill="url(#gp)"/>
            <path d="M-10 70 C 40 50, 80 90, 140 60 S 240 30, 330 55" stroke="rgba(245,217,10,0.45)" strokeWidth="2" fill="none" strokeDasharray="4 4"/>
            {[
              [22, 72, T.green], [68, 56, T.yellow], [128, 64, T.blue], [180, 50, T.yellow],
              [232, 42, T.purple], [284, 56, T.green],
            ].map(([x,y,c],i)=> (
              <g key={i}>
                <circle cx={x} cy={y} r="7" fill={c} opacity="0.18"/>
                <circle cx={x} cy={y} r="3.5" fill={c}/>
              </g>
            ))}
          </svg>
          <div style={{ position: 'absolute', left: 10, bottom: 10, padding: '6px 10px', borderRadius: 999, background: 'rgba(10,14,24,0.7)', backdropFilter: 'blur(8px)', fontSize: 11, fontWeight: 600, color: T.text, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: T.yellow }}/>
            3 nearby in Andheri
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Speak summary CTA (sticky-ish above tabs) ─────────────────────────
function SpeakCTA() {
  return (
    <div style={{ margin: '18px 20px 24px' }}>
      <button style={{
        width: '100%', height: 56, borderRadius: 18, border: 0, cursor: 'pointer',
        background: 'linear-gradient(180deg,#FFE140,#F5D90A)',
        color: '#1A1300', fontWeight: 700, fontSize: 15,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 8px 0 20px',
        boxShadow: '0 14px 28px -14px rgba(245,217,10,0.6)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {Ico.mic(18)} Speak evening summary
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: F.mono, fontSize: 11, fontWeight: 600, color: 'rgba(26,19,0,0.7)', background: 'rgba(255,255,255,0.4)', padding: '6px 10px', borderRadius: 999 }}>
          ~30s
        </span>
      </button>
      <button style={{
        width: '100%', height: 44, borderRadius: 14, marginTop: 10,
        background: 'transparent', border: `1px solid ${T.line}`,
        color: T.muted, fontWeight: 600, fontSize: 13.5, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>{Ico.play(14)} Type instead</button>
    </div>
  );
}

// ── Bottom tab bar (proper fixed alignment) ───────────────────────────
function TabBar() {
  const tabs = [
    { l: 'Today', i: Ico.sun(22), active: true },
    { l: 'Follow-ups', i: Ico.clock(22) },
    { l: 'Leads', i: Ico.inbox(22) },
    { l: 'Quotes', i: Ico.list(22) },
  ];
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30,
      paddingBottom: 28, // home indicator area
      background: 'linear-gradient(180deg, rgba(10,14,24,0) 0%, rgba(10,14,24,0.85) 30%, #0A0E18 70%)',
    }}>
      <div style={{
        margin: '0 12px', height: 64, borderRadius: 22,
        background: 'rgba(20,26,40,0.92)', border: `1px solid ${T.line}`,
        backdropFilter: 'blur(14px) saturate(150%)',
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', alignItems: 'center',
        boxShadow: '0 -8px 24px rgba(0,0,0,0.35)',
      }}>
        {tabs.map((t, i) => (
          <button key={i} style={{
            background: 'transparent', border: 0, cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            color: t.active ? T.yellow : T.muted, padding: 6,
          }}>
            <div style={{ position: 'relative' }}>
              {t.i}
              {t.active && (
                <div style={{
                  position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: -6,
                  width: 22, height: 3, borderRadius: 999, background: T.yellow,
                }}/>
              )}
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase' }}>{t.l}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────
function Screen({ leadGrad }) {
  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%', background: T.bg,
      overflow: 'hidden',
      fontFamily: F.sans,
      color: T.text,
    }}>
      {/* status spacer */}
      <div style={{ height: 54 }}/>
      <div style={{ height: 'calc(100% - 54px)', overflowY: 'auto', paddingBottom: 130 }}>
        <Header/>
        <Incentive/>
        <Actions leadGrad={leadGrad}/>
        <Progress/>
        <Stats/>
        <NextUp/>
        <Tasks/>
        <MapBlock/>
        <SpeakCTA/>
      </div>
      <TabBar/>
    </div>
  );
}

// ── Gradient swatch picker ────────────────────────────────────────────
function GradPicker({ value, onChange }) {
  const groups = ['Theme', 'Vivid'];
  return (
    <div style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {groups.map(grp => (
        <div key={grp}>
          <div style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>
            {grp === 'Theme' ? 'Aligned with theme' : 'More options'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {LEAD_GRADS.filter(g => g.group === grp).map(g => {
              const active = g.id === value;
              return (
                <button key={g.id} onClick={() => onChange(g.id)} style={{
                  position: 'relative', height: 52, borderRadius: 12, border: 0, cursor: 'pointer',
                  background: g.grad, overflow: 'hidden',
                  boxShadow: active ? `0 0 0 2px #fff, 0 0 0 4px ${g.glow}` : 'inset 0 1px 0 rgba(255,255,255,0.25)',
                  padding: 0,
                }}>
                  <span style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 50% at 20% 0%, rgba(255,255,255,0.35), transparent 60%)' }}/>
                  <span style={{ position: 'absolute', left: 8, bottom: 5, fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: g.text, letterSpacing: 0.3 }}>
                    {g.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

window.SalesApp = function SalesApp() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  return (
    <div style={{ minHeight: '100vh', background: '#0F1320', display: 'grid', placeItems: 'center', padding: 24 }}>
      <IOSDevice dark={true} width={402} height={874}>
        <Screen leadGrad={t.leadGradient}/>
      </IOSDevice>
      <TweaksPanel title="Tweaks">
        <TweakSection title="Log lead button">
          <GradPicker value={t.leadGradient} onChange={(id) => setTweak('leadGradient', id)}/>
        </TweakSection>
      </TweaksPanel>
    </div>
  );
};
