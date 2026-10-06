// src/components/ops/DepotContactsModal.jsx — "Who to call · <station>" manager (Phase 337).
// ONE sheet for the exec's dead-end moments (Station board, Tickets, Log): list the station's
// contacts + add one (role chips -> role_en AND role_gu, phone required + normalised) + remove
// the ones YOU added (head/admin can remove any). Self-fetching: the parent passes only the depot.
// DB rules live in supabase_ops_p11_exec_contacts.sql (exec INSERT on own depot, DELETE own rows).
// Global tokens + Lucide (§5/§7); z-index 9000 = the Modal tier (§29).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../v2/Toast'
import { confirmDialog } from '../v2/ConfirmDialog'
import { STR, t } from '../../utils/opsStrings'
import { normalizeIndianPhone } from '../../utils/phone'

// role chip -> opsStrings key. role_en AND role_gu are stored from the same key so a new
// contact is never English-only in the Gujarati field UI.
const ROLE_KEYS = ['role_depot_office', 'role_electrician', 'role_manager', 'role_cleaning', 'role_canteen']

const inp = { width: '100%', boxSizing: 'border-box', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border-strong, var(--border))', borderRadius: 'var(--radius, 10px)', padding: '12px', fontSize: 16 }

export default function DepotContactsModal({ depot, lang = 'gu', meId = null, canDeleteAll = false, nameOf = null, onClose, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(false)       // a FAILED fetch must never read as 'no contacts'
  const [role, setRole] = useState('')               // a ROLE_KEYS entry | 'other' | ''
  const [otherRole, setOtherRole] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState('')
  const latch = useRef(false)                        // §47 synchronous re-entrancy latch

  const load = useCallback(async () => {
    // created_by exists after supabase_ops_p11_exec_contacts.sql; before it runs, retry without it.
    let r = await supabase.from('ops_depot_contacts')
      .select('id, role_en, role_gu, name, phone, display_order, created_by')
      .eq('depot_id', depot.id).order('display_order')
    if (r.error) {
      r = await supabase.from('ops_depot_contacts')
        .select('id, role_en, role_gu, name, phone, display_order')
        .eq('depot_id', depot.id).order('display_order')
    }
    if (r.error) { setLoadErr(true); setLoading(false); return }   // keep the old rows, show Retry — don't pretend the list is empty
    setLoadErr(false); setRows(r.data || []); setLoading(false)
  }, [depot.id, lang])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !latch.current) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const label = (c) => (lang === 'gu' ? (c.role_gu || c.role_en) : (c.role_en || c.role_gu)) || c.name || '—'

  async function add() {
    if (latch.current || busy || loading || loadErr) return   // never add against a list we could not read (dup guard + order would be blind)
    setFormErr('')
    const roleEn = role === 'other' ? otherRole.trim() : (STR[role]?.en || '')
    const roleGu = role === 'other' ? null : (STR[role]?.gu || null)
    if (!roleEn) return setFormErr(t('role_pick_first', lang))
    const p = normalizeIndianPhone(phone)
    if (!p.ok) return setFormErr(t('phone_invalid', lang))
    if (rows.some(r => normalizeIndianPhone(r.phone).value === p.value)) return setFormErr(t('contact_dup', lang))
    latch.current = true; setBusy(true)
    try {
      const { data, error } = await supabase.from('ops_depot_contacts').insert([{
        depot_id: depot.id, role_en: roleEn, role_gu: roleGu, name: name.trim() || null, phone: p.value,
        display_order: rows.reduce((m, r) => Math.max(m, r.display_order || 0), 0) + 1,
      }]).select('id')
      if (error || !data?.length) {
        return toastError({ message: error?.code === '42501' ? t('contact_no_perm', lang) : t('contact_add_failed', lang) })
      }
      setRole(''); setOtherRole(''); setName(''); setPhone('')
      toastSuccess(t('contact_added', lang))
      await load(); onChanged?.()
    } finally { latch.current = false; setBusy(false) }
  }

  async function remove(c) {
    const ok = await confirmDialog({
      title: t('contact_remove_q', lang), message: [label(c), c.phone].filter(Boolean).join(' · '),
      confirmLabel: t('contact_remove', lang), cancelLabel: t('cancel', lang), danger: true,
    })
    if (!ok) return
    // 0 rows = an RLS no-op (e.g. not your row) — never report that as success.
    const { data, error } = await supabase.from('ops_depot_contacts').delete().eq('id', c.id).select('id')
    if (error || !data?.length) return toastError({ message: t('contact_remove_failed', lang) })
    toastSuccess(t('contact_removed', lang)); await load(); onChanged?.()
  }

  const canRemove = (c) => canDeleteAll || (!!meId && c.created_by === meId)
  const addedBy = (c) => {
    if (!c.created_by) return ''
    if (meId && c.created_by === meId) return t('added_by_you', lang)
    const n = nameOf?.(c.created_by)
    return n ? `${t('added_by', lang)} ${n}` : ''
  }

  return (
    <div role="dialog" aria-modal="true" onClick={() => !busy && onClose?.()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 14px)', padding: 20, maxHeight: '86vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>{t('who_to_call', lang)} · {depot.name}</div>
          <button onClick={() => !busy && onClose?.()} aria-label={t('close', lang)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', minWidth: 44, minHeight: 44 }}><X size={20} strokeWidth={1.6} /></button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>{t('add_contact_hint', lang)}</p>

        {loading && <div style={{ padding: '10px 0' }}><Loader2 size={18} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} /></div>}
        {!loading && loadErr && (
          <div style={{ fontSize: 13.5, color: 'var(--danger)', padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1 }}>{t('error_generic', lang)}</span>
            <button type="button" onClick={() => { setLoading(true); load() }} className="btn btn-sec btn-sm" style={{ minHeight: 44 }}>{t('retry', lang)}</button>
          </div>
        )}
        {!loading && !loadErr && rows.length === 0 && <div style={{ fontSize: 13.5, color: 'var(--text-muted)', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>{t('no_contacts_add', lang)}</div>}
        {rows.map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name || label(c)}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{[c.name ? label(c) : null, c.phone].filter(Boolean).join(' · ') || '—'}</div>
              {addedBy(c) && <div style={{ fontSize: 11.5, color: 'var(--text-subtle, var(--text-muted))', marginTop: 2 }}>{addedBy(c)}</div>}
            </div>
            {canRemove(c) && <button onClick={() => remove(c)} aria-label={t('contact_remove', lang)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', minWidth: 44, minHeight: 44 }}><Trash2 size={16} strokeWidth={1.6} /></button>}
          </div>
        ))}

        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('contact_role', lang)}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[...ROLE_KEYS, 'other'].map(k => {
              const on = role === k
              return <button key={k} type="button" onClick={() => { setRole(k); setFormErr('') }} style={{ minHeight: 44, padding: '0 14px', borderRadius: 999, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-soft)' : 'var(--surface-2)', color: on ? 'var(--accent)' : 'var(--text)' }}>
                {k === 'other' ? t('role_other', lang) : (STR[k][lang] || STR[k].en)}</button>
            })}
          </div>
          {role === 'other' && <input value={otherRole} onChange={e => { setOtherRole(e.target.value); setFormErr('') }} placeholder={t('role_other_ph', lang)} maxLength={60} style={inp} />}
          <input value={phone} onChange={e => { setPhone(e.target.value); setFormErr('') }} placeholder={t('contact_phone_ph', lang)} inputMode="tel" autoComplete="off" style={inp} />
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('contact_name_ph', lang)} maxLength={60} style={inp} />
          {formErr && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{formErr}</div>}
          <button className="btn btn-primary" onClick={add} disabled={busy || loading || loadErr}
            style={{ minHeight: 48, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {busy ? <Loader2 size={16} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={16} strokeWidth={1.6} />} {t('add_contact', lang)}
          </button>
        </div>
      </div>
    </div>
  )
}
