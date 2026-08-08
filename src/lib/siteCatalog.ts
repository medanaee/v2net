import type { ComponentType, SVGProps } from 'react';
import { GeminiIcon } from '../components/icons/GeminiIcon';

export type SiteIconProps = SVGProps<SVGSVGElement>;

export type SiteDef = {
  id: string;
  nameKey: string;
  checkUrl: string;
  Icon: ComponentType<SiteIconProps>;
};

/**
 * Fixed catalog of sites Site Test can check.
 * To add a site later: append one entry + icon component + i18n key.
 * Settings, table column, and Rust invoke all consume this list generically.
 */
export const SITE_CATALOG: SiteDef[] = [
  {
    id: 'gemini',
    nameKey: 'siteGemini',
    checkUrl: 'https://gemini.google.com/',
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
