import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import {
  FolderPlus,
  Minus,
  Square,
  X,
  Settings,
  Sun,
  Moon,
  ChevronDown,
  Trash2,
  Globe,
  ArrowDownToLine,
  RefreshCw,
  Link2,
} from 'lucide-react';
import { useConfigStore } from '../store/useConfigStore';
import { isSubscriptionGroup } from '../types/config';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog';
import { GroupEditorDialog } from './GroupEditorDialog';

export const TitleBar: React.FC = () => {
  const { t } = useTranslation();
  const {
    groups,
    activeGroupId,
    setActiveGroupId,
    addGroup,
    deleteGroup,
    refreshSubscription,
    toggleTheme,
    settings,
    setIsSettingsOpen,
    isSettingsOpen,
    setLanguage,
  } = useConfigStore();

  const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleMinimize = async () => {
    try {
      await invoke('minimize_window');
    } catch (e) {
      console.error(e);
    }
  };

  const handleMaximize = async () => {
    try {
      await invoke('toggle_maximize_window');
    } catch (e) {
      console.error(e);
    }
  };

  const handleClose = async () => {
    try {
      await invoke('close_window');
    } catch (e) {
      console.error(e);
    }
  };

  const handleHideToTray = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().hide();
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateGroup = async (data: { name: string; subscriptionUrl: string }) => {
    const id = addGroup(data.name, data.subscriptionUrl);
    setIsAddGroupOpen(false);
    if (id && data.subscriptionUrl.trim()) {
      setRefreshing(true);
      try {
        const count = await refreshSubscription(id);
        showToast(`${count} ${t('subscriptionRefreshed')}`);
      } catch (e) {
        console.error(e);
        showToast(t('subscriptionRefreshFailed'));
      } finally {
        setRefreshing(false);
      }
    }
  };

  const activeGroup = groups.find((g) => g.id === activeGroupId) || groups[0];
  const activeIsSub = isSubscriptionGroup(activeGroup);

  const handleRefreshActive = async () => {
    if (!activeIsSub || refreshing) return;
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

  return (
    <div
      data-tauri-drag-region
      className="h-10 border-b flex items-center justify-between px-3 select-none text-xs font-medium bg-transparent border-border/50 z-50 shrink-0"
    >
      <div className="flex items-center gap-3" data-tauri-drag-region>
        <div className="flex items-center gap-1.5 text-blue-500 font-bold text-sm pointer-events-none">
          <img src="/icon.png" alt="v2net" className="w-5 h-5 object-contain pointer-events-none" />
          <span>{t('appTitle')}</span>
        </div>

        <div className="h-4 w-[1px] bg-border" />

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/70 text-[11px]">{t('group')}:</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 font-medium max-w-[180px]">
                {activeIsSub && <Link2 className="w-3 h-3 text-sky-500 shrink-0" />}
                <span className="truncate">{activeGroup?.name}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
              {groups.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  onClick={() => setActiveGroupId(g.id)}
                  className={g.id === activeGroupId ? 'font-bold text-blue-500' : ''}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    {isSubscriptionGroup(g) && <Link2 className="w-3 h-3 text-sky-500 shrink-0" />}
                    <span className="truncate">{g.name}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {activeIsSub && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-sky-500 hover:bg-sky-500/10"
              title={t('refreshSubscription')}
              disabled={refreshing}
              onClick={handleRefreshActive}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsAddGroupOpen(true)}
            className="h-7 gap-1"
            title={t('newGroup')}
          >
            <FolderPlus className="w-3.5 h-3.5 text-blue-500" />
            <span>{t('newGroup')}</span>
          </Button>

          {groups.length > 1 && activeGroupId !== 'default_group' && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-red-500 hover:bg-red-500/10"
                  title={t('deleteGroup')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('deleteGroup')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('confirmDeleteGroup')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteGroup(activeGroupId)}
                    className="bg-red-600 text-white hover:bg-red-700"
                  >
                    {t('delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5" data-tauri-drag-region={false}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2">
              <Globe className="w-3.5 h-3.5 text-blue-400" />
              <span className="uppercase text-[11px] font-bold">{settings.language}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setLanguage('fa')}>فارسی (Persian)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLanguage('en')}>English</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="h-7 w-7"
          title={t('theme')}
        >
          {settings.theme === 'dark' ? (
            <Sun className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-slate-700" />
          )}
        </Button>

        <Button
          variant={isSettingsOpen ? 'default' : 'secondary'}
          size="sm"
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className="h-7 gap-1"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>{t('settings')}</span>
        </Button>

        <div className="h-4 w-[1px] bg-border mx-1" />

        <button
          onClick={handleMinimize}
          className="h-7 w-8 flex items-center justify-center hover:bg-muted text-muted-foreground"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-7 w-8 flex items-center justify-center hover:bg-muted text-muted-foreground"
          title="Maximize"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={handleHideToTray}
          className="h-7 w-8 flex items-center justify-center hover:bg-muted text-muted-foreground"
          title={t('hideToTray')}
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleClose}
          className="h-7 w-8 flex items-center justify-center hover:bg-red-600 hover:text-white text-muted-foreground"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <GroupEditorDialog
        open={isAddGroupOpen}
        mode="create"
        onOpenChange={setIsAddGroupOpen}
        onSubmit={handleCreateGroup}
      />

      {toast && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-3 py-1.5 rounded shadow-lg border border-slate-700 z-50">
          {toast}
        </div>
      )}
    </div>
  );
};
