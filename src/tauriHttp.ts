// Helper Tauri plugin-http
import { fetch } from '@tauri-apps/plugin-http';
import { useAuth } from './contexts/AuthContext';
import apiEndpoints from './api_endpoints.json';

type EndpointKey = Exclude<keyof typeof apiEndpoints, 'api_base_url'>;

function isEndpointKey(key: string): key is EndpointKey {
  return (
    key in apiEndpoints &&
    key !== 'api_base_url'
  );
}

export async function tauriHttpRequest(url: string, options: any = {}) {
  // Get valid access token
  // Must be called from a React component or custom hook for useAuth() to be valid
  const { getValidAccessToken } = useAuth();
  const token = await getValidAccessToken();

  let resolvedUrl = url;
  if (isEndpointKey(url)) {
    resolvedUrl = apiEndpoints.api_base_url + apiEndpoints[url];
  }
  let fixedUrl = resolvedUrl.replace(/([^:])\/\/+/, '$1/');
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Debug log
  // eslint-disable-next-line no-console
  console.log('[tauriHttpRequest] URL:', fixedUrl, 'Options:', options);
  const response = await fetch(fixedUrl, {
    method: options.method || 'GET',
    headers,
    body: (options.body && typeof options.body !== 'string') ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json();
  if (response.status >= 200 && response.status < 300) {
    return data;
  } else {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  }
}
