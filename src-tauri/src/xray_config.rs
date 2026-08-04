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

pub fn generate_xray_config_mixed(target: &crate::tester::TestTarget, local_port: u16) -> Value {
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
    outbound["tag"] = json!("proxy");

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
            "destOverride": ["http", "tls"]
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

    json!({
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
        "inbounds": [inbound, api_inbound],
        "outbounds": [
            outbound,
            json!({
                "protocol": "freedom",
                "tag": "direct"
            }),
            json!({
                "protocol": "blackhole",
                "tag": "block"
            })
        ],
        "routing": {
            "domainStrategy": "AsIs",
            "rules": [
                json!({
                    "type": "field",
                    "inboundTag": ["api"],
                    "outboundTag": "api"
                }),
                json!({
                    "type": "field",
                    "inboundTag": ["inbound"],
                    "outboundTag": "proxy"
                })
            ]
        }
    })
}
