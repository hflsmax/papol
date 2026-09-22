import React, { useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { login, register } from '../../../shared/api/account.js';

export default function AuthPage({ onAuth, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const result =
        mode === 'login'
          ? await login(email.trim(), password)
          : await register(email.trim(), displayName.trim(), affiliation.trim(), password);
      onAuth(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>{mode === 'login' ? 'Sign in' : 'Join Papol'}</h2>
        <p className="auth-subtitle">
          Papol is your paper reading companion.
        </p>

        {error && <div className="error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          {mode === 'register' && (
            <>
              <div className="form-group">
                <label htmlFor="auth-display-name">Display name</label>
                <input
                  id="auth-display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Use your real name for a professional profile"
                  autoComplete="name"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="auth-affiliation">Affiliation</label>
                <input
                  id="auth-affiliation"
                  type="text"
                  value={affiliation}
                  onChange={(e) => setAffiliation(e.target.value)}
                  placeholder="University, lab, or company (optional)"
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </div>

          <button type="submit" className="primary full-width" disabled={isLoading}>
            {mode === 'login'
              ? (isLoading ? 'Signing in…' : 'Sign in')
              : (isLoading ? 'Creating account…' : 'Create account')}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? (
            <>
              New here?{' '}
              <button className="link-button" onClick={() => { setMode('register'); setError(null); }}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already a member?{' '}
              <button className="link-button" onClick={() => { setMode('login'); setError(null); }}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
