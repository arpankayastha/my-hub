/**
 * Intercepts fetch() for /api/v1 document preview/download in local mode.
 */

import { handleLocalApi } from './handlers.js';

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const binary = atob(match[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function installLocalFetchInterceptor() {
  if (typeof window === 'undefined' || !window.__MY_HUB_LOCAL_MODE__) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function localFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const apiIdx = url.indexOf('/api/v1/');
    if (apiIdx === -1) return originalFetch(input, init);

    const pathAndQuery = url.slice(apiIdx + '/api/v1'.length);
    const qIdx = pathAndQuery.indexOf('?');
    const path = qIdx >= 0 ? pathAndQuery.slice(0, qIdx) : pathAndQuery;
    const isBinary = /\/documents\/\d+\/(preview|download|thumbnail)$/.test(path);

    if (!isBinary) return originalFetch(input, init);

    try {
      const result = await handleLocalApi('GET', path.replace(/^\//, ''), null, {});
      if (result?.__blob && result.content_data) {
        const blob = dataUrlToBlob(result.content_data);
        if (!blob) return new Response('Invalid content', { status: 500 });
        const headers = new Headers();
        headers.set('Content-Type', result.mime_type || blob.type);
        if (result.download) {
          headers.set('Content-Disposition', `attachment; filename="${result.name || 'document'}"`);
        } else {
          headers.set('Content-Disposition', 'inline');
        }
        return new Response(blob, { status: 200, headers });
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      return new Response(err.message || 'Error', { status: err.status || 500 });
    }
  };
}
