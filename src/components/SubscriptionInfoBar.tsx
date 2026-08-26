import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  HardDrive,
  RefreshCw,
  Link2,
  Clock,
  Info,
} from 'lucide-react';
import { useConfigStore } from '../store/useConfigStore';
import { isSubscriptionGroup } from '../types/config';
import { Button } from './ui/button';

export const SubscriptionInfoBar: React.FC = () => {
  const { t } = useTranslation();
  const { groups, activeGroupId, refreshSubscription } = useConfigStore();
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const isSub = isSubscriptionGroup(activeGroup);
  const info = activeGroup?.subscriptionInfo;

  if (!isSub || !info) {
    return null;
  }

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const count = await refreshSubscription(activeGroupId);
      showToast(`${count} ${t('subscriptionRefreshed')}`);
    } catch (e) {
      console.error(e);
      showToast(t('subscriptionRefreshFailed'));
    } finally {
      setRefreshing(false);
    }
  };

  const hasStructuredData =
    !!info.remainingDays ||
    !!info.expireDate ||
    !!info.usedTraffic ||
    !!info.totalTraffic;

  return (
    <div className="h-8 border-b flex items-center justify-between px-2 sm:px-3 bg-background border-border/50 text-xs shrink-0 select-none gap-2 overflow-x-auto overflow-y-hidden">
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* Subscription Header Label */}
        <div className="flex items-center gap-1 text-sky-500 font-semibold text-[11px] shrink-0">
          <Link2 className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">{t('subscriptionInfo')}:</span>
        </div>

        {/* Days / Expiry Badge */}
        {(info.remainingDays || info.expireDate) && (
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/60 text-foreground border border-border/40 text-[11px] font-medium shrink-0"
            title={info.expireDate ? `${t('expires')}: ${info.expireDate}` : undefined}
          >
            <Calendar className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span className="font-semibold">{info.remainingDays || info.expireDate}</span>
            {info.remainingDays && info.expireDate && (
              <span className="text-[10px] opacity-70 hidden md:inline">
                ({info.expireDate})
              </span>
            )}
          </div>
        )}

        {/* Traffic Usage Badge */}
        {(info.usedTraffic || info.totalTraffic) && (
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/60 text-foreground border border-border/40 text-[11px] font-medium shrink-0"
            title={t('trafficUsage')}
          >
            <HardDrive className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="text-muted-foreground/80 hidden sm:inline text-[10px]">
              {t('trafficUsage')}:
            </span>
            <span className="font-semibold tabular-nums">
              {info.usedTraffic ? `${info.usedTraffic} / ` : ''}
              {info.totalTraffic}
            </span>
          </div>
        )}

        {/* Progress Bar (if percentage is parsed) */}
        {info.percentUsed !== undefined && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-14 sm:w-20 md:w-28 h-1.5 bg-muted rounded-full overflow-hidden border border-border/50">
              <div
                className={`h-full transition-all duration-300 ${
                  info.percentUsed > 90
                    ? 'bg-red-500'
                    : info.percentUsed > 75
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, info.percentUsed))}%` }}
              />
            </div>
            <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
              {info.percentUsed}%
            </span>
          </div>
        )}

        {/* Raw Display (if unstructured string) */}
        {!hasStructuredData && info.raw && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted text-foreground border border-border/50 text-[11px] font-medium shrink-0">
            <Info className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span>{info.raw}</span>
          </div>
        )}
      </div>

      {/* Right side: Last updated time & Refresh Button */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {activeGroup.lastUpdated && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70 hidden lg:flex">
            <Clock className="w-3 h-3" />
            <span>
              {t('lastUpdated')}: {new Date(activeGroup.lastUpdated).toLocaleTimeString()}
            </span>
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-sky-500 hover:bg-sky-500/10 shrink-0"
          title={t('refreshSubscription')}
          disabled={refreshing}
          onClick={handleRefresh}
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {toast && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-3 py-1.5 rounded shadow-lg border border-slate-700 z-50">
          {toast}
        </div>
      )}
    </div>
  );
};
