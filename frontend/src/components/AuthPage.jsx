import React, { useState } from 'react';
import { login, register } from '../api';

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
          Every reader gets a nook — share the papers you read, rate them, and
          gather to discuss.
        </p>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
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
                <label>Display name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Use your real name for a professional profile"
                  autoComplete="name"
                  required
                />
              </div>

              <div className="form-group">
                <label>Affiliation</label>
                <input
                  type="text"
                  value={affiliation}
                  onChange={(e) => setAffiliation(e.target.value)}
                  placeholder="University, lab, or company (optional)"
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </div>

          <button type="submit" className="primary full-width" disabled={isLoading}>
            {isLoading
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? (
            <>
              New here?{' '}
              <button className="link-btn" onClick={() => { setMode('register'); setError(null); }}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already a member?{' '}
              <button className="link-btn" onClick={() => { setMode('login'); setError(null); }}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
