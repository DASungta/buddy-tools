import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Loader2, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCodebuddyCnInstanceStore } from '../../stores/useCodebuddyCnInstanceStore';
import type { CreateInstanceParams, InstanceDefaults } from '../../types/codebuddyInstance';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

interface Props {
  defaults: InstanceDefaults;
  accounts?: Array<{ id: string; email: string }>;
  onClose: () => void;
  onCreated: () => void;
}

export default function CodeBuddyInstanceDialog({ defaults, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const { createInstance } = useCodebuddyCnInstanceStore();

  const [name, setName] = useState('');
  const [userDataDir, setUserDataDir] = useState(defaults.default_user_data_dir || '');
  const [workingDir, setWorkingDir] = useState('');
  const [extraArgs, setExtraArgs] = useState('');
  const [initMode, setInitMode] = useState<'empty' | 'copy' | 'existingdir'>('empty');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userDataDir && defaults) setUserDataDir(defaults.default_user_data_dir);
  }, [defaults]);

  const pickDir = async (setter: (v: string) => void) => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === 'string') setter(selected);
    } catch {
      // user cancelled
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError(t('codebuddy.instance.form.nameRequired', '实例名称不能为空')); return; }
    if (!userDataDir.trim()) { setError(t('codebuddy.instance.form.dataDirRequired', '数据目录不能为空')); return; }

    setSubmitting(true);
    setError('');
    try {
      const params: CreateInstanceParams = {
        name: name.trim(),
        user_data_dir: userDataDir.trim(),
        working_dir: workingDir.trim() || null,
        extra_args: extraArgs.trim(),
        bind_account_id: null,
        copy_source_instance_id: null,
        init_mode: initMode,
      };
      await createInstance(params);
      onCreated();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-base-100 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-base-300 flex items-center gap-2">
          <Plus size={18} className="text-blue-500" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-base-content">
            {t('codebuddy.instance.create', '新建实例')}
          </h2>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('codebuddy.instance.form.name', '实例名称')} <span className="text-red-500">*</span>
            </label>
            <input
              className="input input-bordered input-sm w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('codebuddy.instance.form.namePlaceholder', '如：工作实例 1')}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('codebuddy.instance.form.dataDir', '数据目录')} <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                className="input input-bordered input-sm flex-1 font-mono text-xs"
                value={userDataDir}
                onChange={(e) => setUserDataDir(e.target.value)}
                placeholder="/path/to/user-data"
              />
              <button
                className="btn btn-sm btn-ghost border border-gray-200 dark:border-base-300"
                onClick={() => pickDir(setUserDataDir)}
                type="button"
              >
                <FolderOpen size={14} />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('codebuddy.instance.form.initMode', '初始化方式')}
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={initMode}
              onChange={(e) => setInitMode(e.target.value as typeof initMode)}
            >
              <option value="empty">{t('codebuddy.instance.form.initEmpty', '创建空数据目录')}</option>
              <option value="existingdir">{t('codebuddy.instance.form.initExisting', '使用已有目录')}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('codebuddy.instance.form.workingDir', '工作目录（可选）')}
            </label>
            <div className="flex gap-2">
              <input
                className="input input-bordered input-sm flex-1 font-mono text-xs"
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                placeholder={t('codebuddy.instance.form.workingDirPlaceholder', '留空表示无特定工作目录')}
              />
              <button
                className="btn btn-sm btn-ghost border border-gray-200 dark:border-base-300"
                onClick={() => pickDir(setWorkingDir)}
                type="button"
              >
                <FolderOpen size={14} />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('codebuddy.instance.form.extraArgs', '额外启动参数（可选）')}
            </label>
            <input
              className="input input-bordered input-sm w-full font-mono text-xs"
              value={extraArgs}
              onChange={(e) => setExtraArgs(e.target.value)}
              placeholder="--disable-extensions"
            />
          </div>

          {error && (
            <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 dark:border-base-300 flex justify-end gap-2">
          <button className="btn btn-sm btn-ghost" onClick={onClose} disabled={submitting}>
            {t('common.cancel', '取消')}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {t('common.create', '创建')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export { CodeBuddyInstanceDialog };
