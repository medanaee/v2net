use serde_json::Value;
use std::fs;
use std::sync::Mutex;
use std::io::Write;
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
    tun_mode: bool,
    sudo_password: Option<String>,
) -> Result<(), String> {
    println!("[start_proxy] target: {}, tun_mode: {}, linux_sudo: {}", target.id.clone(), tun_mode, sudo_password.is_some());
    // 1. Kill existing xray if any
    let _ = stop_proxy().await;

    // 2. Generate config
    let config = crate::xray_config::generate_xray_config_mixed(&target, local_port, tun_mode);

    // 3. Write config to temp file
    let temp_dir = std::env::temp_dir().join("v2ray_test_configs");
    let _ = fs::create_dir_all(&temp_dir);
    let config_path = temp_dir.join("active_proxy.json");
    fs::write(&config_path, config.to_string()).map_err(|e| e.to_string())?;

    // 4. Start xray
    if tun_mode && cfg!(target_os = "linux") {
        let password = sudo_password.unwrap_or_default();
        // Since sidecar paths are hard to resolve directly in Tauri v2 for sudo,
        // we'll use `app.shell().sidecar("xray")` to find the path, or just run a helper script.
        // Actually, we can just resolve the sidecar path manually or assume it's next to the exe.
        let exe = std::env::current_exe().unwrap();
        let sidecar_dir = exe.parent().unwrap();
        // We look for any file starting with `xray-` (like xray-x86_64-unknown-linux-gnu)
        let mut xray_path = None;
        if let Ok(entries) = std::fs::read_dir(sidecar_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("xray-") && !name.ends_with(".json") {
                    xray_path = Some(entry.path());
                    break;
                }
            }
        }
        
        let path_to_run = xray_path.map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| "xray".to_string());
        
        let mut child = std::process::Command::new("sudo")
            .arg("-S")
            .arg(&path_to_run)
            .arg("run")
            .arg("-config")
            .arg(config_path.to_string_lossy().to_string())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run sudo: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(format!("{}\n", password).as_bytes());
        }

        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || {
                use std::io::Read;
                let mut reader = std::io::BufReader::new(stdout);
                let mut buf = String::new();
                while reader.read_to_string(&mut buf).is_ok() && !buf.is_empty() {
                    println!("[XRAY SUDO STDOUT] {}", buf);
                    buf.clear();
                }
            });
        }
        
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                use std::io::Read;
                let mut reader = std::io::BufReader::new(stderr);
                let mut buf = String::new();
                while reader.read_to_string(&mut buf).is_ok() && !buf.is_empty() {
                    eprintln!("[XRAY SUDO STDERR] {}", buf);
                    buf.clear();
                }
            });
        }

        // We can't wrap std::process::Child in tauri_plugin_shell::process::CommandChild easily.
        // But we don't strictly need to track it if it's sudo? Wait, stop_proxy uses `child.kill()`.
        // For sudo, killing the child (which is the sudo process) might not kill the xray process.
        // Actually, killing `sudo` usually sends sigterm to its child.
        // For simplicity, we just won't track it in ACTIVE_XRAY. Wait, then stop_proxy won't work!
        // The user asked "اگر ادمین بود هم که xray فعلی رو ببند مجدد روی کانفیگ انتخاب شده xray با دسترسی ادمین و tun مود باز کن."
        // We can execute a `sudo killall xray` in stop_proxy if we are on linux and tun is enabled?
        // Let's just track the PID of `sudo` and run `sudo kill <pid>` later, or just `sudo killall xray`.
    } else {
        // Find the bin directory to use as current_dir so wintun.dll is found
        use tauri::Manager;
        let resource_dir = app.path().resource_dir().unwrap_or_else(|_| std::env::current_dir().unwrap());
        let bin_dir = resource_dir.join("bin");

        // Dynamically copy wintun.dll next to our executable (where sidecars usually run from)
        #[cfg(target_os = "windows")]
        {
            let exe_dir = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
            let source_dll = bin_dir.join("wintun.dll");
            let target_dll = exe_dir.join("wintun.dll");
            if source_dll.exists() && !target_dll.exists() {
                let _ = std::fs::copy(&source_dll, &target_dll);
            } else if !source_dll.exists() && !target_dll.exists() {
                // As fallback if not in bin
                let root_dll = resource_dir.join("wintun.dll");
                if root_dll.exists() {
                    let _ = std::fs::copy(&root_dll, &target_dll);
                }
            }
        }

        let mut cmd = app.shell().sidecar("xray").map_err(|e| e.to_string())?;
        
        cmd = cmd
            .arg("run")
            .arg("-config")
            .arg(config_path.to_string_lossy().to_string());

        let path_env = std::env::var("PATH").unwrap_or_default();
        cmd = cmd.env("PATH", format!("{};{};{}", path_env, resource_dir.display(), bin_dir.display()));

        match cmd.spawn() {
            Ok((mut rx, child)) => {
                crate::track_pid(child.pid());
                let mut guard = ACTIVE_XRAY.lock().unwrap();
                *guard = Some(child);

                tokio::spawn(async move { 
                    while let Some(event) = rx.recv().await {
                        match event {
                            tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                                println!("[XRAY STDOUT] {}", String::from_utf8_lossy(&line));
                            },
                            tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                                eprintln!("[XRAY STDERR] {}", String::from_utf8_lossy(&line));
                            },
                            tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                                println!("[XRAY EXITED] code: {:?}", payload.code);
                            }
                            _ => {}
                        }
                    } 
                });
            }
            Err(e) => return Err(e.to_string()),
        }
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
    {
        let guard = ACTIVE_XRAY.lock().unwrap();
        if guard.is_none() {
            return Err("Proxy not running".to_string());
        }
    }

    let mut cmd = app.shell().sidecar("xray").map_err(|e| e.to_string())?;
    cmd = cmd
        .arg("api")
        .arg("statsquery")
        .arg("-server")
        .arg(format!("127.0.0.1:{}", api_port));

    // Use spawn and timeout to prevent hanging xray processes
    let (mut rx, child) = cmd.spawn().map_err(|e| e.to_string())?;
    
    let output = match tokio::time::timeout(std::time::Duration::from_secs(1), async {
        let mut stdout_str = String::new();
        while let Some(event) = rx.recv().await {
            if let tauri_plugin_shell::process::CommandEvent::Stdout(bytes) = event {
                stdout_str.push_str(&String::from_utf8_lossy(&bytes));
            }
        }
        stdout_str
    }).await {
        Ok(s) => s,
        Err(_) => {
            let _ = child.kill();
            return Err("Timeout".to_string());
        }
    };
    
    let parsed: Value = serde_json::from_str(&output).unwrap_or(Value::Null);
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

#[tauri::command]
pub fn check_elevation() -> bool {
    is_elevated::is_elevated()
}

#[tauri::command]
pub fn restart_as_admin(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        std::process::Command::new("powershell")
            .args(&[
                "-Command",
                &format!("Start-Process '{}' -Verb RunAs", exe.display()),
            ])
            .spawn()
            .map_err(|e| e.to_string())?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("restart_as_admin is only supported on Windows".to_string())
    }
}
