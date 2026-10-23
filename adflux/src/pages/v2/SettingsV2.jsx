// src/pages/v2/SettingsV2.jsx
//
// Day mode was removed (24 Oct 2026, section 491): the app is night-only.
// There is nothing to configure here yet; the page stays so /settings links
// keep working.

import { PageHeader, Banner } from '../../components/v2/primitives'

export default function SettingsV2() {
  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <PageHeader title="Settings" />
      <Banner tone="info">The app uses the Night theme on every device. There are no settings to change yet.</Banner>
    </div>
  )
}
