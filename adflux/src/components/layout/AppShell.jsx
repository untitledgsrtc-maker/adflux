// src/components/layout/AppShell.jsx
//
// Top-level authenticated shell. Structure:
//
//   <div class="app-shell">
//     <Sidebar />                 fixed, desktop only
//     <div class="app-main">      flex column, margin-left = sidebar width
//       <Topbar />                sticky
//       <main class="app-content">
//         <Outlet />              routed page
//       </main>
//     </div>
//     <MobileNav />               fixed bottom, mobile only
//   </div>
//
// All spacing and the desktop/mobile toggle live in globals.css.

import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { MobileNav } from './MobileNav'

export function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Topbar />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
      <MobileNav />
    </div>
  )
}
