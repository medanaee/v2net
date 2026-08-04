import { ConfigItem } from '../../types/config';
import { parseVMess, vmessToXrayOutbound } from './vmess';
import { parseVLess, vlessToXrayOutbound } from './vless';
import { parseTrojan, trojanToXrayOutbound } from './trojan';
import { parseShadowsocks, shadowsocksToXrayOutbound } from './shadowsocks';

export function parseSingleConfig(line: string, groupId: string, index: number): ConfigItem | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const id = `cfg_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 7)}`;

  if (trimmed.startsWith('vmess://')) {
    return parseVMess(trimmed, groupId, id);
  }
  if (trimmed.startsWith('vless://')) {
    return parseVLess(trimmed, groupId, id);
  }
  if (trimmed.startsWith('trojan://')) {
    return parseTrojan(trimmed, groupId, id);
  }
  if (trimmed.startsWith('ss://')) {
    return parseShadowsocks(trimmed, groupId, id);
  }

  return null;
}

export function parseBatchConfigs(rawText: string, groupId: string): ConfigItem[] {
  const lines = rawText.split(/\r?\n/);
  const configs: ConfigItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const item = parseSingleConfig(lines[i], groupId, i);
    if (item) {
      configs.push(item);
    }
  }

  return configs;
}

export function configToXrayOutbound(config: ConfigItem): object {
  switch (config.protocol) {
    case 'vmess':
      return vmessToXrayOutbound(config);
    case 'vless':
      return vlessToXrayOutbound(config);
    case 'trojan':
      return trojanToXrayOutbound(config);
    case 'shadowsocks':
      return shadowsocksToXrayOutbound(config);
    default:
      return { protocol: 'freedom', settings: {} };
  }
}
