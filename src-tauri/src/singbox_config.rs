use serde_json::{json, Value};
use std::path::PathBuf;

/// Generate a sing-box TUN front-end config that forwards all traffic to a local
/// SOCKS5 proxy (Xray mixed inbound), matching v2rayN's legacy-protect pre-service.
///
/// Architecture (v2rayN EnableLegacyProtect=true):
///   OS → sing-box TUN (auto_route) → socks://127.0.0.1:socks_port → Xray → remote
pub fn generate_singbox_tun_config(socks_port: u16, protect_paths: &[String]) -> Value {
    let mut process_paths: Vec<String> = protect_paths.to_vec();
    // Basename fallbacks — sing-box matches full path; extras are harmless if unused.
    for name in [
        "xray.exe",
        "xray",
        "xray-x86_64-pc-windows-msvc.exe",
        "sing-box.exe",
        "sing-box",
        "sing-box-x86_64-pc-windows-msvc.exe",
    ] {
        if !process_paths.iter().any(|p| p.ends_with(name)) {
            process_paths.push(name.to_string());
        }
    }

    // Inbound from v2rayN Sample/tun_singbox_inbound + TunModeItem defaults
    // (AutoRoute=true, StrictRoute=true, Stack=gvisor, Mtu=9000).
    // sniff moved to route action (sing-box 1.13 removed inbound sniff field)
    let tun_inbound = json!({
        "type": "tun",
        "tag": "tun",
        "interface_name": "singbox_tun",
        "address": ["172.18.0.1/30"],
        "mtu": 9000,
        "auto_route": true,
        "strict_route": true,
        "stack": "gvisor"
    });

    let proxy_outbound = json!({
        "type": "socks",
        "tag": "proxy",
        "server": "127.0.0.1",
        "server_port": socks_port,
        "version": "5"
    });

    let direct_outbound = json!({
        "type": "direct",
        "tag": "direct"
    });

    // Route rules: tun_singbox_rules + ProtectCore process_path + sniff/DNS hijack
    let mut rules = vec![
        json!({
            "network": "udp",
            "port": [135, 137, 138, 139, 5353],
            "action": "reject"
        }),
        json!({
            "ip_cidr": ["224.0.0.0/3", "ff00::/8"],
            "action": "reject"
        }),
    ];

    if !process_paths.is_empty() {
        rules.push(json!({
            "port": [53],
            "action": "hijack-dns",
            "process_path": process_paths
        }));
        rules.push(json!({
            "outbound": "direct",
            "process_path": process_paths
        }));
    }

    rules.push(json!({ "action": "sniff" }));
    rules.push(json!({
        "type": "logical",
        "mode": "or",
        "action": "hijack-dns",
        "rules": [
            { "port": [53] },
            { "protocol": ["dns"] }
        ]
    }));

    json!({
        "log": {
            "level": "warn",
            "timestamp": true
        },
        "dns": {
            "servers": [
                {
                    "tag": "remote_dns",
                    "type": "udp",
                    "server": "8.8.8.8",
                    "detour": "proxy"
                },
                {
                    "tag": "local_dns",
                    "type": "udp",
                    "server": "223.5.5.5"
                },
                {
                    "tag": "direct_dns",
                    "type": "udp",
                    "server": "223.5.5.5",
                    "domain_resolver": "local_dns"
                }
            ],
            "final": "remote_dns",
            "independent_cache": true,
            "strategy": "prefer_ipv4"
        },
        "inbounds": [tun_inbound],
        "outbounds": [proxy_outbound, direct_outbound],
        "route": {
            "auto_detect_interface": true,
            "default_domain_resolver": {
                "server": "direct_dns",
                "strategy": "prefer_ipv4"
            },
            "final": "proxy",
            "rules": rules
        }
    })
}

/// Collect absolute paths of core binaries next to the app / in bin dirs for process_path protect.
pub fn collect_protect_paths(extra_dirs: &[PathBuf]) -> Vec<String> {
    let mut out = Vec::new();
    let names = [
        "xray.exe",
        "xray",
        "xray-x86_64-pc-windows-msvc.exe",
        "sing-box.exe",
        "sing-box",
        "sing-box-x86_64-pc-windows-msvc.exe",
    ];

    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.to_path_buf());
        }
    }
    dirs.extend(extra_dirs.iter().cloned());

    for dir in dirs {
        for name in names {
            let p = dir.join(name);
            if p.is_file() {
                let s = p.to_string_lossy().to_string();
                if !out.iter().any(|x| x == &s) {
                    out.push(s);
                }
            }
        }
    }
    out
}
