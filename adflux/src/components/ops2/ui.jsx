// Operations design primitives (from the owner Claude Design file). Pure display, no data.
import { useRef, useState, useSyncExternalStore } from 'react'
import UserAvatar from '../common/UserAvatar'
export const IC={
phone:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
camoff:'<line x1="2" x2="22" y1="2" y2="22"/><path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16"/><path d="M9.5 4h5L17 7h3a2 2 0 0 1 2 2v7.5"/><path d="M14.121 15.121A3 3 0 1 1 9.88 10.88"/>',
mon:'<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
monoff:'<path d="M17 17H4a2 2 0 0 1-2-2V5c0-1.5 1-2 1-2"/><path d="M22 15V5a2 2 0 0 0-2-2H9"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m2 2 20 20"/>',
pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
navi:'<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
zap:'<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
plug:'<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
wifi:'<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
wifioff:'<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
toggle:'<rect width="20" height="12" x="2" y="6" rx="6"/><circle cx="16" cy="12" r="2"/>',
feather:'<path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
drop:'<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
rupee:'<path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/>',
clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
check:'<path d="M20 6 9 17l-5-5"/>',checkc:'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',circle:'<circle cx="12" cy="12" r="10"/>',
loader:'<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
flag:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
alert:'<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
warn:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
brief:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
pencil:'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
home:'<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
list:'<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
user:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
chart:'<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
gauge:'<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
bell:'<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
save:'<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
cpu:'<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
msg:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
send:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
swap:'<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
swipe:'<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>',
plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
cl:'<path d="m15 18-6-6 6-6"/>',cr:'<path d="m9 18 6-6-6-6"/>',cd:'<path d="m6 9 6 6 6-6"/>',
arrow:'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
cal:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
img:'<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
route:'<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
repeat:'<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
dl:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'
};
export function Ic({ n, s = 18, style }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', ...style }} dangerouslySetInnerHTML={{ __html: IC[n] || '' }} />
}
// Language: English by default, ગુ shows Gujarati first with English under (as the old ops pages did).
const LK = 'ops2_lang'
const subs = new Set()
let lang = (() => { try { return localStorage.getItem(LK) === 'gu' ? 'gu' : 'en' } catch { return 'en' } })()
export const setOps2Lang = (l) => { lang = l; try { localStorage.setItem(LK, l) } catch { /* private mode */ } subs.forEach(f => f()) }
export const useOps2Lang = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => lang)
export function LangToggle() {
  const l = useOps2Lang()
  return <div className="seg" role="group" aria-label="Language">{[['gu', 'ગુ'], ['en', 'EN']].map(([k, t]) => <button key={k} className={l === k ? 'on' : ''} aria-pressed={l === k} onClick={() => setOps2Lang(k)}>{t}</button>)}</div>
}
export function Bi({ g, e, big, center }) {
  const l = useOps2Lang()
  if (l === 'en') return <span className={'bi' + (big ? ' big' : '')} style={center ? { textAlign: 'center' } : null}><span className="g">{e}</span></span>
  return <span className={'bi' + (big ? ' big' : '')} style={center ? { textAlign: 'center' } : null}><span className="g">{g}</span><span className="e">{e}</span></span>
}
export function Btn({ kind, icon, children, sm, lg, onClick, title, style, disabled, full }) {
  const c = ['btn', kind, sm && 'sm', lg && 'lg', !children && 'ic', full && 'full'].filter(Boolean).join(' ')
  return <button className={c} onClick={e => { e.stopPropagation(); onClick && onClick(e) }} title={title} aria-label={title || undefined} style={style} disabled={disabled}>{icon && <Ic n={icon} s={lg ? 22 : sm ? 16 : 18} />}{children}</button>
}
export function Pill({ tone = 'n', icon, children }) {
  return <span className={'pill t-' + tone}>{icon && <Ic n={icon} s={14} />}{children}</span>
}
export function Tile({ n, tone = 'n', s = 36 }) {
  return <span className={'tl t-' + tone} style={{ width: s, height: s, borderRadius: s > 34 ? 12 : 8 }}><Ic n={n} s={s > 34 ? 18 : 16} /></span>
}
export function Ring({ v, s = 88, txt, lab, max = 100 }) {
  const r = (s - 10) / 2, c = 2 * Math.PI * r, col = v >= 95 ? 'var(--ok)' : v >= 85 ? 'var(--y)' : 'var(--da)'
  return <div style={{ position: 'relative', width: s, height: s, flex: 'none', zIndex: 1 }}><svg width={s} height={s} aria-hidden="true"><circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="8" /><circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={col} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${c * Math.min(v, max) / max} ${c}`} transform={`rotate(-90 ${s / 2} ${s / 2})`} /></svg>
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center', color: '#f1f5f9' }}><span className="num" style={{ fontSize: s * .21, fontWeight: 600, lineHeight: 1 }}>{txt ?? v + '%'}</span>{lab && <span style={{ fontSize: 12, color: '#ccfbf1', marginTop: 3 }}>{lab}</span>}</div></div>
}
export function Hero({ eyebrow, value, unit, sub, right, icon }) {
  return <section className="hero"><div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
    <div style={{ display: 'grid', gap: 6, minWidth: 0, position: 'relative', zIndex: 1 }}><span className="heb">{icon && <Ic n={icon} s={14} />}{eyebrow}</span>
      <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}><span className="num hv">{value}</span>{unit && <span className="hu">{unit}</span>}</div>
      {sub && <span className="hs">{sub}</span>}</div>{right}</div></section>
}
export function StatTile({ icon, tone = 'n', value, label, sub, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return <Tag className={'stt s-' + tone} onClick={onClick} style={onClick ? { textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' } : null}><Tile n={icon} tone={tone} s={36} /><div className="num stv">{value}</div><div className="stl">{label}</div>{sub && <div className="mu sm">{sub}</div>}</Tag>
}
export function Card({ title, icon, tone, action, children, pad = true, style, sub }) {
  return <section className="card" style={style}>
    {title && <header className="ch"><div className="row" style={{ gap: 10, minWidth: 0 }}>{icon && <Tile n={icon} tone={tone || 'n'} s={32} />}<h3>{title}</h3>{sub && <span className="mu sm">{sub}</span>}</div>{action}</header>}
    <div style={pad ? { padding: 18 } : null}>{children}</div></section>
}
export function Seg({ value, onChange, opts, full }) {
  return <div className="seg" role="tablist" style={full ? { display: 'flex' } : null}>{opts.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} style={full ? { flex: 1 } : null} onClick={() => onChange(k)}>{l}</button>)}</div>
}
export function Sel({ value, opts, onChange, label }) {
  return <div className="selw"><select className="inp" aria-label={label} value={value} onChange={e => onChange && onChange(e.target.value)}>{opts.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select><span className="selc"><Ic n="cd" /></span></div>
}
export function Bar({ v, tone = 'y', h = 10, marks }) {
  return <div style={{ position: 'relative' }}><div style={{ height: h, borderRadius: 999, background: 'var(--raised)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.max(0, Math.min(100, v))}%`, background: `var(--${tone})`, borderRadius: 999 }} /></div>{marks && marks.map(m => <span key={m} style={{ position: 'absolute', left: `${m}%`, top: -4, height: h + 8, width: 2, background: 'var(--tx)', borderRadius: 2 }} />)}</div>
}
export function ScrTile({ n, st, sel, onClick, small }) {
  const m = { on: 'ok', off: 'da', rest: 'n', tm: 'wa' }[st]
  return <button className={'stile t-' + m + (sel ? ' sel' : '') + (small ? ' sm' : '')} disabled={!onClick} onClick={onClick} aria-pressed={sel} aria-label={`Screen ${n}, ${st}`}>
    <span className="num">{n}</span>{!small && <Ic n={st === 'on' ? 'mon' : st === 'rest' ? 'moon' : st === 'tm' ? 'clock' : 'monoff'} s={14} />}</button>
}
export function Av({ name, userId, s = 36 }) {
  return <UserAvatar name={name} userId={userId} size={s} style={{ background: 'var(--y)', color: '#0f172a', fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600 }} />
}
export function Sheet({ title, sub, onClose, children, footer, side }) {
  return <div className={'scrim' + (side ? ' side' : '')} onClick={onClose}><aside className={side ? 'panel' : 'sheet'} onClick={e => e.stopPropagation()} role="dialog" aria-label={typeof title === 'string' ? title : 'Details'}>
    <header className="row" style={{ justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--bd)', alignItems: 'flex-start' }}><div style={{ minWidth: 0 }}><h2 className="h" style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{title}</h2>{sub && <div className="mu" style={{ marginTop: 2 }}>{sub}</div>}</div><Btn kind="gh" icon="x" title="Close" onClick={onClose} /></header>
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'grid', gap: 20, alignContent: 'start' }}>{children}</div>
    {footer && <footer style={{ display: 'flex', gap: 12, padding: '14px 20px', borderTop: '1px solid var(--bd)' }}>{footer}</footer>}</aside></div>
}
export function Toast({ m }) {
  return m ? <div className="toast" role="status"><Ic n={m.icon || 'checkc'} /><span style={{ flex: 1 }}>{m.t}</span></div> : null
}
export function useToast() {
  const [m, setM] = useState(null); const t = useRef()
  return [m, x => { setM(x); clearTimeout(t.current); t.current = setTimeout(() => setM(null), 3200) }]
}
// Real photo box: opens the phone camera / gallery and hands back the File.
export function Photo({ label, file, onFile }) {
  const ref = useRef()
  return <><input ref={ref} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => onFile(e.target.files?.[0] || null)} />
    {file
      ? <div className="photo has"><div className="ph-img"><Ic n="img" s={22} /></div><div style={{ flex: 1, minWidth: 0 }}>{label}<div className="mu sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div></div><Btn kind="gh" sm icon="x" title="Remove" onClick={() => { onFile(null); if (ref.current) ref.current.value = '' }} /></div>
      : <button className="photo" onClick={() => ref.current && ref.current.click()}><Ic n="camera" s={22} />{label}</button>}</>
}
export function Swipe({ onDone, g, e }) {
  const ref = useRef(); const [x, setX] = useState(0); const d = useRef(null); const max = () => ref.current.clientWidth - 60
  return <div ref={ref} className="swipe"><span className="swl"><Bi g={g} e={e} center /></span>
    <button className="swk" style={{ transform: `translateX(${x}px)` }} aria-label={e} onPointerDown={ev => { d.current = ev.clientX - x; ev.currentTarget.setPointerCapture(ev.pointerId) }} onPointerMove={ev => d.current != null && setX(Math.max(0, Math.min(max(), ev.clientX - d.current)))} onPointerUp={() => { d.current = null; if (x > max() * .75) { setX(max()); setTimeout(onDone, 150) } else setX(0) }} onKeyDown={ev => (ev.key === 'Enter' || ev.key === ' ') && onDone()}><Ic n="swipe" s={22} /></button></div>
}
