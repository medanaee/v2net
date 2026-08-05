//! Cross-desktop system tray setup.
//!
//! Linux notes (KDE Plasma / GNOME / XFCE / Cinnamon / COSMIC / …):
//! - StatusNotifier / AppIndicator often **hides** the icon unless a menu is attached.
//! - Left-click tray events are unsupported; use the menu for Show / Quit.
//! - Icon PNG must be writable under `$XDG_RUNTIME_DIR` for the panel to load it.
//! - Runtime needs `libayatana-appindicator3` or `libappindicator3`.

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};

#[allow(dead_code)] // held so TrayIcon is not dropped (drop removes the panel icon)
struct TrayState(TrayIcon);

fn linux_desktop_hint() -> String {
    let keys = [
        "XDG_CURRENT_DESKTOP",
        "XDG_SESSION_DESKTOP",
        "DESKTOP_SESSION",
        "KDE_SESSION_VERSION",
        "GNOME_DESKTOP_SESSION_ID",
    ];
    keys.iter()
        .filter_map(|k| std::env::var(k).ok().map(|v| format!("{k}={v}")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "linux")]
fn linux_indicator_libs_present() -> Vec<&'static str> {
    use std::ffi::CString;

    const CANDIDATES: &[&str] = &[
        "libayatana-appindicator3.so.1",
        "libappindicator3.so.1",
        "libayatana-appindicator3.so",
        "libappindicator3.so",
    ];
    let mut found = Vec::new();
    for name in CANDIDATES {
        let Ok(c_name) = CString::new(*name) else {
            continue;
        };
        let probe = unsafe { libc::dlopen(c_name.as_ptr(), libc::RTLD_LAZY) };
        if !probe.is_null() {
            found.push(*name);
            unsafe { libc::dlclose(probe) };
        }
    }
    found
}

#[cfg(target_os = "linux")]
fn tray_temp_dir() -> std::path::PathBuf {
    // Prefer XDG_RUNTIME_DIR so KDE/GNOME StatusNotifier can read the icon file.
    if let Ok(runtime) = std::env::var("XDG_RUNTIME_DIR") {
        if !runtime.is_empty() {
            return std::path::PathBuf::from(runtime).join("v2net-tray");
        }
    }
    std::env::temp_dir().join("v2net-tray")
}

fn load_tray_icon(app: &App) -> Option<Image<'static>> {
    // 1) Bundled window icon from tauri.conf
    if let Some(icon) = app.default_window_icon() {
        return Some(icon.clone().to_owned());
    }

    // 2) Files next to the executable / resources (packaged + portable)
    let mut candidates = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        candidates.push(resource.join("icons").join("32x32.png"));
        candidates.push(resource.join("icons").join("128x128.png"));
        candidates.push(resource.join("icons").join("icon.png"));
        candidates.push(resource.join("32x32.png"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("icons").join("32x32.png"));
            candidates.push(dir.join("32x32.png"));
            candidates.push(dir.join("icon.png"));
        }
    }
    // Dev tree
    candidates.push(std::path::PathBuf::from("icons/32x32.png"));
    candidates.push(std::path::PathBuf::from("src-tauri/icons/32x32.png"));

    for path in candidates {
        if !path.is_file() {
            continue;
        }
        match Image::from_path(&path) {
            Ok(img) => {
                println!("[tray] loaded icon from {}", path.display());
                return Some(img);
            }
            Err(e) => eprintln!("[tray] failed to load {}: {e}", path.display()),
        }
    }

    // 3) Embedded PNG (compile-time) — works even if resource paths are wrong
    match Image::from_bytes(include_bytes!("../icons/32x32.png")) {
        Ok(img) => {
            println!("[tray] loaded embedded 32x32.png");
            Some(img)
        }
        Err(e) => {
            eprintln!("[tray] embedded icon decode failed: {e}");
            None
        }
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn quit_app(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::connection::stop_proxy().await;
        crate::tester::cancel_testing();
        crate::kill_tracked_pids();
        app.exit(0);
    });
}

/// Build a tray that works across Windows and major Linux DEs (KDE/GNOME/…).
pub fn setup_tray(app: &App) -> tauri::Result<()> {
    println!("[tray] desktop: {}", linux_desktop_hint());

    #[cfg(target_os = "linux")]
    {
        let libs = linux_indicator_libs_present();
        if libs.is_empty() {
            eprintln!(
                "[tray] WARNING: no AppIndicator library found. Install one of:\n\
                 - Debian/Ubuntu: sudo apt install libayatana-appindicator3-1\n\
                 - Fedora:        sudo dnf install libappindicator-gtk3\n\
                 - Arch:          sudo pacman -S libappindicator-gtk3\n\
                 - openSUSE:      sudo zypper install libappindicator3-1"
            );
        } else {
            println!("[tray] AppIndicator libs: {}", libs.join(", "));
        }
        let temp = tray_temp_dir();
        let _ = std::fs::create_dir_all(&temp);
        println!("[tray] icon temp dir: {}", temp.display());
    }

    let Some(icon) = load_tray_icon(app) else {
        eprintln!("[tray] no icon available — tray will not be created");
        return Ok(());
    };

    let show_i = MenuItem::with_id(app, "tray_show", "Show v2net", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show_i, &sep, &quit_i])?;

    let builder = TrayIconBuilder::with_id("v2net-main-tray")
        .icon(icon)
        .menu(&menu)
        .tooltip("v2net")
        .title("v2net")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => show_main_window(app),
            "tray_quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Linux: click events are not emitted by AppIndicator — menu handles UX.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    #[cfg(target_os = "linux")]
    let builder = builder.temp_dir_path(tray_temp_dir());

    let tray = builder.build(app)?;
    // Keep alive for the whole process — dropping TrayIcon removes it from the panel.
    app.manage(TrayState(tray));
    println!("[tray] ready");
    Ok(())
}
