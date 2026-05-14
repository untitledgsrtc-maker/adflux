// src/components/v2/primitives/index.js
//
// Phase 35 PR 1 — barrel export. Consumers do
//   import { PageHeader, Modal, StatusBadge, EmptyState, LoadingState,
//            Banner, ActionButton, MonoNumber } from '../components/v2/primitives'
// rather than 8 separate import lines.

export { default as PageHeader }   from './PageHeader'
export { default as Modal }        from './Modal'
export { default as StatusBadge }  from './StatusBadge'
export { default as EmptyState }   from './EmptyState'
export { default as LoadingState } from './LoadingState'
export { default as Banner }       from './Banner'
export { default as ActionButton } from './ActionButton'
export { default as MonoNumber }   from './MonoNumber'
