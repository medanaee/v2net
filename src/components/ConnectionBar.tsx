import React from 'react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../store/useConfigStore';
import { Globe, Plug, Power } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Button } from './ui/button';

export const ConnectionBar: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings, configs } = useConfigStore();

  const handleProxyModeChange = async (mode: 'set' | 'clear' | 'dont_change') => {
    updateSettings({ systemProxyMode: mode });
    try {
      await invoke('set_system_proxy_mode', { mode, port: settings.localPort || 10900 });
    } catch (e) {
      console.error('Failed to set proxy mode:', e);
    }
  };

  const handleStop = async () => {
    try {
      await invoke('stop_proxy');
      updateSettings({ activeConfigId: null });
    } catch (e) {
      console.error(e);
    }
  };

  const activeConfig = configs.find(c => c.id === settings.activeConfigId);

  return (
    <div className="h-8 border-t flex items-center justify-between px-3 bg-card/30 border-border/50 text-xs shrink-0 select-none">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 font-mono">
          <Globe className={`w-3.5 h-3.5 ${settings.activeConfigId ? 'text-emerald-500' : 'text-muted-foreground/50'}`} />
          <span className="text-muted-foreground">{t('port')}</span>
          <span className={`font-semibold ${settings.activeConfigId ? 'text-foreground' : 'text-muted-foreground'}`}>
            {settings.localPort}
          </span>
        </div>

        <div className="h-4 w-[1px] bg-border" />

        {settings.activeConfigId && (
          <>
            <div className="flex items-center gap-1.5 max-w-[200px] truncate">
              <Plug className="w-3.5 h-3.5 text-blue-500" />
              <span className="truncate font-semibold text-blue-500">{activeConfig?.name || 'Unknown'}</span>
            </div>
            
            <button
              onClick={handleStop}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
            >
              <Power className="w-3 h-3" />
              <span>{t('disconnect')}</span>
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{t('systemProxy')}:</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2 bg-muted/50 hover:bg-muted">
              {settings.systemProxyMode === 'set' && t('setProxy')}
              {settings.systemProxyMode === 'clear' && t('clearProxy')}
              {settings.systemProxyMode === 'dont_change' && t('dontChangeProxy')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-xs min-w-[120px]">
            <DropdownMenuItem onClick={() => handleProxyModeChange('set')}>
              {t('setProxy')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleProxyModeChange('clear')}>
              {t('clearProxy')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleProxyModeChange('dont_change')}>
              {t('dontChangeProxy')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
