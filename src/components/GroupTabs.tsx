import React, { useState } from 'react';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useTranslation } from 'react-i18next';
import {
  HelpCircle,
  XCircle,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Trash2,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useConfigStore } from '../store/useConfigStore';
import { Button } from './ui/button';

interface GroupTabsProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const GroupTabs: React.FC<GroupTabsProps> = ({ searchQuery, setSearchQuery }) => {
  const { t } = useTranslation();
  const {
    configs,
    activeGroupId,
    activeTab,
    setActiveTab,
    selectedConfigIds,
    addConfigsFromText,
    deleteSelectedConfigs,
    resetSelectedResults,
  } = useConfigStore();

  const [notification, setNotification] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2500);
  };

  const groupConfigs = configs.filter((c) => c.groupId === activeGroupId);

  const untestedCount = groupConfigs.filter((c) => c.status === 'untested').length;
  const disconnectedCount = groupConfigs.filter((c) => c.status === 'disconnected').length;
  const workingCount = groupConfigs.filter((c) => c.status === 'working').length;

  const handlePaste = async () => {
    try {
      const text = await readText();
      if (text) {
        const added = addConfigsFromText(text);
        showToast(`${added} ${t('configsPastedSuccess')}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopySelected = async () => {
    const selectedSet = new Set(selectedConfigIds);
    const selectedItems = groupConfigs.filter((c) => selectedSet.has(c.id));
    if (selectedItems.length === 0) {
      showToast(t('noConfigSelected'));
      return;
    }

    const rawText = selectedItems.map((c) => c.raw).join('\n');
    await writeText(rawText);
    showToast(`${selectedItems.length} ${t('configsCopiedSuccess')}`);
  };

  return (
    <div className="h-11 border-b flex items-center justify-between px-3 bg-transparent border-border/50 text-xs shrink-0">
      {/* 3 Tabs */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setActiveTab('untested')}
          className={`h-8 px-3 flex items-center gap-1.5 font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === 'untested'
              ? 'border-blue-500 text-blue-500 bg-muted'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>{t('untested')}</span>
          <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-slate-500/20 text-muted-foreground font-bold">
            {untestedCount}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('disconnected')}
          className={`h-8 px-3 flex items-center gap-1.5 font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === 'disconnected'
              ? 'border-red-500 text-red-500 bg-muted'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <XCircle className="w-3.5 h-3.5 text-red-500" />
          <span>{t('disconnected')}</span>
          <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-red-500/20 text-red-500 font-bold">
            {disconnectedCount}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('working')}
          className={`h-8 px-3 flex items-center gap-1.5 font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === 'working'
              ? 'border-emerald-500 text-emerald-500 bg-muted'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <span>{t('working')}</span>
          <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-emerald-500/20 text-emerald-500 font-bold">
            {workingCount}
          </span>
        </button>
      </div>

      {/* Controls & Search */}
      <div className="flex items-center gap-2">
        <div className="relative w-44">
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-card/50 border border-border/50 text-foreground rounded px-2 py-1 outline-none focus:border-primary transition-colors h-7 w-full rtl:pl-7 rtl:pr-2 ltr:pr-7 ltr:pl-2 text-[11px]"
          />
          <Search className="w-3.5 h-3.5 absolute rtl:left-2 ltr:right-2 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none" />
        </div>

        <div className="h-4 w-[1px] bg-border" />

        <Button variant="secondary" size="sm" onClick={handlePaste} className="h-7 gap-1">
          <ClipboardPaste className="w-3.5 h-3.5 text-blue-400" />
          <span>{t('paste')}</span>
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={handleCopySelected}
          disabled={selectedConfigIds.length === 0}
          className="h-7 gap-1"
        >
          <Copy className="w-3.5 h-3.5 text-slate-400" />
          <span>
            {t('copy')} ({selectedConfigIds.length})
          </span>
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            resetSelectedResults();
            showToast(t('resetToast'));
          }}
          disabled={selectedConfigIds.length === 0}
          className="h-7 gap-1"
        >
          <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
          <span>{t('resetResults')}</span>
        </Button>

        <Button
          variant="destructive"
          size="sm"
          onClick={deleteSelectedConfigs}
          disabled={selectedConfigIds.length === 0}
          className="h-7 gap-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{t('delete')}</span>
        </Button>
      </div>

      {notification && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-3 py-1.5 rounded shadow-lg border border-slate-700 z-50 animate-fade-in">
          {notification}
        </div>
      )}
    </div>
  );
};
