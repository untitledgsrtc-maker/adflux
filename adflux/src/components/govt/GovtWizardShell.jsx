// src/components/govt/GovtWizardShell.jsx
//
// Shared shell for the Government Auto Hood + GSRTC LED wizards.
// Renders the page header, step indicator, body slot, and
// Next/Back/Save nav. Steps are passed in as { id, label, render }.
// The shell itself is dumb — state lives in the parent (Auto Hood
// or GSRTC LED page) so we don't have to invent a generic state
// shape that fits both.
//
// Visual matches AdFlux design tokens. No new patterns.

import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function GovtWizardShell({
  kicker = 'Government',
  title,
  steps,
  step,
  goBack,
  goNext,
  onCancel,
  saving = false,
  isLastStep = false,
  primaryLabel = 'Save Draft',
  onPrimary,
  children,
}) {
  const navigate = useNavigate()
  const handleCancel = onCancel || (() => navigate('/quotes/new'))

  return (
    <div className="govt-wiz">
      <div className="govt-wiz__head">
        <div>
          <div className="govt-wiz__kicker">{kicker}</div>
          <h1 className="govt-wiz__title">{title}</h1>
        </div>
        <button type="button" className="govt-wiz__back" onClick={handleCancel}>
          <ArrowLeft size={14} /> Cancel
        </button>
      </div>

      {/* Steps */}
      <div className="govt-wiz__steps">
        {steps.map((s, i) => {
          const done = step > s.id
          const active = step === s.id
          return (
            <div className="govt-wiz__step" key={s.id}>
              <div
                className={
                  'govt-wiz__step-dot' +
                  (active ? ' govt-wiz__step-dot--active' : '') +
                  (done   ? ' govt-wiz__step-dot--done' : '')
                }
              >
                {done ? <Check size={13} /> : s.id}
              </div>
              <span
                className={
                  'govt-wiz__step-label' +
                  (active ? ' govt-wiz__step-label--active' : '')
                }
              >
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div
                  className={
                    'govt-wiz__step-line' +
                    (done ? ' govt-wiz__step-line--done' : '')
                  }
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Body */}
      <div className="govt-wiz__body">{children}</div>

      {/* Nav */}
      <div className="govt-wiz__nav">
        <button
          type="button"
          className="govt-wiz__btn"
          onClick={goBack}
          disabled={step === 1 || saving}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div style={{ display: 'flex', gap: 10 }}>
          {!isLastStep && (
            <button
              type="button"
              className="govt-wiz__btn govt-wiz__btn--primary"
              onClick={goNext}
              disabled={saving}
            >
              Next <ArrowRight size={14} />
            </button>
          )}
          {isLastStep && (
            <button
              type="button"
              className="govt-wiz__btn govt-wiz__btn--primary"
              onClick={onPrimary}
              disabled={saving}
            >
              {saving ? 'Saving…' : primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
