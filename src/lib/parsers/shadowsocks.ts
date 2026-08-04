import { ConfigItem } from '../../types/config';

function safeBase64Decode(str: string): string {
  try {
    let padded = str.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4 !== 0) {
      padded += '=';
    }
    return atob(padded);
  } catch {
    return str;
  }
}

export function parseShadowsocks(rawLink: string, groupId: string, id: string): ConfigItem | null {
  try {
    const trimmed = rawLink.trim();
    if (!trimmed.startsWith('ss://')) return null;

    let body = trimmed.replace('ss://', '');
    let remark = 'Shadowsocks Config';

    if (body.includes('#')) {
      const parts = body.split('#');
      body = parts[0];
      remark = decodeURIComponent(parts.slice(1).join('#'));
    }

    let method = 'aes-256-gcm';
    let password = '';
    let address = '';
    let port = 8388;

    // SIP002 format: ss://BASE64(method:password)@host:port?plugin=...
    if (body.includes('@')) {
      const atSplit = body.split('@');
      const userinfoB64 = atSplit[0];
      const hostPortStr = atSplit[1].split('?')[0];

      const decodedUserinfo = safeBase64Decode(userinfoB64);
      if (decodedUserinfo.includes(':')) {
        const uParts = decodedUserinfo.split(':');
        method = uParts[0];
        password = uParts.slice(1).join(':');
      }

      const hpParts = hostPortStr.split(':');
      address = hpParts[0];
      port = parseInt(hpParts[1], 10) || 8388;
    } else {
      // Legacy format: ss://BASE64(method:password@host:port)
      const decoded = safeBase64Decode(body);
      if (decoded.includes('@')) {
        const atSplit = decoded.split('@');
        const uParts = atSplit[0].split(':');
        method = uParts[0];
        password = uParts.slice(1).join(':');

        const hpParts = atSplit[1].split(':');
        address = hpParts[0];
        port = parseInt(hpParts[1], 10) || 8388;
      }
    }

    if (!address) return null;

    return {
      id,
      groupId,
      name: remark,
      protocol: 'shadowsocks',
      address,
      port,
      secret: password,
      type: method,
      raw: trimmed,
      status: 'untested',
      realDelay: null,
      downloadSpeed: null,
      uploadSpeed: null,
    };
  } catch (err) {
    console.error('Shadowsocks parse error:', err);
    return null;
  }
}

export function shadowsocksToXrayOutbound(config: ConfigItem): object {
  return {
    protocol: 'shadowsocks',
    settings: {
      servers: [
        {
          address: config.address,
          port: config.port,
          method: config.type || 'aes-256-gcm',
          password: config.secret || '',
          uot: true,
        },
      ],
    },
  };
}
