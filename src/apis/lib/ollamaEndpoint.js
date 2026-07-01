/**
 * Returns the Ollama base endpoint.
 * Priority: 1) stored ollama_endpoints[0] in localStorage
 *           2) /proxy on localhost
 *           3) hardcoded ngrok fallback
 */
export const getOllamaEndpoint = () => {
  try {
    const stored = localStorage.getItem('ollama_endpoints');
    if (stored) {
      const endpoints = JSON.parse(stored);
      if (Array.isArray(endpoints) && endpoints[0]) return endpoints[0];
    }
  } catch {}

  // In Node (tests/SSR) there is no window — fall back to localhost directly
  const isBrowser = typeof window !== 'undefined';
  const host = isBrowser ? window.location.hostname : '127.0.0.1';
  if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
    return isBrowser ? '/proxy' : 'http://127.0.0.1:11434';
  }
  return 'https://christy-ramentaceous-verbatim.ngrok-free.dev';
};