import React from 'react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../store/useConfigStore';
import { Globe, Plug, Power, ShieldCheck } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { type as getOsType } from '@tauri-apps/plugin-os';
import { startProxyWithConfig } from '../lib/proxy';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Button } from './ui/button';

export const ConnectionBar: React.FC<{ onRequireSudo: (onSubmit: (pwd: string) => void) => void }> = ({ onRequireSudo }) => {
  const { t } = useTranslation();
  const { settings, updateSettings, configs, tunMode, setTunMode } = useConfigStore();
  const hasStarted = React.useRef(false);

  React.useEffect(() => {
    // Reconnect on startup if config was active
    if (settings.activeConfigId && configs.length > 0 && !hasStarted.current) {
      hasStarted.current = true;
      const activeConfig = configs.find(c => c.id === settings.activeConfigId);
      if (activeConfig) {
        // Add a small delay to let backend initialize
        setTimeout(() => {
          startProxyWithConfig(
            activeConfig,
            settings.localPort || 10900,
            settings.systemProxyMode || 'dont_change',
            false // TUN always starts off after launch
          ).catch(console.error);
        }, 500);
      }
    }
  }, [settings.activeConfigId, configs, settings.localPort, settings.systemProxyMode]);

  const handleTunChange = async (checked: boolean) => {
    if (checked) {
      const osType = await getOsType();
      
      if (osType === 'windows') {
        const isAdmin: boolean = await invoke('check_elevation');
        if (!isAdmin) {
          // Restart elevated; user re-enables TUN manually after relaunch
          try {
            await invoke('restart_as_admin');
          } catch (e) {
            console.error(e);
          }
          return;
        }
        setTunMode(true);
      } else if (osType === 'linux') {
        const isRoot: boolean = await invoke('check_elevation');
        if (!isRoot) {
          onRequireSudo((password) => {
            setTunMode(true);
            if (settings.activeConfigId) {
              const activeConfig = configs.find(c => c.id === settings.activeConfigId);
              if (activeConfig) {
                startProxyWithConfig(
                  activeConfig,
                  settings.localPort || 10900,
                  settings.systemProxyMode || 'dont_change',
                  true,
                  password
                ).catch(console.error);
              }
            }
          });
          return;
        }
        setTunMode(true);
      } else {
        setTunMode(true);
      }
      
      // if it reaches here, reconnect with new tunMode (except linux sudo which does it in callback)
      if ((osType !== 'linux' || await invoke('check_elevation')) && settings.activeConfigId) {
        const activeConfig = configs.find(c => c.id === settings.activeConfigId);
        if (activeConfig) {
          startProxyWithConfig(
            activeConfig,
            settings.localPort || 10900,
            settings.systemProxyMode || 'dont_change',
            true
          ).catch(console.error);
        }
      }

    } else {
      setTunMode(false);
      // Reconnect with tunMode off
      if (settings.activeConfigId) {
        const activeConfig = configs.find(c => c.id === settings.activeConfigId);
        if (activeConfig) {
          startProxyWithConfig(
            activeConfig,
            settings.localPort || 10900,
            settings.systemProxyMode || 'dont_change',
            false
          ).catch(console.error);
        }
      }
    }
  };

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

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 border-r pr-4 border-border/50">
          <Label htmlFor="tun-mode" className="text-muted-foreground flex items-center gap-1 cursor-pointer text-xs">
            <ShieldCheck className="w-3.5 h-3.5" />
            {t('tunMode', 'Tun Mode')}
          </Label>
          <Switch
            size="sm"
            id="tun-mode"
            checked={tunMode}
            onCheckedChange={handleTunChange}
          />
        </div>
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
