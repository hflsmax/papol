import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The profile's My activity panel (ActivityPanel), on a page of its own at
// /__activity_test, with the application's styles and a pretend server
// answering GET /activity with five weeks of reading: six papers, a few
// sessions a day, the same every time for the same day. No account is
// needed. The letter's recorder (scripts/feature-letter) films it.
const sharedStyles = `/@fs${fileURLToPath(new URL('../../../shared/applicationStyles.js', import.meta.url))}`;

function activityFixture(server) {
  server.middlewares.use('/__activity_test', async (req, res) => {
    const html = `<!doctype html><div id="test-root"></div>
      <script>
        window.__PAPOL_ENV__ = {runtime: 'web', surface: 'desk'};
        const papers = {
          ['a'.repeat(64)]: {title: 'Scaling Laws for Neural Language Models', in_nook: true},
          ['b'.repeat(64)]: {title: 'Deep Residual Learning for Image Recognition', in_nook: true},
          ['c'.repeat(64)]: {title: 'Playing Atari with Deep Reinforcement Learning', in_nook: true},
          ['d'.repeat(64)]: {title: 'The Unreasonable Effectiveness of Recurrent Neural Networks', in_nook: true},
          ['e'.repeat(64)]: {title: 'Attention Is All You Need', in_nook: true},
          ['f'.repeat(64)]: {title: 'On Computable Numbers', in_nook: true},
        };
        const subjects = Object.keys(papers);
        // A small generator seeded by the day, so a day reads the same on
        // every visit.
        const random = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const spans = [];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (let back = 35; back >= 0; back--) {
          const day = new Date(today); day.setDate(day.getDate() - back);
          const next = random(day.getFullYear() * 400 + day.getMonth() * 31 + day.getDate());
          if (day.getDay() === 6 && next() < 0.6) continue;
          const sessions = 1 + Math.floor(next() * 3);
          let hour = 8.5 + next() * 2;
          for (let s = 0; s < sessions; s++) {
            // Most of the time goes to the paper of the moment.
            const subject = subjects[next() < 0.55 ? 0 : 1 + Math.floor(next() * 5)];
            const start = new Date(day.getTime() + hour * 3600e3);
            const minutes = 20 + Math.floor(next() * 70);
            if (start > new Date()) break;
            const end = new Date(Math.min(start.getTime() + minutes * 60e3, Date.now()));
            spans.push({subject, started_at: start.toISOString(), ended_at: end.toISOString(), seconds: Math.round((end - start) / 1000)});
            hour += minutes / 60 + 1 + next() * 4;
            if (hour > 22) break;
          }
        }
        window.fetch = async (url, options = {}) => {
          const address = new URL(String(url), location.origin);
          const json = (value, status = 200) => new Response(JSON.stringify(value), {status});
          if (address.pathname.endsWith('/activity') && (options.method || 'GET') === 'GET') {
            const from = new Date(address.searchParams.get('from')), to = new Date(address.searchParams.get('to'));
            const within = spans.filter((s) => new Date(s.started_at) < to && new Date(s.ended_at) > from);
            return json({spans: within, papers, first_at: spans[0].started_at});
          }
          return json({});
        };
      </script>
      <script type="module">
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import ActivityPanel from '/src/components/ActivityPanel.jsx';
        import {applicationStyles} from '${sharedStyles}';
        createRoot(document.getElementById('test-root')).render(
          React.createElement('div', {style: {maxWidth: 760, margin: '24px auto', padding: '0 24px'}},
            React.createElement('style', null, applicationStyles),
            React.createElement(ActivityPanel)));
      </script>`;
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml('/__activity_test', html));
  });
}

// A Vite server for the frontend with the activity page on it, not yet
// listening.
export function activityServer() {
  return createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'activity-fixture', configureServer: activityFixture }],
  });
}
