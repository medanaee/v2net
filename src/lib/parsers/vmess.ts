import { ConfigItem } from '../../types/config';

function safeBase64Decode(str: string): string {
  try {
    let padded = str.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4 !== 0) {
      padded += '=';
    }
    return decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch (e) {
    try {
      return atob(str);
    } catch {
      return str;
    }
  }
}

export function parseVMess(rawLink: string, groupId: string, id: string): ConfigItem | null {
  try {
    const trimmed = rawLink.trim();
    if (!trimmed.startsWith('vmess://')) return null;

    const b64Data = trimmed.replace('vmess://', '');
    const jsonStr = safeBase64Decode(b64Data);
    const data = JSON.parse(jsonStr);

    const name = data.ps || data.add || 'VMess Config';
    const address = data.add || '';
    const port = parseInt(data.port, 10) || 443;
    const uuid = data.id || '';
    const network = data.net || 'tcp';
    const type = data.type || 'none';
    const host = data.host || '';
    const path = data.path || '';
    const tls = data.tls || 'none';
    const sni = data.sni || host || '';
    const alpn = data.alpn || '';

    return {
      id,
      groupId,
      name,
      protocol: 'vmess',
      address,
      port,
      uuid,
      network,
      headerType: type,
      host,
      path,
      tls,
      sni,
      alpn,
      raw: trimmed,
      status: 'untested',
      realDelay: null,
      downloadSpeed: null,
      uploadSpeed: null,
    };
  } catch (err) {
    console.error('VMess parse error:', err);
    return null;
  }
}

export function vmessToXrayOutbound(config: ConfigItem): object {
  const streamSettings: any = {
    network: config.network || 'tcp',
    security: config.tls === 'tls' ? 'tls' : 'none',
  };

  if (config.tls === 'tls') {
    streamSettings.tlsSettings = {
      serverName: config.sni || config.address,
      allowInsecure: false,
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
  } else if (config.network === 'h2' || config.network === 'http') {
    streamSettings.httpSettings = {
      path: config.path || '/',
      host: config.host ? [config.host] : [],
    };
  }

  return {
    protocol: 'vmess',
    settings: {
      vnext: [
        {
          address: config.address,
          port: config.port,
          users: [
            {
              id: config.uuid,
              alterId: 0,
              security: 'auto',
            },
          ],
        },
      ],
    },
    streamSettings,
  };
}
