import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  initialName?: string;
  initialSubscriptionUrl?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; subscriptionUrl: string }) => void;
}

export const GroupEditorDialog: React.FC<Props> = ({
  open,
  mode,
  initialName = '',
  initialSubscriptionUrl = '',
  onOpenChange,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [subscriptionUrl, setSubscriptionUrl] = useState(initialSubscriptionUrl);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setSubscriptionUrl(initialSubscriptionUrl);
    }
  }, [open, initialName, initialSubscriptionUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), subscriptionUrl: subscriptionUrl.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('createGroupTitle') : t('editGroupTitle')}
          </DialogTitle>
          <DialogDescription>{t('groupSubscriptionUrlDesc')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              {t('group')}
            </label>
            <input
              type="text"
              placeholder={t('groupNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-card border border-border text-foreground rounded-md px-2.5 py-1.5 outline-none focus:border-primary transition-colors w-full text-xs"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <Link2 className="w-3.5 h-3.5" />
              {t('groupSubscriptionUrl')}
            </label>
            <input
              type="url"
              dir="ltr"
              placeholder={t('groupSubscriptionUrlPlaceholder')}
              value={subscriptionUrl}
              onChange={(e) => setSubscriptionUrl(e.target.value)}
              className="bg-card border border-border text-foreground rounded-md px-2.5 py-1.5 outline-none focus:border-primary transition-colors w-full text-xs font-mono"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim()}>
              {mode === 'create' ? t('add') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
