import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ArrowDown, ArrowUp, Zap, Play, Share2 } from 'lucide-react';
import { startProxyWithConfig } from '../lib/proxy';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useConfigStore } from '../store/useConfigStore';
import { ConfigItem } from '../types/config';
import { Checkbox } from './ui/checkbox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { CountryFlag } from './CountryFlag';
import { countryDisplayName } from '../lib/country';
import { ShareConfigDialog } from './ShareConfigDialog';

interface ConfigTableProps {
  searchQuery: string;
}

export const ConfigTable: React.FC<ConfigTableProps> = ({ searchQuery }) => {
  const { t } = useTranslation();
  const {
    configs,
    activeGroupId,
    activeTab,
    selectedConfigIds,
    handleConfigClick,
    selectAllVisible,
    clearSelection,
    addConfigsFromText,
    settings,
    updateSettings,
    isGroupSubscription,
  } = useConfigStore();

  const isSubscription = isGroupSubscription(activeGroupId);

  const parentRef = useRef<HTMLDivElement>(null);

  type SortColumn = 'ping' | 'country' | 'speed';
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [secondarySortColumn, setSecondarySortColumn] = useState<SortColumn | null>(null);
  const [secondarySortDirection, setSecondarySortDirection] = useState<'asc' | 'desc'>('asc');
  const [sortTip, setSortTip] = useState<string | null>(null);
  const [shareConfig, setShareConfig] = useState<ConfigItem | null>(null);

  const showSecondarySortTipOnce = () => {
    if (settings.hasSeenSecondarySortTip) return;
    updateSettings({ hasSeenSecondarySortTip: true });
    setSortTip(t('secondarySortTip'));
    window.setTimeout(() => setSortTip(null), 4500);
  };

  const handleSort = (column: SortColumn) => {
    showSecondarySortTipOnce();
    if (sortColumn === column) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumn(null);
        setSecondarySortColumn(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection('asc');
      if (secondarySortColumn === column) {
        setSecondarySortColumn(null);
      }
    }
  };

  /** Right-click: secondary key when primary values tie. */
  const handleSecondarySort = (column: SortColumn) => {
    if (!sortColumn || sortColumn === column) {
      if (sortColumn === column) setSecondarySortColumn(null);
      return;
    }
    showSecondarySortTipOnce();
    if (secondarySortColumn === column) {
      if (secondarySortDirection === 'asc') setSecondarySortDirection('desc');
      else setSecondarySortColumn(null);
    } else {
      setSecondarySortColumn(column);
      setSecondarySortDirection('asc');
    }
  };

  const renderSortIcon = (column: SortColumn) => {
    if (sortColumn === column) {
      return sortDirection === 'asc' ? (
        <ArrowUp className="w-3 h-3 mx-1 inline-block" />
      ) : (
        <ArrowDown className="w-3 h-3 mx-1 inline-block" />
      );
    }
    if (secondarySortColumn === column) {
      return (
        <span className="inline-flex items-center mx-1 opacity-70 text-sky-500 dark:text-sky-400">
          {secondarySortDirection === 'asc' ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          )}
          <span className="text-[9px] font-bold leading-none ml-0.5">2</span>
        </span>
      );
    }
    return null;
  };

  const compareByColumn = (
    a: ConfigItem,
    b: ConfigItem,
    column: SortColumn,
    direction: 'asc' | 'desc',
    lang: string
  ): number => {
    if (column === 'country') {
      const nameA = a.countryCode ? countryDisplayName(a.countryCode, lang) : '';
      const nameB = b.countryCode ? countryDisplayName(b.countryCode, lang) : '';
      if (!nameA && !nameB) return 0;
      if (!nameA) return 1;
      if (!nameB) return -1;
      const cmp = nameA.localeCompare(nameB, lang, { sensitivity: 'base' });
      return direction === 'asc' ? cmp : -cmp;
    }

    let valA = 0;
    let valB = 0;
    if (column === 'ping') {
      valA = a.realDelay ?? Infinity;
      valB = b.realDelay ?? Infinity;
      if (valA === -1) valA = Infinity;
      if (valB === -1) valB = Infinity;
    } else if (column === 'speed') {
      // Prefer download; tie-break on upload within the combined column.
      valA = a.downloadSpeed ?? -1;
      valB = b.downloadSpeed ?? -1;
      if (valA === valB) {
        const upA = a.uploadSpeed ?? -1;
        const upB = b.uploadSpeed ?? -1;
        if (upA < upB) return direction === 'asc' ? -1 : 1;
        if (upA > upB) return direction === 'asc' ? 1 : -1;
        return 0;
      }
    }

    if (valA < valB) return direction === 'asc' ? -1 : 1;
    if (valA > valB) return direction === 'asc' ? 1 : -1;
    return 0;
  };

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const lang = settings.language === 'fa' ? 'fa' : 'en';
    let items = configs.filter((c) => {
      if (c.groupId !== activeGroupId) return false;
      if (c.status !== activeTab) return false;
      if (!query) return true;

      const countryLabel = c.countryCode
        ? countryDisplayName(c.countryCode, lang).toLowerCase()
        : '';

      return (
        c.name.toLowerCase().includes(query) ||
        c.address.toLowerCase().includes(query) ||
        c.port.toString().includes(query) ||
        c.protocol.toLowerCase().includes(query) ||
        (c.countryCode || '').toLowerCase().includes(query) ||
        countryLabel.includes(query)
      );
    });

    if (sortColumn) {
      items = [...items].sort((a, b) => {
        const primary = compareByColumn(a, b, sortColumn, sortDirection, lang);
        if (primary !== 0) return primary;
        if (secondarySortColumn) {
          return compareByColumn(a, b, secondarySortColumn, secondarySortDirection, lang);
        }
        return 0;
      });
    }

    return items;
  }, [
    configs,
    activeGroupId,
    activeTab,
    searchQuery,
    sortColumn,
    sortDirection,
    secondarySortColumn,
    secondarySortDirection,
    settings.language,
  ]);

  const virtualizer = useVirtualizer({
    count: visibleItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  const selectedSet = useMemo(() => new Set(selectedConfigIds), [selectedConfigIds]);

  const isAllSelected =
    visibleItems.length > 0 && visibleItems.every((item) => selectedSet.has(item.id));

  const handleHeaderCheckboxChange = (checked: boolean) => {
    if (checked) {
      selectAllVisible(visibleItems);
    } else {
      clearSelection();
    }
  };

  const connectingRef = React.useRef(false);

  const handleConnect = async (item: ConfigItem) => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    updateSettings({ activeConfigId: item.id });
    try {
      await startProxyWithConfig(
        item,
        settings.localPort || 10900,
        settings.systemProxyMode || 'dont_change',
        useConfigStore.getState().tunMode
      );
    } catch (e) {
      console.error('Failed to connect:', e);
      alert('خطا در اتصال: ' + e);
    } finally {
      connectingRef.current = false;
    }
  };

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
        const selectedItems = visibleItems.filter((item) => selectedSet.has(item.id));
        if (selectedItems.length > 0) {
          e.preventDefault();
          const rawText = selectedItems.map((item) => item.raw).join('\n');
          await writeText(rawText);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
        e.preventDefault();
        selectAllVisible(visibleItems);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visibleItems, selectedSet, selectAllVisible, addConfigsFromText]);

  const renderDelayCell = (item: ConfigItem) => {
    if (item.realDelay === -1 || item.status === 'disconnected') {
      return <span className="text-red-600 dark:text-red-500 font-bold">-1 ms</span>;
    }
    if (item.realDelay === undefined || item.realDelay === null) {
      return <span className="text-muted-foreground/70">-</span>;
    }

    let colorClass = 'text-emerald-500 dark:text-emerald-400';
    if (item.realDelay > 500) colorClass = 'text-red-500 dark:text-red-400';
    else if (item.realDelay > 250) colorClass = 'text-amber-500 dark:text-amber-400';

    const stageLabel =
      settings.multiStageTesting && item.status === 'untested' && (item.testStage || 0) > 0
        ? `[${item.testStage}/${settings.multiStageCount || 3}] `
        : '';

    return (
      <span className={`font-semibold tabular-nums ${colorClass}`}>
        {stageLabel}{item.realDelay} ms
      </span>
    );
  };

  const renderCountryCell = (item: ConfigItem) => {
    if (!item.countryCode) {
      return <span className="text-muted-foreground/70">-</span>;
    }
    const lang = settings.language === 'fa' ? 'fa' : 'en';
    const region = countryDisplayName(item.countryCode, lang);
    return (
      <span className="inline-flex items-center gap-1.5 max-w-full">
        <CountryFlag code={item.countryCode} title={region} />
        <span className="text-[11px] font-medium truncate" title={region}>
          {region}
        </span>
      </span>
    );
  };

  const formatSpeed = (speed?: number | null) => {
    if (speed === undefined || speed === null) return null;
    return `${speed.toFixed(2)} MB/s`;
  };

  const renderSpeedPair = (download?: number | null, upload?: number | null) => {
    const dl = formatSpeed(download);
    const ul = formatSpeed(upload);
    if (!dl && !ul) return <span className="text-muted-foreground/70">-</span>;
    const dlClass =
      download === 0
        ? 'text-red-600 dark:text-red-500 font-semibold'
        : 'text-blue-500 dark:text-blue-400 font-medium';
    const ulClass =
      upload === 0
        ? 'text-red-600 dark:text-red-500 font-semibold'
        : 'text-emerald-500 dark:text-emerald-400 font-medium';
    return (
      <div className="flex flex-col text-[10px] leading-tight justify-center h-full font-mono">
        <span className={dl ? dlClass : 'text-muted-foreground/70'}>↓ {dl ?? '-'}</span>
        <span className={ul ? ulClass : 'text-muted-foreground/70'}>↑ {ul ?? '-'}</span>
      </div>
    );
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderTraffic = (tx: number, rx: number) => {
    if (tx === 0 && rx === 0) return <span className="text-muted-foreground/70">-</span>;
    return (
      <div className="flex flex-col text-[10px] leading-tight justify-center h-full">
        <span className="text-blue-500 dark:text-blue-400 font-medium">↓ {formatBytes(rx)}</span>
        <span className="text-emerald-500 dark:text-emerald-400 font-medium">↑ {formatBytes(tx)}</span>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-transparent">
      {/* Table Header */}
      <div className="h-7 border-b flex items-center text-[11px] font-semibold bg-card/50 border-border/50 text-muted-foreground select-none px-4 shrink-0 justify-start text-left">
        <div className="w-10 flex items-center justify-start pr-2">
          <Checkbox
            checked={isAllSelected}
            onCheckedChange={(checked) => handleHeaderCheckboxChange(!!checked)}
          />
        </div>
        <div className="w-10 text-left">#</div>
        <div className="w-28 text-left">{t('protocol')}</div>
        <div className="flex-1 truncate text-left">{t('remark')}</div>
        <div className="w-56 truncate text-left">{t('address')}</div>
        <div
          className="w-24 text-left cursor-pointer hover:text-foreground transition-colors flex items-center"
          title={t('secondarySortHint')}
          onClick={() => handleSort('ping')}
          onContextMenu={(e) => {
            e.preventDefault();
            handleSecondarySort('ping');
          }}
        >
          {t('ping')}
          {renderSortIcon('ping')}
        </div>
        <div
          className="w-32 text-left cursor-pointer hover:text-foreground transition-colors flex items-center"
          title={t('secondarySortHint')}
          onClick={() => handleSort('country')}
          onContextMenu={(e) => {
            e.preventDefault();
            handleSecondarySort('country');
          }}
        >
          {t('country')}
          {renderSortIcon('country')}
        </div>
        <div
          className="w-24 text-left cursor-pointer hover:text-foreground transition-colors flex items-center"
          title={t('secondarySortHint')}
          onClick={() => handleSort('speed')}
          onContextMenu={(e) => {
            e.preventDefault();
            handleSecondarySort('speed');
          }}
        >
          {t('speed')}
          {renderSortIcon('speed')}
        </div>
        {settings.showTrafficStats && (
          <>
            <div className="w-24 text-left">{t('todayUsage')}</div>
            <div className="w-24 text-left">{t('totalUsage')}</div>
          </>
        )}
      </div>

      {/* Virtualized Rows Container */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        {visibleItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground/70 p-6 space-y-2">
            <p>{t('noConfigsInTab')}</p>
            <p className="text-[11px]">
              {isSubscription ? t('subscriptionEmptyHint') : t('pasteInstruction')}
            </p>
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = visibleItems[virtualRow.index];
              const isSelected = selectedSet.has(item.id);
              const isActive = settings.activeConfigId === item.id;

              return (
                <ContextMenu key={item.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      onClick={(e) =>
                        handleConfigClick(
                          item.id,
                          e.ctrlKey || e.metaKey,
                          e.shiftKey,
                          visibleItems
                        )
                      }
                      onDoubleClick={() => handleConnect(item)}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className={`flex items-center text-xs border-b border-border/30 cursor-pointer h-7 text-xs leading-7 select-none transition-colors text-left justify-start pl-4 pr-2.5 ${
                        isActive
                          ? 'bg-emerald-500/20 dark:bg-emerald-500/25 font-semibold text-emerald-950 dark:text-emerald-100'
                          : isSelected
                          ? 'bg-blue-500/20 dark:bg-blue-600/25 text-blue-950 dark:text-blue-100 hover:bg-blue-500/30 dark:hover:bg-blue-600/35 font-medium'
                          : 'hover:bg-muted text-foreground'
                      }`}
                    >
                      <div
                        className="w-10 flex items-center justify-start pr-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() =>
                            handleConfigClick(item.id, true, false, visibleItems)
                          }
                        />
                      </div>

                      <div className="w-10 text-left text-muted-foreground/70 text-[11px] font-mono">
                        {virtualRow.index + 1}
                      </div>

                      <div className="w-28 text-left font-mono font-semibold uppercase text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1">
                        {isActive && (
                          <Zap className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500" />
                        )}
                        {item.protocol}
                      </div>

                      <div className="flex-1 truncate font-medium text-left">
                        {item.name}
                      </div>

                      <div className="w-56 truncate text-left text-[11px] text-muted-foreground font-mono">
                        {item.address}:{item.port}
                      </div>

                      <div className="w-24 text-left overflow-hidden">
                        {renderDelayCell(item)}
                      </div>

                      <div className="w-32 text-left overflow-hidden">
                        {renderCountryCell(item)}
                      </div>

                      <div className="w-24 text-left font-mono h-full">
                        {renderSpeedPair(item.downloadSpeed, item.uploadSpeed)}
                      </div>

                      {settings.showTrafficStats && (
                        <>
                          <div className="w-24 text-left font-mono h-full">
                            {renderTraffic(
                              item.trafficToday?.tx || 0,
                              item.trafficToday?.rx || 0
                            )}
                          </div>
                          <div className="w-24 text-left font-mono h-full">
                            {renderTraffic(
                              item.trafficTotal?.tx || 0,
                              item.trafficTotal?.rx || 0
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-44">
                    <ContextMenuItem
                      onSelect={() => {
                        void handleConnect(item);
                      }}
                    >
                      <Play className="size-3.5" />
                      {t('setAsActive')}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => {
                        setShareConfig(item);
                      }}
                    >
                      <Share2 className="size-3.5" />
                      {t('share')}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        )}
      </div>

      <ShareConfigDialog
        config={shareConfig}
        open={!!shareConfig}
        onOpenChange={(open) => {
          if (!open) setShareConfig(null);
        }}
      />

      {sortTip && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 max-w-[min(90vw,28rem)] bg-slate-900 text-white text-xs px-3 py-2 rounded shadow-lg border border-slate-700 z-50 text-center leading-relaxed">
          {sortTip}
        </div>
      )}
    </div>
  );
};
