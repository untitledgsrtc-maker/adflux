// Finance -> Rev split -> "Download PDF" (owner 2026-10-28). A4 landscape report: page 1 = the answer
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
const TEAL = '#134e4a', TEAL2 = '#0d3d3a', YELLOW = '#FFE600'
const GREEN = '#047857', RED = '#b91c1c', AMBER = '#b45309'

const nf = (n) => new Intl.NumberFormat('en-IN').format(Math.round(Math.abs(Number(n) || 0)))
const inr = (n) => (Number(n) < 0 ? '- ' : '') + 'Rs. ' + nf(n)
const dash = (n) => (Math.round(Number(n) || 0) === 0 ? '-' : inr(n))
const dmy = (s) => { if (!s) return '-'; const [y, m, d] = String(s).slice(0, 10).split('-'); return d ? `${d}/${m}/${y.slice(2)}` : '-' }
const MEDIA = { AUTO_HOOD: 'Auto Hood', GSRTC_LED: 'GSRTC LED', LED_OTHER: 'Pvt LED' }
const COLS = { no: 22, dept: 176, qty: 34, per: 84, order: 86, comm: 76, vend: 76, tds: 58, profit: 76, last: 50, st: 48 }

const S = StyleSheet.create({
  page: { paddingTop: 26, paddingBottom: 34, paddingHorizontal: 28, fontSize: 9, color: INK, fontFamily: 'Helvetica' },
  band: { backgroundColor: '#ffffff', borderBottomWidth: 2, borderBottomColor: YELLOW, paddingBottom: 12, paddingTop: 2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bar: { width: 5, height: 34, backgroundColor: YELLOW, borderRadius: 3, marginRight: 12 },
  bandTitle: { color: INK, fontSize: 19, fontFamily: 'Helvetica-Bold' },
  bandSub: { color: INK2, fontSize: 9, marginTop: 3 },
  bandRight: { color: INK2, fontSize: 8.5, textAlign: 'right', lineHeight: 1.5 },
  heroRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  hero: { flex: 1.5, backgroundColor: '#ffffff', borderWidth: 1, borderColor: LINE, borderLeftWidth: 5, borderLeftColor: YELLOW, borderRadius: 10, padding: 16, justifyContent: 'center' },
  heroLbl: { color: INK2, fontSize: 8.5, letterSpacing: 1.4, fontFamily: 'Helvetica-Bold' },
  heroVal: { color: INK, fontSize: 30, fontFamily: 'Helvetica-Bold', marginTop: 6 },
  heroSub: { color: INK2, fontSize: 8.5, marginTop: 4 },
  partner: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 10, padding: 14, justifyContent: 'center', backgroundColor: '#ffffff' },
  pName: { fontSize: 9, letterSpacing: 1.4, fontFamily: 'Helvetica-Bold', color: INK2 },
  pPct: { fontSize: 9, color: INK2, marginTop: 2 },
  pVal: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginTop: 8 },
  twoCol: { flexDirection: 'row', gap: 14, marginTop: 14 },
  card: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 10, padding: 14 },
  cardT: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginBottom: 8 },
  wRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4.5, borderBottomWidth: 0.5, borderBottomColor: LINE },
  wLbl: { fontSize: 9.5, color: INK2 },
  wVal: { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },
  wTot: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, marginTop: 3, borderTopWidth: 1.2, borderTopColor: INK },
  note: { fontSize: 7.6, color: INK2, marginTop: 12, lineHeight: 1.5 },
  // deal table
  run: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  runL: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  runR: { fontSize: 8, color: INK2 },
  th: { flexDirection: 'row', backgroundColor: '#ffffff', borderBottomWidth: 1.4, borderBottomColor: INK, borderTopWidth: 0.5, borderTopColor: LINE, paddingVertical: 6, paddingHorizontal: 4 },
  thT: { color: INK, fontSize: 7.6, fontFamily: 'Helvetica-Bold' },
  tr: { flexDirection: 'row', paddingVertical: 4.5, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: LINE, alignItems: 'center' },
  trAlt: { backgroundColor: SOFT },
  td: { fontSize: 8.3 },
  tdDept: { fontFamily: 'NotoGu', fontSize: 8.3 },
  tdSub: { fontSize: 6.8, color: INK2, marginTop: 1 },
  tot: { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 4, marginTop: 4, borderTopWidth: 1.2, borderTopColor: INK, backgroundColor: SOFT },
  foot: { position: 'absolute', left: 28, right: 28, bottom: 14, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: INK2 },
})
const R = { textAlign: 'right' }

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
    ['Order value (ex-GST)', d.tot.order, 0],
    ['Dept expense (commission)', -d.tot.comm, 1],
    ['Vendor costing', -d.tot.vendor, 1],
    ['TDS withheld', -d.tot.tds, 1],
  ]
  return (
    <Document title="Revenue split report" author="Untitled">
      <Page size="A4" orientation="landscape" style={S.page}>
        <View style={S.band}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={S.bar} />
            <View>
              <Text style={S.bandTitle}>Revenue Split Report</Text>
              <Text style={S.bandSub}>Won deals: Government Auto Hood, GSRTC LED and Private LED</Text>
            </View>
          </View>
          <View><Text style={S.bandRight}>Generated {d.on}</Text><Text style={S.bandRight}>{d.filterLabel}</Text><Text style={S.bandRight}>{d.deals.length} deals included</Text></View>
        </View>

        <View style={S.heroRow}>
          <View style={S.hero}>
            <Text style={S.heroLbl}>PROFIT AFTER EXPENSES</Text>
            <Text style={S.heroVal}>{inr(d.net)}</Text>
            <Text style={S.heroSub}>Shared between the two partners below</Text>
          </View>
          <View style={S.partner}>
            <Text style={S.pName}>VISHAL</Text><Text style={S.pPct}>{d.v}% share</Text>
            <Text style={[S.pVal, { color: d.vShare >= 0 ? GREEN : RED }]}>{inr(d.vShare)}</Text>
          </View>
          <View style={S.partner}>
            <Text style={S.pName}>BRIJESH</Text><Text style={S.pPct}>{100 - d.v}% share</Text>
            <Text style={[S.pVal, { color: d.bShare >= 0 ? GREEN : RED }]}>{inr(d.bShare)}</Text>
          </View>
        </View>

        <View style={S.twoCol}>
          <View style={S.card}>
            <Text style={S.cardT}>How this profit is worked out</Text>
            {steps.map(([l, v]) => (
              <View key={l} style={S.wRow}><Text style={S.wLbl}>{v < 0 ? 'less  ' : ''}{l}</Text><Text style={[S.wVal, { color: v < 0 ? AMBER : INK }]}>{inr(v)}</Text></View>
            ))}
            <View style={S.wRow}><Text style={[S.wLbl, { fontFamily: 'Helvetica-Bold', color: INK }]}>Deals profit</Text><Text style={[S.wVal, { color: d.tot.profit >= 0 ? GREEN : RED }]}>{inr(d.tot.profit)}</Text></View>
            {d.expLines.map(([l, v]) => (<View key={l} style={S.wRow}><Text style={S.wLbl}>less  {l}</Text><Text style={[S.wVal, { color: AMBER }]}>{inr(-v)}</Text></View>))}
            {d.useCommon ? <View style={S.wRow}><Text style={S.wLbl}>less  Common expense share</Text><Text style={[S.wVal, { color: AMBER }]}>{inr(-d.commonShare)}</Text></View> : null}
            <View style={S.wTot}><Text style={[S.wVal, { fontSize: 10.5 }]}>Profit after expenses</Text><Text style={[S.wVal, { fontSize: 10.5, color: d.net >= 0 ? GREEN : RED }]}>{inr(d.net)}</Text></View>
          </View>
          <View style={S.card}>
            <Text style={S.cardT}>By media</Text>
            <View style={[S.wRow, { borderBottomColor: INK }]}>
              <Text style={[S.wLbl, { flex: 1.4, fontFamily: 'Helvetica-Bold' }]}>Media</Text><Text style={[S.wLbl, { flex: 0.6, fontFamily: 'Helvetica-Bold' }, R]}>Deals</Text>
              <Text style={[S.wLbl, { flex: 1.3, fontFamily: 'Helvetica-Bold' }, R]}>Order value</Text><Text style={[S.wLbl, { flex: 1.3, fontFamily: 'Helvetica-Bold' }, R]}>Deals profit</Text>
            </View>
            {byMedia.map(x => (
              <View key={x.m} style={S.wRow}>
                <Text style={[S.wLbl, { flex: 1.4, color: INK }]}>{MEDIA[x.m]}</Text><Text style={[S.wVal, { flex: 0.6 }, R]}>{x.n}</Text>
                <Text style={[S.wVal, { flex: 1.3 }, R]}>{inr(x.order)}</Text><Text style={[S.wVal, { flex: 1.3, color: x.profit >= 0 ? GREEN : RED }, R]}>{inr(x.profit)}</Text>
              </View>
            ))}
            <Text style={S.note}>Deal profit = order value (ex-GST) minus dept expense (commission) minus vendor costing minus TDS withheld, counted on payments received so far. Bank expenses are the direct costs paid from the bank for that media (for example the GSRTC capital investment), taken off once as a whole. Common expense is the office total in the share of income these deals brought in.</Text>
          </View>
        </View>
        <Foot on={d.on} />
      </Page>

      <Page size="A4" orientation="landscape" style={S.page} wrap>
        <View style={S.run} fixed><Text style={S.runL}>Deal list</Text><Text style={S.runR}>{d.filterLabel}</Text></View>
        <View style={S.th} fixed>
          <Text style={[S.thT, { width: COLS.no }]}>No</Text><Text style={[S.thT, { width: COLS.dept }]}>Department</Text>
          <Text style={[S.thT, { width: COLS.qty }, R]}>Qty</Text><Text style={[S.thT, { width: COLS.per, paddingLeft: 8 }]}>Period</Text>
          <Text style={[S.thT, { width: COLS.order }, R]}>Order (ex-GST)</Text><Text style={[S.thT, { width: COLS.comm }, R]}>Dept exp</Text>
          <Text style={[S.thT, { width: COLS.vend }, R]}>Vendor</Text><Text style={[S.thT, { width: COLS.tds }, R]}>TDS</Text>
          <Text style={[S.thT, { width: COLS.profit }, R]}>Profit</Text><Text style={[S.thT, { width: COLS.last, paddingLeft: 8 }]}>Last pay</Text>
          <Text style={[S.thT, { width: COLS.st, paddingLeft: 4 }]}>Status</Text>
        </View>
        {d.deals.map((x, i) => (
          <View key={x.id} wrap={false} style={[S.tr, i % 2 ? S.trAlt : null]}>
            <Text style={[S.td, { width: COLS.no, color: INK2 }]}>{i + 1}</Text>
            <View style={{ width: COLS.dept, paddingRight: 6 }}><Text style={S.tdDept}>{x.dept}</Text><Text style={S.tdSub}>{x.no} - {MEDIA[x.media]}</Text></View>
            <Text style={[S.td, { width: COLS.qty, paddingRight: 4 }, R]}>{x.qty || '-'}</Text>
            <Text style={[S.td, { width: COLS.per, paddingLeft: 8, fontSize: 7.6 }]}>{dmy(x.start)} - {dmy(x.end)}</Text>
            <Text style={[S.td, { width: COLS.order }, R]}>{inr(x.order)}</Text>
            <Text style={[S.td, { width: COLS.comm }, R]}>{dash(x.comm)}</Text>
            <Text style={[S.td, { width: COLS.vend }, R]}>{dash(x.vendor)}</Text>
            <Text style={[S.td, { width: COLS.tds }, R]}>{dash(x.tds)}</Text>
            <Text style={[S.td, { width: COLS.profit, fontFamily: 'Helvetica-Bold', color: x.profit >= 0 ? GREEN : RED }, R]}>{inr(x.profit)}</Text>
            <Text style={[S.td, { width: COLS.last, paddingLeft: 8, fontSize: 7.6 }]}>{dmy(x.last)}</Text>
            <Text style={[S.td, { width: COLS.st, paddingLeft: 4, fontSize: 7.6, color: x.status === 'Paid' ? GREEN : AMBER }]}>{x.status}</Text>
          </View>
        ))}
        <View style={S.tot} wrap={false}>
          <Text style={[S.td, { width: COLS.no + COLS.dept, fontFamily: 'Helvetica-Bold' }]}>Total - {d.deals.length} deals</Text>
          <Text style={[S.td, { width: COLS.qty + COLS.per }]} />
          <Text style={[S.td, { width: COLS.order, fontFamily: 'Helvetica-Bold' }, R]}>{inr(d.tot.order)}</Text>
          <Text style={[S.td, { width: COLS.comm, fontFamily: 'Helvetica-Bold' }, R]}>{dash(d.tot.comm)}</Text>
          <Text style={[S.td, { width: COLS.vend, fontFamily: 'Helvetica-Bold' }, R]}>{dash(d.tot.vendor)}</Text>
          <Text style={[S.td, { width: COLS.tds, fontFamily: 'Helvetica-Bold' }, R]}>{dash(d.tot.tds)}</Text>
          <Text style={[S.td, { width: COLS.profit, fontFamily: 'Helvetica-Bold', color: d.tot.profit >= 0 ? GREEN : RED }, R]}>{inr(d.tot.profit)}</Text>
        </View>
        <Foot on={d.on} />
      </Page>
    </Document>
  )
}

export async function buildRevSplitBlob(data) {
  return pdf(<RevSplitDocument d={data} />).toBlob()
}
