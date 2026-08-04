import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRight, ArrowLeft, Sliders, Activity, Sun, Moon, Sparkles, Plus, Trash2, Globe, FolderPlus, Edit2, Save, X } from 'lucide-react';
import { useConfigStore } from '../store/useConfigStore';
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
    addGroup,
    renameGroup,
    deleteGroup,
  } = useConfigStore();

  const [activeTab, setActiveTab] = useState<'general' | 'groups' | 'testing' | 'connection'>('general');
  const [newUrlInput, setNewUrlInput] = useState('');
  
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [newGroupInput, setNewGroupInput] = useState('');

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
            <div className="space-y-4 w-full max-w-xl">
              <div className="border-b pb-3 w-full text-start">
                <h3 className="text-sm font-bold">{t('groupsManagement')}</h3>
              </div>

              {/* Add New Group */}
              <SettingCard className="space-y-3">
                <span className="font-semibold text-xs">{t('createGroupTitle')}</span>
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newGroupInput.trim()) {
                      addGroup(newGroupInput);
                      setNewGroupInput('');
                    }
                  }} 
                  className="flex gap-2 pt-2"
                >
                  <input
                    type="text"
                    placeholder={t('groupNamePlaceholder')}
                    value={newGroupInput}
                    onChange={(e) => setNewGroupInput(e.target.value)}
                    className="bg-card border border-border text-foreground rounded px-2 py-1 outline-none focus:border-primary transition-colors flex-1 text-xs ltr:text-left rtl:text-right"
                  />
                  <Button type="submit" size="sm" className="gap-1">
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('add')}</span>
                  </Button>
                </form>
              </SettingCard>

              {/* Group List */}
              <SettingCard className="space-y-3">
                <div className="space-y-2">
                  {groups.map((group) => (
                    <div
                      key={group.id}
                      className="flex items-center justify-between p-2 rounded bg-muted/50 border border-border/50 text-xs transition-colors"
                    >
                      {editingGroupId === group.id ? (
                        <div className="flex items-center gap-2 flex-1 ltr:mr-2 rtl:ml-2">
                          <input
                            type="text"
                            value={editingGroupName}
                            onChange={(e) => setEditingGroupName(e.target.value)}
                            className="bg-card border border-border text-foreground rounded px-2 py-1 outline-none focus:border-primary flex-1 text-xs"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                renameGroup(group.id, editingGroupName);
                                setEditingGroupId(null);
                              } else if (e.key === 'Escape') {
                                setEditingGroupId(null);
                              }
                            }}
                          />
                          <button
                            onClick={() => {
                              renameGroup(group.id, editingGroupName);
                              setEditingGroupId(null);
                            }}
                            className="text-emerald-500 hover:text-emerald-400 p-1"
                            title={t('save')}
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingGroupId(null)}
                            className="text-muted-foreground hover:text-foreground p-1"
                            title={t('cancel')}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="font-semibold font-mono text-[11px] ltr:text-left rtl:text-right">{group.name}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            {group.id !== 'default_group' && (
                              <button
                                onClick={() => {
                                  setEditingGroupId(group.id);
                                  setEditingGroupName(group.name);
                                }}
                                className="text-blue-500 hover:text-blue-400 p-1"
                                title={t('rename')}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {groups.length > 1 && group.id !== 'default_group' && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <button
                                    className="text-red-400 hover:text-red-500 p-1"
                                    title={t('deleteGroup')}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
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
                                    <AlertDialogAction onClick={() => deleteGroup(group.id)} className="bg-red-600 text-white hover:bg-red-700">
                                      {t('delete')}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </SettingCard>
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
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 flex-1 text-start ltr:mr-4 rtl:ml-4">
                    <span className="font-semibold text-xs">{t('localPort')}</span>
                    <p className="text-[11px] text-muted-foreground/70">{t('localPortDesc')}</p>
                  </div>
                  <SimpleNumberInput
                    value={settings.localPort || 10900}
                    onChange={(val) => updateSettings({ localPort: val })}
                    min={1024}
                    max={65535}
                    className="w-24"
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
                      <DropdownMenuItem onClick={() => updateSettings({ systemProxyMode: 'set' })}>
                        {t('setProxy')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => updateSettings({ systemProxyMode: 'clear' })}>
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
