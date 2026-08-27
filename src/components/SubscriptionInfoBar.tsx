import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  HardDrive,
  Link2,
  Clock,
  Info,
} from 'lucide-react';
import { useConfigStore } from '../store/useConfigStore';
import { isSubscriptionGroup } from '../types/config';

export const SubscriptionInfoBar: React.FC = () => {
  const { t } = useTranslation();
  const { groups, activeGroupId } = useConfigStore();

  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const isSub = isSubscriptionGroup(activeGroup);
  const info = activeGroup?.subscriptionInfo;

  if (!isSub || !info) {
    return null;
  }

  const hasStructuredData =
    !!info.remainingDays ||
    !!info.expireDate ||
    !!info.usedTraffic ||
    !!info.totalTraffic;

  return (
    <div className="h-8 border-b flex items-center justify-between ps-2 sm:ps-3 pe-2 sm:pe-3 bg-transparent border-border/50 text-xs shrink-0 select-none gap-2 overflow-hidden">
      <div className="flex items-center h-full gap-2 min-w-0 shrink overflow-hidden">
        {/* Subscription Header Label */}
        <div className="flex items-center gap-1 text-sky-500 font-semibold text-[11px] shrink-0">
          <Link2 className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">{t('subscriptionInfo')}:</span>
        </div>

        {/* Attached Days & Traffic Usage Container (Flush with bar height, no rounded corners, transparent background) */}
        {hasStructuredData && (
          <div className="h-full flex items-stretch shrink-0 border-x border-border/50 overflow-hidden bg-transparent">
            {/* Days / Expiry Segment */}
            {(info.remainingDays || info.expireDate) && (
              <div
                className="h-full flex items-center gap-1.5 px-2.5 bg-transparent text-foreground text-[11px] font-medium shrink-0 select-none border-e border-border/50"
                title={info.expireDate ? `${t('expires')}: ${info.expireDate}` : undefined}
              >
                <Calendar className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                <span className="font-semibold" dir="ltr">{info.remainingDays || info.expireDate}</span>
                {info.remainingDays && info.expireDate && (
                  <span className="text-[10px] opacity-70 hidden md:inline" dir="ltr">
                    ({info.expireDate})
                  </span>
                )}
              </div>
            )}

            {/* Traffic Usage Segment with In-Place Progress Fill */}
            {(info.usedTraffic || info.totalTraffic) && (
              <div
                className="relative h-full overflow-hidden flex items-center gap-1.5 px-2.5 bg-transparent text-[11px] font-medium shrink-0 select-none"
                title={t('trafficUsage')}
              >
                {/* Transparent progress fill bar (always fills Left-to-Right) */}
                {info.percentUsed !== undefined && (
                  <div
                    className={`absolute inset-y-0 left-0 transition-all duration-300 pointer-events-none ${
                      info.percentUsed > 90
                        ? 'bg-red-500/35 dark:bg-red-500/45'
                        : 'bg-emerald-500/25 dark:bg-emerald-500/30'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, info.percentUsed))}%` }}
                  />
                )}

                {/* High-contrast content on top */}
                <div className="relative z-10 flex items-center gap-1.5 text-foreground dark:text-white font-medium">
                  <HardDrive
                    className={`w-3.5 h-3.5 shrink-0 ${
                      info.percentUsed !== undefined && info.percentUsed > 90
                        ? 'text-red-400'
                        : 'text-emerald-500 dark:text-emerald-400'
                    }`}
                  />
                  <span className="text-muted-foreground dark:text-white/80 hidden sm:inline text-[10px]">
                    {t('trafficUsage')}:
                  </span>
                  <div className="inline-flex items-center gap-1 font-semibold text-foreground dark:text-white tabular-nums" dir="ltr">
                    {info.usedTraffic && <span>{info.usedTraffic}</span>}
                    {info.usedTraffic && info.totalTraffic && <span className="opacity-60">/</span>}
                    <span>{info.totalTraffic}</span>
                  </div>
                  {info.percentUsed !== undefined && (
                    <span className="text-[10px] font-bold text-muted-foreground dark:text-white/90 tabular-nums" dir="ltr">
                      ({info.percentUsed}%)
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Raw Display (if unstructured string) */}
        {!hasStructuredData && info.raw && (
          <div className="h-full flex items-center gap-1.5 px-2.5 bg-transparent text-foreground border-x border-border/50 text-[11px] font-medium shrink-0">
            <Info className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span>{info.raw}</span>
          </div>
        )}
      </div>

      {/* Right side: Last updated time */}
      {activeGroup.lastUpdated && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70 shrink-0 hidden md:flex">
          <Clock className="w-3 h-3" />
          <span>
            {t('lastUpdated')}: {new Date(activeGroup.lastUpdated).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
};
