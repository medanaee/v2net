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

/** Share-link scheme starts; each link runs until whitespace or the next scheme. */
const SHARE_SCHEME_RE = /(?:vmess|vless|trojan|ss):\/\//gi;

export function parseBatchConfigs(rawText: string, groupId: string): ConfigItem[] {
  const configs: ConfigItem[] = [];
  const seen = new Set<string>();
  let index = 0;

  const starts: number[] = [];
  for (const match of rawText.matchAll(SHARE_SCHEME_RE)) {
    if (match.index !== undefined) starts.push(match.index);
  }

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const limit = i + 1 < starts.length ? starts[i + 1] : rawText.length;
    const chunk = rawText.slice(start, limit);
    // Also stop at whitespace / wrappers before the next scheme.
    const stop = chunk.search(/[\s<>"'`]/);
    let link = (stop === -1 ? chunk : chunk.slice(0, stop)).trim();
    // Strip trailing punctuation often glued on in chats / markdown.
    link = link.replace(/[),.;:!?\]]+$/g, '');
    if (!link) continue;

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
