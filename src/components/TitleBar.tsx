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
  ShieldCheck,
  ChevronDown,
  Trash2,
  Globe,
} from 'lucide-react';
import { useConfigStore } from '../store/useConfigStore';
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
} from "./ui/alert-dialog";

export const TitleBar: React.FC = () => {
  const { t } = useTranslation();
  const {
    groups,
    activeGroupId,
    setActiveGroupId,
    addGroup,
    deleteGroup,
    toggleTheme,
    settings,
    setIsSettingsOpen,
    isSettingsOpen,
    setLanguage,
  } = useConfigStore();

  const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

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

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (newGroupName.trim()) {
      addGroup(newGroupName);
      setNewGroupName('');
      setIsAddGroupOpen(false);
    }
  };

  const activeGroup = groups.find((g) => g.id === activeGroupId) || groups[0];

  return (
    <div
      data-tauri-drag-region
      className="h-10 border-b flex items-center justify-between px-3 select-none text-xs font-medium bg-transparent border-border/50 z-50 shrink-0"
    >
      {/* Brand & Group Selector */}
      <div className="flex items-center gap-3" data-tauri-drag-region>
        <div className="flex items-center gap-1.5 text-blue-500 font-bold text-sm pointer-events-none">
          <ShieldCheck className="w-4 h-4" />
          <span>{t('appTitle')}</span>
        </div>

        <div className="h-4 w-[1px] bg-border" />

        {/* Group Selector Dropdown using Shadcn UI */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/70 text-[11px]">{t('group')}:</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 font-medium">
                <span>{activeGroup?.name}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {groups.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  onClick={() => setActiveGroupId(g.id)}
                  className={g.id === activeGroupId ? 'font-bold text-blue-500' : ''}
                >
                  {g.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Add Group Button */}
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

          {/* Delete Active Group Button if >1 groups */}
          {groups.length > 1 && (
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
                  <AlertDialogDescription>
                    {t('confirmDeleteGroup')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteGroup(activeGroupId)} className="bg-red-600 text-white hover:bg-red-700">
                    {t('delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Action Controls & Window Buttons */}
      <div className="flex items-center gap-1.5" data-tauri-drag-region={false}>
        {/* Language Switcher Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2">
              <Globe className="w-3.5 h-3.5 text-blue-400" />
              <span className="uppercase text-[11px] font-bold">{settings.language}</span>
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

        {/* Theme Toggle */}
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

        {/* Settings Toggle Button */}
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

        {/* Custom Window Control Buttons */}
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
          onClick={handleClose}
          className="h-7 w-8 flex items-center justify-center hover:bg-red-600 hover:text-white text-muted-foreground"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Add Group Modal */}
      {isAddGroupOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateGroup}
            className="bg-card border border-border rounded p-4 w-80 space-y-3 shadow-xl"
          >
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-semibold text-sm">{t('createGroupTitle')}</h3>
              <button
                type="button"
                onClick={() => setIsAddGroupOpen(false)}
                className="text-muted-foreground/70 hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              placeholder={t('groupNamePlaceholder')}
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="bg-card border border-border text-foreground rounded px-2 py-1 outline-none focus:border-primary transition-colors w-full text-xs"
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsAddGroupOpen(false)}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" size="sm">
                {t('add')}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
