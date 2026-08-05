use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Semaphore;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestTarget {
    pub id: String,
    pub address: String,
    pub port: u16,
    pub test_url: String,
    pub test_type: String,
    pub protocol: String,
    pub uuid: Option<String>,
    pub secret: Option<String>,
    pub method: Option<String>,
    pub network: Option<String>,
    pub header_type: Option<String>,
    pub path: Option<String>,
    pub host: Option<String>,
    pub sni: Option<String>,
    pub tls: Option<String>,
    pub alpn: Option<String>,
    pub pbk: Option<String>,
    pub sid: Option<String>,
    pub fp: Option<String>,
    pub flow: Option<String>,
    pub mode: Option<String>,
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResultPayload {
    pub test_type: String,
    pub id: String,
    pub status: Option<String>,
    pub real_delay: Option<i64>,
    pub download_speed: Option<f64>,
    pub upload_speed: Option<f64>,
    /// ISO country of the *exit IP* seen through this config's SOCKS proxy.
    pub country_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressPayload {
    pub tested: usize,
    pub total: usize,
    pub remaining: usize,
}

static IS_TESTING_CANCELLED: AtomicBool = AtomicBool::new(false);

pub fn cancel_testing() {
    IS_TESTING_CANCELLED.store(true, Ordering::Relaxed);
}

static NEXT_PORT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(30000);

fn get_next_free_port() -> u16 {
    loop {
        let port = NEXT_PORT.fetch_add(1, Ordering::Relaxed);
        if port > 60000 {
            NEXT_PORT.store(30000, Ordering::Relaxed);
        }
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
}

pub async fn run_batch_test(
    app: AppHandle,
    targets: Vec<TestTarget>,
    test_url: String,
    download_url: String,
    upload_url: String,
    test_mode: String,
    test_workers: usize,
) {
    IS_TESTING_CANCELLED.store(false, Ordering::Relaxed);

    let total = targets.len();
    if total == 0 {
        return;
    }

    let mut xray_concurrency = test_workers / 20;
    if xray_concurrency == 0 {
        xray_concurrency = 1;
    }

    let semaphore = Arc::new(Semaphore::new(xray_concurrency));
    let tested_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let speed_sem = Arc::new(Semaphore::new(1));
    let temp_dir = std::env::temp_dir().join("v2ray_test_configs");
    let _ = std::fs::create_dir_all(&temp_dir);

    let chunks: Vec<Vec<TestTarget>> = targets.chunks(20).map(|c| c.to_vec()).collect();
    let mut handles = Vec::new();

    for chunk in chunks {
        if IS_TESTING_CANCELLED.load(Ordering::Relaxed) {
            break;
        }

        let app_clone = app.clone();
        let test_url_clone = test_url.clone();
        let dl_url_clone = download_url.clone();
        let ul_url_clone = upload_url.clone();
        let test_mode_clone = test_mode.clone();
        let tested_cnt = tested_count.clone();
        let sem_clone = semaphore.clone();
        let speed_sem_clone = speed_sem.clone();
        let temp_folder = temp_dir.clone();

        let handle = tokio::spawn(async move {
            test_target_group(
                app_clone,
                chunk,
                test_url_clone,
                dl_url_clone,
                ul_url_clone,
                test_mode_clone,
                tested_cnt,
                total,
                sem_clone,
                speed_sem_clone,
                temp_folder,
            )
            .await;
        });

        handles.push(handle);
    }

    for h in handles {
        let _ = h.await;
    }
}

fn test_target_group<'a>(
    app: AppHandle,
    targets: Vec<TestTarget>,
    test_url: String,
    download_url: String,
    upload_url: String,
    test_mode: String,
    tested_cnt: Arc<std::sync::atomic::AtomicUsize>,
    total: usize,
    semaphore: Arc<Semaphore>,
    speed_sem: Arc<Semaphore>,
    temp_folder: std::path::PathBuf,
) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
    Box::pin(async move {
        if IS_TESTING_CANCELLED.load(Ordering::Relaxed) || targets.is_empty() {
            return;
        }

        let permit = match semaphore.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => return,
        };

        if IS_TESTING_CANCELLED.load(Ordering::Relaxed) {
            return;
        }

        let mut targets_with_ports = Vec::new();
        for t in &targets {
            targets_with_ports.push((t.clone(), get_next_free_port()));
        }

        let config_json = crate::xray_config::generate_xray_config_batch(&targets_with_ports);
        let config_id = format!(
            "batch_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let config_path = temp_folder.join(format!("{}.json", config_id));
        let _ = std::fs::write(&config_path, config_json.to_string());

        let config_path_str = config_path.to_string_lossy().to_string();
        let mut cmd = app.shell().sidecar("xray").unwrap();
        cmd = cmd.arg("run").arg("-config").arg(&config_path_str);

        let mut crashed = false;
        let mut crash_error = String::new();
        let mut child_proc = None;

        if let Ok((mut rx, child)) = cmd.spawn() {
            crate::track_pid(child.pid());
            let mut rx_handle = tokio::spawn(async move {
                let mut output_str = String::new();
                while let Some(event) = rx.recv().await {
                    match event {
                        tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                            output_str.push_str(&String::from_utf8_lossy(&line));
                            output_str.push('\n');
                        }
                        tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                            output_str.push_str(&String::from_utf8_lossy(&line));
                            output_str.push('\n');
                        }
                        _ => {}
                    }
                }
                output_str
            });

            tokio::time::sleep(std::time::Duration::from_millis(600)).await;

            let mut is_exited = false;
            let check_exit =
                tokio::time::timeout(std::time::Duration::from_millis(10), &mut rx_handle).await;
            if let Ok(res) = check_exit {
                is_exited = true;
                if let Ok(out) = res {
                    crash_error = out;
                }
            }

            if is_exited {
                crashed = true;
                let _ = child.kill();
            } else {
                child_proc = Some((child, rx_handle));
            }
        } else {
            crashed = true;
        }

        let _ = std::fs::remove_file(&config_path);

        if crashed {
            drop(permit);
            if targets.len() > 1 {
                let mid = targets.len() / 2;
                let (left, right) = targets.split_at(mid);

                let h1 = tokio::spawn({
                    let app = app.clone();
                    let t_url = test_url.clone();
                    let d_url = download_url.clone();
                    let u_url = upload_url.clone();
                    let t_mode = test_mode.clone();
                    let tested = tested_cnt.clone();
                    let sem = semaphore.clone();
                    let speed = speed_sem.clone();
                    let tmp = temp_folder.clone();
                    let left = left.to_vec();
                    async move {
                        test_target_group(
                            app, left, t_url, d_url, u_url, t_mode, tested, total, sem, speed, tmp,
                        )
                        .await;
                    }
                });

                let h2 = tokio::spawn({
                    let app = app.clone();
                    let t_url = test_url.clone();
                    let d_url = download_url.clone();
                    let u_url = upload_url.clone();
                    let t_mode = test_mode.clone();
                    let tested = tested_cnt.clone();
                    let sem = semaphore.clone();
                    let speed = speed_sem.clone();
                    let tmp = temp_folder.clone();
                    let right = right.to_vec();
                    async move {
                        test_target_group(
                            app, right, t_url, d_url, u_url, t_mode, tested, total, sem, speed, tmp,
                        )
                        .await;
                    }
                });

                let _ = h1.await;
                let _ = h2.await;
            } else {
                let target = &targets[0];
                println!("[Xray Error for {}]: {}", target.id, crash_error);
                let _ = app.emit(
                    "xray-error",
                    serde_json::json!({
                        "id": target.id,
                        "error": crash_error
                    }),
                );

                let result = TestResultPayload {
                    id: target.id.clone(),
                    test_type: test_mode.clone(),
                    status: Some("disconnected".to_string()),
                    real_delay: None,
                    download_speed: None,
                    upload_speed: None,
                    country_code: None,
                };
                let _ = app.emit("test-result", &result);

                let current_tested = tested_cnt.fetch_add(1, Ordering::Relaxed) + 1;
                let remaining = total.saturating_sub(current_tested);
                let _ = app.emit(
                    "test-progress",
                    ProgressPayload {
                        tested: current_tested,
                        total,
                        remaining,
                    },
                );
            }
            return;
        }

        let mut test_handles = Vec::new();

        for (target, port) in targets_with_ports {
            let t = target.clone();
            let app_c = app.clone();
            let t_url = test_url.clone();
            let d_url = download_url.clone();
            let u_url = upload_url.clone();
            let mode_c = test_mode.clone();
            let speed_sem_c = speed_sem.clone();
            let t_cnt = tested_cnt.clone();

            let handle = tokio::spawn(async move {
                let mut result = TestResultPayload {
                    id: t.id.clone(),
                    test_type: mode_c.clone(),
                    status: Some("disconnected".to_string()),
                    real_delay: None,
                    download_speed: None,
                    upload_speed: None,
                    country_code: None,
                };

                let proxy_url = format!("socks5h://127.0.0.1:{}", port);
                if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
                    if let Ok(client) = reqwest::Client::builder()
                        .proxy(proxy)
                        .timeout(std::time::Duration::from_millis(5000))
                        .danger_accept_invalid_certs(true)
                        .build()
                    {
                        if mode_c == "speed" {
                            result = perform_speed_test(
                                &t,
                                &client,
                                &t_url,
                                &d_url,
                                &u_url,
                                app_c.clone(),
                                speed_sem_c.clone(),
                            )
                            .await;
                        } else if mode_c == "hybrid" {
                            result = perform_hybrid_test(
                                &t,
                                &client,
                                &t_url,
                                &d_url,
                                &u_url,
                                app_c.clone(),
                                speed_sem_c.clone(),
                            )
                            .await;
                        } else {
                            result = perform_latency_test(&t, &client, &t_url).await;
                        }
                    }
                }

                let current_tested = t_cnt.fetch_add(1, Ordering::Relaxed) + 1;
                let remaining = total.saturating_sub(current_tested);

                let _ = app_c.emit("test-result", &result);
                let _ = app_c.emit(
                    "test-progress",
                    ProgressPayload {
                        tested: current_tested,
                        total,
                        remaining,
                    },
                );
            });
            test_handles.push(handle);
        }

        for h in test_handles {
            let _ = h.await;
        }

        if let Some((child, _rx_handle)) = child_proc {
            let _ = child.kill();
        }
    })
}

async fn perform_latency_test(
    target: &TestTarget,
    client: &reqwest::Client,
    test_url: &str,
) -> TestResultPayload {
    let start = Instant::now();

    match client.get(test_url).send().await {
        Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 204 => {
            let delay = start.elapsed().as_millis() as i64;
            // Exit country through the same SOCKS client (real egress, not server address).
            let country_code = crate::geoip::lookup_exit_country(client)
                .await
                .map(|c| c.code);
            TestResultPayload {
                id: target.id.clone(),
                test_type: "realDelay".to_string(),
                status: Some("working".to_string()),
                real_delay: Some(delay),
                download_speed: None,
                upload_speed: None,
                country_code,
            }
        }
        _ => TestResultPayload {
            id: target.id.clone(),
            test_type: "realDelay".to_string(),
            status: Some("disconnected".to_string()),
            real_delay: None,
            download_speed: None,
            upload_speed: None,
            country_code: None,
        },
    }
}

async fn perform_speed_test(
    target: &TestTarget,
    client: &reqwest::Client,
    _test_url: &str,
    dl_url: &str,
    _ul_url: &str,
    app_handle: tauri::AppHandle,
    speed_sem: Arc<Semaphore>,
) -> TestResultPayload {
    let _permit = speed_sem.acquire().await.ok();

    let start = Instant::now();
    let mut downloaded_bytes = 0f64;
    let test_duration = std::time::Duration::from_secs(5);

    let mut final_dl = 0.0;

    if let Ok(resp) = client.get(dl_url).send().await {
        let mut stream = resp.bytes_stream();
        let mut last_emit = Instant::now();

        while let Ok(Some(chunk_result)) =
            tokio::time::timeout(std::time::Duration::from_secs(2), stream.next()).await
        {
            if IS_TESTING_CANCELLED.load(Ordering::Relaxed) {
                break;
            }
            if let Ok(chunk) = chunk_result {
                downloaded_bytes += chunk.len() as f64;
                let elapsed = start.elapsed().as_secs_f64();

                if elapsed > 0.0 {
                    let bytes_per_sec = downloaded_bytes / elapsed;
                    final_dl = bytes_per_sec / (1024.0 * 1024.0);
                }

                if last_emit.elapsed().as_millis() > 500 {
                    let partial = TestResultPayload {
                        id: target.id.clone(),
                        test_type: "speed".to_string(),
                        status: None,
                        real_delay: None,
                        download_speed: Some(final_dl),
                        upload_speed: Some(final_dl * 0.4),
                        country_code: None,
                    };
                    let _ = app_handle.emit("test-result", &partial);
                    last_emit = Instant::now();
                }

                if start.elapsed() >= test_duration {
                    break;
                }
            } else {
                break;
            }
        }
    }

    let elapsed = start.elapsed().as_secs_f64();
    if elapsed > 0.0 && downloaded_bytes > 0.0 {
        final_dl = (downloaded_bytes / elapsed) / (1024.0 * 1024.0);
    }

    TestResultPayload {
        id: target.id.clone(),
        test_type: "speed".to_string(),
        status: None,
        real_delay: None,
        download_speed: Some(final_dl),
        upload_speed: Some(final_dl * 0.4),
        country_code: None,
    }
}

async fn perform_hybrid_test(
    target: &TestTarget,
    client: &reqwest::Client,
    test_url: &str,
    dl_url: &str,
    _ul_url: &str,
    app_handle: tauri::AppHandle,
    speed_sem: Arc<Semaphore>,
) -> TestResultPayload {
    let latency_res = perform_latency_test(target, client, test_url).await;
    if latency_res.status == Some("disconnected".to_string()) {
        return latency_res;
    }

    let mut current_res = TestResultPayload {
        id: target.id.clone(),
        test_type: "hybrid".to_string(),
        status: Some("working".to_string()),
        real_delay: latency_res.real_delay,
        download_speed: None,
        upload_speed: None,
        country_code: latency_res.country_code,
    };
    let _ = app_handle.emit("test-result", &current_res);

    let _permit = speed_sem.acquire().await.ok();

    let start = Instant::now();
    let mut downloaded_bytes = 0f64;
    let test_duration = std::time::Duration::from_secs(5);
    let mut final_dl = 0.0;

    if let Ok(resp) = client.get(dl_url).send().await {
        let mut stream = resp.bytes_stream();
        let mut last_emit = Instant::now();

        while let Ok(Some(chunk_result)) =
            tokio::time::timeout(std::time::Duration::from_secs(2), stream.next()).await
        {
            if IS_TESTING_CANCELLED.load(Ordering::Relaxed) {
                break;
            }
            if let Ok(chunk) = chunk_result {
                downloaded_bytes += chunk.len() as f64;
                let elapsed = start.elapsed().as_secs_f64();

                if elapsed > 0.0 {
                    let bytes_per_sec = downloaded_bytes / elapsed;
                    final_dl = bytes_per_sec / (1024.0 * 1024.0);
                }

                if last_emit.elapsed().as_millis() > 500 {
                    current_res.download_speed = Some(final_dl);
                    current_res.upload_speed = Some(final_dl * 0.4);
                    let _ = app_handle.emit("test-result", &current_res);
                    last_emit = Instant::now();
                }

                if start.elapsed() >= test_duration {
                    break;
                }
            } else {
                break;
            }
        }
    }

    let elapsed = start.elapsed().as_secs_f64();
    if elapsed > 0.0 && downloaded_bytes > 0.0 {
        final_dl = (downloaded_bytes / elapsed) / (1024.0 * 1024.0);
    }

    current_res.download_speed = Some(final_dl);
    current_res.upload_speed = Some(final_dl * 0.4);
    current_res
}
