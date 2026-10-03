import React, { useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { forgotPassword, login, register, resetPassword } from '../../../shared/api/account.js';

export default function AuthPage({ onAuth, initialMode = 'login', resetToken = '' }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setIsLoading(true);
    try {
      if (mode === 'forgot') {
        const result = await forgotPassword(email.trim());
        setMessage(result.message);
      } else if (mode === 'reset') {
        if (password !== passwordConfirmation) throw new Error('Passwords do not match');
        const result = await resetPassword(resetToken, password);
        setMessage(result.message);
        setMode('complete');
        setPassword('');
      } else {
        const result = mode === 'login'
          ? await login(email.trim(), password)
          : await register(email.trim(), displayName.trim(), affiliation.trim(), password);
        onAuth(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>{mode === 'login' ? 'Sign in' : mode === 'register' ? 'Join Papol' : mode === 'forgot' ? 'Reset password' : mode === 'complete' ? 'Password reset' : 'Choose a new password'}</h2>
        <p className="auth-subtitle">
          Papol is your paper-reading companion.
        </p>

        {error && <div className="error" role="alert">{error}</div>}
        {message && <div className="notice" role="status">{message}</div>}

        {mode !== 'complete' && <form onSubmit={handleSubmit}>
          {mode !== 'reset' && (
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
          )}

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

          {(mode === 'login' || mode === 'register' || mode === 'reset') && <div className="form-group">
            <label htmlFor="auth-password">{mode === 'reset' ? 'New password' : 'Password'}</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </div>}

          {mode === 'reset' && <div className="form-group">
            <label htmlFor="auth-password-confirmation">Confirm new password</label>
            <input
              id="auth-password-confirmation"
              type="password"
              value={passwordConfirmation}
              onChange={(e) => setPasswordConfirmation(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>}

          <button type="submit" className="primary full-width" disabled={isLoading}>
            {mode === 'login'
              ? (isLoading ? 'Signing in…' : 'Sign in')
              : mode === 'register' ? (isLoading ? 'Creating account…' : 'Create account')
                : mode === 'forgot' ? (isLoading ? 'Sending…' : 'Send reset link')
                  : (isLoading ? 'Updating…' : 'Update password')}
          </button>
        </form>}

        <p className="auth-switch">
          {mode === 'login' ? (
            <>
              <button className="link-button" onClick={() => { setMode('forgot'); setError(null); setMessage(null); }}>
                Forgot password?
              </button>
              <br />
              New here?{' '}
              <button className="link-button" onClick={() => { setMode('register'); setError(null); }}>
                Create an account
              </button>
            </>
          ) : mode === 'register' ? (
            <>
              Already a member?{' '}
              <button className="link-button" onClick={() => { setMode('login'); setError(null); }}>
                Sign in
              </button>
            </>
          ) : (
            <button className="link-button" onClick={() => { setMode('login'); setError(null); setMessage(null); }}>
              Return to sign in
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
