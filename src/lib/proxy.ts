import { invoke } from '@tauri-apps/api/core';
import { ConfigItem } from '../types/config';

export const startProxyWithConfig = async (
  item: ConfigItem,
  localPort: number,
  systemProxyMode: string,
  tunMode: boolean,
  sudoPassword?: string
) => {
  return await invoke('start_proxy', {
    target: {
      id: item.id,
      test_url: '',
      test_type: '',
      protocol: item.protocol,
      address: item.address,
      port: item.port,
      uuid: item.uuid,
      secret: item.secret,
      method: item.type, // Map type to method for ss
      network: item.network,
      header_type: item.headerType,
      path: item.path,
      host: item.host,
      sni: item.sni,
      tls: item.tls,
      alpn: item.alpn,
      pbk: item.pbk,
      sid: item.sid,
      fp: item.fp,
      flow: item.flow,
      mode: item.mode,
      extra: item.extra,
    },
    localPort,
    systemProxyMode,
    tunMode,
    sudoPassword,
  });
};
