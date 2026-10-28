// Finance -> Rev split -> "Download PDF" (owner 2026-10-28). A4 portrait report: page 1 = the answer
// (profit after expenses, the two partner shares, how it is worked out, by media); next pages = the deal list
// with a repeating header, rows never cut in half; last row = totals. Built client-side with @react-pdf/renderer
// (lazy-loaded by the tab). Numbers are passed in from the tab, so the PDF always equals the screen.
// Department names are often Gujarati: Noto Sans Gujarati (public/fonts, same-origin) draws them; "Rs." is used
// instead of the rupee sign (blank in the built-in Helvetica).
import { Document, Page, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer'

Font.register({
  family: 'NotoGu',
  fonts: [
    { src: '/fonts/NotoSansGujarati-Regular.woff', fontWeight: 400 },
    { src: '/fonts/NotoSansGujarati-Bold.woff', fontWeight: 700 },
  ],
})

const INK = '#0c1224', INK2 = '#4a5474', LINE = '#e3e6ee', SOFT = '#f8f9fc'
const YELLOW = '#FFE600'
const GREEN = '#047857', RED = '#b91c1c', AMBER = '#b45309'

const nf = (n) => new Intl.NumberFormat('en-IN').format(Math.round(Math.abs(Number(n) || 0)))
const inr = (n) => (Number(n) < 0 ? '- ' : '') + 'Rs. ' + nf(n)
const dash = (n) => (Math.round(Number(n) || 0) === 0 ? '-' : inr(n))
const dmy = (s) => { if (!s) return '-'; const [y, m, d] = String(s).slice(0, 10).split('-'); return d ? `${d}/${m}/${y.slice(2)}` : '-' }
const MEDIA = { AUTO_HOOD: 'Auto Hood', GSRTC_LED: 'GSRTC LED', LED_OTHER: 'Pvt LED' }
const COLS = { no: 20, dept: 227, order: 78, ded: 72, profit: 80, st: 58 }

const S = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 40, paddingHorizontal: 30, fontSize: 9, color: INK, fontFamily: 'Helvetica' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: YELLOW },
  bar: { width: 5, height: 32, backgroundColor: YELLOW, borderRadius: 3, marginRight: 10 },
  title: { fontSize: 19, fontFamily: 'Helvetica-Bold' },
  sub: { fontSize: 8.5, color: INK2, marginTop: 3 },
  meta: { fontSize: 8, color: INK2, textAlign: 'right', lineHeight: 1.55 },
  hero: { marginTop: 14, borderWidth: 1, borderColor: LINE, borderLeftWidth: 5, borderLeftColor: YELLOW, borderRadius: 10, padding: 16 },
  heroLbl: { fontSize: 8.5, letterSpacing: 1.4, fontFamily: 'Helvetica-Bold', color: INK2 },
  heroVal: { fontSize: 32, fontFamily: 'Helvetica-Bold', marginTop: 6 },
  heroSub: { fontSize: 8.5, color: INK2, marginTop: 4 },
  pRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  partner: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 10, padding: 12 },
  pName: { fontSize: 8.5, letterSpacing: 1.4, fontFamily: 'Helvetica-Bold', color: INK2 },
  pPct: { fontSize: 8.5, color: INK2, marginTop: 2 },
  pVal: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginTop: 7 },
  sec: { marginTop: 14, borderWidth: 1, borderColor: LINE, borderRadius: 10, padding: 14 },
  secT: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  wRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4.5, borderBottomWidth: 0.5, borderBottomColor: LINE },
  wLbl: { fontSize: 9.2, color: INK2 },
  wVal: { fontSize: 9.2, fontFamily: 'Helvetica-Bold' },
  wTot: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, marginTop: 3, borderTopWidth: 1.4, borderTopColor: INK },
  note: { fontSize: 7.4, color: INK2, marginTop: 10, lineHeight: 1.5 },
  run: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  runL: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  runR: { fontSize: 7.8, color: INK2 },
  th: { flexDirection: 'row', borderBottomWidth: 1.4, borderBottomColor: INK, borderTopWidth: 0.5, borderTopColor: LINE, paddingVertical: 6, paddingHorizontal: 3 },
  thT: { fontSize: 7.6, fontFamily: 'Helvetica-Bold' },
  tr: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: LINE, alignItems: 'flex-start' },
  trAlt: { backgroundColor: SOFT },
  td: { fontSize: 8.4 },
  dept: { fontFamily: 'NotoGu', fontSize: 8.6 },
  subL: { fontSize: 6.8, color: INK2, marginTop: 1.5, lineHeight: 1.4 },
  tot: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 3, marginTop: 4, borderTopWidth: 1.4, borderTopColor: INK, backgroundColor: SOFT },
  foot: { position: 'absolute', left: 30, right: 30, bottom: 16, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.4, color: INK2 },
})
const R = { textAlign: 'right' }
const stColor = (st) => (st === 'Paid' ? GREEN : st === 'Part paid' ? AMBER : RED)

function Foot({ on }) {
  return (
    <View style={S.foot} fixed>
      <Text>Untitled Group - Revenue split report - {on}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}

function RevSplitDocument({ d }) {
  const byMedia = ['AUTO_HOOD', 'GSRTC_LED', 'LED_OTHER'].map(m => {
    const rows = d.deals.filter(x => x.media === m)
    return { m, n: rows.length, order: rows.reduce((s, x) => s + x.order, 0), profit: rows.reduce((s, x) => s + x.profit, 0) }
  }).filter(x => x.n)
  const steps = [
    ['Order value (ex-GST)', d.tot.order, false],
    ['Dept expense (commission)', -d.tot.comm, true],
    ['Vendor costing', -d.tot.vendor, true],
    ['TDS withheld', -d.tot.tds, true],
  ]
  const col = (n) => (n >= 0 ? GREEN : RED)
  return (
    <Document title="Revenue split report" author="Untitled">
      <Page size="A4" style={S.page}>
        <View style={S.head}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={S.bar} />
            <View><Text style={S.title}>Revenue Split Report</Text><Text style={S.sub}>Government Auto Hood, GSRTC LED and Private LED</Text></View>
          </View>
          <View><Text style={S.meta}>Generated {d.on}</Text><Text style={S.meta}>{d.filterLabel}</Text><Text style={S.meta}>{d.deals.length} deals</Text></View>
        </View>

        <View style={S.hero}>
          <Text style={S.heroLbl}>PROFIT AFTER EXPENSES</Text>
          <Text style={[S.heroVal, { color: col(d.net) }]}>{inr(d.net)}</Text>
          <Text style={S.heroSub}>Shared between the two partners below</Text>
        </View>
        <View style={S.pRow}>
          <View style={S.partner}><Text style={S.pName}>VISHAL</Text><Text style={S.pPct}>{d.v}% share</Text><Text style={[S.pVal, { color: col(d.vShare) }]}>{inr(d.vShare)}</Text></View>
          <View style={S.partner}><Text style={S.pName}>BRIJESH</Text><Text style={S.pPct}>{100 - d.v}% share</Text><Text style={[S.pVal, { color: col(d.bShare) }]}>{inr(d.bShare)}</Text></View>
        </View>

        <View style={S.sec}>
          <Text style={S.secT}>How this profit is worked out</Text>
          {steps.map(([l, v, less]) => (
            <View key={l} style={S.wRow}><Text style={S.wLbl}>{less ? 'less  ' : ''}{l}</Text><Text style={[S.wVal, { color: less ? AMBER : INK }]}>{inr(v)}</Text></View>
          ))}
          <View style={S.wRow}><Text style={[S.wLbl, { fontFamily: 'Helvetica-Bold', color: INK }]}>Deals profit</Text><Text style={[S.wVal, { color: col(d.tot.profit) }]}>{inr(d.tot.profit)}</Text></View>
          {d.expLines.map(([l, v]) => (<View key={l} style={S.wRow}><Text style={S.wLbl}>less  {l}</Text><Text style={[S.wVal, { color: AMBER }]}>{dash(-v)}</Text></View>))}
          {d.useCommon ? <View style={S.wRow}><Text style={S.wLbl}>less  Common expense share</Text><Text style={[S.wVal, { color: AMBER }]}>{dash(-d.commonShare)}</Text></View> : null}
          <View style={S.wTot}><Text style={[S.wVal, { fontSize: 10.5 }]}>Profit after expenses</Text><Text style={[S.wVal, { fontSize: 10.5, color: col(d.net) }]}>{inr(d.net)}</Text></View>
        </View>

        <View style={S.sec}>
          <Text style={S.secT}>By media</Text>
          <View style={[S.wRow, { borderBottomColor: INK }]}>
            <Text style={[S.wLbl, { flex: 1.3, fontFamily: 'Helvetica-Bold' }]}>Media</Text><Text style={[S.wLbl, { flex: 0.6, fontFamily: 'Helvetica-Bold' }, R]}>Deals</Text>
            <Text style={[S.wLbl, { flex: 1.4, fontFamily: 'Helvetica-Bold' }, R]}>Order value</Text><Text style={[S.wLbl, { flex: 1.4, fontFamily: 'Helvetica-Bold' }, R]}>Deals profit</Text>
          </View>
          {byMedia.map(x => (
            <View key={x.m} style={S.wRow}>
              <Text style={[S.wLbl, { flex: 1.3, color: INK }]}>{MEDIA[x.m]}</Text><Text style={[S.wVal, { flex: 0.6 }, R]}>{x.n}</Text>
              <Text style={[S.wVal, { flex: 1.4 }, R]}>{inr(x.order)}</Text><Text style={[S.wVal, { flex: 1.4, color: col(x.profit) }, R]}>{inr(x.profit)}</Text>
            </View>
          ))}
          <Text style={S.note}>Deal profit = order value (ex-GST) minus dept expense (commission) minus vendor costing minus TDS withheld, counted on payments received so far. Bank expenses are the direct costs paid from the bank for that media (for example the GSRTC capital investment), taken off once as a whole. Common expense is the office total in the share of income these deals brought in.</Text>
        </View>
        <Foot on={d.on} />
      </Page>

      <Page size="A4" style={S.page} wrap>
        <View style={S.run} fixed><Text style={S.runL}>Deal list</Text><Text style={S.runR}>{d.filterLabel}</Text></View>
        <View style={S.th} fixed>
          <Text style={[S.thT, { width: COLS.no }]}>No</Text><Text style={[S.thT, { width: COLS.dept }]}>Department</Text>
          <Text style={[S.thT, { width: COLS.order }, R]}>Order (ex-GST)</Text><Text style={[S.thT, { width: COLS.ded }, R]}>Deductions</Text>
          <Text style={[S.thT, { width: COLS.profit }, R]}>Profit</Text><Text style={[S.thT, { width: COLS.st, paddingLeft: 12 }]}>Status</Text>
        </View>
        {d.deals.map((x, i) => {
          const ded = x.comm + x.vendor + x.tds
          const parts = [x.comm > 0 && 'Dept exp ' + nf(x.comm), x.vendor > 0 && 'Vendor ' + nf(x.vendor), x.tds > 0 && 'TDS ' + nf(x.tds)].filter(Boolean)
          return (
            <View key={x.id} wrap={false} style={[S.tr, i % 2 ? S.trAlt : null]}>
              <Text style={[S.td, { width: COLS.no, color: INK2 }]}>{i + 1}</Text>
              <View style={{ width: COLS.dept, paddingRight: 8 }}>
                <Text style={S.dept}>{x.dept}</Text>
                <Text style={S.subL}>{x.no} - {MEDIA[x.media]}{x.qty ? ' - Qty ' + x.qty : ''}{x.start ? ' - ' + dmy(x.start) + ' to ' + dmy(x.end) : ''}</Text>
                {parts.length ? <Text style={S.subL}>{parts.join('  |  ')}</Text> : null}
              </View>
              <Text style={[S.td, { width: COLS.order }, R]}>{inr(x.order)}</Text>
              <Text style={[S.td, { width: COLS.ded, color: ded ? AMBER : INK2 }, R]}>{dash(-ded)}</Text>
              <Text style={[S.td, { width: COLS.profit, fontFamily: 'Helvetica-Bold', color: col(x.profit) }, R]}>{inr(x.profit)}</Text>
              <Text style={[S.td, { width: COLS.st, paddingLeft: 12, fontSize: 7.6, color: stColor(x.status) }]}>{x.status}</Text>
            </View>
          )
        })}
        <View style={S.tot} wrap={false}>
          <Text style={[S.td, { width: COLS.no + COLS.dept, fontFamily: 'Helvetica-Bold' }]}>Total - {d.deals.length} deals</Text>
          <Text style={[S.td, { width: COLS.order, fontFamily: 'Helvetica-Bold' }, R]}>{inr(d.tot.order)}</Text>
          <Text style={[S.td, { width: COLS.ded, fontFamily: 'Helvetica-Bold', color: AMBER }, R]}>{dash(-(d.tot.comm + d.tot.vendor + d.tot.tds))}</Text>
          <Text style={[S.td, { width: COLS.profit, fontFamily: 'Helvetica-Bold', color: col(d.tot.profit) }, R]}>{inr(d.tot.profit)}</Text>
        </View>
        <Foot on={d.on} />
      </Page>
    </Document>
  )
}

export async function buildRevSplitBlob(data) {
  return pdf(<RevSplitDocument d={data} />).toBlob()
}
