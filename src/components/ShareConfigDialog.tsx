import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { ClipboardCopy, Check, Maximize2, Minimize2, X } from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { ConfigItem } from '../types/config';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';

interface ShareConfigDialogProps {
  config: ConfigItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ShareConfigDialog: React.FC<ShareConfigDialogProps> = ({
  config,
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenQrSize, setFullscreenQrSize] = useState(500);

  const raw = config?.raw?.trim() || '';
  const len = raw.length;

  // Adaptive size & error correction level based on config length
  // For huge configs (e.g. Post-Quantum ML-KEM > 1000 chars), we use larger dimensions
  // and Level L (Low error correction) so the matrix density is as low and camera-readable as possible.
  const isHuge = len > 1000;
  const isMedium = len > 500;

  const qrSize = isHuge ? 380 : isMedium ? 320 : 250;
  const qrLevel: 'L' | 'M' = isMedium ? 'L' : 'M';
  const dialogWidthClass = isHuge
    ? 'max-w-xl w-[min(100vw-2rem,33rem)]'
    : isMedium
    ? 'max-w-lg w-[min(100vw-2rem,30rem)]'
    : 'max-w-md w-[min(100vw-2rem,28rem)]';

  // Calculate maximum readable QR size in fullscreen mode
  useEffect(() => {
    const updateSize = () => {
      const minDimension = Math.min(window.innerWidth, window.innerHeight);
      const calculated = Math.floor(minDimension * 0.72);
      setFullscreenQrSize(Math.max(calculated, 320));
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Listen for Escape key to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleExitFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  const handleEnterFullscreen = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setFullscreen(true);
    } catch (e) {
      console.error('Failed to set window fullscreen:', e);
    }
    setIsFullscreen(true);
  };

  const handleExitFullscreen = async () => {
    setIsFullscreen(false);
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setFullscreen(false);
    } catch (e) {
      console.error('Failed to exit window fullscreen:', e);
    }
  };

  const handleCopy = async () => {
    if (!raw) return;
    try {
      await writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setCopied(false);
            if (isFullscreen) {
              handleExitFullscreen();
            }
          }
          onOpenChange(next);
        }}
      >
        <DialogContent
          className={`${dialogWidthClass} gap-4 max-h-[92vh] overflow-y-auto`}
          showCloseButton
        >
          <DialogHeader className="min-w-0 overflow-hidden pe-8">
            <DialogTitle className="min-w-0 truncate" title={config?.name || undefined}>
              {config?.name || t('share')}
            </DialogTitle>
            <DialogDescription className="min-w-0">{t('shareConfigDesc')}</DialogDescription>
          </DialogHeader>

          <div className="relative flex justify-center rounded-xl bg-white p-3.5 mx-auto shadow-sm border border-border/20 group">
            {raw ? (
              <QRCodeSVG value={raw} size={qrSize} level={qrLevel} includeMargin={false} />
            ) : (
              <div
                style={{ width: qrSize, height: qrSize }}
                className="flex items-center justify-center text-xs text-muted-foreground"
              >
                —
              </div>
            )}
            {raw && (
              <button
                type="button"
                title={t('fullscreen')}
                onClick={handleEnterFullscreen}
                className="absolute top-2 end-2 p-1.5 rounded-lg bg-black/5 hover:bg-black/15 text-slate-700 transition-all opacity-80 hover:opacity-100 cursor-pointer shadow-xs"
              >
                <Maximize2 className="size-4" />
              </button>
            )}
          </div>

          <div className="space-y-2">
            <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 max-h-24 overflow-auto">
              <p className="text-[11px] font-mono break-all leading-relaxed text-foreground/90 select-text">
                {raw || '—'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={handleCopy}
                disabled={!raw}
              >
                {copied ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : (
                  <ClipboardCopy className="size-3.5" />
                )}
                {copied ? t('copied') : t('copy')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleEnterFullscreen}
                disabled={!raw}
                title={t('fullscreen')}
              >
                <Maximize2 className="size-3.5" />
                <span className="hidden sm:inline">{t('fullscreen')}</span>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fullscreen Overlay */}
      {isFullscreen && open && raw && (
        <div
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-6 sm:p-10 select-none animate-in fade-in-0 duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleExitFullscreen();
            }
          }}
        >
          {/* Top Bar */}
          <div className="w-full max-w-4xl flex items-center justify-between gap-4 text-white">
            <div className="min-w-0">
              <h2 className="text-base font-bold truncate" title={config?.name || undefined}>
                {config?.name || t('share')}
              </h2>
              <p className="text-xs text-white/60 truncate">{t('shareConfigDesc')}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExitFullscreen}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 gap-1.5 shrink-0"
            >
              <Minimize2 className="size-4" />
              <span>{t('exitFullscreen')}</span>
            </Button>
          </div>

          {/* Large Center QR Code */}
          <div
            className="flex items-center justify-center p-6 sm:p-8 rounded-3xl bg-white shadow-2xl my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <QRCodeSVG
              value={raw}
              size={fullscreenQrSize}
              level="L"
              includeMargin={false}
            />
          </div>

          {/* Bottom Footer & Hint */}
          <div className="text-center text-white/60 text-xs flex flex-col items-center gap-1">
            <p className="font-medium">{t('pressEscToExit')}</p>
          </div>
        </div>
      )}
    </>
  );
};
