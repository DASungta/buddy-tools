import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { request as invoke } from '../utils/request';
import { isTauri } from '../utils/env';
import { copyToClipboard } from '../utils/clipboard';
import {
    Power,
    Copy,
    RefreshCw,
    CheckCircle,
    Settings,
    Terminal,
    Trash2,
    Sparkles,
    Code,
    Bot,
    X,
    Edit2
} from 'lucide-react';
import { AppConfig, ProxyConfig, StickySessionConfig, ExperimentalConfig, CodeBuddyCnConfig } from '../types/config';
import HelpTooltip from '../components/common/HelpTooltip';
import ModalDialog from '../components/common/ModalDialog';
import { showToast } from '../components/common/ToastContainer';
import { cn } from '../utils/cn';
import { useProxyModels } from '../hooks/useProxyModels';
import { CliSyncCard } from '../components/proxy/CliSyncCard';
import DebouncedSlider from '../components/common/DebouncedSlider';
import { listAccounts } from '../services/accountService';
import CircuitBreaker from '../components/settings/CircuitBreaker';
import { CircuitBreakerConfig } from '../types/config';

interface ProxyStatus {
    running: boolean;
    port: number;
    base_url: string;
    active_accounts: number;
}



interface CollapsibleCardProps {
    title: string;
    icon: React.ReactNode;
    enabled?: boolean;
    onToggle?: (enabled: boolean) => void;
    children: React.ReactNode;
    defaultExpanded?: boolean;
    rightElement?: React.ReactNode;
    allowInteractionWhenDisabled?: boolean;
}

function CollapsibleCard({
    title,
    icon,
    enabled,
    onToggle,
    children,
    defaultExpanded = false,
    rightElement,
    allowInteractionWhenDisabled = false,
}: CollapsibleCardProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const { t } = useTranslation();

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700/50 overflow-hidden transition-all duration-200 hover:shadow-md">
            <div
                className="px-5 py-4 flex items-center justify-between cursor-pointer bg-gray-50/50 dark:bg-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                onClick={(e) => {
                    // Prevent toggle when clicking the switch or right element
                    if ((e.target as HTMLElement).closest('.no-expand')) return;
                    setIsExpanded(!isExpanded);
                }}
            >
                <div className="flex items-center gap-3">
                    <div className="text-gray-500 dark:text-gray-400">
                        {icon}
                    </div>
                    <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                        {title}
                    </span>
                    {enabled !== undefined && (
                        <div className={cn('text-xs px-2 py-0.5 rounded-full', enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-600/50 dark:text-gray-300')}>
                            {enabled ? t('common.enabled') : t('common.disabled')}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4 no-expand">
                    {rightElement}

                    {enabled !== undefined && onToggle && (
                        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                            <input
                                type="checkbox"
                                className="toggle toggle-sm bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 checked:bg-blue-500 checked:border-blue-500"
                                checked={enabled}
                                onChange={(e) => onToggle(e.target.checked)}
                            />
                        </div>
                    )}

                    <button
                        className={cn('p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-all duration-200', isExpanded ? 'rotate-180' : '')}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m6 9 6 6 6-6" />
                        </svg>
                    </button>
                </div>
            </div>

            <div
                className={`transition-all duration-300 ease-in-out border-t border-gray-100 dark:border-base-200 ${isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
                    }`}
            >
                <div className="p-5 relative">
                    {/* Overlay when disabled */}
                    {enabled === false && !allowInteractionWhenDisabled && (
                        <div className="absolute inset-0 bg-gray-100/40 dark:bg-black/30 z-10 cursor-not-allowed" />
                    )}
                    <div className={enabled === false && !allowInteractionWhenDisabled ? 'opacity-60 pointer-events-none select-none' : ''}>
                        {children}
                    </div>
                </div>

            </div>
        </div>
    );
}

export default function ApiProxy() {
    const { t } = useTranslation();

    const { models } = useProxyModels();

    const [status, setStatus] = useState<ProxyStatus>({
        running: false,
        port: 0,
        base_url: '',
        active_accounts: 0,
    });

    const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
    const [configLoading, setConfigLoading] = useState(true);
    const [configError, setConfigError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);
    const [selectedModelId, setSelectedModelId] = useState('auto');

    // API Key editing states
    const [isEditingApiKey, setIsEditingApiKey] = useState(false);
    const [tempApiKey, setTempApiKey] = useState('');

    const [isEditingAdminPassword, setIsEditingAdminPassword] = useState(false);
    const [tempAdminPassword, setTempAdminPassword] = useState('');

    // Modal states
    const [isRegenerateKeyConfirmOpen, setIsRegenerateKeyConfirmOpen] = useState(false);
    const [isClearBindingsConfirmOpen, setIsClearBindingsConfirmOpen] = useState(false);
    const [isClearRateLimitsConfirmOpen, setIsClearRateLimitsConfirmOpen] = useState(false);

    // [FIX #820] Fixed account mode states
    const [preferredAccountId, setPreferredAccountId] = useState<string | null>(null);
    const [availableAccounts, setAvailableAccounts] = useState<Array<{ id: string; email: string }>>([]);

    // Cloudflared (CF隧道) states
    const [cfStatus, setCfStatus] = useState<{ installed: boolean; version?: string; running: boolean; url?: string; error?: string }>({
        installed: false,
        running: false,
    });
    const [cfLoading, setCfLoading] = useState(false);
    const [cfMode, setCfMode] = useState<'quick' | 'auth'>('quick');
    const [cfToken, setCfToken] = useState('');
    const [cfUseHttp2, setCfUseHttp2] = useState(true); // 默认启用HTTP/2，更稳定


    // 初始化加载
    useEffect(() => {
        loadConfig();
        loadStatus();
        loadAccounts();
        loadPreferredAccount();
        loadCfStatus();
        const interval = setInterval(loadStatus, 3000);
        const cfInterval = setInterval(loadCfStatus, 5000);
        return () => {
            clearInterval(interval);
            clearInterval(cfInterval);
        };
    }, []);



    // [FIX #820] Load available accounts for fixed account mode
    const loadAccounts = async () => {
        try {
            const accounts = await listAccounts();
            setAvailableAccounts(accounts.map(a => ({ id: a.id, email: a.email })));
        } catch (error) {
            console.error('Failed to load accounts:', error);
        }
    };

    // Cloudflared: 检查状态
    const loadCfStatus = async () => {
        try {
            const status = await invoke<typeof cfStatus>('cloudflared_get_status');
            setCfStatus(status);
        } catch (error) {
            // 忽略错误，可能是manager未初始化
        }
    };

    // Cloudflared: 安装
    const handleCfInstall = async () => {
        console.log('[Cloudflared] Install button clicked');
        setCfLoading(true);
        try {
            console.log('[Cloudflared] Calling cloudflared_install...');
            const status = await invoke<typeof cfStatus>('cloudflared_install');
            console.log('[Cloudflared] Install result:', status);
            setCfStatus(status);
            showToast(t('proxy.cloudflared.install_success', { defaultValue: 'Cloudflared installed successfully' }), 'success');
        } catch (error) {
            console.error('[Cloudflared] Install error:', error);
            showToast(String(error), 'error');
        } finally {
            setCfLoading(false);
        }
    };

    // Cloudflared: 启动/停止
    const handleCfToggle = async (enable: boolean) => {
        if (enable && !status.running) {
            showToast(
                t('proxy.cloudflared.require_proxy_running', { defaultValue: 'Please start the local proxy service first' }),
                'warning'
            );
            return;
        }
        setCfLoading(true);
        try {
            if (enable) {
                if (!cfStatus.installed) {
                    const installStatus = await invoke<typeof cfStatus>('cloudflared_install');
                    setCfStatus(installStatus);
                    if (!installStatus.installed) {
                        throw new Error('Cloudflared install failed');
                    }
                    showToast(t('proxy.cloudflared.install_success', { defaultValue: 'Cloudflared installed successfully' }), 'success');
                }

                const config = {
                    enabled: true,
                    mode: cfMode,
                    port: appConfig?.proxy.port || 8045,
                    token: cfMode === 'auth' ? cfToken : null,
                    use_http2: cfUseHttp2,
                };
                const status = await invoke<typeof cfStatus>('cloudflared_start', { config });
                setCfStatus(status);
                showToast(t('proxy.cloudflared.started', { defaultValue: 'Tunnel started' }), 'success');

                // 持久化“启用”状态
                if (appConfig) {
                    const newConfig = {
                        ...appConfig,
                        cloudflared: {
                            ...appConfig.cloudflared,
                            enabled: true,
                            mode: cfMode,
                            token: cfToken,
                            use_http2: cfUseHttp2,
                            port: appConfig.proxy.port || 8045
                        }
                    };
                    saveConfig(newConfig);
                }
            } else {
                const status = await invoke<typeof cfStatus>('cloudflared_stop');
                setCfStatus(status);
                showToast(t('proxy.cloudflared.stopped', { defaultValue: 'Tunnel stopped' }), 'success');

                // 持久化“禁用”状态
                if (appConfig) {
                    const newConfig = {
                        ...appConfig,
                        cloudflared: {
                            ...appConfig.cloudflared,
                            enabled: false
                        }
                    };
                    saveConfig(newConfig);
                }
            }
        } catch (error) {
            showToast(String(error), 'error');
        } finally {
            setCfLoading(false);
        }
    };

    // Cloudflared: 复制URL
    const handleCfCopyUrl = async () => {
        if (cfStatus.url) {
            const success = await copyToClipboard(cfStatus.url);
            if (success) {
                setCopied('cf-url');
                setTimeout(() => setCopied(null), 2000);
            }
        }
    };

    // [FIX #820] Load current preferred account
    const loadPreferredAccount = async () => {
        try {
            const prefId = await invoke<string | null>('get_preferred_account');
            setPreferredAccountId(prefId);
        } catch (error) {
            // Service not running, ignore
        }
    };

    // [FIX #820] Set preferred account
    const handleSetPreferredAccount = async (accountId: string | null) => {
        try {
            const wasEnabled = preferredAccountId !== null;
            await invoke('set_preferred_account', { accountId });
            setPreferredAccountId(accountId);

            // Determine appropriate message
            let message: string;
            if (accountId === null) {
                message = t('proxy.config.scheduling.round_robin_set', { defaultValue: 'Round-robin mode enabled' });
            } else if (wasEnabled) {
                // Changed account while already in fixed mode
                const account = availableAccounts.find(a => a.id === accountId);
                message = t('proxy.config.scheduling.account_changed', {
                    defaultValue: `Switched to ${account?.email || accountId}`,
                    email: account?.email || accountId
                });
            } else {
                // Just enabled fixed mode
                message = t('proxy.config.scheduling.fixed_account_set', { defaultValue: 'Fixed account mode enabled' });
            }

            showToast(message, 'success');
        } catch (error) {
            showToast(String(error), 'error');
        }
    };

    const loadConfig = async () => {
        setConfigLoading(true);
        setConfigError(null);
        try {
            const config = await invoke<AppConfig>('load_config');
            setAppConfig(config);

            // 恢复 Cloudflared 持久化状态
            if (config.cloudflared) {
                setCfMode(config.cloudflared.mode || 'quick');
                setCfToken(config.cloudflared.token || '');
                setCfUseHttp2(config.cloudflared.use_http2 !== false); // 默认开启 HTTP/2
            }

            // 恢复 Cloudflared 状态并实现持久化同步
            if (config.cloudflared) {
                setCfMode(config.cloudflared.mode || 'quick');
                setCfToken(config.cloudflared.token || '');
                setCfUseHttp2(config.cloudflared.use_http2 !== false); // 默认 true
            }
        } catch (error) {
            console.error('加载配置失败:', error);
            setConfigError(String(error));
        } finally {
            setConfigLoading(false);
        }
    };

    const loadStatus = async () => {
        try {
            const s = await invoke<ProxyStatus>('get_proxy_status');
            // 如果后端返回 starting 或 busy，则在 UI 上表现为加载中
            if (s.base_url === 'starting' || s.base_url === 'busy') {
                // 如果当前已经是运行状态，不要被覆盖为 false
                setStatus(prev => ({ ...s, running: prev.running }));
            } else {
                setStatus(s);
            }
        } catch (error) {
            console.error('获取状态失败:', error);
        }
    };


    const saveConfig = async (newConfig: AppConfig) => {
        // 1. 立即更新 UI 状态，确保流畅
        setAppConfig(newConfig);
        try {
            await invoke('save_config', { config: newConfig });
        } catch (error) {
            console.error('保存配置失败:', error);
            showToast(`${t('common.error')}: ${error}`, 'error');
        }
    };

    const updateProxyConfig = (updates: Partial<ProxyConfig>) => {
        if (!appConfig) return;
        const newConfig = {
            ...appConfig,
            proxy: {
                ...appConfig.proxy,
                ...updates
            }
        };
        saveConfig(newConfig);
    };

    const updateSchedulingConfig = (updates: Partial<StickySessionConfig>) => {
        if (!appConfig) return;
        const currentScheduling = appConfig.proxy.scheduling || { mode: 'Balance', max_wait_seconds: 60 };
        const newScheduling = { ...currentScheduling, ...updates };

        const newAppConfig = {
            ...appConfig,
            proxy: {
                ...appConfig.proxy,
                scheduling: newScheduling
            }
        };
        saveConfig(newAppConfig);
    };

    const updateExperimentalConfig = (updates: Partial<ExperimentalConfig>) => {
        if (!appConfig) return;
        const newConfig = {
            ...appConfig,
            proxy: {
                ...appConfig.proxy,
                experimental: {
                    ...(appConfig.proxy.experimental || {
                        enable_usage_scaling: true,
                        context_compression_threshold_l1: 0.4,
                        context_compression_threshold_l2: 0.55,
                        context_compression_threshold_l3: 0.7
                    }),
                    ...updates
                }
            }
        };
        saveConfig(newConfig);
    };

    const updateCircuitBreakerConfig = (newBreakerConfig: CircuitBreakerConfig) => {
        if (!appConfig) return;
        const newConfig = {
            ...appConfig,
            circuit_breaker: newBreakerConfig
        };
        saveConfig(newConfig);
    };

    const handleClearSessionBindings = () => {
        setIsClearBindingsConfirmOpen(true);
    };

    const executeClearSessionBindings = async () => {
        setIsClearBindingsConfirmOpen(false);
        try {
            await invoke('clear_proxy_session_bindings');
            showToast(t('common.success'), 'success');
        } catch (error) {
            console.error('Failed to clear session bindings:', error);
            showToast(`${t('common.error')}: ${error}`, 'error');
        }
    };

    const handleClearRateLimits = () => {
        setIsClearRateLimitsConfirmOpen(true);
    };

    const executeClearRateLimits = async () => {
        setIsClearRateLimitsConfirmOpen(false);
        try {
            await invoke('clear_all_proxy_rate_limits');
            showToast(t('common.success'), 'success');
        } catch (error) {
            console.error('Failed to clear rate limits:', error);
            showToast(`${t('common.error')}: ${error}`, 'error');
        }
    };

    const updateCodebuddyCnConfig = (updates: Partial<CodeBuddyCnConfig>) => {
        if (!appConfig) return;
        const newConfig = {
            ...appConfig,
            proxy: {
                ...appConfig.proxy,
                codebuddy_cn: {
                    enabled: true,
                    base_url: '',
                    token: '',
                    user_id: '',
                    model: 'auto',
                    dispatch_mode: 'exclusive' as const,
                    ...appConfig.proxy.codebuddy_cn,
                    ...updates
                }
            }
        };
        saveConfig(newConfig);
    };

    const handleToggle = async () => {
        if (!appConfig) return;
        setLoading(true);
        try {
            if (status.running) {
                await invoke('stop_proxy_service');
            } else {
                // 使用当前的 appConfig.proxy 启动
                await invoke('start_proxy_service', { config: appConfig.proxy });
            }
            await loadStatus();
        } catch (error: any) {
            showToast(t('proxy.dialog.operate_failed', { error: error.toString() }), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateApiKey = () => {
        setIsRegenerateKeyConfirmOpen(true);
    };

    const executeGenerateApiKey = async () => {
        setIsRegenerateKeyConfirmOpen(false);
        try {
            const newKey = await invoke<string>('generate_api_key');
            updateProxyConfig({ api_key: newKey });
            showToast(t('common.success'), 'success');
        } catch (error: any) {
            console.error('生成 API Key 失败:', error);
            showToast(t('proxy.dialog.operate_failed', { error: error.toString() }), 'error');
        }
    };

    const copyToClipboardHandler = (text: string, label: string) => {
        copyToClipboard(text).then((success) => {
            if (success) {
                setCopied(label);
                setTimeout(() => setCopied(null), 2000);
            }
        });
    };

    // API Key editing functions
    const validateApiKey = (key: string): boolean => {
        // Must start with 'sk-' and be at least 10 characters long
        return key.startsWith('sk-') && key.length >= 10;
    };

    const handleEditApiKey = () => {
        setTempApiKey(appConfig?.proxy.api_key || '');
        setIsEditingApiKey(true);
    };

    const handleSaveApiKey = () => {
        if (!validateApiKey(tempApiKey)) {
            showToast(t('proxy.config.api_key_invalid'), 'error');
            return;
        }
        updateProxyConfig({ api_key: tempApiKey });
        setIsEditingApiKey(false);
        showToast(t('proxy.config.api_key_updated'), 'success');
    };

    const handleCancelEditApiKey = () => {
        setTempApiKey('');
        setIsEditingApiKey(false);
    };

    // Admin Password editing functions
    const handleEditAdminPassword = () => {
        setTempAdminPassword(appConfig?.proxy.admin_password || '');
        setIsEditingAdminPassword(true);
    };

    const handleSaveAdminPassword = () => {
        // Validation: can be empty (meaning fallback to api_key) or at least 4 chars
        if (tempAdminPassword && tempAdminPassword.length < 4) {
            showToast(t('proxy.config.admin_password_short', { defaultValue: 'Password is too short (min 4 chars)' }), 'error');
            return;
        }
        updateProxyConfig({ admin_password: tempAdminPassword || undefined });
        setIsEditingAdminPassword(false);
        showToast(t('proxy.config.admin_password_updated', { defaultValue: 'Web UI password updated' }), 'success');
    };

    const handleCancelEditAdminPassword = () => {
        setTempAdminPassword('');
        setIsEditingAdminPassword(false);
    };


    const buddyModelFallback = [
        { id: 'auto', name: 'Auto', desc: 'Buddy automatically selects the best available model.', icon: '•' },
        { id: 'glm-5.1', name: 'GLM 5.1', desc: 'General purpose coding and reasoning model.', icon: '•' },
        { id: 'kimi-k2.6', name: 'Kimi K2.6', desc: 'Long-context coding and agentic tasks.', icon: '•' },
        { id: 'deepseek-v3.2', name: 'DeepSeek V3.2', desc: 'Fast coding and chat workloads.', icon: '•' },
        { id: 'hy3-preview', name: 'HY3 Preview', desc: 'Preview Buddy model family.', icon: '•' },
        { id: 'minimax-m2.7', name: 'MiniMax M2.7', desc: 'Balanced coding and assistant model.', icon: '•' },
    ];

    const buddyPriority = buddyModelFallback.map(model => model.id);

    const isBuddyModelId = (modelId: string) => {
        return modelId === 'auto'
            || modelId.startsWith('hy3-')
            || modelId.startsWith('glm-')
            || modelId.startsWith('kimi-')
            || modelId.startsWith('minimax-')
            || modelId.startsWith('deepseek-');
    };

    const buddyModels = useMemo(() => {
        const byId = new Map(buddyModelFallback.map(model => [model.id, model]));
        models.forEach(model => {
            if (isBuddyModelId(model.id)) {
                byId.set(model.id, {
                    id: model.id,
                    name: model.name || model.id,
                    desc: model.desc || 'Buddy model available through the local OpenAI-compatible API.',
                    icon: typeof model.icon === 'string' ? model.icon : '•',
                });
            }
        });

        return Array.from(byId.values()).sort((a, b) => {
            const aIndex = buddyPriority.indexOf(a.id);
            const bIndex = buddyPriority.indexOf(b.id);
            if (aIndex !== -1 || bIndex !== -1) {
                return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
            }
            return a.id.localeCompare(b.id);
        });
    }, [models]);

    const getApiBaseUrl = () => {
        const port = status.running ? status.port : (appConfig?.proxy.port || 8045);
        return `http://127.0.0.1:${port}/v1`;
    };

    const getPythonExample = (modelId: string) => {
        const apiKey = appConfig?.proxy.api_key || 'YOUR_API_KEY';

        return `from openai import OpenAI

client = OpenAI(
    base_url="${getApiBaseUrl()}",
    api_key="${apiKey}"
)

response = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Hello from Buddy"}]
)

print(response.choices[0].message.content)`;
    };

    const getCurlExample = (modelId: string) => {
        const apiKey = appConfig?.proxy.api_key || 'YOUR_API_KEY';

        return `curl ${getApiBaseUrl()}/chat/completions \
  -H "Authorization: Bearer ${apiKey}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "${modelId}",
    "messages": [{"role": "user", "content": "Hello from Buddy"}]
  }'`;
    };

    return (
        <div className="h-full w-full overflow-y-auto overflow-x-hidden">
            <div className="p-5 space-y-4 max-w-7xl mx-auto">

                {/* Loading State */}
                {configLoading && (
                    <div className="flex items-center justify-center py-20">
                        <div className="flex flex-col items-center gap-4">
                            <RefreshCw size={32} className="animate-spin text-blue-500" />
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                {t('common.loading')}
                            </span>
                        </div>
                    </div>
                )}

                {/* Error State */}
                {!configLoading && configError && (
                    <div className="flex items-center justify-center py-20">
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                                <Settings size={32} className="text-red-500" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                    {t('proxy.error.load_failed')}
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
                                    {configError}
                                </p>
                            </div>
                            <button
                                onClick={loadConfig}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                            >
                                <RefreshCw size={16} />
                                {t('common.retry')}
                            </button>
                        </div>
                    </div>
                )}

                {/* 配置区 */}
                {!configLoading && !configError && appConfig && (
                    <div className="bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-base-200">
                        <div className="px-4 py-2.5 border-b border-gray-100 dark:border-base-200 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <h2 className="text-base font-semibold flex items-center gap-2 text-gray-900 dark:text-base-content">
                                    <Settings size={18} />
                                    {t('proxy.config.title')}
                                </h2>
                                {/* 状态指示器 */}
                                <div className="flex items-center gap-2 pl-4 border-l border-gray-200 dark:border-base-300">
                                    <div className={`w-2 h-2 rounded-full ${status.running ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                                    <span className={`text-xs font-medium ${status.running ? 'text-green-600' : 'text-gray-500'}`}>
                                        {status.running
                                            ? `${t('proxy.status.running')} (${status.active_accounts} ${t('common.accounts')})`
                                            : t('proxy.status.stopped')}
                                    </span>
                                </div>
                            </div>

                            {/* 控制按钮 */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleToggle}
                                    disabled={loading || !appConfig}
                                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${status.running
                                        ? 'bg-red-50 to-red-600 text-red-600 hover:bg-red-100 border border-red-200'
                                        : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-500/30'
                                        } ${(loading || !appConfig) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <Power size={14} />
                                    {loading ? t('proxy.status.processing') : (status.running ? t('proxy.action.stop') : t('proxy.action.start'))}
                                </button>
                            </div>
                        </div>
                        <div className="p-3 space-y-3">
                            {/* 监听端口、超时和自启动 */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        <span className="inline-flex items-center gap-1">
                                            {t('proxy.config.port')}
                                            <HelpTooltip
                                                text={t('proxy.config.port_tooltip')}
                                                ariaLabel={t('proxy.config.port')}
                                                placement="right"
                                            />
                                        </span>
                                    </label>
                                    <input
                                        type="number"
                                        value={appConfig.proxy.port}
                                        onChange={(e) => updateProxyConfig({ port: parseInt(e.target.value) })}
                                        min={8000}
                                        max={65535}
                                        disabled={status.running}
                                        className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg bg-white dark:bg-base-200 text-xs text-gray-900 dark:text-base-content focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                                        {t('proxy.config.port_hint')}
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        <span className="inline-flex items-center gap-1">
                                            {t('proxy.config.request_timeout')}
                                            <HelpTooltip
                                                text={t('proxy.config.request_timeout_tooltip')}
                                                ariaLabel={t('proxy.config.request_timeout')}
                                                placement="top"
                                            />
                                        </span>
                                    </label>
                                    <input
                                        type="number"
                                        value={appConfig.proxy.request_timeout || 120}
                                        onChange={(e) => {
                                            const value = parseInt(e.target.value);
                                            const timeout = Math.max(30, Math.min(7200, value));
                                            updateProxyConfig({ request_timeout: timeout });
                                        }}
                                        min={30}
                                        max={7200}
                                        disabled={status.running}
                                        className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg bg-white dark:bg-base-200 text-xs text-gray-900 dark:text-base-content focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                                        {t('proxy.config.request_timeout_hint')}
                                    </p>
                                </div>
                                <div className="flex items-center">
                                    <label className="flex items-center cursor-pointer gap-3">
                                        <input
                                            type="checkbox"
                                            className="toggle toggle-sm bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 checked:bg-blue-500 checked:border-blue-500 disabled:opacity-50 disabled:bg-gray-100 dark:disabled:bg-gray-800"
                                            checked={appConfig.proxy.auto_start}
                                            onChange={(e) => updateProxyConfig({ auto_start: e.target.checked })}
                                        />
                                        <span className="text-xs font-medium text-gray-900 dark:text-base-content inline-flex items-center gap-1">
                                            {t('proxy.config.auto_start')}
                                            <HelpTooltip
                                                text={t('proxy.config.auto_start_tooltip')}
                                                ariaLabel={t('proxy.config.auto_start')}
                                                placement="right"
                                            />
                                        </span>
                                    </label>
                                </div>
                            </div>


                            {/* 局域网访问 & 访问授权 - 合并到同一行 */}
                            <div className="border-t border-gray-200 dark:border-base-300 pt-3 mt-3">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {/* 允许局域网访问 */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 inline-flex items-center gap-1">
                                                {t('proxy.config.allow_lan_access')}
                                                <HelpTooltip
                                                    text={t('proxy.config.allow_lan_access_tooltip')}
                                                    ariaLabel={t('proxy.config.allow_lan_access')}
                                                    placement="right"
                                                />
                                            </span>
                                            <input
                                                type="checkbox"
                                                className="toggle toggle-sm bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 checked:bg-blue-500 checked:border-blue-500"
                                                checked={appConfig.proxy.allow_lan_access || false}
                                                onChange={(e) => updateProxyConfig({ allow_lan_access: e.target.checked })}
                                            />
                                        </div>
                                        <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                            {(appConfig.proxy.allow_lan_access || false)
                                                ? t('proxy.config.allow_lan_access_hint_enabled')
                                                : t('proxy.config.allow_lan_access_hint_disabled')}
                                        </p>
                                        {(appConfig.proxy.allow_lan_access || false) && (
                                            <p className="text-[10px] text-amber-600 dark:text-amber-500">
                                                {t('proxy.config.allow_lan_access_warning')}
                                            </p>
                                        )}
                                        {status.running && (
                                            <p className="text-[10px] text-blue-600 dark:text-blue-400">
                                                {t('proxy.config.allow_lan_access_restart_hint')}
                                            </p>
                                        )}
                                    </div>

                                    {/* 访问授权 */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                <span className="inline-flex items-center gap-1">
                                                    {t('proxy.config.auth.title')}
                                                    <HelpTooltip
                                                        text={t('proxy.config.auth.title_tooltip')}
                                                        ariaLabel={t('proxy.config.auth.title')}
                                                        placement="top"
                                                    />
                                                </span>
                                            </label>
                                            <label className="flex items-center cursor-pointer gap-2">
                                                <span className="text-[11px] text-gray-600 dark:text-gray-400 inline-flex items-center gap-1">
                                                    {(appConfig.proxy.auth_mode || 'off') !== 'off' ? t('proxy.config.auth.enabled') : t('common.disabled')}
                                                    <HelpTooltip
                                                        text={t('proxy.config.auth.enabled_tooltip')}
                                                        ariaLabel={t('proxy.config.auth.enabled')}
                                                        placement="left"
                                                    />
                                                </span>
                                                <input
                                                    type="checkbox"
                                                    className="toggle toggle-sm bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 checked:bg-blue-500 checked:border-blue-500 disabled:opacity-50 disabled:bg-gray-100 dark:disabled:bg-gray-800"
                                                    checked={(appConfig.proxy.auth_mode || 'off') !== 'off'}
                                                    onChange={(e) => {
                                                        const nextMode = e.target.checked ? 'all_except_health' : 'off';
                                                        updateProxyConfig({ auth_mode: nextMode });
                                                    }}
                                                />
                                            </label>
                                        </div>

                                        <div>
                                            <label className="block text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                                                <span className="inline-flex items-center gap-1">
                                                    {t('proxy.config.auth.mode')}
                                                    <HelpTooltip
                                                        text={t('proxy.config.auth.mode_tooltip')}
                                                        ariaLabel={t('proxy.config.auth.mode')}
                                                        placement="top"
                                                    />
                                                </span>
                                            </label>
                                            <select
                                                value={appConfig.proxy.auth_mode || 'off'}
                                                onChange={(e) =>
                                                    updateProxyConfig({
                                                        auth_mode: e.target.value as ProxyConfig['auth_mode'],
                                                    })
                                                }
                                                className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg bg-white dark:bg-base-200 text-xs text-gray-900 dark:text-base-content focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            >
                                                <option value="off">{t('proxy.config.auth.modes.off')}</option>
                                                <option value="strict">{t('proxy.config.auth.modes.strict')}</option>
                                                <option value="all_except_health">{t('proxy.config.auth.modes.all_except_health')}</option>
                                                <option value="auto">{t('proxy.config.auth.modes.auto')}</option>
                                            </select>
                                            <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                                                {t('proxy.config.auth.hint')}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* API 密钥 */}
                            <div>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    <span className="inline-flex items-center gap-1">
                                        {t('proxy.config.api_key')}
                                        <HelpTooltip
                                            text={t('proxy.config.api_key_tooltip')}
                                            ariaLabel={t('proxy.config.api_key')}
                                            placement="right"
                                        />
                                    </span>
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={isEditingApiKey ? tempApiKey : (appConfig.proxy.api_key)}
                                        onChange={(e) => isEditingApiKey && setTempApiKey(e.target.value)}
                                        readOnly={!isEditingApiKey}
                                        className={`flex-1 px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg text-xs font-mono ${isEditingApiKey
                                            ? 'bg-white dark:bg-base-200 text-gray-900 dark:text-base-content'
                                            : 'bg-gray-50 dark:bg-base-300 text-gray-600 dark:text-gray-400'
                                            }`}
                                    />
                                    {isEditingApiKey ? (
                                        <>
                                            <button
                                                onClick={handleSaveApiKey}
                                                className="px-2.5 py-1.5 border border-green-300 dark:border-green-700 rounded-lg bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors text-green-600 dark:text-green-400"
                                                title={t('proxy.config.btn_save')}
                                            >
                                                <CheckCircle size={14} />
                                            </button>
                                            <button
                                                onClick={handleCancelEditApiKey}
                                                className="px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg bg-white dark:bg-base-200 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors"
                                                title={t('common.cancel')}
                                            >
                                                <X size={14} />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={handleEditApiKey}
                                                className="px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg bg-white dark:bg-base-200 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors"
                                                title={t('proxy.config.btn_edit')}
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                onClick={handleGenerateApiKey}
                                                className="px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg bg-white dark:bg-base-200 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors"
                                                title={t('proxy.config.btn_regenerate')}
                                            >
                                                <RefreshCw size={14} />
                                            </button>
                                            <button
                                                onClick={() => copyToClipboardHandler(appConfig.proxy.api_key, 'api_key')}
                                                className="px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg bg-white dark:bg-base-200 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors"
                                                title={t('proxy.config.btn_copy')}
                                            >
                                                {copied === 'api_key' ? (
                                                    <CheckCircle size={14} className="text-green-500" />
                                                ) : (
                                                    <Copy size={14} />
                                                )}
                                            </button>
                                        </>
                                    )}
                                </div>
                                <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-500">
                                    {t('proxy.config.warning_key')}
                                </p>
                            </div>

                            {/* Web UI 管理密码 */}
                            <div className="border-t border-gray-200 dark:border-base-300 pt-3 mt-3">
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    <span className="inline-flex items-center gap-1">
                                        {t('proxy.config.admin_password', { defaultValue: 'Web UI Login Password' })}
                                        <HelpTooltip
                                            text={t('proxy.config.admin_password_tooltip', { defaultValue: 'Used for logging into the Web Management Console. If empty, it defaults to the API Key.' })}
                                            ariaLabel={t('proxy.config.admin_password')}
                                            placement="right"
                                        />
                                    </span>
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={isEditingAdminPassword ? tempAdminPassword : (appConfig.proxy.admin_password || t('proxy.config.admin_password_default', { defaultValue: '(Same as API Key)' }))}
                                        onChange={(e) => isEditingAdminPassword && setTempAdminPassword(e.target.value)}
                                        readOnly={!isEditingAdminPassword}
                                        placeholder={t('proxy.config.admin_password_placeholder', { defaultValue: 'Enter new password or leave empty to use API Key' })}
                                        className={`flex-1 px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg text-xs font-mono ${isEditingAdminPassword
                                            ? 'bg-white dark:bg-base-200 text-gray-900 dark:text-base-content'
                                            : 'bg-gray-50 dark:bg-base-300 text-gray-600 dark:text-gray-400'
                                            }`}
                                    />
                                    {isEditingAdminPassword ? (
                                        <>
                                            <button
                                                onClick={handleSaveAdminPassword}
                                                className="px-2.5 py-1.5 border border-green-300 dark:border-green-700 rounded-lg bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors text-green-600 dark:text-green-400"
                                                title={t('proxy.config.btn_save')}
                                            >
                                                <CheckCircle size={14} />
                                            </button>
                                            <button
                                                onClick={handleCancelEditAdminPassword}
                                                className="px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg bg-white dark:bg-base-200 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors"
                                                title={t('common.cancel')}
                                            >
                                                <X size={14} />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={handleEditAdminPassword}
                                                className="px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg bg-white dark:bg-base-200 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors"
                                                title={t('proxy.config.btn_edit')}
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                onClick={() => copyToClipboardHandler(appConfig.proxy.admin_password || appConfig.proxy.api_key, 'admin_password')}
                                                className="px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg bg-white dark:bg-base-200 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors"
                                                title={t('proxy.config.btn_copy')}
                                            >
                                                {copied === 'admin_password' ? (
                                                    <CheckCircle size={14} className="text-green-500" />
                                                ) : (
                                                    <Copy size={14} />
                                                )}
                                            </button>
                                        </>
                                    )}
                                </div>
                                <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                                    {t('proxy.config.admin_password_hint', { defaultValue: 'For safety in Docker/Browser environments, you can set a separate login password from your API Key.' })}
                                </p>
                            </div>

                            {/* User-Agent Overrides */}
                            <div className="border-t border-gray-200 dark:border-base-300 pt-3 mt-3">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300 inline-flex items-center gap-1">
                                        {t('proxy.config.request.user_agent', { defaultValue: 'User-Agent Override' })}
                                        <HelpTooltip text={t('proxy.config.request.user_agent_tooltip', { defaultValue: 'Override the User-Agent header sent to upstream APIs.' })} />
                                    </label>
                                    <input
                                        type="checkbox"
                                        className="toggle toggle-sm bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 checked:bg-blue-500 checked:border-blue-500"
                                        checked={!!appConfig.proxy.user_agent_override}
                                        onChange={(e) => {
                                            const enabled = e.target.checked;
                                            if (enabled) {
                                                // Restore saved override from config or use default
                                                const restoredValue = appConfig.proxy.saved_user_agent || 'antigravity/1.15.8 darwin/arm64';
                                                updateProxyConfig({
                                                    user_agent_override: restoredValue,
                                                    saved_user_agent: restoredValue
                                                });
                                            } else {
                                                // Disable active override but keep saved value
                                                updateProxyConfig({ user_agent_override: undefined });
                                            }
                                        }}
                                    />
                                </div>

                                {!!appConfig.proxy.user_agent_override && (
                                    <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                        <input
                                            type="text"
                                            value={appConfig.proxy.user_agent_override}
                                            onChange={(e) => {
                                                const newValue = e.target.value;
                                                updateProxyConfig({
                                                    user_agent_override: newValue,
                                                    saved_user_agent: newValue
                                                });
                                            }}
                                            className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-base-200 rounded-lg bg-white dark:bg-base-200 text-xs font-mono text-gray-900 dark:text-base-content focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            placeholder={t('proxy.config.request.user_agent_placeholder', { defaultValue: 'Enter custom User-Agent string...' })}
                                        />
                                        <div className="bg-gray-50 dark:bg-base-300 rounded p-2 text-[10px] text-gray-500 font-mono break-all">
                                            <span className="font-bold select-none mr-2">{t('common.example', { defaultValue: 'Example' })}:</span>
                                            buddy-tools/1.0.0 darwin/arm64
                                        </div>
                                    </div>
                                )}
                            </div>


                        </div>
                    </div>
                )}

                {/* External Providers Integration */}
                {
                    !configLoading && !configError && appConfig && (
                        <div className="space-y-4">
                            <CollapsibleCard
                                title={t('proxy.cli_sync.title', { defaultValue: 'CLI Sync' })}
                                icon={<Terminal size={18} className="text-gray-500" />}
                                defaultExpanded={false}
                            >
                                <CliSyncCard
                                    proxyUrl={status.running ? status.base_url : `http://127.0.0.1:${appConfig.proxy.port || 8045}`}
                                    apiKey={appConfig.proxy.api_key}
                                />
                            </CollapsibleCard>

                            {/* CodeBuddy CN */}
                            <CollapsibleCard
                                title="CodeBuddy CN"
                                icon={<Bot size={18} className="text-teal-500" />}
                                enabled={!!appConfig.proxy.codebuddy_cn?.enabled}
                                onToggle={(checked) => updateCodebuddyCnConfig({ enabled: checked })}
                            >
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                                                Dispatch Mode
                                            </label>
                                            <select
                                                className="select select-sm select-bordered w-full text-xs"
                                                value={appConfig.proxy.codebuddy_cn?.dispatch_mode || 'exclusive'}
                                                onChange={(e) => updateCodebuddyCnConfig({ dispatch_mode: e.target.value as any })}
                                            >
                                                <option value="exclusive">Exclusive — Buddy API requests use CodeBuddy CN</option>
                                                <option value="pooled">Pooled — Buddy API requests can join the account pool</option>
                                                <option value="off">Off — disable CodeBuddy CN routing</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                                                Model
                                            </label>
                                            <input
                                                type="text"
                                                value={appConfig.proxy.codebuddy_cn?.model || 'auto'}
                                                onChange={(e) => updateCodebuddyCnConfig({ model: e.target.value })}
                                                className="input input-sm input-bordered w-full font-mono text-xs"
                                                placeholder="auto"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                                            Base URL
                                        </label>
                                        <input
                                            type="text"
                                            value={appConfig.proxy.codebuddy_cn?.base_url || ''}
                                            onChange={(e) => updateCodebuddyCnConfig({ base_url: e.target.value })}
                                            className="input input-sm input-bordered w-full font-mono text-xs"
                                            placeholder="https://copilot.tencent.com"
                                        />
                                    </div>

                                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-[11px] text-blue-700 dark:text-blue-300">
                                        Manage accounts on the CodeBuddy CN accounts page. With <strong>Exclusive</strong> mode enabled, Buddy OpenAI-compatible requests are routed directly through CodeBuddy CN.
                                    </div>
                                </div>
                            </CollapsibleCard>

                            {/* Account Scheduling & Rotation */}
                            <CollapsibleCard
                                title={t('proxy.config.scheduling.title')}
                                icon={<RefreshCw size={18} className="text-indigo-500" />}
                            >
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <label className="text-xs font-medium text-gray-700 dark:text-gray-300 inline-flex items-center gap-1">
                                                    {t('proxy.config.scheduling.mode')}
                                                    <HelpTooltip
                                                        text={t('proxy.config.scheduling.mode_tooltip')}
                                                        placement="right"
                                                    />
                                                </label>
                                                <div className="flex items-center gap-3">
                                                    {/* [MOVED] Clear Rate Limit button moved to CircuitBreaker component */}
                                                    <button
                                                        onClick={handleClearSessionBindings}
                                                        className="text-[10px] text-indigo-500 hover:text-indigo-600 transition-colors flex items-center gap-1"
                                                        title={t('proxy.config.scheduling.clear_bindings_tooltip')}
                                                    >
                                                        <Trash2 size={12} />
                                                        {t('proxy.config.scheduling.clear_bindings')}
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 gap-2">
                                                {(['CacheFirst', 'Balance', 'PerformanceFirst'] as const).map(mode => (
                                                    <label
                                                        key={mode}
                                                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${(appConfig.proxy.scheduling?.mode || 'Balance') === mode
                                                            ? 'border-indigo-500 bg-indigo-50/30 dark:bg-indigo-900/10'
                                                            : 'border-gray-100 dark:border-base-200 hover:border-indigo-200'
                                                            }`}
                                                    >
                                                        <input
                                                            type="radio"
                                                            className="radio radio-xs radio-primary mt-1"
                                                            checked={(appConfig.proxy.scheduling?.mode || 'Balance') === mode}
                                                            onChange={() => updateSchedulingConfig({ mode })}
                                                        />
                                                        <div className="space-y-1">
                                                            <div className="text-xs font-bold text-gray-900 dark:text-base-content">
                                                                {t(`proxy.config.scheduling.modes.${mode}`)}
                                                            </div>
                                                            <div className="text-[10px] text-gray-500 line-clamp-2">
                                                                {t(`proxy.config.scheduling.modes_desc.${mode}`, {
                                                                    defaultValue: mode === 'CacheFirst' ? 'Binds session to account, waits precisely if limited (Maximizes Prompt Cache hits).' :
                                                                        mode === 'Balance' ? 'Binds session, auto-switches to available account if limited (Balanced cache & availability).' :
                                                                            'No session binding, pure round-robin rotation (Best for high concurrency).'
                                                                })}
                                                            </div>
                                                        </div>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-4 pt-1">
                                            <div className="bg-slate-100 dark:bg-slate-800/80 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                                                <div className="flex items-center justify-between mb-2">
                                                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300 inline-flex items-center gap-1">
                                                        {t('proxy.config.scheduling.max_wait')}
                                                        <HelpTooltip text={t('proxy.config.scheduling.max_wait_tooltip')} />
                                                    </label>
                                                    <span className="text-xs font-mono text-indigo-600 font-bold">
                                                        {appConfig.proxy.scheduling?.max_wait_seconds || 60}s
                                                    </span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="300"
                                                    step="10"
                                                    disabled={(appConfig.proxy.scheduling?.mode || 'Balance') !== 'CacheFirst'}
                                                    className="range range-indigo range-xs"
                                                    value={appConfig.proxy.scheduling?.max_wait_seconds || 60}
                                                    onChange={(e) => updateSchedulingConfig({ max_wait_seconds: parseInt(e.target.value) })}
                                                />
                                                <div className="flex justify-between px-1 mt-1 text-[10px] text-gray-400 font-mono">
                                                    <span>0s</span>
                                                    <span>300s</span>
                                                </div>
                                            </div>

                                            <div className="p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 rounded-xl">
                                                <p className="text-[10px] text-amber-700 dark:text-amber-500 leading-relaxed">
                                                    <strong>{t('common.info')}:</strong> {t('proxy.config.scheduling.subtitle')}
                                                </p>
                                            </div>

                                            {/* [FIX #820] Fixed Account Mode */}
                                            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-4 border border-indigo-200 dark:border-indigo-800">
                                                <div className="flex items-center justify-between mb-3">
                                                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300 inline-flex items-center gap-1">
                                                        🔒 {t('proxy.config.scheduling.fixed_account', { defaultValue: 'Fixed Account Mode' })}
                                                        <HelpTooltip text={t('proxy.config.scheduling.fixed_account_tooltip', { defaultValue: 'When enabled, all API requests will use only the selected account instead of rotating between accounts.' })} />
                                                    </label>
                                                    <input
                                                        type="checkbox"
                                                        className="toggle toggle-sm toggle-primary"
                                                        checked={preferredAccountId !== null}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                // Enable fixed mode with first available account
                                                                if (availableAccounts.length > 0) {
                                                                    handleSetPreferredAccount(availableAccounts[0].id);
                                                                }
                                                            } else {
                                                                // Disable fixed mode
                                                                handleSetPreferredAccount(null);
                                                            }
                                                        }}
                                                        disabled={!status.running}
                                                    />
                                                </div>
                                                {preferredAccountId !== null && (
                                                    <select
                                                        className="select select-bordered select-sm w-full text-xs"
                                                        value={preferredAccountId || ''}
                                                        onChange={(e) => handleSetPreferredAccount(e.target.value || null)}
                                                        disabled={!status.running}
                                                    >
                                                        {availableAccounts.map(account => (
                                                            <option key={account.id} value={account.id}>
                                                                {account.email}
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}
                                                {!status.running && (
                                                    <p className="text-[10px] text-gray-500 mt-2">
                                                        {t('proxy.config.scheduling.start_proxy_first', { defaultValue: 'Start the proxy service to configure fixed account mode.' })}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Circuit Breaker Section */}
                                    {appConfig.circuit_breaker && (
                                        <div className="pt-4 border-t border-gray-100 dark:border-gray-700/50">
                                            <div className="flex items-center justify-between mb-4">
                                                <label className="text-xs font-medium text-gray-700 dark:text-gray-300 inline-flex items-center gap-1">
                                                    {t('proxy.config.circuit_breaker.title', { defaultValue: 'Adaptive Circuit Breaker' })}
                                                    <HelpTooltip text={t('proxy.config.circuit_breaker.tooltip', { defaultValue: 'Prevent continuous failures by exponentially backing off when quota is exhausted.' })} />
                                                </label>
                                                <input
                                                    type="checkbox"
                                                    className="toggle toggle-sm toggle-warning"
                                                    checked={appConfig.circuit_breaker.enabled}
                                                    onChange={(e) => updateCircuitBreakerConfig({ ...appConfig.circuit_breaker, enabled: e.target.checked })}
                                                />
                                            </div>

                                            {appConfig.circuit_breaker.enabled && (
                                                <CircuitBreaker
                                                    config={appConfig.circuit_breaker}
                                                    onChange={updateCircuitBreakerConfig}
                                                    onClearRateLimits={handleClearRateLimits}
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>
                            </CollapsibleCard>

                            {/* 实验性设置 */}
                            <CollapsibleCard
                                title={t('proxy.config.experimental.title')}
                                icon={<Sparkles size={18} className="text-purple-500" />}
                            >
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-base-200 rounded-xl border border-gray-100 dark:border-base-300">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-gray-900 dark:text-base-content">
                                                    {t('proxy.config.experimental.enable_usage_scaling')}
                                                </span>
                                                <HelpTooltip text={t('proxy.config.experimental.enable_usage_scaling_tooltip')} />
                                            </div>
                                            <p className="text-[10px] text-gray-500 dark:text-gray-400 max-w-lg">
                                                {t('proxy.config.experimental.enable_usage_scaling_tooltip')}
                                            </p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={!!appConfig.proxy.experimental?.enable_usage_scaling}
                                                onChange={(e) => updateExperimentalConfig({ enable_usage_scaling: e.target.checked })}
                                            />
                                            <div className="w-11 h-6 bg-gray-200 dark:bg-base-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500 shadow-inner"></div>
                                        </label>
                                    </div>

                                    {/* L1 Threshold */}
                                    <div className="flex flex-col gap-2 p-4 bg-gray-50 dark:bg-base-200 rounded-xl border border-gray-100 dark:border-base-300">
                                        <div className="flex items-center justify-between w-full">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-gray-900 dark:text-base-content">
                                                    {t('proxy.config.experimental.context_compression_threshold_l1')}
                                                </span>
                                                <HelpTooltip text={t('proxy.config.experimental.context_compression_threshold_l1_tooltip')} />
                                            </div>
                                        </div>
                                        <DebouncedSlider
                                            min={0.1}
                                            max={1}
                                            step={0.05}
                                            className="range range-purple range-xs"
                                            value={appConfig.proxy.experimental?.context_compression_threshold_l1 || 0.4}
                                            onChange={(val) => updateExperimentalConfig({ context_compression_threshold_l1: val })}
                                        />
                                    </div>

                                    {/* L2 Threshold */}
                                    <div className="flex flex-col gap-2 p-4 bg-gray-50 dark:bg-base-200 rounded-xl border border-gray-100 dark:border-base-300">
                                        <div className="flex items-center justify-between w-full">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-gray-900 dark:text-base-content">
                                                    {t('proxy.config.experimental.context_compression_threshold_l2')}
                                                </span>
                                                <HelpTooltip text={t('proxy.config.experimental.context_compression_threshold_l2_tooltip')} />
                                            </div>
                                        </div>
                                        <DebouncedSlider
                                            min={0.1}
                                            max={1}
                                            step={0.05}
                                            className="range range-purple range-xs"
                                            value={appConfig.proxy.experimental?.context_compression_threshold_l2 || 0.55}
                                            onChange={(val) => updateExperimentalConfig({ context_compression_threshold_l2: val })}
                                        />
                                    </div>

                                    {/* L3 Threshold */}
                                    <div className="flex flex-col gap-2 p-4 bg-gray-50 dark:bg-base-200 rounded-xl border border-gray-100 dark:border-base-300">
                                        <div className="flex items-center justify-between w-full">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-gray-900 dark:text-base-content">
                                                    {t('proxy.config.experimental.context_compression_threshold_l3')}
                                                </span>
                                                <HelpTooltip text={t('proxy.config.experimental.context_compression_threshold_l3_tooltip')} />
                                            </div>
                                        </div>
                                        <DebouncedSlider
                                            min={0.1}
                                            max={1}
                                            step={0.05}
                                            className="range range-purple range-xs"
                                            value={appConfig.proxy.experimental?.context_compression_threshold_l3 || 0.7}
                                            onChange={(val) => updateExperimentalConfig({ context_compression_threshold_l3: val })}
                                        />
                                    </div>
                                </div>
                            </CollapsibleCard>

                            {/* 公网访问 (Cloudflared) - 仅在桌面端显示 */}
                            {isTauri() && (
                                <CollapsibleCard
                                    title={t('proxy.cloudflared.title', { defaultValue: 'Public Access (Cloudflared)' })}
                                    icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-500"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>}
                                    enabled={cfStatus.running}
                                    onToggle={handleCfToggle}
                                    allowInteractionWhenDisabled={true}
                                    rightElement={
                                        cfLoading ? (
                                            <span className="loading loading-spinner loading-xs"></span>
                                        ) : cfStatus.running && cfStatus.url ? (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleCfCopyUrl(); }}
                                                className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors flex items-center gap-1"
                                            >
                                                {copied === 'cf-url' ? <CheckCircle size={12} /> : <Copy size={12} />}
                                                {cfStatus.url.replace('https://', '').slice(0, 20)}...
                                            </button>
                                        ) : null
                                    }
                                >
                                    <div className="space-y-4">
                                        {/* 安装状态 */}
                                        {!cfStatus.installed ? (
                                            <div className="flex items-center justify-between p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl border border-yellow-200 dark:border-yellow-800">
                                                <div className="space-y-1">
                                                    <span className="text-sm font-bold text-yellow-800 dark:text-yellow-200">
                                                        {t('proxy.cloudflared.not_installed', { defaultValue: 'Cloudflared not installed' })}
                                                    </span>
                                                    <p className="text-xs text-yellow-600 dark:text-yellow-400">
                                                        {t('proxy.cloudflared.install_hint', { defaultValue: 'Click to download and install cloudflared binary' })}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={handleCfInstall}
                                                    disabled={cfLoading}
                                                    className="px-4 py-2 rounded-lg text-sm font-medium bg-yellow-500 text-white hover:bg-yellow-600 disabled:opacity-50 flex items-center gap-2"
                                                >
                                                    {cfLoading ? <span className="loading loading-spinner loading-xs"></span> : null}
                                                    {t('proxy.cloudflared.install', { defaultValue: 'Install' })}
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                {/* 版本信息 */}
                                                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                                    <CheckCircle size={14} className="text-green-500" />
                                                    {t('proxy.cloudflared.installed', { defaultValue: 'Installed' })}: {cfStatus.version || 'Unknown'}
                                                </div>

                                                {/* 隧道模式选择 */}
                                                <div className="grid grid-cols-2 gap-3">
                                                    <button
                                                        onClick={() => {
                                                            setCfMode('quick');
                                                            if (appConfig) {
                                                                saveConfig({
                                                                    ...appConfig,
                                                                    cloudflared: { ...appConfig.cloudflared, mode: 'quick' }
                                                                });
                                                            }
                                                        }}
                                                        disabled={cfStatus.running}
                                                        className={cn(
                                                            "p-3 rounded-lg border-2 text-left transition-all",
                                                            cfMode === 'quick'
                                                                ? "border-orange-500 bg-orange-50 dark:bg-orange-900/20"
                                                                : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600",
                                                            cfStatus.running && "opacity-60 cursor-not-allowed"
                                                        )}
                                                    >
                                                        <div className="text-sm font-bold text-gray-900 dark:text-base-content">
                                                            {t('proxy.cloudflared.mode_quick', { defaultValue: 'Quick Tunnel' })}
                                                        </div>
                                                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                                                            {t('proxy.cloudflared.mode_quick_desc', { defaultValue: 'Auto-generated temporary URL (*.trycloudflare.com)' })}
                                                        </p>
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setCfMode('auth');
                                                            if (appConfig) {
                                                                saveConfig({
                                                                    ...appConfig,
                                                                    cloudflared: { ...appConfig.cloudflared, mode: 'auth' }
                                                                });
                                                            }
                                                        }}
                                                        disabled={cfStatus.running}
                                                        className={cn(
                                                            "p-3 rounded-lg border-2 text-left transition-all",
                                                            cfMode === 'auth'
                                                                ? "border-orange-500 bg-orange-50 dark:bg-orange-900/20"
                                                                : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600",
                                                            cfStatus.running && "opacity-60 cursor-not-allowed"
                                                        )}
                                                    >
                                                        <div className="text-sm font-bold text-gray-900 dark:text-base-content">
                                                            {t('proxy.cloudflared.mode_auth', { defaultValue: 'Named Tunnel' })}
                                                        </div>
                                                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                                                            {t('proxy.cloudflared.mode_auth_desc', { defaultValue: 'Use your Cloudflare account with custom domain' })}
                                                        </p>
                                                    </button>
                                                </div>

                                                {/* Token输入 (仅auth模式) */}
                                                {cfMode === 'auth' && (
                                                    <div className="space-y-2">
                                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                            {t('proxy.cloudflared.token', { defaultValue: 'Tunnel Token' })}
                                                        </label>
                                                        <input
                                                            type="password"
                                                            value={cfToken}
                                                            onChange={(e) => setCfToken(e.target.value)}
                                                            onBlur={() => {
                                                                if (appConfig) {
                                                                    saveConfig({
                                                                        ...appConfig,
                                                                        cloudflared: { ...appConfig.cloudflared, token: cfToken }
                                                                    });
                                                                }
                                                            }}
                                                            disabled={cfStatus.running}
                                                            placeholder="eyJhIjoiNj..."
                                                            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-base-200 text-sm font-mono disabled:opacity-60"
                                                        />
                                                    </div>
                                                )}

                                                {/* HTTP2选项 */}
                                                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-base-200 rounded-lg">
                                                    <div className="space-y-0.5">
                                                        <span className="text-sm font-medium text-gray-900 dark:text-base-content">
                                                            {t('proxy.cloudflared.use_http2', { defaultValue: 'Use HTTP/2' })}
                                                        </span>
                                                        <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                                            {t('proxy.cloudflared.use_http2_desc', { defaultValue: 'More compatible, recommended for China mainland' })}
                                                        </p>
                                                    </div>
                                                    <input
                                                        type="checkbox"
                                                        className="toggle toggle-sm"
                                                        checked={cfUseHttp2}
                                                        onChange={(e) => {
                                                            const val = e.target.checked;
                                                            setCfUseHttp2(val);
                                                            if (appConfig) {
                                                                const newConfig = {
                                                                    ...appConfig,
                                                                    cloudflared: {
                                                                        ...appConfig.cloudflared,
                                                                        use_http2: val
                                                                    }
                                                                };
                                                                saveConfig(newConfig);
                                                            }
                                                        }}
                                                        disabled={cfStatus.running}
                                                    />
                                                </div>

                                                {/* 运行状态和URL */}
                                                {cfStatus.running && (
                                                    <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                                            <span className="text-sm font-bold text-green-800 dark:text-green-200">
                                                                {t('proxy.cloudflared.running', { defaultValue: 'Tunnel Running' })}
                                                            </span>
                                                        </div>
                                                        {cfStatus.url && (
                                                            <div className="flex items-center gap-2">
                                                                <code className="flex-1 px-3 py-2 bg-white dark:bg-base-100 rounded text-xs font-mono text-gray-800 dark:text-gray-200 border border-green-200 dark:border-green-800">
                                                                    {cfStatus.url}
                                                                </code>
                                                                <button
                                                                    onClick={handleCfCopyUrl}
                                                                    className="p-2 rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors"
                                                                >
                                                                    {copied === 'cf-url' ? <CheckCircle size={16} /> : <Copy size={16} />}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* 错误信息 */}
                                                {cfStatus.error && (
                                                    <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
                                                        {cfStatus.error}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </CollapsibleCard>
                            )}
                        </div>
                    )
                }

                {/* Buddy API support information */}
                {
                    !configLoading && !configError && appConfig && (
                        <div className="bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-base-200 overflow-hidden">
                            <div className="p-4">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-teal-600 flex items-center justify-center shadow-md">
                                        <Code size={16} className="text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-bold text-gray-900 dark:text-base-content">
                                            Buddy OpenAI-compatible API
                                        </h3>
                                        <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                            Use Buddy through standard OpenAI SDK clients and local endpoints.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="p-3 rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/40 dark:bg-blue-900/10">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">Base URL</div>
                                        <div className="flex items-center gap-2">
                                            <code className="flex-1 text-[11px] font-mono truncate">{getApiBaseUrl()}</code>
                                            <button onClick={() => copyToClipboardHandler(getApiBaseUrl(), 'buddy-base-url')} className="btn btn-ghost btn-xs">
                                                {copied === 'buddy-base-url' ? <CheckCircle size={12} /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="p-3 rounded-xl border border-gray-100 dark:border-base-200 bg-gray-50/60 dark:bg-base-200/40">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">API Key</div>
                                        <div className="flex items-center gap-2">
                                            <code className="flex-1 text-[11px] font-mono truncate">{appConfig.proxy.api_key || 'YOUR_API_KEY'}</code>
                                            <button onClick={() => copyToClipboardHandler(appConfig.proxy.api_key || 'YOUR_API_KEY', 'buddy-api-key')} className="btn btn-ghost btn-xs">
                                                {copied === 'buddy-api-key' ? <CheckCircle size={12} /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="p-3 rounded-xl border border-teal-100 dark:border-teal-900/30 bg-teal-50/40 dark:bg-teal-900/10">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400 mb-2">Primary endpoints</div>
                                        <div className="space-y-1 text-[11px] font-mono">
                                            <div className="flex items-center justify-between gap-2">
                                                <code>/v1/chat/completions</code>
                                                <button onClick={() => copyToClipboardHandler(`${getApiBaseUrl()}/chat/completions`, 'buddy-chat-endpoint')} className="btn btn-ghost btn-xs min-h-0 h-5 px-1">
                                                    {copied === 'buddy-chat-endpoint' ? <CheckCircle size={10} /> : <Copy size={10} />}
                                                </button>
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                                <code>/v1/models</code>
                                                <button onClick={() => copyToClipboardHandler(`${getApiBaseUrl()}/models`, 'buddy-models-endpoint')} className="btn btn-ghost btn-xs min-h-0 h-5 px-1">
                                                    {copied === 'buddy-models-endpoint' ? <CheckCircle size={10} /> : <Copy size={10} />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 text-[11px] text-amber-700 dark:text-amber-300">
                                    This Buddy surface is optimized for <code className="font-mono">/v1/chat/completions</code> and <code className="font-mono">/v1/models</code>. Other compatibility paths may exist internally, but this page only documents the supported Buddy workflow.
                                </div>
                            </div>
                        </div>
                    )
                }


                {/* Buddy models and integration */}
                {
                    !configLoading && !configError && appConfig && (
                        <div className="bg-white dark:bg-base-100 rounded-xl shadow-sm border border-gray-100 dark:border-base-200 overflow-hidden mt-4">
                            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-base-200">
                                <h2 className="text-base font-bold text-gray-900 dark:text-base-content flex items-center gap-2">
                                    <Terminal size={18} />
                                    Buddy model examples
                                </h2>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:divide-x dark:divide-gray-700">
                                <div className="col-span-2 p-0">
                                    <div className="overflow-x-auto">
                                        <table className="table w-full">
                                            <thead className="bg-gray-50/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
                                                <tr>
                                                    <th className="w-10 pl-3"></th>
                                                    <th className="text-[11px] font-medium">Model</th>
                                                    <th className="text-[11px] font-medium">ID</th>
                                                    <th className="text-[11px] hidden sm:table-cell font-medium">Description</th>
                                                    <th className="text-[11px] w-20 text-center font-medium">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {buddyModels.map((m) => (
                                                    <tr
                                                        key={m.id}
                                                        className={`hover:bg-blue-50/50 dark:hover:bg-blue-900/10 cursor-pointer transition-colors ${selectedModelId === m.id ? 'bg-blue-50/80 dark:bg-blue-900/20' : ''}`}
                                                        onClick={() => setSelectedModelId(m.id)}
                                                    >
                                                        <td className="pl-4 text-blue-500">{m.icon}</td>
                                                        <td className="font-bold text-xs">{m.name}</td>
                                                        <td className="font-mono text-[10px] text-gray-500">{m.id}</td>
                                                        <td className="text-[10px] text-gray-400 hidden sm:table-cell">{m.desc}</td>
                                                        <td className="text-center">
                                                            <button
                                                                className="btn btn-ghost btn-xs text-blue-500"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    copyToClipboardHandler(m.id, `model-${m.id}`);
                                                                }}
                                                            >
                                                                {copied === `model-${m.id}` ? <CheckCircle size={14} /> : <div className="flex items-center gap-1 text-[10px] font-bold tracking-tight"><Copy size={12} /> {t('common.copy')}</div>}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="col-span-1 bg-gray-900 text-blue-100 flex flex-col h-[460px] lg:h-auto">
                                    <div className="p-3 border-b border-gray-800 flex items-center justify-between">
                                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Quick integration</span>
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                            OpenAI SDK + curl
                                        </span>
                                    </div>
                                    <div className="flex-1 relative overflow-hidden group">
                                        <div className="absolute inset-0 overflow-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                                            <pre className="p-4 text-[10px] font-mono leading-relaxed whitespace-pre-wrap">
{`${getPythonExample(selectedModelId)}

# curl
${getCurlExample(selectedModelId)}`}
                                            </pre>
                                        </div>
                                        <button
                                            onClick={() => copyToClipboardHandler(`${getPythonExample(selectedModelId)}

# curl
${getCurlExample(selectedModelId)}`, 'example-code')}
                                            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white opacity-0 group-hover:opacity-100"
                                        >
                                            {copied === 'example-code' ? <CheckCircle size={16} /> : <Copy size={16} />}
                                        </button>
                                    </div>
                                    <div className="p-3 bg-gray-800/50 border-t border-gray-800 text-[10px] text-gray-400">
                                        Click a model row to update the examples. Recommended defaults are auto, glm-5.1, and kimi-k2.6.
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }
                {/* 各种对话框 */}

                <ModalDialog
                    isOpen={isRegenerateKeyConfirmOpen}
                    title={t('proxy.dialog.regenerate_key_title') || t('proxy.dialog.confirm_regenerate')}
                    message={t('proxy.dialog.regenerate_key_msg') || t('proxy.dialog.confirm_regenerate')}
                    type="confirm"
                    isDestructive={true}
                    onConfirm={executeGenerateApiKey}
                    onCancel={() => setIsRegenerateKeyConfirmOpen(false)}
                />

                <ModalDialog
                    isOpen={isClearBindingsConfirmOpen}
                    title={t('proxy.dialog.clear_bindings_title') || '清除会话绑定'}
                    message={t('proxy.dialog.clear_bindings_msg') || '确定要清除所有会话与账号的绑定映射吗？'}
                    type="confirm"
                    isDestructive={true}
                    onConfirm={executeClearSessionBindings}
                    onCancel={() => setIsClearBindingsConfirmOpen(false)}
                />

                <ModalDialog
                    isOpen={isClearRateLimitsConfirmOpen}
                    title={t('proxy.dialog.clear_rate_limits_title') || '清除限流记录'}
                    message={t('proxy.dialog.clear_rate_limits_confirm') || '确定要清除所有本地限流记录吗？'}
                    type="confirm"
                    isDestructive={true}
                    onConfirm={executeClearRateLimits}
                    onCancel={() => setIsClearRateLimitsConfirmOpen(false)}
                />

            </div >
        </div >
    );
}
