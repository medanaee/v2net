import type { ComponentType, SVGProps } from 'react';
import { GeminiIcon } from '../components/icons/GeminiIcon';
import { ColabIcon } from '../components/icons/ColabIcon';
import { OverleafIcon } from '../components/icons/OverleafIcon';

export type SiteIconProps = SVGProps<SVGSVGElement>;

export type SiteDef = {
  /** Stable key sent to Rust; probe logic lives in the backend per id. */
  id: string;
  nameKey: string;
  Icon: ComponentType<SiteIconProps>;
  colorClass?: string;
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
    colorClass: 'text-sky-500',
  },
  {
    id: 'colab',
    nameKey: 'siteColab',
    Icon: ColabIcon,
    colorClass: 'text-amber-500',
  },
  {
    id: 'overleaf',
    nameKey: 'siteOverleaf',
    Icon: OverleafIcon,
    colorClass: 'text-emerald-500',
  },
];

export function getSiteById(id: string): SiteDef | undefined {
  return SITE_CATALOG.find((s) => s.id === id);
}

/** Resolve selected ids → catalog entries (drops unknown ids). */
export function resolveSelectedSites(selectedIds: string[] | undefined | null): SiteDef[] {
  if (!selectedIds || selectedIds.length === 0) {
    return SITE_CATALOG;
  }
  // If stored settings only have legacy 'gemini' when more catalog sites exist, upgrade to all sites
  const ids =
    selectedIds.length === 1 && selectedIds[0] === 'gemini' && SITE_CATALOG.length > 1
      ? SITE_CATALOG.map((s) => s.id)
      : selectedIds;
  const resolved = ids
    .map((id) => getSiteById(id))
    .filter((s): s is SiteDef => !!s);
  return resolved.length > 0 ? resolved : SITE_CATALOG;
}
