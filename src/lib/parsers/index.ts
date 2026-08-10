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

/** Share-link schemes we recognize; matched anywhere in free-form text. */
const SHARE_LINK_RE = /(?:vmess|vless|trojan|ss):\/\/[^\s<>"'`]+/gi;

export function parseBatchConfigs(rawText: string, groupId: string): ConfigItem[] {
  const configs: ConfigItem[] = [];
  const seen = new Set<string>();
  let index = 0;

  for (const match of rawText.matchAll(SHARE_LINK_RE)) {
    // Strip trailing punctuation often glued on in chats / markdown.
    const link = match[0].replace(/[),.;:!?\]]+$/g, '');
    const dedupeKey = link.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    const item = parseSingleConfig(link, groupId, index);
    if (item) {
      seen.add(dedupeKey);
      configs.push(item);
      index += 1;
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
