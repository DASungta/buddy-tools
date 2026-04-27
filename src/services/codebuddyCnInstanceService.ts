import { invoke } from '@tauri-apps/api/core';
import type {
  CodebuddyInstance,
  CreateInstanceParams,
  DefaultInstanceSettings,
  InstanceDefaults,
  UpdateInstanceParams,
} from '../types/codebuddyInstance';

export async function listCodebuddyCnInstances(): Promise<CodebuddyInstance[]> {
  return invoke<CodebuddyInstance[]>('list_codebuddy_cn_instances');
}

export async function getCodebuddyCnInstanceDefaults(): Promise<InstanceDefaults> {
  return invoke<InstanceDefaults>('get_codebuddy_cn_instance_defaults');
}

export async function getCodebuddyCnDefaultSettings(): Promise<DefaultInstanceSettings> {
  return invoke<DefaultInstanceSettings>('get_codebuddy_cn_default_settings');
}

export async function createCodebuddyCnInstance(
  params: CreateInstanceParams,
): Promise<CodebuddyInstance> {
  return invoke<CodebuddyInstance>(
    'create_codebuddy_cn_instance',
    params as unknown as Record<string, unknown>,
  );
}

export async function updateCodebuddyCnInstance(
  params: UpdateInstanceParams,
): Promise<CodebuddyInstance> {
  return invoke<CodebuddyInstance>(
    'update_codebuddy_cn_instance',
    params as unknown as Record<string, unknown>,
  );
}

export async function deleteCodebuddyCnInstance(instanceId: string): Promise<void> {
  return invoke<void>('delete_codebuddy_cn_instance', { instance_id: instanceId });
}

export async function startCodebuddyCnInstance(instanceId: string): Promise<number> {
  return invoke<number>('start_codebuddy_cn_instance', { instance_id: instanceId });
}

export async function focusCodebuddyCnInstance(instanceId: string): Promise<number> {
  return invoke<number>('focus_codebuddy_cn_instance', { instance_id: instanceId });
}

export async function stopCodebuddyCnInstance(instanceId: string): Promise<void> {
  return invoke<void>('stop_codebuddy_cn_instance', { instance_id: instanceId });
}

export async function getCodebuddyCnInstancePid(instanceId: string): Promise<number> {
  return invoke<number>('get_codebuddy_cn_instance_pid', { instance_id: instanceId });
}

export async function injectTokenForCodebuddyCnInstance(instanceId: string): Promise<void> {
  return invoke<void>('inject_token_for_codebuddy_cn_instance', { instance_id: instanceId });
}
