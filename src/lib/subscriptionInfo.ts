import { ConfigItem, SubscriptionInfo } from '../types/config';

/**
 * Format raw bytes into human readable string (e.g. 75.66 GB).
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Parse a traffic string (e.g. "75.66 GB", "250 گیگ") into approximate Gigabytes for math/progress calculation.
 */
export function parseTrafficToGB(str?: string): number | null {
  if (!str) return null;
  const cleaned = str.replace(/,/g, '').trim();
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*([KMGTP]?B|گیگ|گیگابایت|مگابایت|ترابایت)?/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;

  const unit = (match[2] || 'GB').toUpperCase();
  if (unit.includes('PB') || unit.includes('پتابایت')) return num * 1024 * 1024;
  if (unit.includes('TB') || unit.includes('ترابایت')) return num * 1024;
  if (unit.includes('GB') || unit.includes('گیگ')) return num;
  if (unit.includes('MB') || unit.includes('مگ')) return num / 1024;
  if (unit.includes('KB') || unit.includes('کیلو')) return num / (1024 * 1024);
  if (unit.includes('B')) return num / (1024 * 1024 * 1024);
  return num;
}

/**
 * Determines whether a given config remark or item is actually a subscription status/info marker
 * (injected by Marzban, 3X-UI, V2Board, etc.) rather than a usable proxy server.
 */
export function isSubscriptionInfoRemark(name: string, port?: number, address?: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();

  // 1. Emoji markers commonly used in subscription info headers
  const hasInfoEmoji = /[📅📆🗓️⏳⏰⌛📊📈📉🔋ℹ️]/.test(trimmed);

  // 2. Days / Time remaining patterns (English & Persian)
  const hasDaysPattern = /(?:📅|📆|🗓️|⏳|⏰|⌛)?\s*\d+[\s\.\w]*\s*(?:Days?|روز(?: دیگر| مانده)?|d|day|days)(?:\s*[-_|,]|\s+|$)/i.test(trimmed);
  const hasExpireKeyword = /(?:Expire|Expiration|Expires|انقضا|تاریخ انقضا|Expir)/i.test(trimmed);

  // 3. Traffic usage patterns (e.g. 75.66 GB / 250 GB or 75.66 گیگ از 250 گیگ)
  const hasTrafficPair = /(?:\d+(?:\.\d+)?\s*(?:[KMGTP]?B|گیگ|گیگابایت|مگابایت))\s*(?:\/|of|از|total|از کل)\s*(?:\d+(?:\.\d+)?\s*(?:[KMGTP]?B|گیگ|گیگابایت|مگابایت)|\u221E|unlimited|نامحدود)/i.test(trimmed);
  const hasTrafficKeyword = /(?:Traffic|حجم مصرفی|حجم باقی‌مانده|ترافیک|Remaining Traffic|Total Traffic)/i.test(trimmed);

  // If emoji is present along with days or traffic info
  if (hasInfoEmoji && (hasDaysPattern || hasExpireKeyword || hasTrafficPair || hasTrafficKeyword || /\d+\s*(?:GB|MB|TB|گیگ)/i.test(trimmed))) {
    return true;
  }

  // If both days/expiration and traffic ratio are found
  if ((hasDaysPattern || hasExpireKeyword) && (hasTrafficPair || hasTrafficKeyword)) {
    return true;
  }

  // If dummy port/host is used alongside subscription keywords
  const isDummyPortOrHost = port === 0 || port === 1 || address === '127.0.0.1' || address === '0.0.0.0' || address === '1.1.1.1' || /^\d{5,}$/.test(address || '');
  if (isDummyPortOrHost && (hasDaysPattern || hasExpireKeyword || hasTrafficPair || hasTrafficKeyword)) {
    return true;
  }

  return false;
}

export function isSubscriptionInfoConfig(config: ConfigItem): boolean {
  return isSubscriptionInfoRemark(config.name, config.port, config.address);
}

/**
 * Extracts structured SubscriptionInfo from a dummy config's remark and/or standard HTTP headers.
 */
export function parseSubscriptionInfo(
  remark?: string,
  httpUserInfoHeader?: string
): SubscriptionInfo | null {
  const info: SubscriptionInfo = {};
  let hasData = false;

  // 1. Parse standard subscription-userinfo HTTP header if present
  // e.g. upload=1073741824; download=80287383552; total=268435456000; expire=1789400000
  if (httpUserInfoHeader) {
    const parts = httpUserInfoHeader.split(';').map((p) => p.trim());
    const map: Record<string, number> = {};
    for (const part of parts) {
      const [k, v] = part.split('=').map((s) => s.trim());
      if (k && v && !isNaN(Number(v))) {
        map[k.toLowerCase()] = Number(v);
      }
    }

    if (map.upload !== undefined) info.upload = map.upload;
    if (map.download !== undefined) info.download = map.download;

    const usedBytes = (map.upload || 0) + (map.download || 0);
    if (usedBytes > 0) {
      info.usedTraffic = formatBytes(usedBytes);
      hasData = true;
    }

    if (map.total !== undefined && map.total > 0) {
      info.totalTraffic = formatBytes(map.total);
      if (usedBytes > 0) {
        info.percentUsed = Math.min(100, Math.round((usedBytes / map.total) * 100));
      }
      hasData = true;
    }

    if (map.expire !== undefined && map.expire > 0) {
      const expireMs = map.expire * 1000;
      const diffDays = Math.ceil((expireMs - Date.now()) / (1000 * 60 * 60 * 24));
      if (diffDays > 0) {
        info.remainingDays = `${diffDays} Days`;
      } else {
        info.remainingDays = 'Expired';
      }
      info.expireDate = new Date(expireMs).toISOString().split('T')[0];
      hasData = true;
    }
  }

  // 2. Parse from the config's decoded remark string
  // e.g. "📅 15 Days - 📊 75.66 GB / 250.0 GB" or "📅 15 روز - 📊 75.66 گیگ از 250 گیگ"
  if (remark) {
    info.raw = remark.trim();
    hasData = true;

    // Remaining Days (e.g. "15 Days", "28d", "15 روز")
    const daysMatch = remark.match(/(?:📅|📆|🗓️|⏳|⏰|⌛)?\s*(\d+[\s\.\w]*\s*(?:Days?|روز(?: دیگر| مانده)?|d|day|days))(?:\s*[-_|,]|\s+|$)/i);
    if (daysMatch && !info.remainingDays) {
      info.remainingDays = daysMatch[1].trim();
    }

    // Expiration date (e.g. "Expire: 2026-09-15" or "2026-09-15")
    const dateMatch =
      remark.match(/(?:Expire|Expiration|Expires|انقضا|تاریخ انقضا)[\s:：]*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i) ||
      remark.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (dateMatch && !info.expireDate) {
      info.expireDate = dateMatch[1].trim();
    }

    // Used & Total Traffic (e.g. "75.66 GB / 250.0 GB" or "75.66 گیگ از 250 گیگ")
    const trafficPairMatch = remark.match(
      /(?:📊|📈|📉|🔋|Traffic|حجم|مصرف|Used)?[\s:：]*(\d+(?:\.\d+)?\s*(?:[KMGTP]?B|گیگ|گیگابایت|مگابایت))\s*(?:\/|of|از|total|از کل)\s*(\d+(?:\.\d+)?\s*(?:[KMGTP]?B|گیگ|گیگابایت|مگابایت)|\u221E|unlimited|نامحدود)/i
    );
    if (trafficPairMatch) {
      if (!info.usedTraffic) info.usedTraffic = trafficPairMatch[1].trim();
      if (!info.totalTraffic) info.totalTraffic = trafficPairMatch[2].trim();

      if (info.percentUsed === undefined) {
        const usedNum = parseTrafficToGB(trafficPairMatch[1]);
        const totalNum = parseTrafficToGB(trafficPairMatch[2]);
        if (usedNum !== null && totalNum !== null && totalNum > 0) {
          info.percentUsed = Math.min(100, Math.round((usedNum / totalNum) * 100));
        }
      }
    } else {
      // Remaining single traffic string if given
      const remainingMatch = remark.match(/(?:Remaining|باقی‌مانده|مانده|باقیمانده)[\s:：]*(\d+(?:\.\d+)?\s*(?:[KMGTP]?B|گیگ|گیگابایت))/i);
      if (remainingMatch && !info.totalTraffic) {
        info.totalTraffic = remainingMatch[1].trim();
      }
    }
  }

  return hasData ? info : null;
}

/**
 * Filter dummy info configs out from a list of parsed ConfigItems and aggregate subscription info.
 */
export function extractSubscriptionInfoFromConfigs(
  configs: ConfigItem[],
  httpUserInfoHeader?: string
): { realConfigs: ConfigItem[]; subscriptionInfo: SubscriptionInfo | null } {
  let aggregatedInfo: SubscriptionInfo | null = parseSubscriptionInfo(undefined, httpUserInfoHeader);
  const realConfigs: ConfigItem[] = [];

  for (const config of configs) {
    if (isSubscriptionInfoConfig(config)) {
      const parsedFromConfig = parseSubscriptionInfo(config.name);
      if (parsedFromConfig) {
        aggregatedInfo = {
          ...parsedFromConfig,
          ...aggregatedInfo,
          // Keep raw or most detailed info
          raw: parsedFromConfig.raw || aggregatedInfo?.raw,
          remainingDays: aggregatedInfo?.remainingDays || parsedFromConfig.remainingDays,
          expireDate: aggregatedInfo?.expireDate || parsedFromConfig.expireDate,
          usedTraffic: aggregatedInfo?.usedTraffic || parsedFromConfig.usedTraffic,
          totalTraffic: aggregatedInfo?.totalTraffic || parsedFromConfig.totalTraffic,
          percentUsed: aggregatedInfo?.percentUsed ?? parsedFromConfig.percentUsed,
        };
      }
    } else {
      realConfigs.push(config);
    }
  }

  return { realConfigs, subscriptionInfo: aggregatedInfo };
}
