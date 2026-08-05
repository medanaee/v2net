mod connection;
mod geoip;
#[cfg(target_os = "linux")]
mod linux_sysproxy;
mod singbox_config;
mod subscription;
mod tester;
mod tray;
pub mod xray_config;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Manager, WebviewWindow};
use tester::{cancel_testing, run_batch_test, TestTarget};
#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, clear_blur};

#[tauri::command]
async fn start_batch_test(
    app: AppHandle,
    targets: Vec<TestTarget>,
    test_url: String,
    download_url: String,
    upload_url: String,
    test_mode: String,
    test_workers: usize,
) -> Result<(), String> {
    tokio::spawn(async move {
        run_batch_test(
            app,
            targets,
            test_url,
            download_url,
            upload_url,
            test_mode,
            test_workers,
        )
        .await;
    });
    Ok(())
}

#[tauri::command]
fn stop_batch_test() -> Result<(), String> {
    cancel_testing();
    Ok(())
}

#[tauri::command]
fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_maximize_window(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn apply_window_vibrancy(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            // Apply acrylic or blur effect on Windows
            let _ = apply_acrylic(&window, Some((18, 18, 24, 180)));
        } else {
            let _ = clear_blur(&window);
        }
    }
    let _ = enabled;
    let _ = window;
    Ok(())
}

use connection::{
    check_elevation, get_proxy_stats, restart_as_admin, set_system_proxy_mode, start_proxy,
    stop_proxy, verify_sudo_password,
};
use geoip::lookup_country;
use std::sync::Mutex;

pub static SPAWNED_PIDS: Mutex<Vec<u32>> = Mutex::new(Vec::new());
static SHUTTING_DOWN: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub fn track_pid(pid: u32) {
    if let Ok(mut pids) = SPAWNED_PIDS.lock() {
        pids.push(pid);
    }
}

/// Force-kill every tracked sidecar PID (waits for each kill).
pub fn kill_tracked_pids() {
    let pids = {
        let mut guard = match SPAWNED_PIDS.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        std::mem::take(&mut *guard)
    };

    for pid in pids {
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string(), "/T"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("kill")
                .args(["-9", &pid.to_string()])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
    }
}

/// Tracked PIDs + known sidecar image names (xray / sing-box).
pub fn kill_all_children() {
    kill_tracked_pids();
    crate::connection::force_kill_all_sidecars();
}

/// Hide UI immediately, then tear down proxy/sidecars in the background and exit.
/// Used by title-bar X and tray Quit so the app never feels frozen.
pub fn begin_app_quit(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    if SHUTTING_DOWN.swap(true, Ordering::SeqCst) {
        return;
    }

    for (_label, window) in app.webview_windows() {
        let _ = window.hide();
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::tester::cancel_testing();
        // Kill children first (fast); don't wait on slow stop_proxy / TUN sleeps.
        crate::kill_all_children();
        let _ = crate::connection::shutdown_for_exit().await;
        crate::kill_all_children();
        app.exit(0);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // single-instance must be registered first so a second launch is rejected early.
    let mut builder = tauri::Builder::default();

    #[cfg(any(windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_batch_test,
            stop_batch_test,
            minimize_window,
            toggle_maximize_window,
            close_window,
            apply_window_vibrancy,
            start_proxy,
            stop_proxy,
            set_system_proxy_mode,
            get_proxy_stats,
            check_elevation,
            restart_as_admin,
            verify_sudo_password,
            lookup_country,
            subscription::fetch_subscription
        ])
        .setup(|app| {
            if let Err(e) = crate::tray::setup_tray(app) {
                eprintln!("[tray] setup failed: {e}");
            }

            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window {
                #[cfg(target_os = "windows")]
                let _ = apply_acrylic(&window, Some((18, 18, 24, 180)));

                let app_handle = app.handle().clone();
                window.on_window_event(move |event| match event {
                    // Title-bar X → hide instantly, cleanup in background.
                    // Hide-to-tray is a separate frontend button (window.hide only).
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        crate::begin_app_quit(&app_handle);
                    }
                    _ => {}
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
