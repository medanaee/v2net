import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { ClipboardCopy, Check } from 'lucide-react';
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

  const raw = config?.raw?.trim() || '';

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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setCopied(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md gap-4" showCloseButton>
        <DialogHeader>
          <DialogTitle className="pe-6 truncate">
            {config?.name || t('share')}
          </DialogTitle>
          <DialogDescription>{t('shareConfigDesc')}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center rounded-lg bg-white p-3 mx-auto">
          {raw ? (
            <QRCodeSVG value={raw} size={200} level="M" includeMargin={false} />
          ) : (
            <div className="size-[200px] flex items-center justify-center text-xs text-muted-foreground">
              —
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 max-h-28 overflow-auto">
            <p className="text-[11px] font-mono break-all leading-relaxed text-foreground/90 select-text">
              {raw || '—'}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
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
        </div>
      </DialogContent>
    </Dialog>
  );
};
