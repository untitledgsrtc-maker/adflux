// src/pages/v2/PrimitivesDemoV2.jsx
//
// Phase 35 PR 1 — admin-only demo route. Renders every primitive in
// every documented variant so owner can eyeball them on Vercel staging.
// Replaces the absent unit-test layer for this codebase: rep walks the
// demo on a 390 px viewport and a 1440 px viewport and either signs
// off or files specific feedback before PR 2 starts.

import { useState } from 'react'
import { Inbox, Phone, Plus, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import {
  PageHeader, Modal, StatusBadge, EmptyState, LoadingState,
  Banner, ActionButton, MonoNumber,
} from '../../components/v2/primitives'

export default function PrimitivesDemoV2() {
  const { profile, isPrivileged } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)

  // Admin-only — sales/agency/telecaller bounce.
  if (!isPrivileged) {
    return (
      <div style={{ padding: 40 }}>
        <Banner tone="danger">Admin only.</Banner>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>

      <PageHeader title="Primitives demo" subtitle="Phase 35 PR 1 — every variant of every primitive. Sign-off gate before PR 2." />

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>PageHeader</h2>
      <PageHeader title="Plain title" />
      <PageHeader title="With eyebrow + subtitle" eyebrow="EYEBROW" subtitle="Subtitle line." />
      <PageHeader title="With actions" subtitle="Right-side slot." actions={<ActionButton size="sm">Action</ActionButton>} />
      <PageHeader title="Compact" hero="compact" subtitle="hero='compact'" />
      <PageHeader title="₹4.2 L incentive" hero="full" eyebrow="HERO FULL" subtitle="Used on /work + /my-performance only." />

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>StatusBadge</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <StatusBadge tint="success">Won</StatusBadge>
        <StatusBadge tint="warning">Pending</StatusBadge>
        <StatusBadge tint="danger">Lost</StatusBadge>
        <StatusBadge tint="blue">New</StatusBadge>
        <StatusBadge tint="purple">Forecast</StatusBadge>
        <StatusBadge tint="yellow">Hot</StatusBadge>
        <StatusBadge tint="orange">Stale</StatusBadge>
        <StatusBadge tint="neutral">Draft</StatusBadge>
        <StatusBadge tint="success" icon={CheckCircle2}>With icon</StatusBadge>
        <StatusBadge tint="success" size="sm">Small</StatusBadge>
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>ActionButton</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <ActionButton variant="primary">Primary</ActionButton>
        <ActionButton variant="ghost">Ghost</ActionButton>
        <ActionButton variant="danger">Danger</ActionButton>
        <ActionButton variant="subtle">Subtle</ActionButton>
        <ActionButton iconLeft={Plus}>With icon</ActionButton>
        <ActionButton size="sm">Small</ActionButton>
        <ActionButton size="lg">Large</ActionButton>
        <ActionButton disabled>Disabled</ActionButton>
        <ActionButton loading>Loading</ActionButton>
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>Banner</h2>
      <Banner tone="success">Saved.</Banner>
      <Banner tone="warning">Heads up.</Banner>
      <Banner tone="danger" onDismiss={() => {}}>Could not save.</Banner>
      <Banner tone="info">FYI.</Banner>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>EmptyState</h2>
      <EmptyState
        icon={Inbox}
        title="No leads yet"
        sub="Tap below to add your first lead."
        action={{ label: '+ Add lead', onClick: () => {} }}
      />

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>LoadingState</h2>
      <div style={{ marginBottom: 16 }}><LoadingState type="inline" /></div>
      <LoadingState type="page" label="Loading…" />
      <table style={{ width: '100%', marginTop: 16, borderCollapse: 'collapse' }}>
        <thead>
          <tr><th>Name</th><th>Company</th><th>Phone</th><th>Stage</th></tr>
        </thead>
        <tbody>
          <LoadingState type="table" rows={3} columns={4} />
        </tbody>
      </table>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>MonoNumber</h2>
      <p>Phone <MonoNumber>9876543210</MonoNumber>, amount <MonoNumber size={14}>₹2,34,567</MonoNumber>, ID <MonoNumber>UA-2026-0042</MonoNumber>.</p>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 32 }}>Modal</h2>
      <ActionButton onClick={() => setModalOpen(true)}>Open modal</ActionButton>
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Demo modal"
        size="md"
        footer={
          <>
            <ActionButton variant="ghost" size="sm" onClick={() => setModalOpen(false)}>Cancel</ActionButton>
            <ActionButton variant="primary" size="sm" onClick={() => setModalOpen(false)}>OK</ActionButton>
          </>
        }
      >
        <p>Body content. Esc closes. Backdrop click closes.</p>
        <p style={{ marginTop: 12 }}>Logged in as <MonoNumber>{profile?.email}</MonoNumber>.</p>
      </Modal>
    </div>
  )
}
