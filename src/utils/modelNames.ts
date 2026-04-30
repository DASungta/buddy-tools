const MODEL_DISPLAY_NAMES: Record<string, string> = {
  auto: 'Auto',
  'hy3-preview': 'Hy3 preview',
  'glm-5v-turbo': 'GLM-5v-Turbo',
  'glm-5.1': 'GLM-5.1',
  'glm-5.0-turbo': 'GLM-5.0-Turbo',
  'kimi-k2.6': 'Kimi-K2.6',
  'kimi-k2.5': 'Kimi-K2.5',
  'minimax-m2.7': 'MiniMax-M2.7',
  'deepseek-v4-flash': 'Deepseek-V4-Flash',
  'deepseek-v3.2': 'DeepSeek-V3.2',
};

interface DefaultGroup {
  id: string;
  name: string;
  models: string[];
}

export interface AutoModelGroup {
  id: string;
  name: string;
  models: string[];
}

const DEFAULT_GROUPS: DefaultGroup[] = [
  {
    id: 'auto',
    name: 'Auto',
    models: ['auto'],
  },
  {
    id: 'hy3',
    name: 'Hy3',
    models: ['hy3-preview'],
  },
  {
    id: 'glm',
    name: 'GLM',
    models: ['glm-5v-turbo', 'glm-5.1', 'glm-5.0-turbo'],
  },
  {
    id: 'kimi',
    name: 'Kimi',
    models: ['kimi-k2.6', 'kimi-k2.5'],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    models: ['minimax-m2.7'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    models: ['deepseek-v4-flash', 'deepseek-v3.2'],
  },
];

const CURRENT_MODEL_IDS = new Set(Object.keys(MODEL_DISPLAY_NAMES));
const INTERNAL_MODEL_ID_PATTERNS = [
  /^model_placeholder_/i,
  /^model_chat_/i,
  /^chat_\d+$/i,
  /^unknown(?:[-_].*)?$/i,
  /^placeholder(?:[-_].*)?$/i,
  /^test[-_]model(?:[-_].*)?$/i,
];
const INTERNAL_DISPLAY_NAME_PATTERNS = [
  /^model placeholder\b/i,
  /^model chat\b/i,
  /^chat[_\s-]?\d+$/i,
  /^unknown(?:\s+model)?$/i,
  /^placeholder(?:\s+model)?$/i,
  /^test\s+model\b/i,
];

export const RECOMMENDED_MODELS = [
  'auto',
  'hy3-preview',
  'glm-5v-turbo',
  'glm-5.1',
  'glm-5.0-turbo',
  'kimi-k2.6',
  'kimi-k2.5',
  'minimax-m2.7',
  'deepseek-v4-flash',
  'deepseek-v3.2',
] as const;

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function normalizeModelName(modelId: string, displayName?: string): string {
  return (displayName?.trim() || getModelDisplayName(modelId))
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseToken(token: string): string {
  const upperToken = token.toUpperCase();
  if (/^(api|cn|gpt|glm|oss|tk|id)$/.test(token)) {
    return upperToken;
  }
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function formatModelId(modelId: string): string {
  return modelId
    .trim()
    .split(/[-_]+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(' ');
}

function isExactGroupMatch(group: DefaultGroup, normalizedModelId: string): boolean {
  return group.models.some((modelId) => normalizeModelId(modelId) === normalizedModelId);
}

function matchesGroupPrefix(groupId: string, normalizedModelId: string, normalizedModelName: string): boolean {
  switch (groupId) {
    case 'auto':
      return normalizedModelId === 'auto' || normalizedModelName === 'auto';
    case 'hy3':
      return normalizedModelId.startsWith('hy3-') || normalizedModelName.startsWith('hy3 ');
    case 'glm':
      return normalizedModelId.startsWith('glm-') || normalizedModelName.startsWith('glm ');
    case 'kimi':
      return normalizedModelId.startsWith('kimi-') || normalizedModelName.startsWith('kimi ');
    case 'minimax':
      return normalizedModelId.startsWith('minimax-') || normalizedModelName.startsWith('minimax ');
    case 'deepseek':
      return normalizedModelId.startsWith('deepseek-') || normalizedModelName.startsWith('deepseek ');
    default:
      return false;
  }
}

export function getModelDisplayName(modelId: string): string {
  const normalizedModelId = normalizeModelId(modelId);
  if (!normalizedModelId) {
    return modelId;
  }
  return MODEL_DISPLAY_NAMES[normalizedModelId] || formatModelId(modelId);
}

export function resolveDefaultGroupId(modelId: string, displayName?: string): string | null {
  const normalizedModelId = normalizeModelId(modelId);
  if (!normalizedModelId) {
    return null;
  }

  const normalizedModelName = normalizeModelName(modelId, displayName);

  for (const group of DEFAULT_GROUPS) {
    if (isExactGroupMatch(group, normalizedModelId)) {
      return group.id;
    }
  }

  for (const group of DEFAULT_GROUPS) {
    if (matchesGroupPrefix(group.id, normalizedModelId, normalizedModelName)) {
      return group.id;
    }
  }

  return null;
}

export function getModelGroupName(modelId: string, displayName?: string): string {
  const groupId = resolveDefaultGroupId(modelId, displayName);
  return DEFAULT_GROUPS.find((group) => group.id === groupId)?.name || 'Other';
}

export function autoGroupModels(modelIds: string[]): AutoModelGroup[] {
  const groupedModels = new Map<string, string[]>();

  for (const modelId of modelIds) {
    const groupId = resolveDefaultGroupId(modelId);
    if (!groupId) {
      continue;
    }

    const models = groupedModels.get(groupId);
    if (models) {
      models.push(modelId);
    } else {
      groupedModels.set(groupId, [modelId]);
    }
  }

  return DEFAULT_GROUPS.flatMap((group) => {
    const models = groupedModels.get(group.id);
    return models?.length ? [{ id: group.id, name: group.name, models }] : [];
  });
}

export function isInternalOrDeprecatedModel(modelId: string, displayName?: string): boolean {
  const normalizedModelId = normalizeModelId(modelId);
  if (!normalizedModelId || CURRENT_MODEL_IDS.has(normalizedModelId)) {
    return false;
  }
  if (normalizedModelId.startsWith('gemini-') || normalizedModelId.startsWith('claude-')) {
    return true;
  }
  if (INTERNAL_MODEL_ID_PATTERNS.some((pattern) => pattern.test(normalizedModelId))) {
    return true;
  }

  const normalizedDisplayName = displayName?.trim().toLowerCase();
  return Boolean(
    normalizedDisplayName
      && INTERNAL_DISPLAY_NAME_PATTERNS.some((pattern) => pattern.test(normalizedDisplayName)),
  );
}
