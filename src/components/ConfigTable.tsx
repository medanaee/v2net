import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ArrowDown, ArrowUp, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useConfigStore } from '../store/useConfigStore';
import { ConfigItem } from '../types/config';
import { Checkbox } from './ui/checkbox';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

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
  } = useConfigStore();

  const parentRef = useRef<HTMLDivElement>(null);

  const [sortColumn, setSortColumn] = useState<'ping' | 'download' | 'upload' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (column: 'ping' | 'download' | 'upload') => {
    if (sortColumn === column) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else setSortColumn(null);
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const renderSortIcon = (column: 'ping' | 'download' | 'upload') => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 mx-1 inline-block" /> : <ArrowDown className="w-3 h-3 mx-1 inline-block" />;
  };

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let items = configs.filter((c) => {
      if (c.groupId !== activeGroupId) return false;
      if (c.status !== activeTab) return false;
      if (!query) return true;

      return (
        c.name.toLowerCase().includes(query) ||
        c.address.toLowerCase().includes(query) ||
        c.port.toString().includes(query) ||
        c.protocol.toLowerCase().includes(query)
      );
    });

    if (sortColumn) {
      items = [...items].sort((a, b) => {
        let valA = 0, valB = 0;
        if (sortColumn === 'ping') {
          valA = a.realDelay ?? Infinity;
          valB = b.realDelay ?? Infinity;
          if (valA === -1) valA = Infinity;
          if (valB === -1) valB = Infinity;
        } else if (sortColumn === 'download') {
          valA = a.downloadSpeed ?? -1;
          valB = b.downloadSpeed ?? -1;
        } else if (sortColumn === 'upload') {
          valA = a.uploadSpeed ?? -1;
          valB = b.uploadSpeed ?? -1;
        }
        
        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return items;
  }, [configs, activeGroupId, activeTab, searchQuery, sortColumn, sortDirection]);

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

  const handleConnect = async (item: ConfigItem) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('start_proxy', {
        target: {
          id: item.id,
          test_url: '',
          test_type: '',
          protocol: item.protocol,
          address: item.address,
          port: item.port,
          uuid: item.uuid,
          secret: item.secret,
          method: item.type, // Map type to method for ss
          network: item.network,
          header_type: item.headerType,
          path: item.path,
          host: item.host,
          sni: item.sni,
          tls: item.tls,
          alpn: item.alpn,
          pbk: item.pbk,
          sid: item.sid,
          fp: item.fp,
          flow: item.flow,
          mode: item.mode,
          extra: item.extra,
        },
        localPort: settings.localPort || 10900,
        systemProxyMode: settings.systemProxyMode || 'dont_change',
      });
      updateSettings({ activeConfigId: item.id });
    } catch (e) {
      console.error('Failed to connect:', e);
      alert('خطا در اتصال: ' + e);
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
      <span className={`font-semibold ${colorClass}`}>
        {stageLabel}{item.realDelay} ms
      </span>
    );
  };

  const renderSpeedCell = (speed?: number | null) => {
    if (speed === undefined || speed === null) return <span className="text-muted-foreground/70">-</span>;
    if (speed === 0) return <span className="font-mono text-[11px] text-red-600 dark:text-red-500 font-semibold">0.00 MB/s</span>;
    return <span className="font-mono text-[11px]">{speed.toFixed(2)} MB/s</span>;
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
        <div className="flex-1 px-2 truncate text-left">{t('remark')}</div>
        <div className="w-56 px-2 truncate text-left">{t('address')}</div>
        <div 
          className="w-24 text-left cursor-pointer hover:text-foreground transition-colors"
          onClick={() => handleSort('ping')}
        >
          {t('ping')}{renderSortIcon('ping')}
        </div>
        <div 
          className="w-24 text-left cursor-pointer hover:text-foreground transition-colors"
          onClick={() => handleSort('download')}
        >
          {t('download')}{renderSortIcon('download')}
        </div>
        <div 
          className="w-24 text-left cursor-pointer hover:text-foreground transition-colors"
          onClick={() => handleSort('upload')}
        >
          {t('upload')}{renderSortIcon('upload')}
        </div>
      </div>

      {/* Virtualized Rows Container */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        {visibleItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground/70 p-6 space-y-2">
            <p>{t('noConfigsInTab')}</p>
            <p className="text-[11px]">{t('pasteInstruction')}</p>
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
                <div
                  key={item.id}
                  onClick={(e) =>
                    handleConfigClick(item.id, e.ctrlKey || e.metaKey, e.shiftKey, visibleItems)
                  }
                  onDoubleClick={() => handleConnect(item)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    handleConnect(item);
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={`flex items-center text-xs border-b border-border/30 cursor-pointer h-7 text-xs leading-7 select-none transition-colors text-left justify-start px-4 ${
                    isActive
                      ? 'bg-emerald-500/20 dark:bg-emerald-500/25 font-semibold text-emerald-950 dark:text-emerald-100'
                      : isSelected
                      ? 'bg-blue-500/20 dark:bg-blue-600/25 text-blue-950 dark:text-blue-100 hover:bg-blue-500/30 dark:hover:bg-blue-600/35 font-medium'
                      : 'hover:bg-muted text-foreground'
                  }`}
                >
                  {/* Checkbox with padding */}
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

                  {/* Index # */}
                  <div className="w-10 text-left text-muted-foreground/70 text-[11px] font-mono">
                    {virtualRow.index + 1}
                  </div>

                  {/* Protocol */}
                  <div className="w-28 text-left font-mono font-semibold uppercase text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    {isActive && <Zap className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500" />}
                    {item.protocol}
                  </div>

                  {/* Config Remark */}
                  <div className="flex-1 px-2 truncate font-medium text-left">{item.name}</div>

                  {/* Address & Port */}
                  <div className="w-56 px-2 truncate text-left text-[11px] text-muted-foreground font-mono">
                    {item.address}:{item.port}
                  </div>

                  {/* Ping Delay */}
                  <div className="w-24 text-left">{renderDelayCell(item)}</div>

                  {/* Download Speed */}
                  <div className="w-24 text-left text-muted-foreground">
                    {renderSpeedCell(item.downloadSpeed)}
                  </div>

                  {/* Upload Speed */}
                  <div className="w-24 text-left text-muted-foreground">
                    {renderSpeedCell(item.uploadSpeed)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
