import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { get, set, del } from 'idb-keyval';
import { ConfigItem, ConfigStatus, Group, AppSettings } from '../types/config';
import { parseBatchConfigs } from '../lib/parsers';
import i18n from '../lib/i18n';

const DEFAULT_TEST_URLS = [
  'http://cp.cloudflare.com/generate_204',
  'http://www.gstatic.com/generate_204',
  'https://www.google.com',
  'https://1.1.1.1',
];

interface ConfigState {
  // Groups
  groups: Group[];
  activeGroupId: string;
  addGroup: (name: string) => void;
  renameGroup: (id: string, newName: string) => void;
  deleteGroup: (id: string) => void;
  setActiveGroupId: (id: string) => void;

  // Configs
  configs: ConfigItem[];
  activeTab: ConfigStatus;
  setActiveTab: (tab: ConfigStatus) => void;
  selectedConfigIds: string[];
  lastSelectedId: string | null;

  addConfigsFromText: (rawText: string, targetGroupId?: string) => number;
  deleteSelectedConfigs: () => void;
  resetSelectedResults: () => void;
  resetResultsForIds: (targetIds: string[], mode: 'realDelay' | 'speed' | 'hybrid') => void;

  // Selection logic
  handleConfigClick: (
    id: string,
    isCtrl: boolean,
    isShift: boolean,
    visibleItems: ConfigItem[]
  ) => void;
  selectAllVisible: (visibleItems: ConfigItem[]) => void;
  clearSelection: () => void;

  // Testing
  testMode: 'realDelay' | 'speed' | 'hybrid';
  setTestMode: (mode: 'realDelay' | 'speed' | 'hybrid') => void;
  isTesting: boolean;
  setIsTesting: (testing: boolean) => void;
  testProgress: { tested: number; total: number; remaining: number };
  setTestProgress: (progress: { tested: number; total: number; remaining: number }) => void;
  updateConfigTestResult: (
    id: string,
    result: {
      realDelay?: number | null;
      status?: ConfigStatus | null;
      downloadSpeed?: number | null;
      uploadSpeed?: number | null;
    }
  ) => void;
  bulkUpdateTestResults: (
    updates: Record<string, {
      realDelay?: number | null;
      status?: ConfigStatus | null;
      downloadSpeed?: number | null;
      uploadSpeed?: number | null;
    }>
  ) => void;
  updateConfigTraffic: (id: string, txDiff: number, rxDiff: number) => void;

  // Settings & Navigation
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  toggleTheme: () => void;
  toggleAcrylicBlur: () => void;
  setLanguage: (lang: 'fa' | 'en') => void;
}


let throttleTimer: number | undefined;
let latestValue: string | null = null;
let lastWriteTime = 0;

const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    latestValue = value;
    const now = Date.now();
    
    if (now - lastWriteTime >= 2000) {
      lastWriteTime = now;
      await set(name, latestValue);
    } else if (!throttleTimer) {
      throttleTimer = window.setTimeout(async () => {
        throttleTimer = undefined;
        lastWriteTime = Date.now();
        if (latestValue) {
          await set(name, latestValue).catch(console.error);
        }
      }, 2000 - (now - lastWriteTime));
    }
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};

const DEFAULT_GROUP: Group = {
  id: 'default_group',
  name: 'Main',
  createdTime: Date.now(),
};

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
  groups: [DEFAULT_GROUP],
  activeGroupId: 'default_group',

  addGroup: (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newGroup: Group = {
      id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: trimmed,
      createdTime: Date.now(),
    };
    set((state) => ({
      groups: [...state.groups, newGroup],
      activeGroupId: newGroup.id,
    }));
  },

  renameGroup: (id: string, newName: string) => {
    if (id === 'default_group') return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    set((state) => ({
      groups: state.groups.map(g => g.id === id ? { ...g, name: trimmed } : g),
    }));
  },

  deleteGroup: (id: string) => {
    set((state) => {
      if (id === 'default_group') return state;
      if (state.groups.length <= 1) return state; // keep at least one group
      const newGroups = state.groups.filter((g) => g.id !== id);
      const newActiveId =
        state.activeGroupId === id ? newGroups[0].id : state.activeGroupId;
      return {
        groups: newGroups,
        activeGroupId: newActiveId,
        configs: state.configs.filter((c) => c.groupId !== id),
        selectedConfigIds: [],
      };
    });
  },

  setActiveGroupId: (id: string) => {
    set({ activeGroupId: id, selectedConfigIds: [], lastSelectedId: null });
  },

  configs: [],
  activeTab: 'untested',
  setActiveTab: (tab: ConfigStatus) => {
    set({ activeTab: tab, selectedConfigIds: [], lastSelectedId: null });
  },

  selectedConfigIds: [],
  lastSelectedId: null,

  addConfigsFromText: (rawText: string, targetGroupId?: string) => {
    const groupId = targetGroupId || get().activeGroupId;
    const parsed = parseBatchConfigs(rawText, groupId);
    if (parsed.length === 0) return 0;

    set((state) => ({
      configs: [...state.configs, ...parsed],
    }));
    return parsed.length;
  },

  deleteSelectedConfigs: () => {
    const selectedSet = new Set(get().selectedConfigIds);
    if (selectedSet.size === 0) return;

    set((state) => ({
      configs: state.configs.filter((c) => !selectedSet.has(c.id)),
      selectedConfigIds: [],
      lastSelectedId: null,
    }));
  },

  resetSelectedResults: () => {
    const selectedSet = new Set(get().selectedConfigIds);
    if (selectedSet.size === 0) return;

    set((state) => ({
      configs: state.configs.map((c) => {
        if (selectedSet.has(c.id)) {
          return {
            ...c,
            status: 'untested' as ConfigStatus,
            testStage: 0,
            realDelay: null,
            downloadSpeed: null,
            uploadSpeed: null,
          };
        }
        return c;
      }),
    }));
  },

  resetResultsForIds: (targetIds: string[], mode: 'realDelay' | 'speed' | 'hybrid') => {
    const idsSet = new Set(targetIds);
    set((state) => ({
      configs: state.configs.map((c) => {
        if (idsSet.has(c.id)) {
          if (mode === 'speed') {
            return {
              ...c,
              downloadSpeed: null,
              uploadSpeed: null,
            };
          } else {
            return {
              ...c,
              status: 'untested' as ConfigStatus,
              testStage: 0,
              realDelay: null,
              downloadSpeed: null,
              uploadSpeed: null,
            };
          }
        }
        return c;
      }),
    }));
  },

  handleConfigClick: (
    id: string,
    isCtrl: boolean,
    isShift: boolean,
    visibleItems: ConfigItem[]
  ) => {
    const { selectedConfigIds, lastSelectedId } = get();

    if (isShift && lastSelectedId) {
      const lastIndex = visibleItems.findIndex((item) => item.id === lastSelectedId);
      const currentIndex = visibleItems.findIndex((item) => item.id === id);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeIds = visibleItems.slice(start, end + 1).map((item) => item.id);

        const newSelected = Array.from(new Set([...selectedConfigIds, ...rangeIds]));
        set({ selectedConfigIds: newSelected });
        return;
      }
    }

    if (isCtrl) {
      if (selectedConfigIds.includes(id)) {
        set({
          selectedConfigIds: selectedConfigIds.filter((item) => item !== id),
          lastSelectedId: id,
        });
      } else {
        set({
          selectedConfigIds: [...selectedConfigIds, id],
          lastSelectedId: id,
        });
      }
      return;
    }

    set({
      selectedConfigIds: [id],
      lastSelectedId: id,
    });
  },

  selectAllVisible: (visibleItems: ConfigItem[]) => {
    set({ selectedConfigIds: visibleItems.map((item) => item.id) });
  },

  clearSelection: () => {
    set({ selectedConfigIds: [], lastSelectedId: null });
  },

  testMode: 'realDelay',
  setTestMode: (mode: 'realDelay' | 'speed' | 'hybrid') => set({ testMode: mode }),

  isTesting: false,
  setIsTesting: (testing: boolean) => set({ isTesting: testing }),

  testProgress: { tested: 0, total: 0, remaining: 0 },
  setTestProgress: (progress) => set({ testProgress: progress }),

  updateConfigTestResult: (id, result) => {
    set((state) => ({
      configs: state.configs.map((c) => {
        if (c.id === id) {
          let nextStatus = result.status ?? c.status;
          let nextTestStage = c.testStage || 0;
          
          if (
            state.settings.multiStageTesting &&
            state.testMode === 'realDelay' &&
            result.status === 'working'
          ) {
            nextTestStage += 1;
            const maxStages = state.settings.multiStageCount || 3;
            if (nextTestStage < maxStages) {
              nextStatus = 'untested';
            }
          }

          if (result.status === 'disconnected') {
            nextTestStage = 0;
          }

          return {
            ...c,
            status: nextStatus,
            testStage: nextTestStage,
            realDelay: result.realDelay !== undefined ? result.realDelay : c.realDelay,
            downloadSpeed:
              result.downloadSpeed !== undefined ? result.downloadSpeed : c.downloadSpeed,
            uploadSpeed:
              result.uploadSpeed !== undefined ? result.uploadSpeed : c.uploadSpeed,
          };
        }
        return c;
      }),
    }));
  },

  bulkUpdateTestResults: (updates) => {
    set((state) => ({
      configs: state.configs.map((c) => {
        const result = updates[c.id];
        if (result) {
          let nextStatus = result.status ?? c.status;
          let nextTestStage = c.testStage || 0;
          
          if (
            state.settings.multiStageTesting &&
            state.testMode === 'realDelay' &&
            result.status === 'working'
          ) {
            nextTestStage += 1;
            const maxStages = state.settings.multiStageCount || 3;
            if (nextTestStage < maxStages) {
              nextStatus = 'untested';
            }
          }

          if (result.status === 'disconnected') {
            nextTestStage = 0;
          }

          return {
            ...c,
            status: nextStatus,
            testStage: nextTestStage,
            realDelay: result.realDelay !== undefined ? result.realDelay : c.realDelay,
            downloadSpeed:
              result.downloadSpeed !== undefined ? result.downloadSpeed : c.downloadSpeed,
            uploadSpeed:
              result.uploadSpeed !== undefined ? result.uploadSpeed : c.uploadSpeed,
          };
        }
        return c;
      }),
    }));
  },

  updateConfigTraffic: (id, txDiff, rxDiff) => {
    set((state) => {
      const todayString = new Date().toISOString().split('T')[0];
      return {
        configs: state.configs.map((c) => {
          if (c.id === id) {
            let nextToday = c.trafficToday;
            if (!nextToday || nextToday.date !== todayString) {
              nextToday = { tx: 0, rx: 0, date: todayString };
            }
            const nextTotal = c.trafficTotal || { tx: 0, rx: 0 };
            
            return {
              ...c,
              trafficToday: {
                ...nextToday,
                tx: nextToday.tx + txDiff,
                rx: nextToday.rx + rxDiff,
              },
              trafficTotal: {
                tx: nextTotal.tx + txDiff,
                rx: nextTotal.rx + rxDiff,
              }
            };
          }
          return c;
        }),
      };
    });
  },

  isSettingsOpen: false,
  setIsSettingsOpen: (open: boolean) => set({ isSettingsOpen: open }),

  settings: {
    theme: 'dark',
    language: 'en',
    acrylicBlur: false,
    testWorkers: 40,
    multiStageTesting: false,
    multiStageCount: 3,
    testUrls: {
      realDelay: DEFAULT_TEST_URLS,
      selectedRealDelayUrl: DEFAULT_TEST_URLS[0],
      downloadUrl: 'https://speed.cloudflare.com/__down?bytes=10000000',
      uploadUrl: 'https://speed.cloudflare.com/__up',
    },
    localPort: 10900,
    systemProxyMode: 'dont_change',
    activeConfigId: null,
    showTrafficStats: true,
  },

  updateSettings: (newSettings) => {
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    }));
  },

  toggleTheme: () => {
    set((state) => {
      const nextTheme = state.settings.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', nextTheme === 'dark');
      return {
        settings: { ...state.settings, theme: nextTheme },
      };
    });
  },

  toggleAcrylicBlur: () => {
    set((state) => ({
      settings: { ...state.settings, acrylicBlur: !state.settings.acrylicBlur },
    }));
  },

  setLanguage: (lang: 'fa' | 'en') => {
    i18n.changeLanguage(lang);
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    set((state) => ({
      settings: { ...state.settings, language: lang },
    }));
  },
    }),
    {
      name: 'v2ray-test-storage',
      storage: createJSONStorage(() => idbStorage),
      merge: (persistedState: any, currentState) => {
        return {
          ...currentState,
          ...persistedState,
          settings: {
            ...currentState.settings,
            ...(persistedState.settings || {}),
            localPort: persistedState.settings?.localPort || 10900,
            systemProxyMode: persistedState.settings?.systemProxyMode || 'dont_change',
            showTrafficStats: persistedState.settings?.showTrafficStats ?? true,
          },
        };
      },
      partialize: (state) => ({
        groups: state.groups,
        configs: state.configs,
        settings: state.settings,
        activeGroupId: state.activeGroupId,
      }),
    }
  )
);
