use crate::tester::TestTarget;
use serde_json::{json, Value};

pub fn generate_xray_config(target: &TestTarget, local_port: u16) -> Value {
    let inbound = json!({
        "port": local_port,
        "listen": "127.0.0.1",
        "protocol": "socks",
        "settings": {
            "auth": "noauth",
            "udp": false
        },
        "sniffing": {
            "enabled": true,
            "destOverride": ["http", "tls"]
        }
    });

    let mut outbound = json!({
        "protocol": target.protocol,
        "settings": {}
    });

    // Populate outbound based on protocol
    match target.protocol.as_str() {
        "vmess" => {
            let vnext = json!({
                "address": target.address,
                "port": target.port,
                "users": [{
                    "id": target.uuid.clone().unwrap_or_default(),
                    "alterId": 0,
                    "security": "auto"
                }]
            });
            outbound["settings"] = json!({ "vnext": [vnext] });
        }
        "vless" => {
            let vnext = json!({
                "address": target.address,
                "port": target.port,
                "users": [{
                    "id": target.uuid.clone().unwrap_or_default(),
                    "encryption": "none",
                    "flow": target.flow.clone().unwrap_or_default()
                }]
            });
            outbound["settings"] = json!({ "vnext": [vnext] });
        }
        "trojan" => {
            let server = json!({
                "address": target.address,
                "port": target.port,
                "password": target.secret.clone().unwrap_or_default()
            });
            outbound["settings"] = json!({ "servers": [server] });
        }
        "shadowsocks" => {
            let server = json!({
                "address": target.address,
                "port": target.port,
                "password": target.secret.clone().unwrap_or_default(),
                "method": target.method.clone().unwrap_or_default(),
                "email": "test@test.com",
                "uot": true
            });
            outbound["settings"] = json!({ "servers": [server] });
        }
        _ => {}
    }

    // Stream settings
    let mut stream_settings = json!({});

    // Network (tcp, ws, grpc, etc)
    let network = target.network.clone().unwrap_or_else(|| "tcp".to_string());
    stream_settings["network"] = json!(network);

    if network == "ws" {
        let mut ws_settings = json!({});
        if let Some(path) = &target.path {
            ws_settings["path"] = json!(path);
        }
        let mut ws_host = target.host.clone().unwrap_or_default();
        if ws_host.is_empty() {
            ws_host = target.sni.clone().unwrap_or_default();
        }
        if ws_host.is_empty() {
            ws_host = target.address.clone();
        }
        ws_settings["host"] = json!(ws_host);
        stream_settings["wsSettings"] = ws_settings;
    } else if network == "grpc" {
        let mut grpc_settings = json!({});
        if let Some(path) = &target.path {
            grpc_settings["serviceName"] = json!(path);
        }
        grpc_settings["multiMode"] = json!(false);
        stream_settings["grpcSettings"] = grpc_settings;
    } else if network == "h2" || network == "http" {
        let mut http_settings = json!({});
        if let Some(path) = &target.path {
            http_settings["path"] = json!(path);
        }
        if let Some(host) = &target.host {
            if !host.is_empty() {
                let hosts: Vec<&str> = host.split(',').collect();
                http_settings["host"] = json!(hosts);
            }
        }
        stream_settings["httpSettings"] = http_settings;
    } else if network == "xhttp" {
        let mut xhttp_settings = json!({});
        if let Some(path) = &target.path {
            if !path.is_empty() {
                xhttp_settings["path"] = json!(path);
            }
        }
        if let Some(mode) = &target.mode {
            if !mode.is_empty() {
                xhttp_settings["mode"] = json!(mode);
            }
        }
        if let Some(extra) = &target.extra {
            if let Some(obj) = extra.as_object() {
                for (k, v) in obj {
                    xhttp_settings[k] = v.clone();
                }
            }
        }
        stream_settings["xhttpSettings"] = xhttp_settings;
    } else if network == "tcp" {
        if let Some(header_type) = &target.header_type {
            if header_type == "http" {
                let mut req = json!({
                    "version": "1.1",
                    "method": "GET",
                    "path": ["/"],
                    "headers": {
                        "Host": [""]
                    }
                });
                if let Some(path) = &target.path {
                    if !path.is_empty() {
                        req["path"] = json!([path]);
                    }
                }
                if let Some(host) = &target.host {
                    if !host.is_empty() {
                        req["headers"]["Host"] = json!([host]);
                    }
                }
                stream_settings["tcpSettings"] = json!({
                    "header": {
                        "type": "http",
                        "request": req
                    }
                });
            }
        }
    }

    // Security (tls, reality, xtls)
    let security = target.tls.clone().unwrap_or_else(|| "none".to_string());
    if security != "none" && security != "" {
        stream_settings["security"] = json!(security);

        if security == "tls" {
            let mut tls_settings = json!({});
            if let Some(sni) = &target.sni {
                if !sni.is_empty() {
                    tls_settings["serverName"] = json!(sni);
                }
            }
            if let Some(alpn) = &target.alpn {
                if !alpn.is_empty() {
                    let alpns: Vec<&str> = alpn.split(',').collect();
                    tls_settings["alpn"] = json!(alpns);
                }
            }
            if let Some(fp) = &target.fp {
                if !fp.is_empty() {
                    tls_settings["fingerprint"] = json!(fp);
                } else {
                    tls_settings["fingerprint"] = json!("chrome");
                }
            } else {
                tls_settings["fingerprint"] = json!("chrome");
            }
            stream_settings["tlsSettings"] = tls_settings;
        } else if security == "reality" {
            let mut reality_settings = json!({
                "show": false,
                "spiderX": "/"
            });
            if let Some(sni) = &target.sni {
                reality_settings["serverName"] = json!(sni);
            }
            if let Some(pbk) = &target.pbk {
                reality_settings["publicKey"] = json!(pbk);
            }
            if let Some(sid) = &target.sid {
                reality_settings["shortId"] = json!(sid);
            }
            if let Some(fp) = &target.fp {
                reality_settings["fingerprint"] = json!(fp);
            }
            stream_settings["realitySettings"] = reality_settings;
        }
    }

    outbound["streamSettings"] = stream_settings;

    json!({
        "log": {
            "loglevel": "none"
        },
        "inbounds": [inbound],
        "outbounds": [
            outbound,
            {
                "protocol": "freedom",
                "tag": "direct"
            },
            {
                "protocol": "blackhole",
                "tag": "block"
            }
        ]
    })
}

pub fn generate_xray_config_batch(targets_with_ports: &[(TestTarget, u16)]) -> Value {
    let mut inbounds = Vec::new();
    let mut outbounds = Vec::new();
    let mut rules = Vec::new();

    for (i, (target, local_port)) in targets_with_ports.iter().enumerate() {
        let tag = format!("proxy_{}", i);
        let inbound_tag = format!("inbound_{}", i);

        inbounds.push(json!({
            "port": local_port,
            "listen": "127.0.0.1",
            "protocol": "socks",
            "tag": inbound_tag,
            "settings": {
                "auth": "noauth",
                "udp": false
            },
            "sniffing": {
                "enabled": true,
                "destOverride": ["http", "tls"]
            }
        }));

        let mut outbound = json!({
            "protocol": target.protocol,
            "settings": {}
        });

        match target.protocol.as_str() {
            "vmess" => {
                let vnext = json!({
                    "address": target.address,
                    "port": target.port,
                    "users": [{
                        "id": target.uuid.clone().unwrap_or_default(),
                        "alterId": 0,
                        "security": "auto"
                    }]
                });
                outbound["settings"] = json!({ "vnext": [vnext] });
            }
            "vless" => {
                let vnext = json!({
                    "address": target.address,
                    "port": target.port,
                    "users": [{
                        "id": target.uuid.clone().unwrap_or_default(),
                        "encryption": "none",
                        "flow": target.flow.clone().unwrap_or_default()
                    }]
                });
                outbound["settings"] = json!({ "vnext": [vnext] });
            }
            "trojan" => {
                let server = json!({
                    "address": target.address,
                    "port": target.port,
                    "password": target.secret.clone().unwrap_or_default()
                });
                outbound["settings"] = json!({ "servers": [server] });
            }
            "shadowsocks" => {
                let server = json!({
                    "address": target.address,
                    "port": target.port,
                    "password": target.secret.clone().unwrap_or_default(),
                    "method": target.method.clone().unwrap_or_default(),
                    "email": "test@test.com",
                    "uot": true
                });
                outbound["settings"] = json!({ "servers": [server] });
            }
            _ => {}
        }

        let mut stream_settings = json!({});
        let network = target.network.clone().unwrap_or_else(|| "tcp".to_string());
        stream_settings["network"] = json!(network);

        if network == "ws" {
            let mut ws_settings = json!({});
            if let Some(path) = &target.path {
                ws_settings["path"] = json!(path);
            }
            let mut ws_host = target.host.clone().unwrap_or_default();
            if ws_host.is_empty() {
                ws_host = target.sni.clone().unwrap_or_default();
            }
            if ws_host.is_empty() {
                ws_host = target.address.clone();
            }
            ws_settings["host"] = json!(ws_host);
            stream_settings["wsSettings"] = ws_settings;
        } else if network == "grpc" {
            let mut grpc_settings = json!({});
            if let Some(path) = &target.path {
                grpc_settings["serviceName"] = json!(path);
            }
            grpc_settings["multiMode"] = json!(false);
            stream_settings["grpcSettings"] = grpc_settings;
        } else if network == "h2" || network == "http" {
            let mut http_settings = json!({});
            if let Some(path) = &target.path {
                http_settings["path"] = json!(path);
            }
            if let Some(host) = &target.host {
                if !host.is_empty() {
                    let hosts: Vec<&str> = host.split(",").collect();
                    http_settings["host"] = json!(hosts);
                }
            }
            stream_settings["httpSettings"] = http_settings;
        } else if network == "xhttp" {
            let mut xhttp_settings = json!({});
            if let Some(path) = &target.path {
                if !path.is_empty() {
                    xhttp_settings["path"] = json!(path);
                }
            }
            if let Some(mode) = &target.mode {
                if !mode.is_empty() {
                    xhttp_settings["mode"] = json!(mode);
                }
            }
            if let Some(extra) = &target.extra {
                if let Some(obj) = extra.as_object() {
                    for (k, v) in obj {
                        xhttp_settings[k] = v.clone();
                    }
                }
            }
            stream_settings["xhttpSettings"] = xhttp_settings;
        } else if network == "tcp" {
            if let Some(header_type) = &target.header_type {
                if header_type == "http" {
                    let mut req = json!({
                        "version": "1.1",
                        "method": "GET",
                        "path": ["/"],
                        "headers": {
                            "Host": [""]
                        }
                    });
                    if let Some(path) = &target.path {
                        if !path.is_empty() {
                            req["path"] = json!([path]);
                        }
                    }
                    if let Some(host) = &target.host {
                        if !host.is_empty() {
                            req["headers"]["Host"] = json!([host]);
                        }
                    }
                    stream_settings["tcpSettings"] = json!({
                        "header": {
                            "type": "http",
                            "request": req
                        }
                    });
                }
            }
        }

        let security = target.tls.clone().unwrap_or_else(|| "none".to_string());
        if security != "none" && security != "" {
            stream_settings["security"] = json!(security);

            if security == "tls" {
                let mut tls_settings = json!({});
                if let Some(sni) = &target.sni {
                    if !sni.is_empty() {
                        tls_settings["serverName"] = json!(sni);
                    }
                }
                if let Some(alpn) = &target.alpn {
                    if !alpn.is_empty() {
                        let alpns: Vec<&str> = alpn.split(",").collect();
                        tls_settings["alpn"] = json!(alpns);
                    }
                }
                if let Some(fp) = &target.fp {
                    if !fp.is_empty() {
                        tls_settings["fingerprint"] = json!(fp);
                    } else {
                        tls_settings["fingerprint"] = json!("chrome");
                    }
                } else {
                    tls_settings["fingerprint"] = json!("chrome");
                }
                stream_settings["tlsSettings"] = tls_settings;
            } else if security == "reality" {
                let mut reality_settings = json!({
                    "show": false,
                    "spiderX": "/"
                });
                if let Some(sni) = &target.sni {
                    reality_settings["serverName"] = json!(sni);
                }
                if let Some(pbk) = &target.pbk {
                    reality_settings["publicKey"] = json!(pbk);
                }
                if let Some(sid) = &target.sid {
                    reality_settings["shortId"] = json!(sid);
                }
                if let Some(fp) = &target.fp {
                    reality_settings["fingerprint"] = json!(fp);
                }
                stream_settings["realitySettings"] = reality_settings;
            }
        }

        outbound["streamSettings"] = stream_settings;
        outbound["tag"] = json!(tag.clone());
        outbounds.push(outbound);

        rules.push(json!({
            "type": "field",
            "inboundTag": [inbound_tag],
            "outboundTag": tag
        }));
    }

    outbounds.push(json!({
        "protocol": "freedom",
        "tag": "direct"
    }));
    outbounds.push(json!({
        "protocol": "blackhole",
        "tag": "block"
    }));

    json!({
        "log": {
            "loglevel": "none"
        },
        "inbounds": inbounds,
        "outbounds": outbounds,
        "routing": {
            "domainStrategy": "AsIs",
            "rules": rules
        }
    })
}

/// Physical NIC chosen for TUN egress (avoids WSL/Hyper-V when `auto` picks wrong).
#[derive(Debug, Clone, Default)]
pub struct TunBindInfo {
    pub interface_name: String,
    pub local_ip: String,
}

pub fn generate_xray_config_mixed(
    target: &crate::tester::TestTarget,
    local_port: u16,
    tun_mode: bool,
) -> Value {
    generate_xray_config_mixed_with_bind(target, local_port, tun_mode, None)
}

pub fn generate_xray_config_mixed_with_bind(
    target: &crate::tester::TestTarget,
    local_port: u16,
    tun_mode: bool,
    tun_bind: Option<TunBindInfo>,
) -> Value {
    let mut outbound = json!({
        "protocol": target.protocol,
        "tag": "proxy",
        "settings": {}
    });

    match target.protocol.as_str() {
        "vmess" => {
            let vnext = json!({
                "address": target.address,
                "port": target.port,
                "users": [{
                    "id": target.uuid.clone().unwrap_or_default(),
                    "alterId": 0,
                    "security": "auto"
                }]
            });
            outbound["settings"] = json!({ "vnext": [vnext] });
        }
        "vless" => {
            let vnext = json!({
                "address": target.address,
                "port": target.port,
                "users": [{
                    "id": target.uuid.clone().unwrap_or_default(),
                    "encryption": "none",
                    "flow": target.flow.clone().unwrap_or_default()
                }]
            });
            outbound["settings"] = json!({ "vnext": [vnext] });
        }
        "trojan" => {
            let server = json!({
                "address": target.address,
                "port": target.port,
                "password": target.secret.clone().unwrap_or_default()
            });
            outbound["settings"] = json!({ "servers": [server] });
        }
        "shadowsocks" => {
            let server = json!({
                "address": target.address,
                "port": target.port,
                "password": target.secret.clone().unwrap_or_default(),
                "method": target.method.clone().unwrap_or_default(),
                "email": "test@test.com",
                "uot": true
            });
            outbound["settings"] = json!({ "servers": [server] });
        }
        _ => {}
    }

    let mut stream_settings = json!({});
    let network = target.network.clone().unwrap_or_else(|| "tcp".to_string());
    stream_settings["network"] = json!(network);

    if network == "ws" {
        let mut ws_settings = json!({});
        if let Some(path) = &target.path {
            ws_settings["path"] = json!(path);
        }
        let mut ws_host = target.host.clone().unwrap_or_default();
        if ws_host.is_empty() {
            ws_host = target.sni.clone().unwrap_or_default();
        }
        if ws_host.is_empty() {
            ws_host = target.address.clone();
        }
        ws_settings["host"] = json!(ws_host);
        stream_settings["wsSettings"] = ws_settings;
    } else if network == "grpc" {
        let mut grpc_settings = json!({});
        if let Some(path) = &target.path {
            grpc_settings["serviceName"] = json!(path);
        }
        grpc_settings["multiMode"] = json!(false);
        stream_settings["grpcSettings"] = grpc_settings;
    } else if network == "h2" || network == "http" {
        let mut http_settings = json!({});
        if let Some(path) = &target.path {
            http_settings["path"] = json!(path);
        }
        if let Some(host) = &target.host {
            if !host.is_empty() {
                let hosts: Vec<&str> = host.split(",").collect();
                http_settings["host"] = json!(hosts);
            }
        }
        stream_settings["httpSettings"] = http_settings;
    } else if network == "xhttp" {
        let mut xhttp_settings = json!({});
        if let Some(path) = &target.path {
            if !path.is_empty() {
                xhttp_settings["path"] = json!(path);
            }
        }
        if let Some(mode) = &target.mode {
            if !mode.is_empty() {
                xhttp_settings["mode"] = json!(mode);
            }
        }
        if let Some(extra) = &target.extra {
            if let Some(obj) = extra.as_object() {
                for (k, v) in obj {
                    xhttp_settings[k] = v.clone();
                }
            }
        }
        stream_settings["xhttpSettings"] = xhttp_settings;
    } else if network == "tcp" {
        if let Some(header_type) = &target.header_type {
            if header_type == "http" {
                let mut req = json!({
                    "version": "1.1",
                    "method": "GET",
                    "path": ["/"],
                    "headers": {
                        "Host": [""]
                    }
                });
                if let Some(path) = &target.path {
                    if !path.is_empty() {
                        req["path"] = json!([path]);
                    }
                }
                if let Some(host) = &target.host {
                    if !host.is_empty() {
                        req["headers"]["Host"] = json!([host]);
                    }
                }
                stream_settings["tcpSettings"] = json!({
                    "header": {
                        "type": "http",
                        "request": req
                    }
                });
            }
        }
    }

    let security = target.tls.clone().unwrap_or_else(|| "none".to_string());
    if security != "none" && security != "" {
        stream_settings["security"] = json!(security);

        if security == "tls" {
            let mut tls_settings = json!({});
            if let Some(sni) = &target.sni {
                if !sni.is_empty() {
                    tls_settings["serverName"] = json!(sni);
                }
            }
            if let Some(alpn) = &target.alpn {
                if !alpn.is_empty() {
                    let alpns: Vec<&str> = alpn.split(",").collect();
                    tls_settings["alpn"] = json!(alpns);
                }
            }
            if let Some(fp) = &target.fp {
                if !fp.is_empty() {
                    tls_settings["fingerprint"] = json!(fp);
                } else {
                    tls_settings["fingerprint"] = json!("chrome");
                }
            } else {
                tls_settings["fingerprint"] = json!("chrome");
            }
            stream_settings["tlsSettings"] = tls_settings;
        } else if security == "reality" {
            let mut reality_settings = json!({
                "show": false,
                "spiderX": "/"
            });
            if let Some(sni) = &target.sni {
                reality_settings["serverName"] = json!(sni);
            }
            if let Some(pbk) = &target.pbk {
                reality_settings["publicKey"] = json!(pbk);
            }
            if let Some(sid) = &target.sid {
                reality_settings["shortId"] = json!(sid);
            }
            if let Some(fp) = &target.fp {
                reality_settings["fingerprint"] = json!(fp);
            }
            stream_settings["realitySettings"] = reality_settings;
        }
    }

    outbound["streamSettings"] = stream_settings;
    outbound["tag"] = json!("proxy");

    // Pin proxy egress by local IP (more reliable than interface name on Windows).
    // Leave autoOutboundsInterface as "auto"; sendThrough prevents TUN loops.
    if tun_mode {
        if let Some(bind) = &tun_bind {
            if !bind.local_ip.is_empty() {
                outbound["sendThrough"] = json!(bind.local_ip);
            }
        }
    }

    let inbound = json!({
        "port": local_port,
        "listen": "127.0.0.1",
        "protocol": "mixed",
        "tag": "inbound",
        "settings": {
            "udp": true
        },
        "sniffing": {
            "enabled": true,
            "destOverride": ["http", "tls", "quic"]
        }
    });

    let api_inbound = json!({
        "listen": "127.0.0.1",
        "port": local_port + 1,
        "protocol": "dokodemo-door",
        "settings": {
            "address": "127.0.0.1"
        },
        "tag": "api"
    });

    // TUN inbound must match v2rayN SampleTunInbound.
    let mut inbounds = vec![inbound, api_inbound];
    if tun_mode {
        inbounds.push(json!({
            "tag": "tun",
            "protocol": "tun",
            "settings": {
                "name": "xray_tun",
                "MTU": 1500,
                "gateway": ["172.18.0.1/30"],
                "dns": ["1.1.1.1", "8.8.8.8"],
                "autoSystemRoutingTable": ["0.0.0.0/0"],
                "autoOutboundsInterface": "auto"
            },
            "sniffing": {
                "enabled": true,
                "destOverride": ["http", "tls", "quic"],
                "routeOnly": true
            }
        }));
    }

    let mut rules = vec![
        json!({
            "type": "field",
            "inboundTag": ["api"],
            "outboundTag": "api"
        }),
    ];

    if tun_mode {
        // v2rayN SampleTunRules — drop noisy local/multicast before proxy
        rules.push(json!({
            "type": "field",
            "network": "udp",
            "port": "135,137-139,5353",
            "outboundTag": "block"
        }));
        rules.push(json!({
            "type": "field",
            "ip": ["224.0.0.0/3", "ff00::/8"],
            "outboundTag": "block"
        }));
        // Protect core process from TUN loop (v2rayN uses xray/ + self/)
        rules.push(json!({
            "type": "field",
            "port": "53",
            "process": ["xray/", "self/", "xray.exe", "xray-x86_64-pc-windows-msvc.exe"],
            "outboundTag": "dns-out"
        }));
        rules.push(json!({
            "type": "field",
            "process": ["xray/", "self/", "xray.exe", "xray-x86_64-pc-windows-msvc.exe"],
            "outboundTag": "direct"
        }));
        rules.push(json!({
            "type": "field",
            "inboundTag": ["tun"],
            "port": "53",
            "outboundTag": "dns-out"
        }));
    }

    rules.push(json!({
        "type": "field",
        "inboundTag": if tun_mode {
            json!(["inbound", "tun"])
        } else {
            json!(["inbound"])
        },
        "outboundTag": "proxy"
    }));
    rules.push(json!({
        "type": "field",
        "port": "0-65535",
        "outboundTag": "proxy"
    }));

    let mut config = json!({
        "log": {
            "loglevel": "warning"
        },
        "api": {
            "tag": "api",
            "services": ["StatsService"]
        },
        "stats": {},
        "policy": {
            "system": {
                "statsInboundDownlink": true,
                "statsInboundUplink": true,
                "statsOutboundDownlink": true,
                "statsOutboundUplink": true
            }
        },
        "inbounds": inbounds,
        "outbounds": [
            outbound,
            json!({
                "protocol": "freedom",
                "tag": "direct",
                "settings": {
                    "domainStrategy": "UseIP"
                }
            }),
            json!({
                "protocol": "blackhole",
                "tag": "block"
            }),
            json!({
                "protocol": "dns",
                "tag": "dns-out"
            })
        ],
        "routing": {
            "domainStrategy": "IPIfNonMatch",
            "rules": rules
        }
    });

    if tun_mode {
        config["dns"] = json!({
            "hosts": {
                "dns.google": "8.8.8.8"
            },
            "servers": [
                "1.1.1.1",
                "8.8.8.8",
                "https://dns.google/dns-query"
            ],
            "queryStrategy": "UseIPv4"
        });
    }

    config
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tester::TestTarget;

    fn sample_target() -> TestTarget {
        TestTarget {
            id: "t1".into(),
            address: "1.2.3.4".into(),
            port: 443,
            test_url: String::new(),
            test_type: String::new(),
            protocol: "trojan".into(),
            uuid: None,
            secret: Some("pw".into()),
            method: None,
            network: Some("ws".into()),
            header_type: None,
            path: Some("/x".into()),
            host: Some("h".into()),
            sni: Some("h".into()),
            tls: Some("tls".into()),
            alpn: None,
            pbk: None,
            sid: None,
            fp: Some("chrome".into()),
            flow: None,
            mode: None,
            extra: None,
        }
    }

    #[test]
    fn tun_inbound_matches_v2rayn_sample() {
        let bind = TunBindInfo {
            interface_name: "Wi-Fi 2".into(),
            local_ip: "172.17.139.154".into(),
        };
        let cfg = generate_xray_config_mixed_with_bind(&sample_target(), 10900, true, Some(bind));
        let tun = cfg["inbounds"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["protocol"] == "tun")
            .expect("tun inbound");

        assert_eq!(tun["tag"], "tun");
        assert!(tun.get("listen").is_none());
        assert!(tun.get("port").is_none());
        assert!(tun["settings"].get("address").is_none());
        assert_eq!(tun["settings"]["dns"], json!(["1.1.1.1", "8.8.8.8"]));
        assert_eq!(
            tun["settings"]["autoSystemRoutingTable"],
            json!(["0.0.0.0/0"])
        );
        assert_eq!(tun["settings"]["autoOutboundsInterface"], "auto");
        assert_eq!(tun["settings"]["gateway"], json!(["172.18.0.1/30"]));
        assert_eq!(tun["sniffing"]["routeOnly"], true);

        let proxy = cfg["outbounds"]
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["tag"] == "proxy")
            .expect("proxy outbound");
        assert_eq!(proxy["sendThrough"], "172.17.139.154");
        assert!(proxy["streamSettings"].get("sockopt").is_none());
    }
}
