import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { ShieldCheck, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
}

export const SudoPasswordModal: React.FC<Props> = ({ isOpen, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      onSubmit(password);
      setPassword('');
    }
  };

  const handleClose = () => {
    setPassword('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card w-full max-w-sm rounded-lg shadow-xl overflow-hidden border border-border flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <ShieldCheck className="w-5 h-5 text-blue-500" />
            <span>{t('sudoTitle', 'Authentication Required')}</span>
          </div>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {t('sudoDesc', 'Please enter your sudo password to enable Tun mode.')}
          </p>
          <input
            type="password"
            autoFocus
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            placeholder={t('password', 'Password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t('cancel', 'Cancel')}
            </Button>
            <Button type="submit" variant="default" disabled={!password}>
              {t('confirm', 'Confirm')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
