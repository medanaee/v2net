import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRight, ArrowLeft, Sliders, Activity, Sun, Moon, Sparkles, Plus, Trash2, Globe, FolderPlus, Edit2, Link2, RefreshCw } from 'lucide-react';
import { useConfigStore } from '../store/useConfigStore';
import { isSubscriptionGroup, type Group } from '../types/config';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
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
} from "./ui/alert-dialog";
import { Checkbox } from './ui/checkbox';
import { NumberInput } from './ui/number-input';
import { SimpleNumberInput } from './ui/simple-number-input';
import { GroupEditorDialog } from './GroupEditorDialog';
import { SITE_CATALOG } from '../lib/siteCatalog';


const SettingCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-card/50 border border-border/50 rounded-xl p-4 ${className}`}>
    {children}
  </div>
);

export const SettingsModal: React.FC = () => {
  const { t, i18n } = useTranslation();
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    settings,
    updateSettings,
    toggleTheme,
    toggleAcrylicBlur,
    setLanguage,
    groups,
    configs,
    addGroup,
    updateGroup,
    deleteGroup,
    refreshSubscription,
  } = useConfigStore();

  const [activeTab, setActiveTab] = useState<'general' | 'groups' | 'testing' | 'connection'>('general');
  const [newUrlInput, setNewUrlInput] = useState('');
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [refreshingGroupId, setRefreshingGroupId] = useState<string | null>(null);
  const [groupToast, setGroupToast] = useState<string | null>(null);

  const showGroupToast = (msg: string) => {
    setGroupToast(msg);
    setTimeout(() => setGroupToast(null), 2500);
  };

  const handleRefreshGroup = async (groupId: string) => {
    setRefreshingGroupId(groupId);
    try {
      const count = await refreshSubscription(groupId);
      showGroupToast(`${count} ${t('subscriptionRefreshed')}`);
    } catch (e) {
      console.error(e);
      showGroupToast(t('subscriptionRefreshFailed'));
    } finally {
      setRefreshingGroupId(null);
    }
  };

  if (!isSettingsOpen) return null;

  const handleAcrylicToggle = async (checked: boolean) => {
    toggleAcrylicBlur();
    try {
      await invoke('apply_window_vibrancy', { enabled: checked });
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddRealDelayUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUrlInput.trim();
    if (!trimmed) return;

    if (!settings.testUrls.realDelay.includes(trimmed)) {
      const updatedList = [...settings.testUrls.realDelay, trimmed];
      updateSettings({
        testUrls: {
          ...settings.testUrls,
          realDelay: updatedList,
          selectedRealDelayUrl: trimmed,
        },
      });
    }
    setNewUrlInput('');
  };

  const handleDeleteRealDelayUrl = (urlToDelete: string) => {
    if (settings.testUrls.realDelay.length <= 1) return;

    const updatedList = settings.testUrls.realDelay.filter((u) => u !== urlToDelete);
    const newSelected =
      settings.testUrls.selectedRealDelayUrl === urlToDelete
        ? updatedList[0]
        : settings.testUrls.selectedRealDelayUrl;

    updateSettings({
      testUrls: {
        ...settings.testUrls,
        realDelay: updatedList,
        selectedRealDelayUrl: newSelected,
      },
    });
  };

  const isRtl = i18n.language === 'fa';
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <div className="flex-1 flex flex-col bg-transparent text-foreground select-none overflow-hidden h-full">
      {/* Settings Top Bar Header */}
      <div className="h-11 border-b flex items-center justify-between px-4 bg-transparent border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsSettingsOpen(false)}
            className="h-7 gap-1.5 font-medium"
          >
            <BackIcon className="w-4 h-4" />
            <span>{t('backToApp')}</span>
          </Button>
          <div className="h-4 w-[1px] bg-border" />
          <h2 className="font-bold text-xs">{t('settings')}</h2>
        </div>
      </div>

      {/* Settings Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 border-b-0 ltr:border-r rtl:border-l bg-transparent border-border p-3 space-y-1 text-xs font-medium shrink-0">
          <button
            onClick={() => setActiveTab('general')}
            className={`w-full h-8 px-3 flex items-center gap-2 rounded transition-colors cursor-pointer ${
              activeTab === 'general'
                ? 'bg-blue-600 text-white font-semibold shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>{t('general')}</span>
          </button>

          <button
            onClick={() => setActiveTab('groups')}
            className={`w-full h-8 px-3 flex items-center gap-2 rounded transition-colors cursor-pointer ${
              activeTab === 'groups'
                ? 'bg-blue-600 text-white font-semibold shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <FolderPlus className="w-4 h-4" />
            <span>{t('groupsManagement')}</span>
          </button>

          <button
            onClick={() => setActiveTab('testing')}
            className={`w-full h-8 px-3 flex items-center gap-2 rounded transition-colors cursor-pointer ${
              activeTab === 'testing'
                ? 'bg-blue-600 text-white font-semibold shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>{t('testing')}</span>
          </button>

          <button
            onClick={() => setActiveTab('connection')}
            className={`w-full h-8 px-3 flex items-center gap-2 rounded transition-colors cursor-pointer ${
              activeTab === 'connection'
                ? 'bg-blue-600 text-white font-semibold shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Globe className={`w-4 h-4 ${activeTab === 'connection' ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`} />
            <span>{t('connection')}</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-6 overflow-auto w-full max-w-3xl space-y-6 mx-auto flex flex-col items-center">
          {activeTab === 'general' && (
            <div className="space-y-4 w-full max-w-xl">
              <div className="border-b pb-3 w-full text-start">
                <h3 className="text-sm font-bold">{t('general')}</h3>
              </div>

              {/* Theme Settings */}
              <SettingCard className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="font-semibold text-xs">{t('theme')}</span>
                    <p className="text-[11px] text-muted-foreground/70">{t('themeDesc')}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={toggleTheme} className="h-8 gap-1.5">
                    {settings.theme === 'dark' ? (
                      <>
                        <Sun className="w-4 h-4 text-amber-400" />
                        <span>{t('darkTheme')}</span>
                      </>
                    ) : (
                      <>
                        <Moon className="w-4 h-4 text-slate-700" />
                        <span>{t('lightTheme')}</span>
                      </>
                    )}
                  </Button>
                </div>
              </SettingCard>

              {/* Language Settings */}
              <SettingCard className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="font-semibold text-xs">{t('language')}</span>
                    <p className="text-[11px] text-muted-foreground/70">{t('languageDesc')}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5">
                        <Globe className="w-4 h-4 text-blue-500" />
                        <span>{settings.language === 'fa' ? 'فارسی (Persian)' : 'English'}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setLanguage('fa')}>
                        فارسی (Persian)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setLanguage('en')}>
                        English
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </SettingCard>

              {/* Acrylic Switch using Shadcn UI Switch Primitive */}
              <SettingCard className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 font-semibold text-xs">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span>{t('acrylic')}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground/70">{t('acrylicDesc')}</p>
                  </div>
                  <Switch
                    checked={settings.acrylicBlur}
                    onCheckedChange={handleAcrylicToggle}
                  />
                </div>
              </SettingCard>

              {/* Show Traffic Stats Toggle */}
              <SettingCard className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 font-semibold text-xs">
                      <Activity className="w-4 h-4 text-emerald-400" />
                      <span>{t('showTrafficStats')}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground/70">{t('showTrafficStatsDesc')}</p>
                  </div>
                  <Switch
                    checked={settings.showTrafficStats}
                    onCheckedChange={(val) => updateSettings({ showTrafficStats: val })}
                  />
                </div>
              </SettingCard>
            </div>
          )}

          {activeTab === 'groups' && (
            <div className="space-y-4 w-full max-w-2xl">
              <div className="flex items-start justify-between gap-3 border-b pb-3 w-full">
                <div className="text-start space-y-1">
                  <h3 className="text-sm font-bold">{t('groupsManagement')}</h3>
                  <p className="text-[11px] text-muted-foreground/70">{t('groupsManagementDesc')}</p>
                </div>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 shrink-0"
                  onClick={() => setIsCreateGroupOpen(true)}
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  {t('newGroup')}
                </Button>
              </div>

              <div className="space-y-2.5">
                {groups.map((group) => {
                  const isSub = isSubscriptionGroup(group);
                  const count = configs.filter((c) => c.groupId === group.id).length;
                  const refreshing = refreshingGroupId === group.id;
                  return (
                    <div
                      key={group.id}
                      className="rounded-xl border border-border/60 bg-card/40 p-3.5 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1.5 text-start">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm truncate">{group.name}</span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                isSub
                                  ? 'bg-sky-500/15 text-sky-500'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {isSub ? (
                                <>
                                  <Link2 className="w-3 h-3" />
                                  {t('subscriptionGroup')}
                                </>
                              ) : (
                                t('manualGroup')
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{t('configsCount', { count })}</span>
                            {isSub && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>
                                  {group.lastUpdated
                                    ? `${t('lastUpdated')}: ${new Date(group.lastUpdated).toLocaleString()}`
                                    : t('neverUpdated')}
                                </span>
                              </>
                            )}
                          </div>
                          {isSub && (
                            <p
                              dir="ltr"
                              className="text-[10px] font-mono text-muted-foreground/80 truncate max-w-full"
                              title={group.subscriptionUrl}
                            >
                              {group.subscriptionUrl}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {isSub && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-sky-500 hover:bg-sky-500/10"
                              title={t('refreshSubscription')}
                              disabled={refreshing}
                              onClick={() => handleRefreshGroup(group.id)}
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-blue-500 hover:bg-blue-500/10"
                            title={t('editGroup')}
                            onClick={() => setEditingGroup(group)}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          {groups.length > 1 && group.id !== 'default_group' && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-red-500 hover:bg-red-500/10"
                                  title={t('deleteGroup')}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{t('deleteGroup')}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t('confirmDeleteGroup')}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteGroup(group.id)}
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
                    </div>
                  );
                })}
              </div>

              <GroupEditorDialog
                open={isCreateGroupOpen}
                mode="create"
                onOpenChange={setIsCreateGroupOpen}
                onSubmit={async (data) => {
                  const id = addGroup(data.name, data.subscriptionUrl);
                  setIsCreateGroupOpen(false);
                  if (id && data.subscriptionUrl) {
                    await handleRefreshGroup(id);
                  }
                }}
              />

              <GroupEditorDialog
                open={!!editingGroup}
                mode="edit"
                initialName={editingGroup?.name || ''}
                initialSubscriptionUrl={editingGroup?.subscriptionUrl || ''}
                onOpenChange={(open) => {
                  if (!open) setEditingGroup(null);
                }}
                onSubmit={async (data) => {
                  if (!editingGroup) return;
                  const hadUrl = !!editingGroup.subscriptionUrl?.trim();
                  const nextUrl = data.subscriptionUrl.trim();
                  updateGroup(editingGroup.id, {
                    name: data.name,
                    subscriptionUrl: data.subscriptionUrl,
                  });
                  const groupId = editingGroup.id;
                  setEditingGroup(null);
                  if (nextUrl && (!hadUrl || nextUrl !== editingGroup.subscriptionUrl?.trim())) {
                    await handleRefreshGroup(groupId);
                  }
                }}
              />

              {groupToast && (
                <div className="fixed bottom-14 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-3 py-1.5 rounded shadow-lg border border-slate-700 z-50">
                  {groupToast}
                </div>
              )}
            </div>
          )}

          {activeTab === 'testing' && (
            <div className="space-y-6 w-full max-w-xl">
              <div className="border-b pb-3 w-full text-start">
                <h3 className="text-sm font-bold">{t('testing')}</h3>
              </div>

              {/* Test Workers Settings */}
              <SettingCard className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 flex-1 text-start ltr:mr-4 rtl:ml-4">
                    <span className="font-semibold text-xs">{t('testWorkers')}</span>
                    <p className="text-[11px] text-muted-foreground/70">{t('testWorkersDesc')}</p>
                  </div>
                  <NumberInput
                    value={settings.testWorkers || 40}
                    onChange={(val) => updateSettings({ testWorkers: val })}
                    min={20}
                    max={80}
                    step={20}
                  />
                </div>
              </SettingCard>

              {/* Multi-Stage Testing */}
              <SettingCard className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 flex-1 text-start ltr:mr-4 rtl:ml-4">
                    <span className="font-semibold text-xs">{t('multiStage')}</span>
                    <p className="text-[11px] text-muted-foreground/70">{t('multiStageDesc')}</p>
                  </div>
                  <Switch
                    checked={settings.multiStageTesting}
                    onCheckedChange={(val) => updateSettings({ multiStageTesting: val })}
                  />
                </div>
                {settings.multiStageTesting && (
                  <div className="flex items-center justify-between mt-3 pt-3 border-t">
                    <div className="space-y-0.5 flex-1 text-start ltr:mr-4 rtl:ml-4">
                      <span className="font-semibold text-xs">{t('multiStageCount')}</span>
                    </div>
                    <NumberInput
                      value={settings.multiStageCount || 3}
                      onChange={(val) => updateSettings({ multiStageCount: val })}
                      min={2}
                      max={5}
                    />
                  </div>
                )}
              </SettingCard>

              {/* Real Delay URLs List */}
              <SettingCard className="space-y-3">
                <span className="font-semibold text-xs">{t('realDelayUrls')}</span>
                <p className="text-[11px] text-muted-foreground/70">{t('realDelayUrlsDesc')}</p>

                <div className="space-y-2">
                  {settings.testUrls.realDelay.map((url) => {
                    const isSelected = settings.testUrls.selectedRealDelayUrl === url;
                    return (
                      <div
                        key={url}
                        className={`flex items-center justify-between p-2 rounded bg-muted/50 border rounded text-xs transition-colors ${
                          isSelected
                            ? 'border-blue-500/50'
                            : 'border-border/50'
                        }`}
                      >
                        <div className="flex items-center gap-3 truncate ltr:text-left rtl:text-right font-mono">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() =>
                              updateSettings({
                                testUrls: {
                                  ...settings.testUrls,
                                  selectedRealDelayUrl: url,
                                },
                              })
                            }
                          />
                          <span className="truncate">{url}</span>
                        </div>

                        {settings.testUrls.realDelay.length > 1 && (
                          <button
                            onClick={() => handleDeleteRealDelayUrl(url)}
                            className="text-red-400 hover:text-red-500 p-1"
                            title={t('delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <form onSubmit={handleAddRealDelayUrl} className="flex gap-2 pt-2">
                  <input
                    type="url"
                    placeholder="https://example.com/generate_204"
                    value={newUrlInput}
                    onChange={(e) => setNewUrlInput(e.target.value)}
                    className="bg-card border border-border text-foreground rounded px-2 py-1 outline-none focus:border-primary transition-colors flex-1 text-xs ltr:text-left rtl:text-right font-mono"
                  />
                  <Button type="submit" size="sm" className="gap-1">
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('add')}</span>
                  </Button>
                </form>
              </SettingCard>

              {/* Site Test catalog picker */}
              <SettingCard className="space-y-3">
                <div className="space-y-0.5 text-start">
                  <span className="font-semibold text-xs">{t('siteTestSettings')}</span>
                  <p className="text-[11px] text-muted-foreground/70">{t('siteTestSettingsDesc')}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SITE_CATALOG.map((site) => {
                    const selected = settings.siteTestSelectedIds ?? ['gemini'];
                    const checked = selected.includes(site.id);
                    const Icon = site.Icon;
                    return (
                      <label
                        key={site.id}
                        className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                          checked
                            ? 'border-blue-500/50 bg-blue-500/5'
                            : 'border-border/50 bg-muted/40 hover:bg-muted/60'
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(val) => {
                            const on = !!val;
                            const prev = settings.siteTestSelectedIds ?? ['gemini'];
                            let next: string[];
                            if (on) {
                              next = prev.includes(site.id) ? prev : [...prev, site.id];
                            } else {
                              next = prev.filter((id) => id !== site.id);
                              if (next.length === 0) {
                                // Keep at least one site selected
                                return;
                              }
                            }
                            updateSettings({ siteTestSelectedIds: next });
                          }}
                        />
                        <span className="inline-flex items-center justify-center size-7 rounded-md bg-background/80 text-sky-500">
                          <Icon className="size-4" />
                        </span>
                        <span className="text-xs font-medium">{t(site.nameKey)}</span>
                      </label>
                    );
                  })}
                </div>
              </SettingCard>

              {/* Speed Test URLs */}
              <SettingCard className="space-y-4">
                <span className="font-semibold text-xs">{t('speedTestUrls')}</span>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">
                      {t('downloadUrl')}
                    </label>
                    <input
                      type="url"
                      value={settings.testUrls.downloadUrl}
                      onChange={(e) =>
                        updateSettings({
                          testUrls: {
                            ...settings.testUrls,
                            downloadUrl: e.target.value,
                          },
                        })
                      }
                      className="bg-card border border-border text-foreground rounded px-2 py-1 outline-none focus:border-primary transition-colors w-full text-xs ltr:text-left rtl:text-right font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">
                      {t('uploadUrl')}
                    </label>
                    <input
                      type="url"
                      value={settings.testUrls.uploadUrl}
                      onChange={(e) =>
                        updateSettings({
                          testUrls: {
                            ...settings.testUrls,
                            uploadUrl: e.target.value,
                          },
                        })
                      }
                      className="bg-card border border-border text-foreground rounded px-2 py-1 outline-none focus:border-primary transition-colors w-full text-xs ltr:text-left rtl:text-right font-mono"
                    />
                  </div>
                </div>
              </SettingCard>
            </div>
          )}

          {activeTab === 'connection' && (
            <div className="space-y-4 w-full max-w-xl">
              <div className="border-b pb-3 w-full text-start">
                <h3 className="text-sm font-bold">{t('connection')}</h3>
              </div>

              <SettingCard className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5 flex-1 text-start">
                    <span className="font-semibold text-xs">{t('localPort')}</span>
                    <p className="text-[11px] text-muted-foreground/70">{t('localPortDesc')}</p>
                  </div>
                  <SimpleNumberInput
                    value={settings.localPort || 10900}
                    onChange={(val) => updateSettings({ localPort: val })}
                    min={1024}
                    max={65535}
                    className="w-28"
                  />
                </div>
              </SettingCard>

              <SettingCard className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 flex-1 text-start ltr:mr-4 rtl:ml-4">
                    <span className="font-semibold text-xs">{t('systemProxy')}</span>
                    <p className="text-[11px] text-muted-foreground/70">{t('systemProxyDesc')}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs w-32 justify-between">
                        {settings.systemProxyMode === 'set' && t('setProxy')}
                        {settings.systemProxyMode === 'clear' && t('clearProxy')}
                        {settings.systemProxyMode === 'dont_change' && t('dontChangeProxy')}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-32">
                      <DropdownMenuItem
                        onClick={() => {
                          updateSettings({ systemProxyMode: 'set' });
                          invoke('set_system_proxy_mode', {
                            mode: 'set',
                            port: settings.localPort || 10900,
                          }).catch(console.error);
                        }}
                      >
                        {t('setProxy')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          updateSettings({ systemProxyMode: 'clear' });
                          invoke('set_system_proxy_mode', {
                            mode: 'clear',
                            port: settings.localPort || 10900,
                          }).catch(console.error);
                        }}
                      >
                        {t('clearProxy')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => updateSettings({ systemProxyMode: 'dont_change' })}>
                        {t('dontChangeProxy')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </SettingCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
