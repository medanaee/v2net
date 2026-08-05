export type ConfigProtocol = 'vmess' | 'vless' | 'trojan' | 'shadowsocks' | 'unknown';

export type ConfigStatus = 'untested' | 'disconnected' | 'working';

export interface ConfigItem {
  id: string;
  groupId: string;
  name: string;
  protocol: ConfigProtocol;
  address: string;
  port: number;
  uuid?: string;
  secret?: string; // password for trojan/ss
  type?: string; // method for shadowsocks or header type
  network?: string; // ws, tcp, grpc, h2, http
  headerType?: string; // none, srtp, utp, wechat-video, dtls
  path?: string;
  host?: string;
  sni?: string;
  tls?: string; // tls, reality, none
  alpn?: string;
  pbk?: string; // publicKey for REALITY
  sid?: string; // shortId for REALITY
  fp?: string; // fingerprint (chrome, firefox, safari, etc.)
  flow?: string; // XTLS flow (xtls-rprx-vision, etc)
  mode?: string; // stream mode for xhttp
  extra?: Record<string, any>; // extra settings for xhttp
  raw: string; // Original URL link
  
  // Realtime test results
  status: ConfigStatus;
  testStage?: number; // current passed stages in multi-stage
  realDelay?: number | null; // ms (-1 or null if failed)
  /** ISO 3166-1 alpha-2 of exit IP seen through the config during real-delay */
  countryCode?: string | null;
  downloadSpeed?: number | null; // Bytes/sec or MB/s
  uploadSpeed?: number | null; // Bytes/sec or MB/s
  
  // Traffic stats
  trafficToday?: { tx: number; rx: number; date: string };
  trafficTotal?: { tx: number; rx: number };
}

export interface Group {
  id: string;
  name: string;
  createdTime: number;
}

export interface AppSettings {
  theme: 'dark' | 'light';
  language: 'fa' | 'en';
  acrylicBlur: boolean;
  testWorkers: number;
  multiStageTesting: boolean;
  multiStageCount: number;
  testUrls: {
    realDelay: string[];
    selectedRealDelayUrl: string;
    downloadUrl: string;
    uploadUrl: string;
  };
  localPort: number;
  systemProxyMode: 'set' | 'clear' | 'dont_change';
  activeConfigId: string | null;
  showTrafficStats: boolean;
}
