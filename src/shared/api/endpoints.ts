import api from '../../api_endpoints.json';

type Key = Exclude<keyof typeof api, 'api_base_url'>;

export function ep(key: Key): string {
  const base = String(api.api_base_url).replace(/\/+$/, '');
  const path = String(api[key]).replace(/^\/+/, '');
  return `${base}/${path}`;
}

export const API_BASE = String(api.api_base_url).replace(/\/+$/, '');
