import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MODEL_CONFIG } from '../config/modelConfig';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { listCodebuddyCnCachedModels } from '../services/codebuddyCnService';
import {
    getModelDisplayName,
    getModelGroupName,
    isInternalOrDeprecatedModel,
} from '../utils/modelNames';

type CachedModel = Awaited<ReturnType<typeof listCodebuddyCnCachedModels>>[number];

type ProxyModel = {
    id: string;
    name: string;
    desc: string;
    group: string;
    icon: ReactNode;
};

export const useProxyModels = () => {
    const { t } = useTranslation();
    const [cachedModels, setCachedModels] = useState<CachedModel[]>([]);

    useEffect(() => {
        let cancelled = false;

        listCodebuddyCnCachedModels()
            .then((models) => {
                if (!cancelled) {
                    setCachedModels(Array.isArray(models) ? models : []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setCachedModels([]);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const models = useMemo(() => {
        const dynamicMap = new Map<string, CachedModel>();
        for (const model of cachedModels) {
            const id = model.id.trim();
            if (!id) continue;

            const displayName = model.display_name?.trim() || undefined;
            if (isInternalOrDeprecatedModel(id, displayName)) continue;

            const key = id.toLowerCase();
            const existing = dynamicMap.get(key);
            if (!existing || (!existing.display_name && displayName)) {
                dynamicMap.set(key, { ...model, id, display_name: displayName });
            }
        }

        const result: ProxyModel[] = [];
        const seenIds = new Set<string>();

        for (const [key, model] of dynamicMap) {
            if (seenIds.has(key)) continue;
            seenIds.add(key);

            const cfgEntry = Object.entries(MODEL_CONFIG).find(
                ([cfgId, cfg]) =>
                    cfgId.toLowerCase() === key ||
                    (cfg.protectedKey && cfg.protectedKey.toLowerCase() === key),
            );
            const displayName = model.display_name || getModelDisplayName(model.id);
            const ConfigIcon = cfgEntry?.[1].Icon;
            const icon = ConfigIcon
                ? <ConfigIcon size={16} />
                : <Bot size={16} className="text-gray-400 dark:text-gray-500" />;

            result.push({
                id: model.id,
                name: displayName,
                desc: displayName,
                group: cfgEntry?.[1].group || getModelGroupName(model.id, displayName),
                icon,
            });
        }

        for (const [id, config] of Object.entries(MODEL_CONFIG)) {
            const key = id.toLowerCase();
            if (seenIds.has(key)) continue;
            seenIds.add(key);

            const displayName = config.i18nKey ? t(config.i18nKey, config.label) : config.label;
            const StaticIcon = config.Icon;
            result.push({
                id,
                name: displayName,
                desc: displayName,
                group: config.group || 'Other',
                icon: <StaticIcon size={16} />,
            });
        }

        return result;
    }, [cachedModels, t]);

    return { models };
};
