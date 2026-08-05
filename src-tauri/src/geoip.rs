use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CountryInfo {
    pub code: String,
    pub name: String,
    pub ip: String,
}

fn cache() -> &'static Mutex<HashMap<String, CountryInfo>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CountryInfo>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_get(key: &str) -> Option<CountryInfo> {
    cache().lock().ok().and_then(|g| g.get(key).cloned())
}

fn cache_put(key: String, info: CountryInfo) {
    if let Ok(mut g) = cache().lock() {
        g.insert(key, info);
    }
}

fn is_ip_literal(host: &str) -> bool {
    host.parse::<std::net::IpAddr>().is_ok()
}

async fn resolve_ip(host: &str) -> Result<String, String> {
    let host = host.trim().trim_matches(|c| c == '[' || c == ']');
    if host.is_empty() {
        return Err("empty host".into());
    }
    if is_ip_literal(host) {
        return Ok(host.to_string());
    }

    let mut addrs = tokio::net::lookup_host((host, 0u16))
        .await
        .map_err(|e| format!("DNS resolve failed for {host}: {e}"))?;

    let mut v4 = None;
    let mut v6 = None;
    while let Some(addr) = addrs.next() {
        match addr.ip() {
            std::net::IpAddr::V4(ip) if v4.is_none() => v4 = Some(ip.to_string()),
            std::net::IpAddr::V6(ip) if v6.is_none() => v6 = Some(ip.to_string()),
            _ => {}
        }
        if v4.is_some() {
            break;
        }
    }

    v4.or(v6)
        .ok_or_else(|| format!("No A/AAAA record for {host}"))
}

fn ok_info(code: String, name: String, ip: String) -> Result<CountryInfo, String> {
    let code = code.to_uppercase();
    if code.len() != 2 || !code.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err(format!("invalid country code: {code}"));
    }
    Ok(CountryInfo { code, name, ip })
}

async fn fetch_ipwho(ip: &str) -> Result<CountryInfo, String> {
    #[derive(Deserialize)]
    struct Resp {
        success: Option<bool>,
        country: Option<String>,
        country_code: Option<String>,
        ip: Option<String>,
        message: Option<String>,
    }
    let url = format!("https://ipwho.is/{ip}");
    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(6))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Resp>()
        .await
        .map_err(|e| e.to_string())?;
    if resp.success == Some(false) {
        return Err(resp.message.unwrap_or_else(|| "ipwho.is failed".into()));
    }
    let code = resp.country_code.ok_or("missing country_code")?;
    let name = resp.country.unwrap_or_else(|| code.clone());
    ok_info(code, name, resp.ip.unwrap_or_else(|| ip.to_string()))
}

async fn fetch_geojs(ip: &str) -> Result<CountryInfo, String> {
    #[derive(Deserialize)]
    struct Resp {
        country: Option<String>,
        name: Option<String>,
        country_code: Option<String>,
        ip: Option<String>,
    }
    let url = format!("https://get.geojs.io/v1/ip/country/{ip}.json");
    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(6))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Resp>()
        .await
        .map_err(|e| e.to_string())?;
    let code = resp.country_code.ok_or("missing country_code")?;
    let name = resp
        .name
        .or(resp.country)
        .unwrap_or_else(|| code.clone());
    ok_info(code, name, resp.ip.unwrap_or_else(|| ip.to_string()))
}

async fn fetch_ip_api(ip: &str) -> Result<CountryInfo, String> {
    #[derive(Deserialize)]
    struct Resp {
        status: String,
        message: Option<String>,
        country: Option<String>,
        #[serde(rename = "countryCode")]
        country_code: Option<String>,
        query: Option<String>,
    }
    let url = format!(
        "http://ip-api.com/json/{ip}?fields=status,message,country,countryCode,query"
    );
    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(6))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Resp>()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status != "success" {
        return Err(resp.message.unwrap_or_else(|| "ip-api failed".into()));
    }
    let code = resp.country_code.ok_or("missing countryCode")?;
    let name = resp.country.unwrap_or_else(|| code.clone());
    ok_info(code, name, resp.query.unwrap_or_else(|| ip.to_string()))
}

async fn fetch_country_for_ip(ip: &str) -> Result<CountryInfo, String> {
    if let Some(hit) = cache_get(ip) {
        return Ok(hit);
    }

    // Prefer HTTPS providers first (ip-api HTTP is often filtered).
    let mut errors = Vec::new();

    match fetch_ipwho(ip).await {
        Ok(info) => {
            cache_put(ip.to_string(), info.clone());
            println!("[geoip] {ip} -> {} (ipwho.is)", info.code);
            return Ok(info);
        }
        Err(e) => {
            eprintln!("[geoip] ipwho.is failed for {ip}: {e}");
            errors.push(format!("ipwho.is: {e}"));
        }
    }
    match fetch_geojs(ip).await {
        Ok(info) => {
            cache_put(ip.to_string(), info.clone());
            println!("[geoip] {ip} -> {} (geojs)", info.code);
            return Ok(info);
        }
        Err(e) => {
            eprintln!("[geoip] geojs failed for {ip}: {e}");
            errors.push(format!("geojs: {e}"));
        }
    }
    match fetch_ip_api(ip).await {
        Ok(info) => {
            cache_put(ip.to_string(), info.clone());
            println!("[geoip] {ip} -> {} (ip-api)", info.code);
            return Ok(info);
        }
        Err(e) => {
            eprintln!("[geoip] ip-api failed for {ip}: {e}");
            errors.push(format!("ip-api: {e}"));
        }
    }

    Err(format!("all geoip providers failed: {}", errors.join(" | ")))
}

/// Resolve host → IP → country (ISO 3166-1 alpha-2). Cached by host and IP.
#[tauri::command]
pub async fn lookup_country(host: String) -> Result<CountryInfo, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("empty host".into());
    }

    if let Some(hit) = cache_get(&host) {
        return Ok(hit);
    }

    let ip = resolve_ip(&host).await?;
    let info = fetch_country_for_ip(&ip).await?;
    cache_put(host, info.clone());
    Ok(info)
}

/// Exit-country via an already-proxied HTTP client (real delay SOCKS path).
/// This reflects where the config actually exits on the internet.
pub async fn lookup_exit_country(client: &reqwest::Client) -> Option<CountryInfo> {
    // Keep this short so it doesn't dominate real-delay duration.
    let timeout = std::time::Duration::from_secs(3);

    // 1) ipwho.is through the proxy
    if let Ok(Ok(resp)) = tokio::time::timeout(timeout, client.get("https://ipwho.is/").send()).await
    {
        if let Ok(v) = resp.json::<serde_json::Value>().await {
            if v.get("success").and_then(|x| x.as_bool()) != Some(false) {
                if let Some(code) = v.get("country_code").and_then(|x| x.as_str()) {
                    let name = v
                        .get("country")
                        .and_then(|x| x.as_str())
                        .unwrap_or(code)
                        .to_string();
                    let ip = v
                        .get("ip")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                    if let Ok(info) = ok_info(code.to_string(), name, ip) {
                        return Some(info);
                    }
                }
            }
        }
    }

    // 2) geojs through the proxy
    if let Ok(Ok(resp)) = tokio::time::timeout(
        timeout,
        client.get("https://get.geojs.io/v1/ip/country.json").send(),
    )
    .await
    {
        if let Ok(v) = resp.json::<serde_json::Value>().await {
            if let Some(code) = v.get("country").and_then(|x| x.as_str()) {
                // geojs /country.json returns { country: "US", name: "...", ip: "..." }
                // (country field is the ISO code here)
                let name = v
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or(code)
                    .to_string();
                let ip = v
                    .get("ip")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let code = if code.len() == 2 {
                    code.to_string()
                } else {
                    v.get("country_code")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string()
                };
                if let Ok(info) = ok_info(code, name, ip) {
                    return Some(info);
                }
            }
        }
    }

    // 3) ip-api through the proxy (HTTP)
    if let Ok(Ok(resp)) = tokio::time::timeout(
        timeout,
        client
            .get("http://ip-api.com/json/?fields=status,country,countryCode,query")
            .send(),
    )
    .await
    {
        if let Ok(v) = resp.json::<serde_json::Value>().await {
            if v.get("status").and_then(|x| x.as_str()) == Some("success") {
                if let Some(code) = v.get("countryCode").and_then(|x| x.as_str()) {
                    let name = v
                        .get("country")
                        .and_then(|x| x.as_str())
                        .unwrap_or(code)
                        .to_string();
                    let ip = v
                        .get("query")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                    if let Ok(info) = ok_info(code.to_string(), name, ip) {
                        return Some(info);
                    }
                }
            }
        }
    }

    None
}
