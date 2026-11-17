// The toolbar button's panel: switch the automatic opening off and on, open
// the page in front of you in Papol when it is a PDF the rules missed, and
// choose which Papol (a development build answers on 127.0.0.1:5173).
(async () => {
  const api = globalThis.browser ?? globalThis.chrome;
  const Policy = globalThis.PapolPolicy;
  const enabled = document.getElementById('enabled');
  const hint = document.getElementById('hint');
  const origin = document.getElementById('origin');
  const openHere = document.getElementById('open-here');
  const status = document.getElementById('status');

  const chosen = await api.storage.local.get({ enabled: true, origin: Policy.DEFAULT_ORIGIN });
  enabled.checked = chosen.enabled;
  hint.classList.toggle('off', !chosen.enabled);
  for (const address of Policy.ORIGINS) {
    const option = document.createElement('option');
    option.value = address;
    option.textContent = address.replace(/^https?:\/\//, '');
    option.selected = address === chosen.origin;
    origin.append(option);
  }

  enabled.addEventListener('change', async () => {
    await api.storage.local.set({ enabled: enabled.checked });
    hint.classList.toggle('off', !enabled.checked);
  });
  origin.addEventListener('change', () => api.storage.local.set({ origin: origin.value }));

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const web = /^https?:/.test(tab?.url || '');
  if (!web || Policy.isPapol(tab.url, chosen.origin)) openHere.disabled = true;
  openHere.addEventListener('click', async () => {
    const answer = await api.runtime.sendMessage({ type: 'open-here' });
    if (answer?.opened) window.close();
    else status.textContent = 'This page cannot be opened in Papol.';
  });
})();
