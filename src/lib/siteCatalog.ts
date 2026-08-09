import type { ComponentType, SVGProps } from 'react';
import { GeminiIcon } from '../components/icons/GeminiIcon';

export type SiteIconProps = SVGProps<SVGSVGElement>;

export type SiteDef = {
  /** Stable key sent to Rust; probe logic lives in the backend per id. */
  id: string;
  nameKey: string;
  Icon: ComponentType<SiteIconProps>;
};

/**
 * Fixed catalog of sites Site Test can check.
 * To add a site later: append one entry + icon + i18n key, and add a match arm in Rust.
 * Settings, table column, and invoke all consume this list generically.
 */
export const SITE_CATALOG: SiteDef[] = [
  {
    id: 'gemini',
    nameKey: 'siteGemini',
    Icon: GeminiIcon,
  },
];

export function getSiteById(id: string): SiteDef | undefined {
  return SITE_CATALOG.find((s) => s.id === id);
}

/** Resolve selected ids → catalog entries (drops unknown ids). */
export function resolveSelectedSites(selectedIds: string[] | undefined | null): SiteDef[] {
  const ids = selectedIds?.length ? selectedIds : ['gemini'];
  const resolved = ids
    .map((id) => getSiteById(id))
    .filter((s): s is SiteDef => !!s);
  return resolved.length > 0 ? resolved : SITE_CATALOG.slice(0, 1);
}
