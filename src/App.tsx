import React, { useState, useEffect } from 'react';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { TitleBar } from './components/TitleBar';
import { GroupTabs } from './components/GroupTabs';
import { ConfigTable } from './components/ConfigTable';
import { TestingBar } from './components/TestingBar';
import { ConnectionBar } from './components/ConnectionBar';
import { SettingsModal } from './components/SettingsModal';
import { useConfigStore } from './store/useConfigStore';
import i18n from './lib/i18n';

export const App: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const { settings, isSettingsOpen } = useConfigStore();

  useEffect(() => {
    document.documentElement.dir = settings.language === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = settings.language;
    i18n.changeLanguage(settings.language);
  }, [settings.language]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  useEffect(() => {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('apply_window_vibrancy', { enabled: settings.acrylicBlur }).catch(console.error);
    });
  }, [settings.acrylicBlur]);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey)) {
        const target = e.target as HTMLElement;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

        if (e.code === 'KeyC') {
          // Allow default for Ctrl+C, but if it fails in WebView2, polyfill it
          if (isInput) {
            const inputTarget = target as HTMLInputElement;
            const start = inputTarget.selectionStart || 0;
            const end = inputTarget.selectionEnd || 0;
            if (start !== end) {
              e.preventDefault();
              writeText(inputTarget.value.substring(start, end)).catch(console.error);
            }
          } else {
            const selectedText = window.getSelection()?.toString();
            if (selectedText) {
              e.preventDefault();
              writeText(selectedText).catch(console.error);
            }
          }
          return;
        }

        if (e.code === 'KeyV') {
          try {
            const text = await readText();
            if (!text) return;

            if (isInput) {
              e.preventDefault();
              const inputTarget = target as HTMLInputElement;
              const start = inputTarget.selectionStart || 0;
              const end = inputTarget.selectionEnd || 0;
              const val = inputTarget.value;
              inputTarget.value = val.substring(0, start) + text + val.substring(end);
              inputTarget.selectionStart = inputTarget.selectionEnd = start + text.length;
              inputTarget.dispatchEvent(new Event('input', { bubbles: true }));
              inputTarget.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              // Not in an input -> add configs
              if (!useConfigStore.getState().isSettingsOpen) {
                e.preventDefault();
                useConfigStore.getState().addConfigsFromText(text);
              }
            }
          } catch (err) {
            console.error('Failed to read clipboard', err);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      className={`h-screen w-screen flex flex-col overflow-hidden select-none ${
        settings.acrylicBlur ? 'acrylic-active bg-transparent' : 'bg-background'
      }`}
    >
      {/* TitleBar is ALWAYS fixed at the very top */}
      <TitleBar />

      {/* Main Content Area beneath TitleBar */}
      {isSettingsOpen ? (
        <SettingsModal />
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 3 Tabs & Action Toolbar */}
          <GroupTabs searchQuery={searchQuery} setSearchQuery={setSearchQuery} />

          {/* High-Performance Virtualized Config Table */}
          <ConfigTable searchQuery={searchQuery} />

          {/* Bottom Testing Bar */}
          <TestingBar />

          {/* Proxy Connection Bar */}
          <ConnectionBar />
        </div>
      )}
    </div>
  );
};

export default App;
