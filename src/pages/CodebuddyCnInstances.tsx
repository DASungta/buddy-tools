import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Layers,
  Plus,
  Play,
  Square,
  Eye,
  Trash2,
  Loader2,
  RefreshCw,
  KeyRound,
} from 'lucide-react';
import { useCodebuddyCnInstanceStore } from '../stores/useCodebuddyCnInstanceStore';
import { CodeBuddyInstanceDialog } from '../components/codebuddy/CodeBuddyInstanceDialog';
import type { CodebuddyInstance } from '../types/codebuddyInstance';

function StatusBadge({ running, initialized }: { running: boolean; initialized: boolean }) {
  const { t } = useTranslation();
  if (!initialized) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
        {t('codebuddy.instance.status.uninit', 'Not initialized')}
      </span>
    );
  }
  if (running) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        {t('codebuddy.instance.status.running', 'Running')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
      {t('codebuddy.instance.status.stopped', 'Stopped')}
    </span>
  );
}

interface RowProps {
  instance: CodebuddyInstance;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onFocus: (id: string) => void;
  onDelete: (id: string) => void;
  onInjectToken: (id: string) => void;
  actionId: string | null;
}

function InstanceRow({
  instance,
  onStart,
  onStop,
  onFocus,
  onDelete,
  onInjectToken,
  actionId,
}: RowProps) {
  const { t } = useTranslation();
  const busy = actionId === instance.id;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {instance.name}
          </span>
          <StatusBadge running={instance.running ?? false} initialized={instance.initialized ?? true} />
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">
          {instance.user_data_dir}
        </p>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {instance.running ? (
          <>
            <button
              onClick={() => onFocus(instance.id)}
              disabled={busy}
              title={t('codebuddy.instance.focus', 'Focus')}
              className="p-1.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
            >
              <Eye size={14} />
            </button>
            <button
              onClick={() => onStop(instance.id)}
              disabled={busy}
              title={t('codebuddy.instance.stop', 'Stop')}
              className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
            </button>
          </>
        ) : (
          <button
            onClick={() => onStart(instance.id)}
            disabled={busy}
            title={t('codebuddy.instance.start', 'Start')}
            className="p-1.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          </button>
        )}

        <button
          onClick={() => onInjectToken(instance.id)}
          disabled={busy}
          title={t('codebuddy.instance.injectToken', 'Inject Token')}
          className="p-1.5 rounded text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50 transition-colors"
        >
          <KeyRound size={14} />
        </button>

        <button
          onClick={() => onDelete(instance.id)}
          disabled={busy}
          title={t('common.delete', 'Delete')}
          className="p-1.5 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export default function CodebuddyCnInstances() {
  const { t } = useTranslation();
  const { instances, defaults, loading, fetchInstances, fetchDefaults, startInstance, stopInstance, focusInstance, deleteInstance, injectToken } =
    useCodebuddyCnInstanceStore();

  const [actionId, setActionId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetchInstances();
    fetchDefaults();
  }, []);

  const withAction = async (id: string, fn: () => Promise<void>) => {
    setActionId(id);
    try {
      await fn();
    } catch (e) {
      console.error(e);
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers size={20} className="text-green-500" />
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('codebuddy.cn.instances', 'CodeBuddy CN Instances')}
          </h1>
          <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium">
            codebuddy.cn
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchInstances}
            disabled={loading}
            className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <Plus size={14} />
            {t('codebuddy.instance.create', 'Create')}
          </button>
        </div>
      </div>

      {instances.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <Layers size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">{t('codebuddy.instance.empty', 'No instances yet')}</p>
        </div>
      )}

      {instances.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
          {instances.map((instance) => (
            <InstanceRow
              key={instance.id}
              instance={instance}
              onStart={(id) => withAction(id, () => startInstance(id))}
              onStop={(id) => withAction(id, () => stopInstance(id))}
              onFocus={(id) => withAction(id, () => focusInstance(id))}
              onDelete={(id) => {
                if (!window.confirm(t('codebuddy.instance.deleteConfirm', 'Delete this instance?'))) return;
                withAction(id, () => deleteInstance(id));
              }}
              onInjectToken={(id) => withAction(id, () => injectToken(id))}
              actionId={actionId}
            />
          ))}
        </div>
      )}

      {showCreate && defaults && (
        <CodeBuddyInstanceDialog
          defaults={defaults}
          accounts={[]}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            fetchInstances();
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}
