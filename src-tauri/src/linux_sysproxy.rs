//! Linux system proxy — same approach as v2rayN ProxySettingLinux + proxy_set_linux_sh.
//! Covers GNOME-family (gsettings) and KDE (kwriteconfig5/6 + DBus reparse).

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::process::{Command, Stdio};

const SCRIPT: &str = include_str!("../scripts/proxy_set_linux.sh");

const DEFAULT_BYPASS: &str = "localhost,127.0.0.1,127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,<local>";

fn ensure_script() -> Result<std::path::PathBuf, String> {
    let dir = std::env::temp_dir().join("v2net");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("proxy_set_linux.sh");
    // Rewrite each time so updates ship without stale temp scripts.
    fs::write(&path, SCRIPT).map_err(|e| e.to_string())?;
    let mut perms = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
    Ok(path)
}

fn run_script(args: &[&str]) -> Result<(), String> {
    let script = ensure_script()?;
    let output = Command::new("bash")
        .arg(&script)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("failed to run proxy script: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stdout.trim().is_empty() {
        println!("[linux_sysproxy] {stdout}");
    }
    if !stderr.trim().is_empty() {
        eprintln!("[linux_sysproxy] {stderr}");
    }

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "linux system proxy failed (exit {:?}): {}",
            output.status.code(),
            stderr.trim()
        ))
    }
}

pub fn set_proxy(host: &str, port: u16) -> Result<(), String> {
    run_script(&[
        "manual",
        host,
        &port.to_string(),
        DEFAULT_BYPASS,
    ])
}

pub fn unset_proxy() -> Result<(), String> {
    run_script(&["none"])
}

/// Verify sudo password the same way as v2rayN SudoPasswordInputView (`sudo -S echo SUDO_CHECK`).
pub fn verify_sudo_password(password: &str) -> Result<(), String> {
    if password.is_empty() {
        return Err("empty password".into());
    }
    let mut child = Command::new("sudo")
        .args(["-S", "-p", "", "echo", "SUDO_CHECK"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn sudo: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(format!("{password}\n").as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if output.status.success() && stdout.contains("SUDO_CHECK") {
        Ok(())
    } else {
        Err("incorrect sudo password".into())
    }
}
