import React from 'react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../store/useConfigStore';
import { Globe, Plug, Power, ShieldCheck, Network, Copy, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
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

/** Survives Settings remounts — auto-connect must run only once per app session. */
let autoConnectDone = false;

export const ConnectionBar: React.FC<{ onRequireSudo: (onSubmit: (pwd: string) => void) => void }> = ({ onRequireSudo }) => {
  const { t } = useTranslation();
  const { settings, updateSettings, configs, tunMode, setTunMode } = useConfigStore();
  const [lanPopoverPos, setLanPopoverPos] = React.useState<{ left: number; bottom: number } | null>(null);
  const [lanIps, setLanIps] = React.useState<string[]>([]);
  const [copiedIp, setCopiedIp] = React.useState<string | null>(null);
  const lanBadgeRef = React.useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = React.useRef<number | undefined>(undefined);

  const openLanPopover = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
    if (lanBadgeRef.current) {
      const rect = lanBadgeRef.current.getBoundingClientRect();
      setLanPopoverPos({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 260)),
        bottom: window.innerHeight - rect.top + 8,
      });
    }
    invoke<string[]>('get_lan_ips')
      .then((ips) => setLanIps(ips))
      .catch(() => setLanIps([]));
  };

  const scheduleCloseLanPopover = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setLanPopoverPos(null);
    }, 150);
  };

  const handleCopyLanEndpoint = async (endpoint: string) => {
    try {
      await writeText(endpoint);
      setCopiedIp(endpoint);
      setTimeout(() => setCopiedIp((prev) => (prev === endpoint ? null : prev)), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  React.useEffect(() => {
    if (autoConnectDone) return;

    let cancelled = false;
    let timer: number | undefined;

    const tryAutoConnect = () => {
      if (cancelled || autoConnectDone) return;
      const state = useConfigStore.getState();
      const activeId = state.settings.activeConfigId;
      if (!activeId) {
        if (useConfigStore.persist.hasHydrated()) {
          autoConnectDone = true;
        }
        return;
      }
      const activeConfig = state.configs.find((c) => c.id === activeId);
      if (!activeConfig) return;

      autoConnectDone = true;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        // Respect current tunMode (normally false after launch by persist merge)
        startProxyWithConfig(
          activeConfig,
          state.settings.localPort || 10900,
          state.settings.systemProxyMode || 'dont_change',
          useConfigStore.getState().tunMode,
          undefined,
          state.settings.allowLan ?? false,
          state.settings.customRouting?.enabled ? state.settings.customRouting.rules : []
        ).catch(console.error);
      }, 300);
    };

    const unsub = useConfigStore.persist.onFinishHydration(() => {
      tryAutoConnect();
    });
    if (useConfigStore.persist.hasHydrated()) {
      tryAutoConnect();
    }

    return () => {
      cancelled = true;
      unsub();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const reconnect = async (nextTun: boolean, sudoPassword?: string) => {
    if (!settings.activeConfigId) return;
    const activeConfig = configs.find((c) => c.id === settings.activeConfigId);
    if (!activeConfig) return;
    await startProxyWithConfig(
      activeConfig,
      settings.localPort || 10900,
      settings.systemProxyMode || 'dont_change',
      nextTun,
      sudoPassword,
      settings.allowLan ?? false,
      settings.customRouting?.enabled ? settings.customRouting.rules : []
    );
  };

  const handleTunChange = async (checked: boolean) => {
    if (!checked) {
      setTunMode(false);
      try {
        await reconnect(false);
      } catch (e) {
        console.error(e);
      }
      return;
    }

    try {
      const osType = await getOsType();

      if (osType === 'windows') {
        const isAdmin: boolean = await invoke('check_elevation');
        if (!isAdmin) {
          try {
            await invoke('restart_as_admin');
          } catch (e) {
            console.error(e);
          }
          return;
        }
        setTunMode(true);
        await reconnect(true);
        return;
      }

      if (osType === 'linux') {
        const isRoot: boolean = await invoke('check_elevation');
        if (!isRoot) {
          onRequireSudo(async (password) => {
            try {
              await invoke('verify_sudo_password', { password });
              setTunMode(true);
              await reconnect(true, password);
            } catch (e) {
              console.error(e);
              setTunMode(false);
              alert(String(e));
            }
          });
          return;
        }
        setTunMode(true);
        await reconnect(true);
        return;
      }

      setTunMode(true);
      await reconnect(true);
    } catch (e) {
      console.error(e);
      setTunMode(false);
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
      setTunMode(false);
    } catch (e) {
      console.error(e);
    }
  };

  const activeConfig = configs.find(c => c.id === settings.activeConfigId);

  return (
    <div className="h-8 border-t flex items-center justify-between px-2 sm:px-3 bg-card/30 border-border/50 text-xs shrink-0 select-none gap-1.5 sm:gap-2 overflow-hidden">
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 shrink overflow-hidden">
        <div className="flex items-center gap-1.5 font-mono shrink-0">
          <Globe className={`w-3.5 h-3.5 shrink-0 ${settings.activeConfigId ? 'text-emerald-500' : 'text-muted-foreground/50'}`} />
          <span className="text-muted-foreground hidden sm:inline">{t('port')}</span>
          <span className={`font-semibold ${settings.activeConfigId ? 'text-foreground' : 'text-muted-foreground'}`}>
            {settings.localPort}
          </span>
          <span
            ref={lanBadgeRef}
            onMouseEnter={openLanPopover}
            onMouseLeave={scheduleCloseLanPopover}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold shrink-0 cursor-default ${
              settings.allowLan
                ? 'bg-sky-500/15 text-sky-500'
                : 'bg-muted/40 text-muted-foreground/70'
            }`}
          >
            <Network className="w-3 h-3 shrink-0" />
            <span>{settings.allowLan ? 'LAN' : t('lanDisabled')}</span>
          </span>
          {lanPopoverPos && (
            <div
              onMouseEnter={() => {
                if (closeTimerRef.current !== undefined) {
                  window.clearTimeout(closeTimerRef.current);
                  closeTimerRef.current = undefined;
                }
              }}
              onMouseLeave={scheduleCloseLanPopover}
              style={{ left: lanPopoverPos.left, bottom: lanPopoverPos.bottom }}
              className="fixed z-50 min-w-[220px] max-w-[300px] rounded-lg border border-border bg-popover/95 backdrop-blur-md p-2.5 shadow-lg text-xs font-sans text-popover-foreground"
            >
              <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-border/50">
                <span className="font-semibold text-[11px] flex items-center gap-1.5">
                  <Network className="w-3.5 h-3.5 text-sky-500" />
                  {t('lanAddresses')}
                </span>
              </div>
              {!settings.allowLan ? (
                <p className="text-[11px] text-muted-foreground">{t('lanDisabled')}</p>
              ) : lanIps.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">{t('noLanIpFound')}</p>
              ) : (
                <div className="space-y-1">
                  {lanIps.map((ip) => {
                    const endpoint = `${ip}:${settings.localPort || 10900}`;
                    const isCopied = copiedIp === endpoint;
                    return (
                      <button
                        key={ip}
                        type="button"
                        onClick={() => handleCopyLanEndpoint(endpoint)}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/40 hover:bg-muted transition-colors font-mono text-[11px] cursor-pointer"
                        dir="ltr"
                      >
                        <span className="truncate">{endpoint}</span>
                        {isCopied ? (
                          <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                        ) : (
                          <Copy className="w-3 h-3 text-muted-foreground shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {settings.activeConfigId && <div className="h-4 w-[1px] bg-border shrink-0" />}

        {settings.activeConfigId && (
          <>
            <div className="flex items-center gap-1.5 max-w-[90px] sm:max-w-[160px] md:max-w-[220px] truncate min-w-0 shrink">
              <Plug className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className="truncate font-semibold text-blue-500">{activeConfig?.name || 'Unknown'}</span>
            </div>
            
            <button
              onClick={handleStop}
              title={t('disconnect')}
              className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors shrink-0"
            >
              <Power className="w-3 h-3 shrink-0" />
              <span className="hidden sm:inline">{t('disconnect')}</span>
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-4 shrink-0">
        <div className="flex items-center gap-1 sm:gap-2 ltr:border-r ltr:pr-1.5 sm:ltr:pr-3 rtl:border-l rtl:pl-1.5 sm:rtl:pl-3 border-border/50 shrink-0">
          <Label htmlFor="tun-mode" className="text-muted-foreground flex items-center gap-1 cursor-pointer text-xs shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{t('tunMode', 'Tun Mode')}</span>
          </Label>
          <Switch
            size="sm"
            id="tun-mode"
            checked={tunMode}
            onCheckedChange={handleTunChange}
          />
        </div>
        <span className="text-muted-foreground hidden md:inline shrink-0">{t('systemProxy')}:</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 text-[11px] px-1.5 sm:px-2 bg-muted/50 hover:bg-muted shrink-0">
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
