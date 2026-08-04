import { ConfigItem } from '../../types/config';

export function parseVLess(rawLink: string, groupId: string, id: string): ConfigItem | null {
  try {
    const trimmed = rawLink.trim();
    if (!trimmed.startsWith('vless://')) return null;

    // vless://uuid@host:port?params#remark
    const urlStr = trimmed.replace('vless://', 'http://');
    const url = new URL(urlStr);

    const uuid = url.username;
    const address = url.hostname;
    const port = parseInt(url.port, 10) || 443;
    const remark = decodeURIComponent(url.hash ? url.hash.substring(1) : address);

    const params = url.searchParams;
    const network = params.get('type') || 'tcp';
    const security = params.get('security') || 'none';
    const sni = params.get('sni') || params.get('host') || '';
    const host = params.get('host') || '';
    const path = params.get('path') || params.get('serviceName') || '';
    const headerType = params.get('headerType') || 'none';
    const pbk = params.get('pbk') || '';
    const sid = params.get('sid') || '';
    const fp = params.get('fp') || '';
    const alpn = params.get('alpn') || '';
    const flow = params.get('flow') || '';
    const mode = params.get('mode') || '';
    
    let extraParsed: Record<string, any> | undefined = undefined;
    const extraStr = params.get('extra');
    if (extraStr) {
      try {
        extraParsed = JSON.parse(extraStr);
      } catch (e) {
        console.warn('Failed to parse extra json for VLESS', e);
      }
    }

    return {
      id,
      groupId,
      name: remark || 'VLess Config',
      protocol: 'vless',
      address,
      port,
      uuid,
      network,
      headerType,
      host,
      path,
      tls: security,
      sni,
      alpn,
      pbk,
      sid,
      fp,
      flow,
      mode,
      extra: extraParsed,
      raw: trimmed,
      status: 'untested',
      realDelay: null,
      downloadSpeed: null,
      uploadSpeed: null,
    };
  } catch (err) {
    console.error('VLess parse error:', err);
    return null;
  }
}

export function vlessToXrayOutbound(config: ConfigItem): object {
  const streamSettings: any = {
    network: config.network || 'tcp',
    security: config.tls || 'none',
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
  } else if (config.tls === 'reality') {
    streamSettings.realitySettings = {
      serverName: config.sni || config.address,
      fingerprint: config.fp || 'chrome',
      publicKey: config.pbk || '',
      shortId: config.sid || '',
      spiderX: '/',
    };
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
    protocol: 'vless',
    settings: {
      vnext: [
        {
          address: config.address,
          port: config.port,
          users: [
            {
              id: config.uuid,
              encryption: 'none',
            },
          ],
        },
      ],
    },
    streamSettings,
  };
}
