import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, Square, Activity, Gauge, Zap } from 'lucide-react';
import { useConfigStore } from '../store/useConfigStore';
import { Button } from './ui/button';

const startBatchTestToRust = async (targets: any[], settings: any, testMode: string, setIsTesting: any) => {
  const rustTargets = targets.map((c: any) => ({
    id: c.id,
    address: c.address,
    port: c.port,
    test_url: settings.testUrls.selectedRealDelayUrl,
    test_type: testMode,
    protocol: c.protocol,
    uuid: c.uuid,
    secret: c.secret,
    method: c.type,
    network: c.network,
    header_type: c.headerType,
    path: c.path,
    host: c.host,
    sni: c.sni,
    tls: c.tls,
    alpn: c.alpn,
    pbk: c.pbk,
    sid: c.sid,
    fp: c.fp,
    flow: c.flow,
    mode: c.mode,
    extra: c.extra,
  }));

  try {
    await invoke('start_batch_test', {
      targets: rustTargets,
      testUrl: settings.testUrls.selectedRealDelayUrl,
      downloadUrl: settings.testUrls.downloadUrl,
      uploadUrl: settings.testUrls.uploadUrl,
      testMode: testMode,
      testWorkers: settings.testWorkers,
    });
  } catch (err) {
    console.error(err);
    setIsTesting(false);
  }
};

export const TestingBar: React.FC = () => {
  const { t } = useTranslation();
  const {
    configs,
    activeGroupId,
    testMode,
    setTestMode,
    isTesting,
    setIsTesting,
    testProgress,
    setTestProgress,
    resetResultsForIds,
  } = useConfigStore();

  const currentStage = React.useRef(1);
  const resultBuffer = React.useRef<Record<string, any>>({});
  const progressBuffer = React.useRef<any>(null);

  useEffect(() => {
    let unlistenResult: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    const flushInterval = setInterval(() => {
      if (Object.keys(resultBuffer.current).length > 0) {
        useConfigStore.getState().bulkUpdateTestResults(resultBuffer.current);
        resultBuffer.current = {};
      }
      
      if (progressBuffer.current) {
        const payload = progressBuffer.current;
        setTestProgress({
          tested: payload.tested,
          total: payload.total,
          remaining: payload.remaining,
        });

        if (payload.remaining === 0 || payload.tested >= payload.total) {
          const state = useConfigStore.getState();
          if (state.settings.multiStageTesting && state.testMode === 'realDelay') {
            const maxStages = state.settings.multiStageCount || 3;
            if (currentStage.current < maxStages) {
              const passedConfigs = state.configs.filter(c => c.testStage === currentStage.current);
              if (passedConfigs.length > 0) {
                currentStage.current += 1;
                startBatchTestToRust(passedConfigs, state.settings, state.testMode, setIsTesting);
                progressBuffer.current = null;
                return;
              }
            }
          }
          setIsTesting(false);
          currentStage.current = 1;
        }
        progressBuffer.current = null;
      }
    }, 200);

    const setupListeners = async () => {
      unlistenResult = await listen('test-result', (event: any) => {
        const payload = event.payload;
        if (payload && payload.id) {
          resultBuffer.current[payload.id] = {
            status: payload.status,
            realDelay: payload.test_type === 'speed' ? undefined : payload.real_delay,
            downloadSpeed: payload.download_speed,
            uploadSpeed: payload.upload_speed,
          };
        }
      });

      unlistenError = await listen('xray-error', (event: any) => {
        const payload = event.payload;
        if (payload && payload.error) {
          console.error(`[Xray Error - ${payload.id}]:`, payload.error);
        }
      });

      unlistenProgress = await listen('test-progress', (event: any) => {
        const payload = event.payload;
        if (payload) {
          if (!progressBuffer.current || payload.tested >= progressBuffer.current.tested) {
            progressBuffer.current = payload;
          }
        }
      });
    };

    setupListeners();

    return () => {
      clearInterval(flushInterval);
      if (unlistenResult) unlistenResult();
      if (unlistenProgress) unlistenProgress();
      if (unlistenError) unlistenError();
    };
  }, [setIsTesting, setTestProgress]);

  const handleStartTest = async () => {
    let targets = configs.filter((c) => c.groupId === activeGroupId);
    
    const { selectedConfigIds } = useConfigStore.getState();
    if (selectedConfigIds && selectedConfigIds.length > 0) {
      targets = targets.filter((c) => selectedConfigIds.includes(c.id));
    } else {
      targets = targets.filter((c) => c.status === 'untested');
    }

    if (targets.length === 0) return;

    resetResultsForIds(targets.map(c => c.id), testMode);

    const state = useConfigStore.getState();
    if (state.settings.multiStageTesting && testMode === 'realDelay') {
      currentStage.current = 1;
    }

    setIsTesting(true);
    setTestProgress({ tested: 0, total: targets.length, remaining: targets.length });

    await startBatchTestToRust(targets, state.settings, testMode, setIsTesting);
  };

  const handleStopTest = async () => {
    try {
      await invoke('stop_batch_test');
    } catch (err) {
      console.error(err);
    }
    setIsTesting(false);
  };

  const progressPercentage =
    testProgress.total > 0
      ? Math.min(100, Math.round((testProgress.tested / testProgress.total) * 100))
      : 0;

  return (
    <div className="h-12 border-t flex items-center justify-between px-4 bg-transparent border-border/50 text-xs select-none shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center bg-muted/50 border border-border/50 rounded p-0.5">
          <button
            onClick={() => setTestMode('realDelay')}
            disabled={isTesting}
            className={`h-7 px-2.5 flex items-center gap-1 rounded text-xs font-medium cursor-pointer transition-colors ${
              testMode === 'realDelay'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>{t('realDelayTest')}</span>
          </button>

          <button
            onClick={() => setTestMode('speed')}
            disabled={isTesting}
            className={`h-7 px-2.5 flex items-center gap-1 rounded text-xs font-medium cursor-pointer transition-colors ${
              testMode === 'speed'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span>{t('speedTest')}</span>
          </button>

          <button
            onClick={() => setTestMode('hybrid')}
            disabled={isTesting}
            className={`h-7 px-2.5 flex items-center gap-1 rounded text-xs font-medium cursor-pointer transition-colors ${
              testMode === 'hybrid'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Hybrid</span>
          </button>
        </div>

        {isTesting ? (
          <Button variant="destructive" onClick={handleStopTest} className="h-8 gap-1.5 font-medium">
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>{t('stopTest')}</span>
          </Button>
        ) : (
          <Button onClick={handleStartTest} className="h-8 gap-1.5 font-medium">
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{t('startTest')}</span>
          </Button>
        )}
      </div>

      <div className="flex items-center gap-4 w-1/2 justify-end">
        {isTesting && (
          <div className="flex-1 max-w-xs space-y-1">
            <div className="flex justify-between text-[11px] font-medium text-muted-foreground">
              <span>{t('testingStatus')}</span>
              <span>{progressPercentage}%</span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden border border-border">
              <div
                className="h-full bg-blue-500 transition-all duration-300 ease-out"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 text-[11px] font-medium text-muted-foreground bg-muted/50 border border-border/50 rounded px-3 py-1.5">
          <div>
            {t('tested')}: <span className="text-emerald-400 font-bold">{testProgress.tested}</span>
          </div>
          <div className="h-3 w-[1px] bg-border" />
          <div>
            {t('remaining')}: <span className="text-amber-400 font-bold">{testProgress.remaining}</span>
          </div>
          <div className="h-3 w-[1px] bg-border" />
          <div>
            {t('total')}: <span className="text-foreground font-bold">{testProgress.total}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
