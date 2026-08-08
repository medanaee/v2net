import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { get, set, del } from 'idb-keyval';
import { invoke } from '@tauri-apps/api/core';
import {
  ConfigItem,
  ConfigStatus,
  Group,
  AppSettings,
  isSubscriptionGroup,
} from '../types/config';
import { parseBatchConfigs } from '../lib/parsers';
import { decodeSubscriptionBody } from '../lib/subscription';
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
  addGroup: (name: string, subscriptionUrl?: string) => string | null;
  updateGroup: (id: string, patch: { name?: string; subscriptionUrl?: string }) => void;
  renameGroup: (id: string, newName: string) => void;
  deleteGroup: (id: string) => void;
  setActiveGroupId: (id: string) => void;
  refreshSubscription: (groupId: string) => Promise<number>;
  isGroupSubscription: (groupId?: string) => boolean;

  // Configs
  configs: ConfigItem[];
  activeTab: ConfigStatus;
  setActiveTab: (tab: ConfigStatus) => void;
  /** Site filter (AND): show configs that pass every selected site id. Empty = no filter. */
  siteFilterIds: string[];
  setSiteFilterIds: (ids: string[]) => void;
  toggleSiteFilter: (id: string) => void;
  selectedConfigIds: string[];
  lastSelectedId: string | null;

  addConfigsFromText: (rawText: string, targetGroupId?: string) => number;
  deleteSelectedConfigs: () => void;
  resetSelectedResults: () => void;
  resetResultsForIds: (
    targetIds: string[],
    mode: 'realDelay' | 'speed' | 'hybrid' | 'siteTest'
  ) => void;

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
  testMode: 'realDelay' | 'speed' | 'hybrid' | 'siteTest';
  setTestMode: (mode: 'realDelay' | 'speed' | 'hybrid' | 'siteTest') => void;
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
      countryCode?: string | null;
      siteResults?: Record<string, boolean | null>;
    }
  ) => void;
  bulkUpdateTestResults: (
    updates: Record<string, {
      realDelay?: number | null;
      status?: ConfigStatus | null;
      downloadSpeed?: number | null;
      uploadSpeed?: number | null;
      countryCode?: string | null;
      siteResults?: Record<string, boolean | null>;
    }>
  ) => void;
  setConfigsCountry: (ids: string[], countryCode: string) => void;
  updateConfigTraffic: (id: string, txDiff: number, rxDiff: number) => void;

  // Settings & Navigation
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  toggleTheme: () => void;
  toggleAcrylicBlur: () => void;
  setLanguage: (lang: 'fa' | 'en') => void;

  // Transient state
  tunMode: boolean;
  setTunMode: (enabled: boolean) => void;
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

function normalizeSubscriptionUrl(url?: string): string | undefined {
  const trimmed = url?.trim();
  return trimmed ? trimmed : undefined;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
  groups: [DEFAULT_GROUP],
  activeGroupId: 'default_group',

  addGroup: (name: string, subscriptionUrl?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const newGroup: Group = {
      id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: trimmed,
      createdTime: Date.now(),
      subscriptionUrl: normalizeSubscriptionUrl(subscriptionUrl),
    };
    set((state) => ({
      groups: [...state.groups, newGroup],
      activeGroupId: newGroup.id,
    }));
    return newGroup.id;
  },

  updateGroup: (id, patch) => {
    set((state) => ({
      groups: state.groups.map((g) => {
        if (g.id !== id) return g;
        const next: Group = { ...g };
        if (patch.name !== undefined) {
          const trimmed = patch.name.trim();
          if (trimmed) next.name = trimmed;
        }
        if (patch.subscriptionUrl !== undefined) {
          next.subscriptionUrl = normalizeSubscriptionUrl(patch.subscriptionUrl);
          if (!next.subscriptionUrl) {
            delete next.lastUpdated;
          }
        }
        return next;
      }),
    }));
  },

  renameGroup: (id: string, newName: string) => {
    get().updateGroup(id, { name: newName });
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

  isGroupSubscription: (groupId?: string) => {
    const id = groupId || get().activeGroupId;
    const group = get().groups.find((g) => g.id === id);
    return isSubscriptionGroup(group);
  },

  refreshSubscription: async (groupId: string) => {
    const group = get().groups.find((g) => g.id === groupId);
    const url = group?.subscriptionUrl?.trim();
    if (!url) {
      throw new Error('Group has no subscription URL');
    }

    const body = await invoke<string>('fetch_subscription', { url });
    const text = decodeSubscriptionBody(body);
    const parsed = parseBatchConfigs(text, groupId);
    if (parsed.length === 0) {
      throw new Error('No valid configs found in subscription');
    }

    set((state) => ({
      configs: [
        ...state.configs.filter((c) => c.groupId !== groupId),
        ...parsed,
      ],
      groups: state.groups.map((g) =>
        g.id === groupId ? { ...g, lastUpdated: Date.now() } : g
      ),
      selectedConfigIds: [],
      lastSelectedId: null,
    }));
    return parsed.length;
  },

  configs: [],
  activeTab: 'untested',
  setActiveTab: (tab: ConfigStatus) => {
    set({ activeTab: tab, selectedConfigIds: [], lastSelectedId: null });
  },

  siteFilterIds: [],
  setSiteFilterIds: (ids) => set({ siteFilterIds: ids }),
  toggleSiteFilter: (id) =>
    set((state) => {
      const has = state.siteFilterIds.includes(id);
      return {
        siteFilterIds: has
          ? state.siteFilterIds.filter((x) => x !== id)
          : [...state.siteFilterIds, id],
      };
    }),

  selectedConfigIds: [],
  lastSelectedId: null,

  addConfigsFromText: (rawText: string, targetGroupId?: string) => {
    const groupId = targetGroupId || get().activeGroupId;
    if (get().isGroupSubscription(groupId)) {
      return 0;
    }
    const parsed = parseBatchConfigs(rawText, groupId);
    if (parsed.length === 0) return 0;

    set((state) => ({
      configs: [...state.configs, ...parsed],
    }));
    return parsed.length;
  },

  deleteSelectedConfigs: () => {
    const state = get();
    if (state.isGroupSubscription(state.activeGroupId)) {
      return;
    }
    const selectedSet = new Set(state.selectedConfigIds);
    if (selectedSet.size === 0) return;

    // Also block deleting configs that belong to any subscription group
    const subGroupIds = new Set(
      state.groups.filter(isSubscriptionGroup).map((g) => g.id)
    );

    set((s) => ({
      configs: s.configs.filter((c) => {
        if (!selectedSet.has(c.id)) return true;
        if (subGroupIds.has(c.groupId)) return true; // keep
        return false;
      }),
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

  resetResultsForIds: (targetIds, mode) => {
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
          }
          if (mode === 'siteTest') {
            return {
              ...c,
              siteResults: undefined,
            };
          }
          return {
            ...c,
            status: 'untested' as ConfigStatus,
            testStage: 0,
            realDelay: null,
            countryCode: null,
            downloadSpeed: null,
            uploadSpeed: null,
          };
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
  setTestMode: (mode) => set({ testMode: mode }),

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
            countryCode:
              result.countryCode !== undefined && result.countryCode
                ? result.countryCode.toUpperCase()
                : c.countryCode,
            siteResults:
              result.siteResults !== undefined
                ? { ...(c.siteResults || {}), ...result.siteResults }
                : c.siteResults,
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

          if (result.status === 'disconnected' && state.testMode !== 'siteTest') {
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
            countryCode:
              result.countryCode !== undefined && result.countryCode
                ? result.countryCode.toUpperCase()
                : c.countryCode,
            siteResults:
              result.siteResults !== undefined
                ? { ...(c.siteResults || {}), ...result.siteResults }
                : c.siteResults,
          };
        }
        return c;
      }),
    }));
  },

  setConfigsCountry: (ids, countryCode) => {
    if (ids.length === 0 || !countryCode) return;
    const code = countryCode.toUpperCase();
    const idSet = new Set(ids);
    set((state) => ({
      configs: state.configs.map((c) =>
        idSet.has(c.id) ? { ...c, countryCode: code } : c
      ),
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

  tunMode: false,
  setTunMode: (enabled: boolean) => set({ tunMode: enabled }),

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
    hasSeenSecondarySortTip: false,
    siteTestSelectedIds: ['gemini'],
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
        const groups = (persistedState?.groups || currentState.groups).map(
          (g: Group) => ({
            ...g,
            subscriptionUrl: g.subscriptionUrl?.trim() || undefined,
          })
        );
        return {
          ...currentState,
          ...persistedState,
          groups,
          // TUN must never persist across launches
          tunMode: false,
          settings: {
            ...currentState.settings,
            ...(persistedState.settings || {}),
            localPort: persistedState.settings?.localPort || 10900,
            systemProxyMode: persistedState.settings?.systemProxyMode || 'dont_change',
            showTrafficStats: persistedState.settings?.showTrafficStats ?? true,
            hasSeenSecondarySortTip:
              persistedState.settings?.hasSeenSecondarySortTip ?? false,
            siteTestSelectedIds:
              Array.isArray(persistedState.settings?.siteTestSelectedIds) &&
              persistedState.settings.siteTestSelectedIds.length > 0
                ? persistedState.settings.siteTestSelectedIds
                : ['gemini'],
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
