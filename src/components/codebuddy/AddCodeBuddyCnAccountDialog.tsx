import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCodebuddyCnAccountStore } from '../../stores/useCodebuddyCnAccountStore';

interface Props {
  showText?: boolean;
}

type Status = 'idle' | 'loading' | 'success' | 'error';

function AddCodeBuddyCnAccountDialog({ showText = true }: Props) {
  const { t } = useTranslation();
  const { addAccountWithToken } = useCodebuddyCnAccountStore();

  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [accessToken, setAccessToken] = useState('');

  const resetState = () => {
    setStatus('idle');
    setMessage('');
    setAccessToken('');
  };

  const handleClose = () => {
    setIsOpen(false);
    resetState();
  };

  const handleSubmit = async () => {
    if (!accessToken.trim()) {
      setStatus('error');
      setMessage(t('codebuddy.addAccount.errorAccessToken', 'access_token 不能为空'));
      return;
    }
    setStatus('loading');
    setMessage(t('common.loading'));
    try {
      await addAccountWithToken(accessToken.trim());
      setStatus('success');
      setMessage(t('common.success'));
      setTimeout(() => handleClose(), 1500);
    } catch (error) {
      setStatus('error');
      setMessage(`${t('common.error')}: ${error}`);
    }
  };

  const StatusAlert = () => {
    if (status === 'idle' || !message) return null;
    const styles: Record<Status, string> = {
      idle: '',
      loading: 'alert-info',
      success: 'alert-success',
      error: 'alert-error',
    };
    const icons: Record<Status, React.ReactNode> = {
      idle: null,
      loading: <Loader2 className="w-5 h-5 animate-spin" />,
      success: <CheckCircle2 className="w-5 h-5" />,
      error: <XCircle className="w-5 h-5" />,
    };
    return (
      <div className={`alert ${styles[status]} mb-4 text-sm py-2 shadow-sm`}>
        {icons[status]}
        <span>{message}</span>
      </div>
    );
  };

  return (
    <>
      <button
        className="px-2.5 lg:px-4 py-2 bg-white dark:bg-base-100 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-base-200 transition-colors flex items-center gap-2 shadow-sm border border-gray-200/50 dark:border-base-300 relative z-[100]"
        onClick={() => setIsOpen(true)}
        title={!showText ? t('codebuddy.addAccount', '添加账号') : undefined}
      >
        <Plus className="w-4 h-4" />
        {showText && <span className="hidden lg:inline">{t('codebuddy.addAccount', '添加账号')}</span>}
      </button>

      {isOpen && createPortal(
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <div className="absolute inset-0 z-[0]" onClick={handleClose} />
          <div className="bg-white dark:bg-base-100 text-gray-900 dark:text-base-content rounded-2xl shadow-2xl w-full max-w-lg p-6 relative z-[10] m-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-4">
              {t('codebuddy.cn.addAccountTitle', '添加 CodeBuddy CN 账号')}
            </h3>

            <StatusAlert />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                access_token
                <span className="text-red-500 ml-1">*</span>
              </label>
              <textarea
                className="textarea textarea-bordered w-full h-24 font-mono text-xs leading-relaxed focus:outline-none focus:border-blue-500 transition-colors bg-white dark:bg-base-100 text-gray-900 dark:text-base-content border-gray-300 dark:border-base-300 placeholder:text-gray-400"
                placeholder={t('codebuddy.accessTokenPlaceholder', '粘贴 access_token...')}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                disabled={status === 'loading' || status === 'success'}
              />
            </div>

            <div className="flex gap-3 w-full mt-6">
              <button
                className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-base-300 transition-colors focus:outline-none"
                onClick={handleClose}
                disabled={status === 'success'}
              >
                {t('accounts.add.btn_cancel', '取消')}
              </button>
              <button
                className="flex-1 px-4 py-2.5 text-white font-medium rounded-xl shadow-md transition-all focus:outline-none bg-blue-500 hover:bg-blue-600 flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                onClick={handleSubmit}
                disabled={status === 'loading' || status === 'success'}
              >
                {status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {t('accounts.add.btn_confirm', '确认')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default AddCodeBuddyCnAccountDialog;
