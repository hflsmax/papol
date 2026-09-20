import React from 'react';
import FeedbackDialog from './FeedbackDialog.jsx';
import { submitFeedback } from '../api/feedback.js';
import { unexpectedDesktopErrorReport } from '../errorReport.js';
import { recordDiagnosticEvent } from '../nativeData.js';
import { IS_DESKTOP } from '../appEnvironment.js';
import { commonStyles } from '../commonStyles.js';

/**
 * The wall between one surface and the whole window.
 *
 * A render that throws unmounts everything above it, and an application
 * whose report dialog lives in that same tree goes blank with nothing to
 * say. This boundary keeps the crash to the surface that raised it, says
 * so in place, and offers to report it — the offer is the point: an error
 * nobody hears about is an error that stays.
 *
 * Give it a `key` from the route so leaving the broken page starts clean,
 * and an `area` naming the surface for the report.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, report: null, reporting: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true, reporting: false };
  }

  componentDidCatch(error) {
    const report = unexpectedDesktopErrorReport(error, this.props.area || 'rendering this page', {
      runtime: IS_DESKTOP ? 'desktop' : 'web',
      surface: window.__PAPOL_ENV__?.surface,
      platform: navigator.platform,
    });
    void recordDiagnosticEvent({
      level: 'error', component: 'frontend', event: 'render_crash',
      message: error?.message || String(error),
      fields: { error_type: error?.name || typeof error, operation: this.props.area || 'render' },
    });
    this.setState({ report });
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="panel render-error" role="alert">
        {/* A crash at an app's root takes the app's own stylesheet with it,
            so the panel dresses itself. Under a surviving stylesheet the
            same rules land twice, which is the same look once. */}
        <style>{commonStyles}</style>
        <h2>This page hit a bug</h2>
        <p>
          The rest of Papol is still running. Reporting what happened is the
          fastest way to get it fixed — the report is shown to you first.
        </p>
        <div className="render-error-actions">
          <button
            type="button"
            className="primary"
            onClick={() => this.setState({ reporting: true })}
          >
            Report this problem
          </button>
          <button
            type="button"
            onClick={() => this.setState({ crashed: false, report: null })}
          >
            Try again
          </button>
        </div>
        {this.state.reporting && this.state.report && (
          <FeedbackDialog
            submit={submitFeedback}
            initialContent={this.state.report.content}
            reportError
            onClose={() => this.setState({ reporting: false })}
          />
        )}
      </div>
    );
  }
}
