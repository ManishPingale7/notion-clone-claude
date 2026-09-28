import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../store';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const navigate = useNavigate();
  const setMe = useApp((s) => s.setMe);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = mode === 'login' ? await api.post('/api/auth/login', { email, password }) : await api.post('/api/auth/signup', { email, name, password });
      setMe(data);
      const next = new URLSearchParams(location.search).get('next');
      navigate(next && next.startsWith('/') ? next : '/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <header className="auth-header">
        <div className="auth-logo">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Notion</span>
        </div>
      </header>
      <div className="auth-box">
        <h1>{mode === 'login' ? 'Log in' : 'Sign up'}</h1>
        <p className="auth-sub">{mode === 'login' ? 'Log in to your Notion account' : 'Create your Notion account'}</p>
        <form onSubmit={submit} className="auth-form" data-testid="auth-form">
          <label>Email</label>
          <input className="input" type="email" autoComplete="email" placeholder="Enter your email address…" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus data-testid="auth-email" />
          {mode === 'signup' && (
            <>
              <label>What should we call you?</label>
              <input className="input" autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required data-testid="auth-name" />
            </>
          )}
          <label>Password</label>
          <input
            className="input"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder={mode === 'login' ? 'Enter your password…' : 'At least 8 characters'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'signup' ? 8 : undefined}
            data-testid="auth-password"
          />
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy} data-testid="auth-submit">
            {busy ? 'Please wait…' : mode === 'login' ? 'Continue' : 'Create account'}
          </button>
        </form>
        <div className="auth-switch">
          {mode === 'login' ? (
            <>
              Don't have an account? <Link to="/signup">Sign up</Link>
            </>
          ) : (
            <>
              Already have an account? <Link to="/login">Log in</Link>
            </>
          )}
        </div>
        <p className="auth-terms faint">This is a self-hosted Notion clone. Your data is stored locally on this server.</p>
      </div>
    </div>
  );
}
