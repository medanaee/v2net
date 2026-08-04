use serde_json::Value;
use std::fs;
use std::sync::Mutex;
#[cfg(target_os = "linux")]
use std::io::Write;
use serde::{Deserialize, Serialize};
use sysproxy::Sysproxy;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::tester::TestTarget;

static ACTIVE_XRAY: Mutex<Option<tauri_plugin_shell::process::CommandChild>> = Mutex::new(None);
static TUN_ACTIVE: Mutex<bool> = Mutex::new(false);
static TUN_SERVER_IP: Mutex<Option<String>> = Mutex::new(None);
/// v2rayN CoreAdminManager: track sudo-launched core PID + password for kill_as_sudo.
#[cfg(target_os = "linux")]
static LINUX_SUDO_PWD: Mutex<Option<String>> = Mutex::new(None);
#[cfg(target_os = "linux")]
static LINUX_SUDO_PID: Mutex<Option<u32>> = Mutex::new(None);
#[cfg(target_os = "linux")]
static LINUX_SUDO_CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);

/// Same approach as v2rayN WindowsUtils.RemoveTunDevice.
/// Stale Wintun adapters stay up without routes and break the next TUN start.
#[cfg(target_os = "windows")]
fn remove_tun_device() {
    use std::os::windows::process::CommandExt;
    let script = r#"
$names = @('xray_tun','wintunsingbox_tun')
foreach ($n in $names) {
  try {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $sum = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($n))
    $guid = New-Object Guid(,$sum)
    $id = 'SWD\Wintun\{' + $guid.ToString() + '}'
    & "$env:SystemRoot\System32\pnputil.exe" /remove-device $id 2>$null | Out-Null
  } catch {}
}
"#;
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .status();
}

#[cfg(not(target_os = "windows"))]
fn remove_tun_device() {}

/// Detect the physical default-route NIC (skip WSL/Hyper-V/Wintun/loopback).
#[cfg(target_os = "windows")]
fn detect_physical_bind() -> Option<crate::xray_config::TunBindInfo> {
    use std::os::windows::process::CommandExt;
    let script = r#"
$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -notmatch 'xray|Wintun|Loopback|WSL|vEthernet|Hyper-V|Virtual|Docker|Npc' } |
  Sort-Object RouteMetric, InterfaceMetric |
  Select-Object -First 1
if (-not $r) { exit 0 }
$ip = Get-NetIPAddress -InterfaceIndex $r.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '169.254*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
if (-not $ip) { exit 0 }
Write-Output ($r.InterfaceAlias + '|' + $ip + '|' + $r.NextHop)
"#;
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return None;
    }
    let mut parts = text.split('|');
    let iface = parts.next()?.trim().to_string();
    let ip = parts.next()?.trim().to_string();
    let gateway = parts.next().unwrap_or("").trim().to_string();
    if iface.is_empty() || ip.is_empty() {
        return None;
    }
    println!(
        "[tun] physical bind: iface={}, ip={}, gateway={}",
        iface, ip, gateway
    );
    Some(crate::xray_config::TunBindInfo {
        interface_name: iface,
        local_ip: ip,
    })
}

/// Linux: parse `ip route get` like v2rayN physical egress selection.
#[cfg(target_os = "linux")]
fn detect_physical_bind() -> Option<crate::xray_config::TunBindInfo> {
    let output = std::process::Command::new("ip")
        .args(["-4", "route", "get", "1.1.1.1"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    // e.g. "1.1.1.1 via 192.168.1.1 dev eth0 src 192.168.1.10 uid 1000"
    let mut iface = None;
    let mut ip = None;
    let mut gateway = None;
    let mut words = text.split_whitespace().peekable();
    while let Some(w) = words.next() {
        match w {
            "dev" => iface = words.next().map(|s| s.to_string()),
            "src" => ip = words.next().map(|s| s.to_string()),
            "via" => gateway = words.next().map(|s| s.to_string()),
            _ => {}
        }
    }
    let iface = iface.filter(|s| {
        let lower = s.to_lowercase();
        !lower.starts_with("xray")
            && !lower.starts_with("tun")
            && !lower.starts_with("docker")
            && !lower.starts_with("veth")
            && !lower.starts_with("br-")
            && lower != "lo"
    })?;
    let ip = ip?;
    println!(
        "[tun] physical bind: iface={}, ip={}, gateway={}",
        iface,
        ip,
        gateway.as_deref().unwrap_or("")
    );
    Some(crate::xray_config::TunBindInfo {
        interface_name: iface,
        local_ip: ip,
    })
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn detect_physical_bind() -> Option<crate::xray_config::TunBindInfo> {
    None
}

#[cfg(target_os = "linux")]
fn linux_sudo_password() -> Option<String> {
    LINUX_SUDO_PWD.lock().ok().and_then(|g| g.clone())
}

#[cfg(target_os = "linux")]
fn run_as_root_shell(script: &str) {
    if is_elevated::is_elevated() {
        let _ = std::process::Command::new("bash")
            .args(["-c", script])
            .status();
        return;
    }
    if let Some(password) = linux_sudo_password() {
        let mut child = match std::process::Command::new("sudo")
            .args(["-S", "bash", "-c", script])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[tun] sudo shell failed: {}", e);
                return;
            }
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(format!("{}\n", password).as_bytes());
        }
        let _ = child.wait();
    } else {
        // Best-effort without password (NOPASSWD sudo)
        let _ = std::process::Command::new("sudo")
            .args(["-n", "bash", "-c", script])
            .status();
    }
}

/// Force proxy-server /32 out the physical gateway so TUN cannot black-hole the uplink.
#[cfg(target_os = "windows")]
fn ensure_proxy_host_route(server_ip: &str) {
    use std::os::windows::process::CommandExt;
    if server_ip.parse::<std::net::Ipv4Addr>().is_err() {
        return;
    }
    let script = format!(
        r#"
$server = '{server}'
$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
  Where-Object {{ $_.InterfaceAlias -notmatch 'xray|Wintun|Loopback|WSL|vEthernet|Hyper-V|Virtual|Docker|vbox' }} |
  Sort-Object RouteMetric, InterfaceMetric |
  Select-Object -First 1
if (-not $r) {{ exit 0 }}
try {{
  Remove-NetRoute -DestinationPrefix ($server + '/32') -Confirm:$false -ErrorAction SilentlyContinue
}} catch {{}}
New-NetRoute -DestinationPrefix ($server + '/32') -InterfaceIndex $r.InterfaceIndex -NextHop $r.NextHop -RouteMetric 1 -ErrorAction SilentlyContinue | Out-Null
"#,
        server = server_ip
    );
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x08000000)
        .status();
}

#[cfg(target_os = "linux")]
fn ensure_proxy_host_route(server_ip: &str) {
    if server_ip.parse::<std::net::Ipv4Addr>().is_err() {
        return;
    }
    // Keep uplink to proxy server on the physical default route.
    let script = format!(
        r#"
set -e
GW=$(ip -4 route show default | awk '/default/ {{print $3; exit}}')
DEV=$(ip -4 route show default | awk '/default/ {{print $5; exit}}')
if [ -z "$GW" ] || [ -z "$DEV" ]; then exit 0; fi
ip -4 route replace {server}/32 via "$GW" dev "$DEV"
"#,
        server = server_ip
    );
    run_as_root_shell(&script);
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn ensure_proxy_host_route(_server_ip: &str) {}

#[cfg(target_os = "windows")]
fn clear_proxy_host_route(server_ip: &str) {
    use std::os::windows::process::CommandExt;
    if server_ip.parse::<std::net::Ipv4Addr>().is_err() {
        return;
    }
    let script = format!(
        "Remove-NetRoute -DestinationPrefix '{}/32' -Confirm:$false -ErrorAction SilentlyContinue",
        server_ip
    );
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x08000000)
        .status();
}

#[cfg(target_os = "linux")]
fn clear_proxy_host_route(server_ip: &str) {
    if server_ip.parse::<std::net::Ipv4Addr>().is_err() {
        return;
    }
    let script = format!("ip -4 route del {}/32 2>/dev/null || true", server_ip);
    run_as_root_shell(&script);
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn clear_proxy_host_route(_server_ip: &str) {}

/// Force Windows to prefer xray_tun for internet traffic after the adapter is up.
/// Xray's autoSystemRoutingTable alone can lose to Wi-Fi interface metric.
#[cfg(target_os = "windows")]
fn ensure_tun_routes() {
    use std::os::windows::process::CommandExt;
    let script = r#"
$alias = 'xray_tun'
$deadline = (Get-Date).AddSeconds(5)
while ((Get-Date) -lt $deadline) {
  $if = Get-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue
  if ($if) { break }
  Start-Sleep -Milliseconds 200
}
if (-not (Get-NetAdapter -Name $alias -ErrorAction SilentlyContinue)) {
  Write-Output 'tun_missing'
  exit 0
}
try {
  Set-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4 -InterfaceMetric 1 -ErrorAction SilentlyContinue
} catch {}
$idx = (Get-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue).InterfaceIndex
if (-not $idx) { exit 0 }
foreach ($prefix in @('0.0.0.0/1','128.0.0.0/1')) {
  try {
    Remove-NetRoute -DestinationPrefix $prefix -InterfaceIndex $idx -Confirm:$false -ErrorAction SilentlyContinue
  } catch {}
  try {
    New-NetRoute -DestinationPrefix $prefix -InterfaceIndex $idx -NextHop '0.0.0.0' -RouteMetric 1 -ErrorAction SilentlyContinue | Out-Null
  } catch {
    # Fallback: route.exe on-link style
    $ifNum = $idx
    if ($prefix -eq '0.0.0.0/1') {
      & route.exe add 0.0.0.0 mask 128.0.0.0 0.0.0.0 metric 1 if $ifNum | Out-Null
    } else {
      & route.exe add 128.0.0.0 mask 128.0.0.0 0.0.0.0 metric 1 if $ifNum | Out-Null
    }
  }
}
Write-Output ("tun_routes_ok if=" + $idx)
"#;
    match std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000)
        .output()
    {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !text.is_empty() {
                println!("[tun] {}", text);
            }
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if !err.is_empty() {
                eprintln!("[tun] route stderr: {}", err);
            }
        }
        Err(e) => eprintln!("[tun] ensure_tun_routes failed: {}", e),
    }
}

#[cfg(target_os = "linux")]
fn ensure_tun_routes() {
    let script = r#"
for i in $(seq 1 25); do
  ip link show xray_tun >/dev/null 2>&1 && break
  sleep 0.2
done
if ! ip link show xray_tun >/dev/null 2>&1; then
  echo tun_missing
  exit 0
fi
ip -4 route replace 0.0.0.0/1 dev xray_tun
ip -4 route replace 128.0.0.0/1 dev xray_tun
echo tun_routes_ok
"#;
    run_as_root_shell(script);
    println!("[tun] linux ensure_tun_routes done");
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn ensure_tun_routes() {}

#[cfg(target_os = "windows")]
fn clear_tun_split_routes() {
    use std::os::windows::process::CommandExt;
    let script = r#"
foreach ($prefix in @('0.0.0.0/1','128.0.0.0/1')) {
  Get-NetRoute -DestinationPrefix $prefix -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -eq 'xray_tun' } |
    ForEach-Object {
      Remove-NetRoute -DestinationPrefix $_.DestinationPrefix -InterfaceIndex $_.InterfaceIndex -Confirm:$false -ErrorAction SilentlyContinue
    }
}
"#;
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000)
        .status();
}

#[cfg(target_os = "linux")]
fn clear_tun_split_routes() {
    run_as_root_shell(
        r#"
ip -4 route del 0.0.0.0/1 dev xray_tun 2>/dev/null || true
ip -4 route del 128.0.0.0/1 dev xray_tun 2>/dev/null || true
"#,
    );
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn clear_tun_split_routes() {}

/// Same idea as v2rayN Sample/kill_as_sudo_linux_sh — kill sudo tree by PID.
#[cfg(target_os = "linux")]
fn kill_linux_sudo_process_tree(pid: u32) {
    let script = format!(
        r#"
PID={pid}
if ! ps -p "$PID" >/dev/null 2>&1; then exit 0; fi
kill_children() {{
  local parent=$1
  local children
  children=$(ps -o pid= --ppid "$parent" 2>/dev/null || true)
  for child in $children; do
    kill_children "$child"
    kill -9 "$child" 2>/dev/null || true
  done
}}
kill -15 "$PID" 2>/dev/null || true
sleep 1
if ps -p "$PID" >/dev/null 2>&1; then
  kill_children "$PID"
  kill -9 "$PID" 2>/dev/null || true
fi
"#,
        pid = pid
    );
    run_as_root_shell(&script);
}

#[cfg(target_os = "linux")]
fn stop_linux_sudo_xray() {
    if let Ok(mut child_guard) = LINUX_SUDO_CHILD.lock() {
        if let Some(mut child) = child_guard.take() {
            let pid = child.id();
            kill_linux_sudo_process_tree(pid);
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut pid_guard) = LINUX_SUDO_PID.lock() {
        if let Some(pid) = pid_guard.take() {
            kill_linux_sudo_process_tree(pid);
        }
    }
    // Fallback: kill leftover xray cores started via sudo
    run_as_root_shell("pkill -9 -x xray 2>/dev/null || true; pkill -9 -f 'xray.*run -config' 2>/dev/null || true");
    if let Ok(mut pwd) = LINUX_SUDO_PWD.lock() {
        *pwd = None;
    }
}

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

    // Stale Wintun adapters block autoSystemRoutingTable on the next start
    let tun_bind = if tun_mode {
        remove_tun_device();
        // Give Windows a moment to finish device removal
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        detect_physical_bind()
    } else {
        None
    };

    // 2. Generate config
    let config = crate::xray_config::generate_xray_config_mixed_with_bind(
        &target,
        local_port,
        tun_mode,
        tun_bind,
    );

    // 3. Write config to temp file
    let temp_dir = std::env::temp_dir().join("v2ray_test_configs");
    let _ = fs::create_dir_all(&temp_dir);
    let config_path = temp_dir.join("active_proxy.json");
    fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap_or_else(|_| config.to_string()))
        .map_err(|e| e.to_string())?;
    println!("[start_proxy] config written to {}", config_path.display());

    // 4. Start xray
    #[cfg(target_os = "linux")]
    let started_linux_sudo = if tun_mode {
        // Mirror v2rayN CoreAdminManager.RunProcessAsLinuxSudo
        let password = sudo_password.clone().unwrap_or_default();
        if !password.is_empty() {
            if let Ok(mut pwd) = LINUX_SUDO_PWD.lock() {
                *pwd = Some(password.clone());
            }
        }

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let sidecar_dir = exe.parent().ok_or("no exe dir")?;
        let mut xray_path = None;
        if let Ok(entries) = std::fs::read_dir(sidecar_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if (name == "xray" || name.starts_with("xray-")) && !name.ends_with(".json") {
                    xray_path = Some(entry.path());
                    break;
                }
            }
        }
        let path_to_run = xray_path
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "xray".to_string());

        let already_root = is_elevated::is_elevated();
        let mut child = if already_root {
            std::process::Command::new(&path_to_run)
                .arg("run")
                .arg("-config")
                .arg(config_path.to_string_lossy().to_string())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to run xray: {}", e))?
        } else {
            let mut child = std::process::Command::new("sudo")
                .arg("-S")
                .arg("--")
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
            child
        };

        let pid = child.id();
        crate::track_pid(pid);
        if let Ok(mut guard) = LINUX_SUDO_PID.lock() {
            *guard = Some(pid);
        }

        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stdout);
                for line in reader.lines().flatten() {
                    println!("[XRAY SUDO STDOUT] {}", line);
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    eprintln!("[XRAY SUDO STDERR] {}", line);
                }
            });
        }

        if let Ok(mut guard) = LINUX_SUDO_CHILD.lock() {
            *guard = Some(child);
        }
        true
    } else {
        false
    };
    #[cfg(not(target_os = "linux"))]
    let started_linux_sudo = false;
    #[cfg(not(target_os = "linux"))]
    let _ = sudo_password;

    if !started_linux_sudo {
        // Find the bin directory to use as current_dir so wintun.dll is found
        use tauri::Manager;
        let resource_dir = app.path().resource_dir().unwrap_or_else(|_| std::env::current_dir().unwrap());
        let bin_dir = resource_dir.join("bin");

        // wintun.dll must sit next to the sidecar executable
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));

        #[cfg(target_os = "windows")]
        {
            let target_dll = exe_dir.join("wintun.dll");
            let candidates = [
                bin_dir.join("wintun.dll"),
                resource_dir.join("wintun.dll"),
                resource_dir.join("bin").join("wintun.dll"),
            ];
            for source_dll in candidates {
                if source_dll.exists() {
                    let _ = std::fs::copy(&source_dll, &target_dll);
                    break;
                }
            }
        }

        let mut cmd = app.shell().sidecar("xray").map_err(|e| e.to_string())?;

        cmd = cmd
            .current_dir(&exe_dir)
            .arg("run")
            .arg("-config")
            .arg(config_path.to_string_lossy().to_string());

        let path_env = std::env::var("PATH").unwrap_or_default();
        #[cfg(target_os = "windows")]
        {
            cmd = cmd.env(
                "PATH",
                format!("{};{};{}", exe_dir.display(), bin_dir.display(), path_env),
            );
        }
        #[cfg(not(target_os = "windows"))]
        {
            cmd = cmd.env(
                "PATH",
                format!("{}:{}:{}", exe_dir.display(), bin_dir.display(), path_env),
            );
        }

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
                            }
                            tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                                eprintln!("[XRAY STDERR] {}", String::from_utf8_lossy(&line));
                            }
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

    if let Ok(mut tun_active) = TUN_ACTIVE.lock() {
        *tun_active = tun_mode;
    }

    if tun_mode {
        // Host route must exist before/with TUN default route or uplink loops into itself.
        ensure_proxy_host_route(&target.address);
        if let Ok(mut guard) = TUN_SERVER_IP.lock() {
            *guard = Some(target.address.clone());
        }
        // Wait for adapter, force split default routes, re-assert host route.
        let server_ip = target.address.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            ensure_tun_routes();
            ensure_proxy_host_route(&server_ip);
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            ensure_tun_routes();
            ensure_proxy_host_route(&server_ip);
        });
    } else if let Ok(mut guard) = TUN_SERVER_IP.lock() {
        *guard = None;
    }

    // Keep user's system-proxy preference (do not clear when TUN is on).
    update_system_proxy(system_proxy_mode, local_port)?;

    Ok(())
}

#[tauri::command]
pub async fn stop_proxy() -> Result<(), String> {
    let was_tun = {
        let mut tun_active = TUN_ACTIVE.lock().unwrap();
        let v = *tun_active;
        *tun_active = false;
        v
    };

    {
        let mut guard = ACTIVE_XRAY.lock().unwrap();
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }

    // v2rayN CoreAdminManager.KillProcessAsLinuxSudo
    #[cfg(target_os = "linux")]
    {
        stop_linux_sudo_xray();
    }

    if was_tun {
        if let Ok(mut guard) = TUN_SERVER_IP.lock() {
            if let Some(ip) = guard.take() {
                clear_proxy_host_route(&ip);
            }
        }
        clear_tun_split_routes();
        // Wait for xray to release the adapter, then remove it
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        remove_tun_device();
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
