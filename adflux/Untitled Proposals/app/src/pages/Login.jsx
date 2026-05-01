// =====================================================================
// Login page — email + password.
// MFA enrollment lives at /admin (owner-only) and is enforced by Supabase
// Auth itself (AAL2 required for sensitive RPCs at the API layer).
// =====================================================================

import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '@/store/authStore';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password is required'),
});

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, signIn } = useAuthStore();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  // Already signed in? Bounce to wherever they came from.
  useEffect(() => {
    if (session) {
      const dest = location.state?.from || '/';
      navigate(dest, { replace: true });
    }
  }, [session, navigate, location]);

  async function onSubmit(values) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await signIn(values);
    } catch (err) {
      setSubmitError(err.message || 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--up-bg-tint)', padding: 16,
    }}>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="up-card up-stack-4"
        style={{ width: '100%', maxWidth: 380 }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Untitled Proposals</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--up-ink-muted)', fontSize: 13 }}>
            Sign in with your work email.
          </p>
        </div>

        <div className="up-field">
          <label className="up-field__label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={`up-input ${errors.email ? 'up-input--invalid' : ''}`}
            {...register('email')}
          />
          {errors.email && <div className="up-field__error">{errors.email.message}</div>}
        </div>

        <div className="up-field">
          <label className="up-field__label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className={`up-input ${errors.password ? 'up-input--invalid' : ''}`}
            {...register('password')}
          />
          {errors.password && <div className="up-field__error">{errors.password.message}</div>}
        </div>

        {submitError && (
          <div style={{
            padding: 10, borderRadius: 6,
            background: '#fef2f2', color: '#b91c1c',
            fontSize: 13,
          }}>
            {submitError}
          </div>
        )}

        <button type="submit" className="up-btn up-btn--primary up-btn--lg" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p style={{ fontSize: 12, color: 'var(--up-ink-soft)', textAlign: 'center', margin: 0 }}>
          Forgot password? Ask the owner to reset it.
        </p>
      </form>
    </div>
  );
}
