import { ConfigItem } from '../../types/config';

export function parseTrojan(rawLink: string, groupId: string, id: string): ConfigItem | null {
  try {
    const trimmed = rawLink.trim();
    if (!trimmed.startsWith('trojan://')) return null;

    const urlStr = trimmed.replace('trojan://', 'http://');
    const url = new URL(urlStr);

    const password = decodeURIComponent(url.username);
    const address = url.hostname;
    const port = parseInt(url.port, 10) || 443;
    const remark = decodeURIComponent(url.hash ? url.hash.substring(1) : address);

    const params = url.searchParams;
    const network = params.get('type') || 'tcp';
    const security = params.get('security') || 'tls';
    const sni = params.get('sni') || params.get('host') || '';
    const host = params.get('host') || '';
    const path = params.get('path') || params.get('serviceName') || '';
    const alpn = params.get('alpn') || '';
    const fp = params.get('fp') || '';
    const mode = params.get('mode') || '';

    let extraParsed: Record<string, any> | undefined = undefined;
    const extraStr = params.get('extra');
    if (extraStr) {
      try {
        extraParsed = JSON.parse(extraStr);
      } catch (e) {
        console.warn('Failed to parse extra json for Trojan', e);
      }
    }

    return {
      id,
      groupId,
      name: remark || 'Trojan Config',
      protocol: 'trojan',
      address,
      port,
      secret: password,
      network,
      host,
      path,
      tls: security,
      sni,
      alpn,
      fp,
      mode,
      extra: extraParsed,
      raw: trimmed,
      status: 'untested',
      realDelay: null,
      downloadSpeed: null,
      uploadSpeed: null,
    };
  } catch (err) {
    console.error('Trojan parse error:', err);
    return null;
  }
}

export function trojanToXrayOutbound(config: ConfigItem): object {
  const streamSettings: any = {
    network: config.network || 'tcp',
    security: config.tls || 'tls',
  };

  if (config.tls === 'tls') {
    streamSettings.tlsSettings = {
      serverName: config.sni || config.address,
      allowInsecure: false,
      fingerprint: config.fp || 'chrome',
    };
    if (config.alpn) {
      streamSettings.tlsSettings.alpn = config.alpn.split(',');
    }
  }

  if (config.network === 'ws') {
    streamSettings.wsSettings = {
      path: config.path || '/',
      headers: {
        Host: config.host || config.address,
      },
    };
  } else if (config.network === 'grpc') {
    streamSettings.grpcSettings = {
      serviceName: config.path || '',
      multiMode: false,
    };
  }

  return {
    protocol: 'trojan',
    settings: {
      servers: [
        {
          address: config.address,
          port: config.port,
          password: config.secret || '',
        },
      ],
    },
    streamSettings,
  };
}
