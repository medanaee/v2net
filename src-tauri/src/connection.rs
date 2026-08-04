use serde_json::Value;
use std::fs;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use sysproxy::Sysproxy;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::tester::TestTarget;

static ACTIVE_XRAY: Mutex<Option<tauri_plugin_shell::process::CommandChild>> = Mutex::new(None);

#[tauri::command]
pub async fn start_proxy(
    app: AppHandle,
    target: TestTarget,
    local_port: u16,
    system_proxy_mode: String,
) -> Result<(), String> {
    // 1. Kill existing xray if any
    let _ = stop_proxy().await;

    // 2. Generate config
    let config = crate::xray_config::generate_xray_config_mixed(&target, local_port);

    // 3. Write config to temp file
    let temp_dir = std::env::temp_dir().join("v2ray_test_configs");
    let _ = fs::create_dir_all(&temp_dir);
    let config_path = temp_dir.join("active_proxy.json");
    fs::write(&config_path, config.to_string()).map_err(|e| e.to_string())?;

    // 4. Start xray
    let mut cmd = app.shell().sidecar("xray").map_err(|e| e.to_string())?;
    cmd = cmd
        .arg("run")
        .arg("-config")
        .arg(config_path.to_string_lossy().to_string());

    match cmd.spawn() {
        Ok((mut rx, child)) => {
            crate::track_pid(child.pid());
            let mut guard = ACTIVE_XRAY.lock().unwrap();
            *guard = Some(child);

            tokio::spawn(async move { while let Some(_) = rx.recv().await {} });
        }
        Err(e) => return Err(e.to_string()),
    }

    // 5. Update system proxy
    update_system_proxy(system_proxy_mode, local_port)?;

    Ok(())
}

#[tauri::command]
pub async fn stop_proxy() -> Result<(), String> {
    let mut guard = ACTIVE_XRAY.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }

    let sysproxy = Sysproxy {
        enable: false,
        host: "127.0.0.1".to_string(),
        port: 10808, 
        bypass: "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*".to_string(),
    };
    let _ = sysproxy.set_system_proxy();
    Ok(())
}

#[tauri::command]
pub async fn set_system_proxy_mode(mode: String, port: u16) -> Result<(), String> {
    update_system_proxy(mode, port)
}

fn update_system_proxy(mode: String, port: u16) -> Result<(), String> {
    let mut sysproxy = Sysproxy {
        enable: false,
        host: "127.0.0.1".to_string(),
        port,
        bypass: "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*".to_string(),
    };

    if mode == "set" {
        sysproxy.enable = true;
        sysproxy.set_system_proxy().map_err(|e| e.to_string())?;
    } else if mode == "clear" {
        sysproxy.enable = false;
        sysproxy.set_system_proxy().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Default)]
pub struct ProxyStats {
    pub uplink: u64,
    pub downlink: u64,
}

#[tauri::command]
pub async fn get_proxy_stats(app: AppHandle, api_port: u16) -> Result<ProxyStats, String> {
    let mut cmd = app.shell().sidecar("xray").map_err(|e| e.to_string())?;
    cmd = cmd
        .arg("api")
        .arg("statsquery")
        .arg("-server")
        .arg(format!("127.0.0.1:{}", api_port));

    let output = cmd.output().await.map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    
    let parsed: Value = serde_json::from_str(&stdout).unwrap_or(Value::Null);
    let mut stats = ProxyStats::default();

    if let Some(stat_array) = parsed.get("stat").and_then(|v| v.as_array()) {
        for item in stat_array {
            if let (Some(name), Some(value)) = (item.get("name").and_then(|v| v.as_str()), item.get("value").and_then(|v| v.as_u64())) {
                if name == "outbound>>>proxy>>>traffic>>>uplink" {
                    stats.uplink = value;
                } else if name == "outbound>>>proxy>>>traffic>>>downlink" {
                    stats.downlink = value;
                }
            }
        }
    }

    Ok(stats)
}
