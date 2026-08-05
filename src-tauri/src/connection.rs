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
static ACTIVE_SINGBOX: Mutex<Option<tauri_plugin_shell::process::CommandChild>> = Mutex::new(None);
static TUN_ACTIVE: Mutex<bool> = Mutex::new(false);
/// Serialize start/stop so right-click reconnect cannot race (port-in-use / app flap).
static PROXY_OP: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// `is_elevated` crate is Windows-only; on Unix treat euid 0 as elevated/root.
fn process_is_elevated() -> bool {
    #[cfg(windows)]
    {
        is_elevated::is_elevated()
    }
    #[cfg(unix)]
    {
        unsafe { libc::geteuid() == 0 }
    }
    #[cfg(not(any(windows, unix)))]
    {
        false
    }
}

/// v2rayN CoreAdminManager: track sudo-launched sing-box PID + password for kill_as_sudo.
#[cfg(target_os = "linux")]
static LINUX_SUDO_PWD: Mutex<Option<String>> = Mutex::new(None);
#[cfg(target_os = "linux")]
static LINUX_SUDO_PID: Mutex<Option<u32>> = Mutex::new(None);
#[cfg(target_os = "linux")]
static LINUX_SUDO_CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);

/// Same approach as v2rayN WindowsUtils.RemoveTunDevice.
/// Do NOT Disable-NetAdapter here — that flaps the whole network and feels like an app reset.
#[cfg(target_os = "windows")]
fn remove_tun_device() {
    use std::os::windows::process::CommandExt;
    let script = r#"
$names = @('wintunsingbox_tun','singbox_tun','xray_tun')
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
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

#[cfg(not(target_os = "windows"))]
fn remove_tun_device() {}

#[cfg(target_os = "windows")]
fn force_kill_pid(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string(), "/T"])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

#[cfg(target_os = "windows")]
fn force_kill_image(image: &str) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/IM", image, "/T"])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

/// Kill every known sidecar image / process name (Windows + Linux).
/// Safe to call during quit or before elevated relaunch.
pub fn force_kill_all_sidecars() {
    #[cfg(target_os = "windows")]
    {
        for image in [
            "xray.exe",
            "xray-x86_64-pc-windows-msvc.exe",
            "sing-box.exe",
            "sing-box-x86_64-pc-windows-msvc.exe",
        ] {
            force_kill_image(image);
        }
    }
    #[cfg(target_os = "linux")]
    {
        stop_linux_sudo_singbox();
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-x", "xray"])
            .status();
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-f", "xray.*run"])
            .status();
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-x", "sing-box"])
            .status();
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-f", "sing-box.*run"])
            .status();
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {}
}

#[cfg(target_os = "windows")]
fn process_image_running(image: &str) -> bool {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {}", image), "/NH"])
        .creation_flags(0x08000000)
        .output();
    match output {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            text.contains(&image.to_lowercase())
        }
        Err(_) => false,
    }
}

fn tun_front_running() -> bool {
    let flagged = TUN_ACTIVE.lock().map(|g| *g).unwrap_or(false);
    if !flagged {
        return false;
    }
    let has_child = ACTIVE_SINGBOX.lock().map(|g| g.is_some()).unwrap_or(false);
    #[cfg(target_os = "windows")]
    {
        has_child
            || process_image_running("sing-box.exe")
            || process_image_running("sing-box-x86_64-pc-windows-msvc.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        has_child
    }
}

async fn wait_port_free(port: u16, timeout_ms: u64) -> Result<(), String> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    loop {
        match std::net::TcpListener::bind(addr) {
            Ok(listener) => {
                drop(listener);
                return Ok(());
            }
            Err(_) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(format!("Port {} still in use after stop", port));
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        }
    }
}

async fn stop_xray_only() {
    let xray_pid = {
        let mut guard = ACTIVE_XRAY.lock().unwrap();
        guard.take().map(|child| {
            let pid = child.pid();
            let _ = child.kill();
            pid
        })
    };
    #[cfg(target_os = "windows")]
    {
        if let Some(pid) = xray_pid {
            force_kill_pid(pid);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = xray_pid;
    }
}

#[cfg(target_os = "linux")]
fn linux_sudo_password() -> Option<String> {
    LINUX_SUDO_PWD.lock().ok().and_then(|g| g.clone())
}

#[cfg(target_os = "linux")]
fn run_as_root_shell(script: &str) {
    if process_is_elevated() {
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
        let _ = std::process::Command::new("sudo")
            .args(["-n", "bash", "-c", script])
            .status();
    }
}

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
fn stop_linux_sudo_singbox() {
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
    run_as_root_shell(
        "pkill -9 -x sing-box 2>/dev/null || true; pkill -9 -f 'sing-box.*run -c' 2>/dev/null || true",
    );
    // Keep LINUX_SUDO_PWD for the session (v2rayN keeps LinuxSudoPwd in memory).
}

fn ensure_wintun_dll(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        let resource_dir = app
            .path()
            .resource_dir()
            .unwrap_or_else(|_| std::env::current_dir().unwrap());
        let bin_dir = resource_dir.join("bin");
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));

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
    let _ = app;
}

fn sidecar_workdir(app: &AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap());
    let bin_dir = resource_dir.join("bin");
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));
    let _ = bin_dir;
    exe_dir
}

async fn spawn_sidecar(
    app: &AppHandle,
    name: &str,
    args: &[&str],
    log_prefix: &'static str,
) -> Result<tauri_plugin_shell::process::CommandChild, String> {
    let exe_dir = sidecar_workdir(app);
    let bin_dir = {
        use tauri::Manager;
        app.path()
            .resource_dir()
            .unwrap_or_else(|_| std::env::current_dir().unwrap())
            .join("bin")
    };

    let mut cmd = app.shell().sidecar(name).map_err(|e| e.to_string())?;
    cmd = cmd.current_dir(&exe_dir);
    for a in args {
        cmd = cmd.arg(*a);
    }

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

    let (mut rx, child) = cmd.spawn().map_err(|e| e.to_string())?;
    crate::track_pid(child.pid());

    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    println!("[{} STDOUT] {}", log_prefix, String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    eprintln!("[{} STDERR] {}", log_prefix, String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                    println!("[{} EXITED] code: {:?}", log_prefix, payload.code);
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

/// v2rayN CoreManager.WaitForProxyPort — SOCKS5 greeting until local port accepts.
async fn wait_for_socks_port(port: u16, timeout_ms: u64) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    let addr = format!("127.0.0.1:{}", port);
    let greeting = [0x05u8, 0x01, 0x00];

    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(format!("Timed out waiting for SOCKS port {}", port));
        }
        match TcpStream::connect(&addr).await {
            Ok(mut stream) => {
                if stream.write_all(&greeting).await.is_ok() {
                    let mut buf = [0u8; 2];
                    if stream.read_exact(&mut buf).await.is_ok() && buf[0] == 0x05 {
                        println!("[start_proxy] socks ready on {}", port);
                        return Ok(());
                    }
                }
            }
            Err(_) => {}
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

#[cfg(target_os = "linux")]
fn find_sidecar_binary(name_prefix: &str) -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let sidecar_dir = exe.parent()?;
    if let Ok(entries) = std::fs::read_dir(sidecar_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if (name == name_prefix || name.starts_with(&format!("{}-", name_prefix)))
                && !name.ends_with(".json")
            {
                return Some(entry.path());
            }
        }
    }
    None
}

/// Start sing-box TUN with sudo on Linux (needs CAP_NET_ADMIN).
#[cfg(target_os = "linux")]
async fn start_singbox_linux_sudo(
    config_path: &std::path::Path,
    sudo_password: Option<String>,
) -> Result<(), String> {
    let already_root = process_is_elevated();
    let password = sudo_password
        .filter(|p| !p.is_empty())
        .or_else(linux_sudo_password)
        .unwrap_or_default();

    if !already_root {
        if password.is_empty() {
            return Err("sudo password required for TUN mode".into());
        }
        crate::linux_sysproxy::verify_sudo_password(&password)?;
        if let Ok(mut pwd) = LINUX_SUDO_PWD.lock() {
            *pwd = Some(password.clone());
        }
    }

    let path_to_run = find_sidecar_binary("sing-box")
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "sing-box".to_string());

    let mut child = if already_root {
        std::process::Command::new(&path_to_run)
            .arg("run")
            .arg("-c")
            .arg(config_path.to_string_lossy().to_string())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run sing-box: {}", e))?
    } else {
        let mut child = std::process::Command::new("sudo")
            .arg("-S")
            .arg("-p")
            .arg("")
            .arg("--")
            .arg(&path_to_run)
            .arg("run")
            .arg("-c")
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

    // Give sudo/sing-box a moment; if auth failed the process exits immediately.
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    match child.try_wait() {
        Ok(Some(status)) => {
            return Err(format!(
                "sing-box/sudo exited early with status {}. Wrong password or missing CAP_NET_ADMIN?",
                status
            ));
        }
        Ok(None) => {}
        Err(e) => return Err(format!("failed to check sing-box process: {e}")),
    }

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
                println!("[SINGBOX SUDO STDOUT] {}", line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                eprintln!("[SINGBOX SUDO STDERR] {}", line);
            }
        });
    }

    if let Ok(mut guard) = LINUX_SUDO_CHILD.lock() {
        *guard = Some(child);
    }
    Ok(())
}

async fn write_and_start_xray(
    app: &AppHandle,
    target: &TestTarget,
    local_port: u16,
) -> Result<(), String> {
    let temp_dir = std::env::temp_dir().join("v2ray_test_configs");
    let _ = fs::create_dir_all(&temp_dir);

    let xray_config =
        crate::xray_config::generate_xray_config_mixed_with_bind(target, local_port, false, None);
    let xray_config_path = temp_dir.join("active_proxy.json");
    fs::write(
        &xray_config_path,
        serde_json::to_string_pretty(&xray_config).unwrap_or_else(|_| xray_config.to_string()),
    )
    .map_err(|e| e.to_string())?;
    println!(
        "[start_proxy] xray config written to {}",
        xray_config_path.display()
    );

    ensure_wintun_dll(app);

    let xray_cfg = xray_config_path.to_string_lossy().to_string();
    let xray_child = spawn_sidecar(app, "xray", &["run", "-config", &xray_cfg], "XRAY").await?;
    {
        let mut guard = ACTIVE_XRAY.lock().unwrap();
        *guard = Some(xray_child);
    }
    Ok(())
}

async fn start_singbox_tun_front(
    app: &AppHandle,
    local_port: u16,
    sudo_password: Option<String>,
) -> Result<(), String> {
    let temp_dir = std::env::temp_dir().join("v2ray_test_configs");
    let exe_dir = sidecar_workdir(app);
    let bin_dir = {
        use tauri::Manager;
        app.path()
            .resource_dir()
            .unwrap_or_else(|_| std::env::current_dir().unwrap())
            .join("bin")
    };
    let protect = crate::singbox_config::collect_protect_paths(&[exe_dir, bin_dir]);
    let sb_config = crate::singbox_config::generate_singbox_tun_config(local_port, &protect);
    let sb_config_path = temp_dir.join("active_singbox_tun.json");
    fs::write(
        &sb_config_path,
        serde_json::to_string_pretty(&sb_config).unwrap_or_else(|_| sb_config.to_string()),
    )
    .map_err(|e| e.to_string())?;
    println!(
        "[start_proxy] sing-box TUN config written to {}",
        sb_config_path.display()
    );

    #[cfg(target_os = "linux")]
    {
        start_singbox_linux_sudo(&sb_config_path, sudo_password).await?;
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = sudo_password;
        let sb_cfg = sb_config_path.to_string_lossy().to_string();
        let sb_child = spawn_sidecar(app, "sing-box", &["run", "-c", &sb_cfg], "SINGBOX").await?;
        let mut guard = ACTIVE_SINGBOX.lock().unwrap();
        *guard = Some(sb_child);
    }

    if let Ok(mut tun_active) = TUN_ACTIVE.lock() {
        *tun_active = true;
    }
    Ok(())
}

async fn stop_proxy_inner(clear_system_proxy: bool, fast: bool) -> Result<(), String> {
    let was_tun = {
        let mut tun_active = TUN_ACTIVE.lock().unwrap();
        let v = *tun_active;
        *tun_active = false;
        v
    };

    // Stop sing-box first (TUN owner), then Xray
    let singbox_pid = {
        let mut guard = ACTIVE_SINGBOX.lock().unwrap();
        guard.take().map(|child| {
            let pid = child.pid();
            let _ = child.kill();
            pid
        })
    };

    #[cfg(target_os = "windows")]
    {
        if let Some(pid) = singbox_pid {
            force_kill_pid(pid);
        }
        if was_tun {
            force_kill_image("sing-box.exe");
            force_kill_image("sing-box-x86_64-pc-windows-msvc.exe");
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = singbox_pid;
    }

    #[cfg(target_os = "linux")]
    {
        stop_linux_sudo_singbox();
    }

    stop_xray_only().await;

    if was_tun {
        if fast {
            // Don't block quit/elevate on Wintun teardown.
            std::thread::spawn(|| {
                remove_tun_device();
            });
        } else {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            remove_tun_device();
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    }

    if clear_system_proxy {
        let _ = update_system_proxy("clear".into(), 10808);
    }
    Ok(())
}

/// Fast teardown for app exit / admin relaunch (no long TUN sleeps).
pub async fn shutdown_for_exit() -> Result<(), String> {
    // Avoid waiting forever if another start/stop holds PROXY_OP.
    match tokio::time::timeout(
        std::time::Duration::from_secs(3),
        PROXY_OP.lock(),
    )
    .await
    {
        Ok(_guard) => stop_proxy_inner(true, true).await,
        Err(_) => {
            eprintln!("[shutdown] PROXY_OP busy — force-killing children anyway");
            crate::kill_all_children();
            let _ = update_system_proxy("clear".into(), 10808);
            Ok(())
        }
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
    let _op = PROXY_OP.lock().await;

    println!(
        "[start_proxy] target: {}, tun_mode: {}, linux_sudo: {}, tun_front_alive: {}",
        target.id.clone(),
        tun_mode,
        sudo_password.is_some(),
        tun_front_running()
    );

    if tun_mode {
        #[cfg(target_os = "windows")]
        if !process_is_elevated() {
            return Err(
                "TUN mode requires administrator privileges (sing-box needs admin for Wintun)"
                    .into(),
            );
        }
    }

    // Soft switch: keep sing-box TUN, only reload Xray outbound (no Wintun recreate / no network flap).
    if tun_mode && tun_front_running() {
        println!("[start_proxy] soft reconnect — restart Xray only, keep sing-box TUN");
        stop_xray_only().await;
        if wait_port_free(local_port, 4000).await.is_ok() {
            write_and_start_xray(&app, &target, local_port).await?;
            wait_for_socks_port(local_port, 5000).await?;
            update_system_proxy("clear".into(), local_port)?;
            return Ok(());
        }
        eprintln!("[start_proxy] soft reconnect port busy; falling back to full restart");
    }

    // Full stop when leaving TUN, first connect, TUN front dead, or soft-reconnect failed.
    let _ = stop_proxy_inner(false, false).await;
    if tun_mode {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        remove_tun_device();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    wait_port_free(local_port, 5000).await?;

    write_and_start_xray(&app, &target, local_port).await?;

    if tun_mode {
        wait_for_socks_port(local_port, 5000).await?;
        start_singbox_tun_front(&app, local_port, sudo_password).await?;
        update_system_proxy("clear".into(), local_port)?;
    } else {
        #[cfg(not(target_os = "linux"))]
        let _ = sudo_password;
        if let Ok(mut tun_active) = TUN_ACTIVE.lock() {
            *tun_active = false;
        }
        update_system_proxy(system_proxy_mode, local_port)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_proxy() -> Result<(), String> {
    let _op = PROXY_OP.lock().await;
    stop_proxy_inner(true, false).await
}

#[tauri::command]
pub async fn set_system_proxy_mode(mode: String, port: u16) -> Result<(), String> {
    update_system_proxy(mode, port)
}

fn update_system_proxy(mode: String, port: u16) -> Result<(), String> {
    if mode == "dont_change" {
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        // v2rayN-style: GNOME gsettings + KDE kwriteconfig (sysproxy crate is GNOME-only
        // and quotes mode incorrectly on some distros).
        match mode.as_str() {
            "set" => crate::linux_sysproxy::set_proxy("127.0.0.1", port)?,
            "clear" => crate::linux_sysproxy::unset_proxy()?,
            _ => {}
        }
        return Ok(());
    }

    #[cfg(not(target_os = "linux"))]
    {
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
}

#[tauri::command]
pub fn verify_sudo_password(password: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        crate::linux_sysproxy::verify_sudo_password(&password)?;
        if let Ok(mut pwd) = LINUX_SUDO_PWD.lock() {
            *pwd = Some(password);
        }
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = password;
        Err("sudo password is only used on Linux".into())
    }
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

    let (mut rx, child) = cmd.spawn().map_err(|e| e.to_string())?;

    let output = match tokio::time::timeout(std::time::Duration::from_secs(1), async {
        let mut stdout_str = String::new();
        while let Some(event) = rx.recv().await {
            if let tauri_plugin_shell::process::CommandEvent::Stdout(bytes) = event {
                stdout_str.push_str(&String::from_utf8_lossy(&bytes));
            }
        }
        stdout_str
    })
    .await
    {
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
            if let (Some(name), Some(value)) = (
                item.get("name").and_then(|v| v.as_str()),
                item.get("value").and_then(|v| v.as_u64()),
            ) {
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
    process_is_elevated()
}

#[tauri::command]
pub async fn restart_as_admin(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        // Hide immediately so TUN→UAC doesn't feel like a hang.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }

        crate::tester::cancel_testing();
        // Kill orphans before elevated relaunch (port/TUN reuse).
        crate::kill_all_children();
        let _ = shutdown_for_exit().await;
        crate::kill_all_children();
        // Short settle only — UI already hidden.
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        use std::os::windows::process::CommandExt;
        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &format!("Start-Process -FilePath '{}' -Verb RunAs", exe.display()),
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("restart_as_admin is only supported on Windows".to_string())
    }
}
