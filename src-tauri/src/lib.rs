mod connection;
mod singbox_config;
mod tester;
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

use connection::{set_system_proxy_mode, start_proxy, stop_proxy, get_proxy_stats, check_elevation, restart_as_admin};
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

use std::sync::Mutex;

pub static SPAWNED_PIDS: Mutex<Vec<u32>> = Mutex::new(Vec::new());

pub fn track_pid(pid: u32) {
    if let Ok(mut pids) = SPAWNED_PIDS.lock() {
        pids.push(pid);
    }
}

pub fn kill_tracked_pids() {
    if let Ok(pids) = SPAWNED_PIDS.lock() {
        for &pid in pids.iter() {
            #[cfg(target_os = "windows")]
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string(), "/T"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .spawn();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            restart_as_admin
        ])
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
            {
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                if let Some(icon) = app.default_window_icon().cloned() {
                    let _tray = TrayIconBuilder::new()
                        .icon(icon)
                        .on_tray_icon_event(|tray, event| match event {
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } => {
                                let app = tray.app_handle();
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                            _ => {}
                        })
                        .build(app);
                }
            }

            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window {
                #[cfg(target_os = "windows")]
                let _ = apply_acrylic(&window, Some((18, 18, 24, 180)));

                let app_handle = app.handle().clone();
                let window_clone = window.clone();

                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window_clone.hide();

                        let app_handle = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            // Clear the proxy and stop the main connection
                            let _ = crate::connection::stop_proxy().await;

                            // Cancel testing
                            crate::tester::cancel_testing();

                            // Force kill ONLY the xray instances we spawned
                            crate::kill_tracked_pids();

                            app_handle.exit(0);
                        });
                    }
                    _ => {}
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
