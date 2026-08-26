//! Fetch remote subscription content (avoid webview CORS).

use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
pub struct SubscriptionResponse {
    pub body: String,
    pub userinfo: Option<String>,
}

#[tauri::command]
pub async fn fetch_subscription(url: String) -> Result<SubscriptionResponse, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("empty subscription url".into());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("subscription url must start with http:// or https://".into());
    }

    let client = reqwest::Client::builder()
        .user_agent("v2rayN/6.0 (v2net)")
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|e| format!("subscription request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("subscription HTTP {status}"));
    }

    let userinfo = resp
        .headers()
        .get("subscription-userinfo")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("failed to read subscription body: {e}"))?;

    // Prefer UTF-8; fall back to lossy so base64 payloads still reach the UI.
    let body = match String::from_utf8(bytes.to_vec()) {
        Ok(s) => s,
        Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
    };

    Ok(SubscriptionResponse { body, userinfo })
}
