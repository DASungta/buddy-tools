import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, ExternalLink, Loader2, X } from 'lucide-react';
import type { CodebuddyCnAccount } from '../../types/codebuddyCn';
import {
  startCodebuddyCnOAuthLogin,
  completeCodebuddyCnOAuthLogin,
  cancelCodebuddyCnOAuthLogin,
} from '../../services/codebuddyCnService';
import { openUrl } from '@tauri-apps/plugin-opener';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (account: CodebuddyCnAccount) => void;
  variant?: 'cn';
}

export default function CodeBuddyOAuthDialog({ open, onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string>('');
  const [_loginId, setLoginId] = useState<string>('');
  const [status, setStatus] = useState<'loading' | 'waiting' | 'expired' | 'cancelled' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const loginIdRef = useRef<string>('');

  useEffect(() => {
    if (!open) return;
    setStatus('loading');
    setUrl('');
    setLoginId('');
    setErrorMsg('');

    let cancelled = false;

    (async () => {
      try {
        const resp = await startCodebuddyCnOAuthLogin();
        if (cancelled) return;
        const loginUrl = resp.verification_uri_complete || resp.verification_uri;
        setUrl(loginUrl);
        setLoginId(resp.login_id);
        loginIdRef.current = resp.login_id;
        setStatus('waiting');

        const account = await completeCodebuddyCnOAuthLogin(resp.login_id);
        if (cancelled) return;
        onSuccess(account);
        onClose();
      } catch (err: any) {
        if (cancelled) return;
        const msg = String(err);
        if (msg.includes('取消') || msg.includes('cancelled')) {
          setStatus('cancelled');
        } else if (msg.includes('超时') || msg.includes('timeout') || msg.includes('expired')) {
          setStatus('expired');
        } else {
          setStatus('error');
          setErrorMsg(msg);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (loginIdRef.current) {
        cancelCodebuddyCnOAuthLogin(loginIdRef.current).catch(() => {});
      }
    };
  }, [open]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleOpenBrowser = async () => {
    if (url) await openUrl(url);
  };

  const handleClose = () => {
    if (loginIdRef.current) {
      cancelCodebuddyCnOAuthLogin(loginIdRef.current).catch(() => {});
    }
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 relative">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <X size={18} />
        </button>

        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
          {t('codebuddy.oauth.dialog.title')}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {t('codebuddy.oauth.dialog.hint')}
        </p>

        {status === 'loading' && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2 className="animate-spin text-blue-500" size={32} />
          </div>
        )}

        {status === 'waiting' && url && (
          <div className="flex flex-col items-center gap-4">
            <div className="p-2 bg-white rounded-lg border border-gray-200">
              <QRCodeSVG value={url} size={200} />
            </div>

            <div className="w-full">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('codebuddy.oauth.urlLabel')}
              </p>
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-xs text-gray-700 dark:text-gray-300 break-all">
                <span className="flex-1 truncate">{url}</span>
              </div>
            </div>

            <div className="flex gap-2 w-full">
              <button
                onClick={handleCopy}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <Copy size={13} />
                {copied ? '✓' : t('codebuddy.oauth.copyUrl')}
              </button>
              <button
                onClick={handleOpenBrowser}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs"
              >
                <ExternalLink size={13} />
                {t('codebuddy.oauth.openBrowser')}
              </button>
            </div>

            <p className="text-xs text-gray-400 flex items-center gap-1.5">
              <Loader2 className="animate-spin" size={12} />
              {t('codebuddy.oauth.waiting')}
            </p>
          </div>
        )}

        {status === 'expired' && (
          <p className="text-center text-sm text-red-500 py-6">{t('codebuddy.oauth.expired')}</p>
        )}
        {status === 'cancelled' && (
          <p className="text-center text-sm text-gray-500 py-6">{t('codebuddy.oauth.cancelled')}</p>
        )}
        {status === 'error' && (
          <p className="text-center text-sm text-red-500 py-6">{errorMsg || 'Error'}</p>
        )}
      </div>
    </div>,
    document.body
  );
}
