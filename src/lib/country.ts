import { invoke } from '@tauri-apps/api/core';
import { useConfigStore } from '../store/useConfigStore';

export type CountryInfo = {
  code: string;
  name: string;
  ip: string;
};

const resultCache = new Map<string, CountryInfo>();
const inflight = new Map<string, Promise<CountryInfo | null>>();

/** Localized region name via Intl (works offline once we have ISO code). */
export function countryDisplayName(code: string, lang: 'fa' | 'en'): string {
  const locale = lang === 'fa' ? 'fa' : 'en';
  try {
    return (
      new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase()) ||
      code.toUpperCase()
    );
  } catch {
    return code.toUpperCase();
  }
}

async function lookupCountryCached(host: string): Promise<CountryInfo | null> {
  const key = host.trim().toLowerCase();
  if (!key) return null;

  const cached = resultCache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = invoke<CountryInfo>('lookup_country', { host: key })
    .then((info) => {
      if (info?.code) {
        resultCache.set(key, info);
        if (info.ip) resultCache.set(info.ip.toLowerCase(), info);
      }
      return info;
    })
    .catch((err) => {
      console.warn('[country] lookup failed for', key, err);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/**
 * After real-delay successes, resolve country for unique server hosts
 * and write ISO codes onto matching configs.
 */
export async function ensureCountriesForConfigIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const state = useConfigStore.getState();
  const byHost = new Map<string, string[]>();

  for (const id of ids) {
    const cfg = state.configs.find((c) => c.id === id);
    if (!cfg?.address) continue;
    if (cfg.countryCode) continue;
    if (cfg.realDelay == null || cfg.realDelay < 0) continue;

    const host = cfg.address.trim().toLowerCase();
    const list = byHost.get(host) ?? [];
    list.push(id);
    byHost.set(host, list);
  }

  const hosts = [...byHost.keys()];
  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < hosts.length) {
      const index = cursor++;
      const host = hosts[index];
      const info = await lookupCountryCached(host);
      if (!info?.code) continue;
      const idsForHost = byHost.get(host) ?? [];
      useConfigStore.getState().setConfigsCountry(idsForHost, info.code);
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, () => worker()));
}
