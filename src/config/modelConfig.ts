import { Bot, BrainCircuit, Cpu, Sparkles, Zap } from 'lucide-react';

/**
 * 模型配置接口
 */
export interface ModelConfig {
    /** 模型完整显示名称 (作为回退或默认展示) */
    label: string;
    /** 模型简短标签 (用于列表/卡片) */
    shortLabel: string;
    /** 保护模型的键名 */
    protectedKey: string;
    /** 模型图标组件 */
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    /** 国际化键名 (用于动态名称) */
    i18nKey: string;
    /** 描述信息键名 (用于详细说明) */
    i18nDescKey: string;
    /** 所属系列/分组 */
    group: string;
    /** 选填标签 (用于筛选) */
    tags?: string[];
}

/**
 * 模型配置映射
 * 键为模型 ID，值为模型配置
 */
export const MODEL_CONFIG: Record<string, ModelConfig> = {
    auto: {
        label: 'Auto',
        shortLabel: 'Auto',
        protectedKey: 'auto',
        Icon: Bot,
        i18nKey: 'proxy.model.auto',
        i18nDescKey: 'proxy.model.auto',
        group: 'Auto',
        tags: ['auto'],
    },
    'hy3-preview': {
        label: 'Hy3 preview',
        shortLabel: 'Hy3',
        protectedKey: 'hy3-preview',
        Icon: Sparkles,
        i18nKey: 'proxy.model.hy3_preview',
        i18nDescKey: 'proxy.model.hy3_preview',
        group: 'Hy3',
        tags: ['preview'],
    },
    'glm-5v-turbo': {
        label: 'GLM-5v-Turbo',
        shortLabel: 'GLM-5V',
        protectedKey: 'glm-5v-turbo',
        Icon: BrainCircuit,
        i18nKey: 'proxy.model.glm_5v_turbo',
        i18nDescKey: 'proxy.model.glm_5v_turbo',
        group: 'GLM',
        tags: ['glm', 'vision', 'turbo'],
    },
    'glm-5.1': {
        label: 'GLM-5.1',
        shortLabel: 'GLM-5.1',
        protectedKey: 'glm-5.1',
        Icon: BrainCircuit,
        i18nKey: 'proxy.model.glm_5_1',
        i18nDescKey: 'proxy.model.glm_5_1',
        group: 'GLM',
        tags: ['glm'],
    },
    'glm-5.0-turbo': {
        label: 'GLM-5.0-Turbo',
        shortLabel: 'GLM-5.0',
        protectedKey: 'glm-5.0-turbo',
        Icon: BrainCircuit,
        i18nKey: 'proxy.model.glm_5_0_turbo',
        i18nDescKey: 'proxy.model.glm_5_0_turbo',
        group: 'GLM',
        tags: ['glm', 'turbo'],
    },
    'kimi-k2.6': {
        label: 'Kimi-K2.6',
        shortLabel: 'Kimi 2.6',
        protectedKey: 'kimi-k2.6',
        Icon: Cpu,
        i18nKey: 'proxy.model.kimi_k2_6',
        i18nDescKey: 'proxy.model.kimi_k2_6',
        group: 'Kimi',
        tags: ['kimi'],
    },
    'kimi-k2.5': {
        label: 'Kimi-K2.5',
        shortLabel: 'Kimi 2.5',
        protectedKey: 'kimi-k2.5',
        Icon: Cpu,
        i18nKey: 'proxy.model.kimi_k2_5',
        i18nDescKey: 'proxy.model.kimi_k2_5',
        group: 'Kimi',
        tags: ['kimi'],
    },
    'minimax-m2.7': {
        label: 'MiniMax-M2.7',
        shortLabel: 'M2.7',
        protectedKey: 'minimax-m2.7',
        Icon: Zap,
        i18nKey: 'proxy.model.minimax_m2_7',
        i18nDescKey: 'proxy.model.minimax_m2_7',
        group: 'MiniMax',
        tags: ['minimax'],
    },
    'deepseek-v4-flash': {
        label: 'Deepseek-V4-Flash',
        shortLabel: 'DS V4',
        protectedKey: 'deepseek-v4-flash',
        Icon: Cpu,
        i18nKey: 'proxy.model.deepseek_v4_flash',
        i18nDescKey: 'proxy.model.deepseek_v4_flash',
        group: 'DeepSeek',
        tags: ['deepseek', 'flash'],
    },
    'deepseek-v3.2': {
        label: 'DeepSeek-V3.2',
        shortLabel: 'DS V3.2',
        protectedKey: 'deepseek-v3.2',
        Icon: Cpu,
        i18nKey: 'proxy.model.deepseek_v3_2',
        i18nDescKey: 'proxy.model.deepseek_v3_2',
        group: 'DeepSeek',
        tags: ['deepseek'],
    },
};

/**
 * 获取所有模型 ID 列表
 */
export const getAllModelIds = (): string[] => Object.keys(MODEL_CONFIG);

/**
 * 根据模型 ID 获取配置
 */
export const getModelConfig = (modelId: string): ModelConfig | undefined => {
    return MODEL_CONFIG[modelId.toLowerCase()];
};

const MODEL_SORT_PREFIXES = [
    ['auto', 10],
    ['hy3', 20],
    ['glm', 30],
    ['kimi', 40],
    ['minimax', 50],
    ['deepseek', 60],
] as const;

/**
 * 获取模型的排序权重
 */
function getModelSortWeight(modelId: string): number {
    const id = modelId.toLowerCase();
    let weight = 100000;

    for (const [prefix, prefixWeight] of MODEL_SORT_PREFIXES) {
        if (id === prefix || id.startsWith(`${prefix}-`)) {
            weight = prefixWeight * 1000;
            break;
        }
    }

    if (id.includes('flash')) weight += 10;
    if (id.includes('turbo')) weight += 20;
    if (id.includes('preview')) weight += 30;

    return weight;
}

/**
 * 对模型列表进行排序
 * @param models 模型列表
 * @returns 排序后的模型列表
 */
export function sortModels<T extends { id: string }>(models: T[]): T[] {
    return [...models].sort((a, b) => {
        const weightA = getModelSortWeight(a.id);
        const weightB = getModelSortWeight(b.id);

        // 按权重升序排序
        if (weightA !== weightB) {
            return weightA - weightB;
        }

        // 权重相同时，按字母顺序排序
        return a.id.localeCompare(b.id);
    });
}
