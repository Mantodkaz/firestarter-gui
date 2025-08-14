use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use chrono::{DateTime, Utc};
use percent_encoding::{AsciiSet, CONTROLS};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, Emitter};

// =============================================================================================================
// ============================================== UTIL & TYPES =================================================
// =============================================================================================================

#[derive(Serialize, Deserialize)]
pub struct UploadLogEntry {
    pub local_path: String,
    pub remote_path: String,
    pub status: String,
    pub message: String,
    pub blake3_hash: String,
    pub file_size: u64,
    pub timestamp: String,
}

/// Helper to get user data dir for a given user_id, using app_handle for base path
fn get_user_data_dir(user_id: &str, app_handle: &AppHandle) -> Result<PathBuf, String> {
    let base = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let user_dir = base.join(user_id);
    Ok(user_dir)
}

/// Append upload log entry to users upload log file
pub fn append_upload_log(user_id: &str, entry: &UploadLogEntry, app_handle: &AppHandle) -> Result<(), String> {
    use std::fs::{create_dir_all, OpenOptions};
    use std::io::Write;

    let user_dir = get_user_data_dir(user_id, app_handle)?;
    if !user_dir.exists() {
        create_dir_all(&user_dir).map_err(|e| format!("Failed to create user dir: {}", e))?;
    }

    let log_path = user_dir.join(format!("list-upload-{}.json", user_id));
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    let json = serde_json::to_string(entry).map_err(|e| format!("Failed to serialize log entry: {}", e))?;
    file.write_all(json.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|e| format!("Failed to write log: {}", e))?;
    Ok(())
}

const QUERY_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}')
    .add(b'|')
    .add(b'\\')
    .add(b'^')
    .add(b'[')
    .add(b']')
    .add(b'%');

// =============================================================================================================
// ========================================== GENERIC API PROXIES ==============================================
// =============================================================================================================

#[tauri::command]
pub async fn get_upload_history(user_id: String, app_handle: AppHandle) -> Result<Vec<UploadLogEntry>, String> {
    use std::fs::File;
    use std::io::{BufRead, BufReader};

    let user_dir = get_user_data_dir(&user_id, &app_handle)?;
    let log_path = user_dir.join(format!("list-upload-{}.json", user_id));
    if !log_path.exists() {
        return Ok(vec![]);
    }

    let file = File::open(&log_path).map_err(|e| format!("Failed to open log file: {}", e))?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read log line: {}", e))?;
        if line.trim().is_empty() { continue; }
        match serde_json::from_str::<UploadLogEntry>(&line) {
            Ok(entry) => entries.push(entry),
            Err(e) => {
                println!("[LOG] Failed to parse upload log line: {}", e);
            }
        }
    }
    Ok(entries)
}

#[tauri::command]
pub async fn proxy_api_get(
    url: String,
    headers: Option<serde_json::Map<String, serde_json::Value>>,
    app_handle: AppHandle,
) -> Result<serde_json::Value, String> {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};

    let api_config = ApiConfig::default();
    let full_url = if url.starts_with("http") { url.clone() } else { format!("{}{}", api_config.api_base_url, url) };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    // try load credentials (might be None)
    let mut credentials = load_credentials(app_handle.clone()).await.unwrap_or(None);

    let mut header_map = HeaderMap::new();
    if let Some(hdrs) = headers.as_ref() {
        for (k, v) in hdrs.iter() {
            if let Some(val) = v.as_str() {
                if let (Ok(hn), Ok(hv)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(val)) {
                    header_map.insert(hn, hv);
                }
            }
        }
    }

    // inject Authorization if not provided
    if !header_map.contains_key(AUTHORIZATION) {
        if let Some(ref creds) = credentials {
            if let Some(ref tokens) = creds.auth_tokens {
                header_map.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", tokens.access_token)).map_err(|e| e.to_string())?);
            } else {
                header_map.insert("X-User-Id", HeaderValue::from_str(&creds.user_id).map_err(|e| e.to_string())?);
                header_map.insert("X-User-App-Key", HeaderValue::from_str(&creds.user_app_key).map_err(|e| e.to_string())?);
            }
        }
    }

    let request_once = |hm: HeaderMap| async {
        let resp = client.get(&full_url).headers(hm).send().await.map_err(|e| format!("HTTP error: {}", e))?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
        let json = serde_json::from_str::<serde_json::Value>(&text);
        if status.is_success() {
            json.map_err(|_| format!("Success but response is not valid JSON: {}", text))
        } else {
            Err(format!("HTTP {}: {}", status, text))
        }
    };

    match request_once(header_map.clone()).await {
        Ok(val) => Ok(val),
        Err(e) if e.starts_with("HTTP 401") && credentials.as_ref().and_then(|c| c.auth_tokens.as_ref()).is_some() => {
            // refresh and retry
            ensure_valid_token(&client, &api_config, credentials.as_mut().unwrap(), &app_handle).await?;
            let mut hm = header_map;
            if let Some(ref creds) = credentials {
                if let Some(ref tokens) = creds.auth_tokens {
                    hm.remove(AUTHORIZATION);
                    hm.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", tokens.access_token)).map_err(|e| e.to_string())?);
                }
            }
            request_once(hm).await
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn proxy_api_post(
    url: String,
    headers: Option<serde_json::Map<String, serde_json::Value>>,
    body: Option<serde_json::Value>,
    app_handle: AppHandle,
) -> Result<serde_json::Value, String> {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};

    let api_config = ApiConfig::default();
    let full_url = if url.starts_with("http") { url.clone() } else { format!("{}{}", api_config.api_base_url, url) };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    // try load credentials (might be None)
    let mut credentials = load_credentials(app_handle.clone()).await.unwrap_or(None);

    // build headers
    let mut header_map = HeaderMap::new();
    if let Some(hdrs) = headers.as_ref() {
        for (k, v) in hdrs.iter() {
            if let Some(val) = v.as_str() {
                if let (Ok(hn), Ok(hv)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(val)) {
                    header_map.insert(hn, hv);
                }
            }
        }
    }
    header_map.entry(CONTENT_TYPE).or_insert(HeaderValue::from_static("application/json"));

    let mut effective_body = body.unwrap_or(serde_json::json!({}));

    // inject auth if Authorization missing
    if !header_map.contains_key(AUTHORIZATION) {
        if let Some(ref creds) = credentials {
            if let Some(ref tokens) = creds.auth_tokens {
                header_map.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", tokens.access_token)).map_err(|e| e.to_string())?);
            } else {
                // legacy: Pipe expects creds in body for POST
                if !effective_body.get("user_id").is_some() {
                    effective_body["user_id"] = serde_json::Value::String(creds.user_id.clone());
                }
                if !effective_body.get("user_app_key").is_some() {
                    effective_body["user_app_key"] = serde_json::Value::String(creds.user_app_key.clone());
                }
            }
        }
    }

    async fn request_once(client: &reqwest::Client, full_url: &str, hm: HeaderMap, b: serde_json::Value) -> Result<serde_json::Value, String> {
        let resp = client.post(full_url).headers(hm).json(&b).send().await.map_err(|e| format!("HTTP error: {}", e))?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
        let json = serde_json::from_str::<serde_json::Value>(&text);
        if status.is_success() {
            json.map_err(|_| format!("Success but response is not valid JSON: {}", text))
        } else {
            Err(format!("HTTP {}: {}", status, text))
        }
    }

    match request_once(&client, &full_url, header_map.clone(), effective_body.clone()).await {
        Ok(val) => Ok(val),
        Err(e) if e.starts_with("HTTP 401") && credentials.as_ref().and_then(|c| c.auth_tokens.as_ref()).is_some() => {
            // refresh and retry
            ensure_valid_token(&client, &api_config, credentials.as_mut().unwrap(), &app_handle).await?;
            let mut hm = header_map;
            if let Some(ref creds) = credentials {
                if let Some(ref tokens) = creds.auth_tokens {
                    hm.remove(AUTHORIZATION);
                    hm.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", tokens.access_token)).map_err(|e| e.to_string())?);
                }
            }
            request_once(&client, &full_url, hm, effective_body).await
        }
        Err(e) => Err(e),
    }
}

// =============================================================================================================
// =============================================== TOKEN USAGE =================================================
// =============================================================================================================

#[tauri::command]
pub async fn get_token_usage(period: String, credentials: Option<SavedCredentials>) -> Result<serde_json::Value, String> {
    use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
    let client = reqwest::Client::new();

    let user_id = credentials.as_ref().ok_or("user_id parameter is required")?.user_id.clone();
    let api_config = ApiConfig::default();
    let url = format!(
        "{}{}?user_id={}&period={}&detailed=false",
        api_config.api_base_url,
        api_config.token_usage,
        user_id,
        period
    );

    let mut req = client.get(&url).header(CONTENT_TYPE, "application/json");
    if let Some(creds) = credentials {
        if let Some(tokens) = creds.auth_tokens {
            req = req.header(AUTHORIZATION, format!("Bearer {}", tokens.access_token));
        }
    }

    let resp = req.send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Invalid JSON: {}", e))?;
    if status.is_success() { Ok(json) } else { Err(format!("HTTP {}: {}", status, json)) }
}

// =============================================================================================================
// =============================================== AUTH / CREDS ================================================
// =============================================================================================================

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub csrf_token: Option<String>,
}

#[tauri::command]
pub async fn register_user(username: String, password: String, app_handle: AppHandle) -> Result<SavedCredentials, String> {
    let api_config = ApiConfig::default();
    let url = format!("{}{}", api_config.api_base_url, api_config.auth_register);
    let client = reqwest::Client::new();
    let request_body = serde_json::json!({ "username": username.clone(), "password": password.clone() });

    let response = client.post(&url).json(&request_body).send().await.map_err(|e| format!("Register request failed: {}", e))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    if !status.is_success() {
        return Err(format!("Register failed - Status: {}, Response: {}", status, text));
    }

    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {}", e))?;
    let user_id = json.get("user_id").and_then(|v| v.as_str()).ok_or("No user_id in response")?.to_string();
    let user_app_key = json.get("user_app_key").and_then(|v| v.as_str()).ok_or("No user_app_key in response")?.to_string();
    let username_resp = json.get("username").and_then(|v| v.as_str()).map(|s| s.to_string());

    let creds = SavedCredentials {
        user_id,
        user_app_key,
        auth_tokens: None,
        username: username_resp,
    };
    save_credentials(creds.clone(), app_handle).await?;
    Ok(creds)
}

#[tauri::command]
pub async fn login_user(username: String, password: String, app_handle: AppHandle) -> Result<SavedCredentials, String> {
    let api_config = ApiConfig::default();
    let url = format!("{}{}", api_config.api_base_url, api_config.auth_login);
    let client = reqwest::Client::new();
    let request_body = serde_json::json!({ "username": username.clone(), "password": password.clone() });

    let response = client.post(&url).json(&request_body).send().await.map_err(|e| format!("Login request failed: {}", e))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    if !status.is_success() {
        return Err(format!("Login failed - Status: {}, Response: {}", status, text));
    }

    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {}", e))?;
    let user_id = json.get("user_id").and_then(|v| v.as_str()).ok_or("No user_id in response")?.to_string();
    let user_app_key = json.get("user_app_key").and_then(|v| v.as_str()).ok_or("No user_app_key in response")?.to_string();
    let username_resp = json.get("username").and_then(|v| v.as_str()).map(|s| s.to_string());
    let tokens = json.get("auth_tokens").cloned();

    let auth_tokens = if let Some(t) = tokens {
        serde_json::from_value::<AuthTokens>(t).ok()
    } else {
        None
    };

    let creds = SavedCredentials {
        user_id,
        user_app_key,
        auth_tokens,
        username: username_resp,
    };
    save_credentials(creds.clone(), app_handle).await?;
    Ok(creds)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtendedAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub csrf_token: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SavedCredentials {
    pub user_id: String,
    pub user_app_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_tokens: Option<AuthTokens>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct CreateUserRequest { pub username: String }

#[derive(Serialize, Deserialize, Debug)]
pub struct CreateUserResponse { pub user_id: String, pub user_app_key: String, pub solana_pubkey: String }

#[derive(Serialize, Debug)]
pub struct LoginRequest { pub username: String, pub password: String }

#[derive(Serialize, Debug)]
pub struct SetPasswordRequest { pub user_id: String, pub user_app_key: String, pub new_password: String }

#[derive(Serialize, Debug)]
pub struct RefreshTokenRequest { pub refresh_token: String }

#[derive(Deserialize, Debug)]
pub struct RefreshTokenResponse { pub access_token: String, pub expires_in: i64 }

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiConfig {
    pub api_base_url: String,
    pub auth_login: String,
    pub auth_refresh: String,
    pub auth_register: String,
    pub auth_reset_password: String,
    pub auth_set_password: String,
    pub upload: String,
    pub get_tier_pricing: Option<String>,
    pub download: String,
    pub check_wallet: String,
    pub check_custom_token: String,
    pub exchange_sol_for_tokens: String,
    pub token_usage: String,
    pub withdraw_sol: String,
    pub create_public_link: String,
    pub delete_public_link: String,
}

impl ApiConfig {
    #[allow(dead_code)]
    pub fn load_from_file(path: std::path::PathBuf) -> Result<Self, String> {
        let data = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read config file: {}", e))?;
        serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse config file: {}", e))
    }
}

impl Default for ApiConfig {
    fn default() -> Self {
        const JSON: &str = include_str!("../../../src/api_endpoints.json");
        let mut config: ApiConfig = serde_json::from_str(JSON).expect("Failed to parse api_endpoints.json");
        // Convert get_tier_pricing to Option if empty string
        if config.get_tier_pricing.as_deref() == Some("") {
            config.get_tier_pricing = None;
        }
        config
    }
}

fn is_token_expired(auth_tokens: &AuthTokens) -> bool {
    if let Some(expires_at_str) = &auth_tokens.expires_at {
        if let Ok(expires_at) = DateTime::parse_from_rfc3339(expires_at_str) {
            let now = Utc::now();
            let buffer = chrono::Duration::minutes(5);
            now + buffer >= expires_at.with_timezone(&Utc)
        } else {
            println!("⚠️ Failed to parse expires_at: {}", expires_at_str);
            true
        }
    } else {
        true
    }
}

async fn ensure_valid_token(
    client: &reqwest::Client,
    api_config: &ApiConfig,
    credentials: &mut SavedCredentials,
    app_handle: &AppHandle,
) -> Result<(), String> {
    if let Some(ref auth_tokens) = credentials.auth_tokens {
        if is_token_expired(auth_tokens) {
            println!("🔄 Token expired or expiring soon, refreshing...");

            let refresh_url = format!("{}{}", api_config.api_base_url, api_config.auth_refresh);
            let req_body = RefreshTokenRequest { refresh_token: auth_tokens.refresh_token.clone() };

            let response = client
                .post(&refresh_url)
                .json(&req_body)
                .send()
                .await
                .map_err(|e| format!("Token refresh request failed: {}", e))?;

            if response.status().is_success() {
                let refresh_response: RefreshTokenResponse = response
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|e| format!("System time error: {}", e))?
                    .as_secs() as i64;
                let expires_at = DateTime::<Utc>::from_timestamp(now + refresh_response.expires_in, 0)
                    .ok_or_else(|| "Invalid expiration timestamp".to_string())?;

                if let Some(ref mut tokens) = credentials.auth_tokens {
                    tokens.access_token = refresh_response.access_token;
                    tokens.expires_in = refresh_response.expires_in;
                    tokens.expires_at = Some(expires_at.to_rfc3339());
                }

                save_credentials(credentials.clone(), app_handle.clone()).await
                    .map_err(|e| format!("Failed to save refreshed credentials: {}", e))?;
                println!("✅ Token refreshed successfully!");
            } else {
                let error_text = response.text().await.unwrap_or_default();
                println!("❌ Token refresh failed: {}", error_text);
                credentials.auth_tokens = None;
                save_credentials(credentials.clone(), app_handle.clone()).await
                    .map_err(|e| format!("Failed to clear invalid credentials: {}", e))?;
                return Err("Token refresh failed, please login again".to_string());
            }
        }
    }
    Ok(())
}

pub type ApiConfigState = Mutex<ApiConfig>;
pub fn new_api_config_state(config: ApiConfig) -> ApiConfigState { Mutex::new(config) }

#[tauri::command]
pub async fn get_api_config() -> Result<ApiConfig, String> { Ok(ApiConfig::default()) }

#[tauri::command]
pub async fn get_config_path() -> Result<String, String> { Ok("src/api_endpoints.json".to_string()) }

// =============================================================================================================
// ============================================== FILE OPERATIONS ==============================================
// =============================================================================================================

#[tauri::command]
pub async fn get_file_size(path: String) -> Result<u64, String> {
    let md = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("metadata error: {}", e))?;
    Ok(md.len())
}

#[tauri::command]
pub async fn upload_file(
    file_path: String,
    tier: Option<String>,
    epochs: Option<u32>,
    remote_file_name: Option<String>,
    id: Option<String>,
    _config: State<'_, ApiConfigState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    use futures_util::TryStreamExt;
    use percent_encoding::utf8_percent_encode;
    use reqwest::Client;
    use std::path::Path;
    use tauri::Emitter;
    use tokio_util::io::ReaderStream;

    // Load credentials & config
    let credentials_opt = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?;
    let mut credentials = credentials_opt.ok_or("No saved credentials found")?;
    let api_config = ApiConfig::default();
    let client = Client::new();

    // Ensure token valid
    ensure_valid_token(&client, &api_config, &mut credentials, &app_handle).await?;

    // Validate file
    let path = Path::new(&file_path);
    if !path.exists() {
        let entry = UploadLogEntry {
            local_path: file_path.clone(),
            remote_path: "".to_string(),
            status: "failed".to_string(),
            message: format!("File not found: {}", file_path),
            blake3_hash: "".to_string(),
            file_size: 0,
            timestamp: Utc::now().to_rfc3339(),
        };
        let _ = append_upload_log(&credentials.user_id, &entry, &app_handle);
        return Err(format!("File not found: {}", file_path));
    }

    // Remote name
    let file_name = if let Some(ref custom) = remote_file_name {
        if !custom.trim().is_empty() { custom.as_str() } else { path.file_name().and_then(|n| n.to_str()).ok_or("Invalid file name")? }
    } else {
        path.file_name().and_then(|n| n.to_str()).ok_or("Invalid file name")?
    };

    let encoded_name = utf8_percent_encode(file_name, QUERY_ENCODE_SET);
    let upload_url = format!("{}{}", api_config.api_base_url, api_config.upload);

    let mut params = vec![format!("file_name={}", encoded_name)];
    if let Some(t) = &tier { params.push(format!("tier={}", utf8_percent_encode(t, QUERY_ENCODE_SET))); }
    if let Some(e) = epochs { params.push(format!("epochs={}", e)); }
    let full_url = format!("{}?{}", upload_url, params.join("&"));

    // Open file for streaming
    let file = tokio::fs::File::open(&file_path).await.map_err(|e| format!("Failed to open file: {}", e))?;
    let file_size = std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);

    let uploaded: u64 = 0;
    let hasher = Arc::new(Mutex::new(blake3::Hasher::new()));

    // Progress stream
    let app_handle_clone = app_handle.clone();
    let uploaded_arc = Arc::new(Mutex::new(uploaded));
    let hasher_clone = hasher.clone();
    let uploaded_clone = uploaded_arc.clone();
    let id_clone = id.clone();

    let stream = ReaderStream::new(file).inspect_ok(move |chunk| {
        if let Ok(mut h) = hasher_clone.lock() { h.update(&chunk); }
        if let Ok(mut up) = uploaded_clone.lock() {
            *up += chunk.len() as u64;
            let percent = if file_size > 0 { ((*up as f64 / file_size as f64) * 100.0).min(100.0) } else { 0.0 };
            let _ = app_handle_clone.emit("upload_progress", serde_json::json!({
                "id": id_clone,
                "percent": percent as u32,
                "uploaded": *up,
                "total": file_size
            }));
        }
    });

    // Build request
    let mut request = client.post(&full_url);
    if let Some(ref auth_tokens) = credentials.auth_tokens {
        request = request.header("Authorization", format!("Bearer {}", auth_tokens.access_token));
    } else {
        request = request
            .header("X-User-Id", &credentials.user_id)
            .header("X-User-App-Key", &credentials.user_app_key);
    }

    let response = request
        .body(reqwest::Body::wrap_stream(stream))
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    let blake3_hash = hasher.lock().unwrap().finalize().to_hex().to_string();

    let entry = UploadLogEntry {
        local_path: file_path.clone(),
        remote_path: file_name.to_string(),
        status: if status.is_success() { "success" } else { "failed" }.to_string(),
        message: response_text.clone(),
        blake3_hash: blake3_hash.clone(),
        file_size,
        timestamp: Utc::now().to_rfc3339(),
    };
    let _ = append_upload_log(&credentials.user_id, &entry, &app_handle);

    if status.is_success() {
        let _ = app_handle.emit("upload_progress", serde_json::json!({
            "id": id,
            "percent": 100,
            "uploaded": file_size,
            "total": file_size
        }));
        Ok(format!("File '{}' uploaded successfully", file_name))
    } else {
        Err(format!("Upload failed - Status: {}, Response: {}", status, response_text))
    }
}

#[tauri::command]
pub async fn download_file(
    file_name: String,
    output_path: String,
    _config: State<'_, ApiConfigState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    use percent_encoding::utf8_percent_encode;
    use reqwest::Client;
    use std::path::Path;

    let credentials_opt = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?;
    let mut credentials = credentials_opt.ok_or("No saved credentials found")?;
    let api_config = ApiConfig::default();
    let client = Client::new();

    ensure_valid_token(&client, &api_config, &mut credentials, &app_handle).await?;

    let encoded_name = utf8_percent_encode(&file_name, QUERY_ENCODE_SET);
    let download_url = format!("{}{}", api_config.api_base_url, api_config.download);
    let full_url = format!("{}?file_name={}", download_url, encoded_name);

    println!("📥 Downloading {} from {}", file_name, download_url);

    let mut request = client.get(&full_url);
    if let Some(ref auth_tokens) = credentials.auth_tokens {
        request = request.header("Authorization", format!("Bearer {}", auth_tokens.access_token));
    } else {
        request = request
            .header("X-User-Id", &credentials.user_id)
            .header("X-User-App-Key", &credentials.user_app_key);
    }

    let response = request.send().await.map_err(|e| format!("Download request failed: {}", e))?;
    let _status = response.status();

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut total_size: Option<u64> = None;
    if let Some(len) = response.content_length() {
        total_size = Some(len);
    }

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let _file_bytes: Vec<u8> = Vec::new();

    let final_path = if output_path.is_empty() {
        file_name.clone()
    } else {
        let path = Path::new(&output_path);
        if path.is_dir() || output_path.ends_with('/') || output_path.ends_with('\\') {
            format!("{}/{}", output_path.trim_end_matches('/').trim_end_matches('\\'), file_name)
        } else {
            output_path
        }
    };

    if let Some(parent) = Path::new(&final_path).parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let mut file = tokio::fs::File::create(&final_path).await.map_err(|e| format!("Failed to create file: {}", e))?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download chunk error: {}", e))?;
        file.write_all(&chunk).await.map_err(|e| format!("Failed to write chunk: {}", e))?;
        downloaded += chunk.len() as u64;

        // Emit progress event
        let percent = if let Some(size) = total_size {
            ((downloaded as f64 / size as f64) * 100.0).min(100.0)
        } else {
            0.0
        };
        let payload = serde_json::json!({
            "file_name": file_name,
            "downloaded": downloaded,
            "total": total_size,
            "percent": percent,
            "output_path": final_path
        });
        app_handle.emit("download_progress", payload).ok();
    }

    if downloaded > 0 {
        println!("✅ Download successful: saved to {}", final_path);
        Ok(format!("File '{}' downloaded to '{}'", file_name, final_path))
    } else {
        Err("No file data received".to_string())
    }
}


#[tauri::command]
pub async fn user_login(
    username: String,
    password: String,
    app_handle: AppHandle,
) -> Result<String, String> {
    let _users = list_saved_users(app_handle.clone()).await?;
    let api_config = ApiConfig::default();
    let url = format!("{}{}", api_config.api_base_url, api_config.auth_login);

    println!("🔄 Attempting login for user: {} to URL: {}", username, url);

    let client = reqwest::Client::new();
    let request_body = LoginRequest { username: username.clone(), password };

    let response = client.post(&url).json(&request_body).send().await.map_err(|e| format!("Request failed: {}", e))?;
    println!("📡 Login response status: {}", response.status());

    if response.status().is_success() {
        let mut auth_tokens: AuthTokens = response.json().await.map_err(|e| format!("Failed to parse response: {}", e))?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| format!("System time error: {}", e))?.as_secs() as i64;
        let expires_at = DateTime::<Utc>::from_timestamp(now + auth_tokens.expires_in, 0).ok_or_else(|| "Invalid expiration timestamp".to_string())?;
        auth_tokens.expires_at = Some(expires_at.to_rfc3339());
        println!("✅ Login successful, token expires in: {} seconds ({})", auth_tokens.expires_in, expires_at);
        serde_json::to_string(&auth_tokens).map_err(|e| format!("Failed to serialize auth tokens: {}", e))
    } else {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        println!("❌ Login failed - Status: {}, Response: {}", status, error_text);
        Err(format!("Login failed. Status: {}, Error: {}", status, error_text))
    }
}

#[tauri::command]
pub async fn test_api_connection(base_url: String) -> Result<String, String> {
    let test_url = format!("{}/health", base_url.trim_end_matches('/'));
    println!("Testing connection to: {}", test_url);

    let client = reqwest::Client::new();
    match client.get(&test_url).send().await {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                match response.json::<serde_json::Value>().await {
                    Ok(health_data) => {
                        if let (Some(status_val), Some(version_val)) = (
                            health_data.get("status").and_then(|v| v.as_str()),
                            health_data.get("version").and_then(|v| v.as_str())
                        ) {
                            Ok(format!("✅ Connection successful! Server is {} (v{})", status_val, version_val))
                        } else {
                            Ok("✅ Connection successful! Server responded normally.".to_string())
                        }
                    }
                    Err(_) => Ok(format!("✅ Connection successful! Server responded with status {}", status)),
                }
            } else {
                Err(format!("Server responded with status: {} {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown")))
            }
        }
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("dns") || error_msg.contains("resolve") {
                Err("DNS resolution failed. Please check the URL.".to_string())
            } else if error_msg.contains("connect") || error_msg.contains("timeout") {
                Err("Connection timeout. Please check the URL and network.".to_string())
            } else if error_msg.contains("certificate") || error_msg.contains("tls") {
                Err("SSL/TLS certificate error. Please check the HTTPS URL.".to_string())
            } else {
                Err(format!("Network error: {}", error_msg))
            }
        }
    }
}

#[tauri::command]
pub async fn set_user_password(
    state: tauri::State<'_, ApiConfigState>,
    user_id: String,
    user_app_key: String,
    new_password: String,
) -> Result<String, String> {
    use reqwest::Client;
    use serde_json::json;

    println!("[set_user_password] Called for user_id: {}", user_id);
    let endpoint = {
        let config = state.lock().unwrap();
        format!("{}{}", config.api_base_url, config.auth_set_password)
    };
    println!("[set_user_password] Endpoint: {}", endpoint);
    let payload = json!({
        "user_id": user_id,
        "user_app_key": user_app_key,
        "new_password": new_password
    });
    println!("[set_user_password] Payload: {}", payload);
    let client = Client::new();
    let res = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| {
            println!("[set_user_password] Request error: {}", e);
            format!("Request error: {}", e)
        })?;
    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| {
            println!("[set_user_password] Read body error: {}", e);
            format!("Read body error: {}", e)
        })?;
    println!("[set_user_password] Response status: {}", status);
    println!("[set_user_password] Response body: {}", text);
    if !status.is_success() {
        println!("[set_user_password] Failed to set password. HTTP {}: {}", status.as_u16(), text);
        return Err(format!(
            "Failed to set password. HTTP {}: {}",
            status.as_u16(),
            text
        ));
    }
    println!("[set_user_password] Password set successfully for user_id: {}", user_id);
    Ok(text)
}

// === CREDENTIALS MANAGEMENT ===

#[tauri::command]
pub async fn save_credentials(credentials: SavedCredentials, app_handle: AppHandle) -> Result<(), String> {
    use std::fs;
    println!("🔄 Saving credentials for user: {}", credentials.user_id);

    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let user_dir = app_data_dir.join(&credentials.user_id);
    fs::create_dir_all(&user_dir).map_err(|e| format!("Failed to create user directory: {}", e))?;

    let credentials_path = user_dir.join(format!("{}.json", credentials.user_id));
    let json_content = serde_json::to_string_pretty(&credentials).map_err(|e| format!("Failed to serialize credentials: {}", e))?;
    fs::write(&credentials_path, json_content).map_err(|e| format!("Failed to write credentials file: {}", e))?;

    println!("✅ Credentials saved to: {:?}", credentials_path);
    Ok(())
}

#[tauri::command]
pub async fn load_credentials(app_handle: AppHandle) -> Result<Option<SavedCredentials>, String> {
    use std::fs;

    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| format!("Failed to get app data directory: {}", e))?;
    if !app_data_dir.exists() { return Ok(None); }

    let mut latest_credentials: Option<SavedCredentials> = None;
    let mut latest_time = std::time::SystemTime::UNIX_EPOCH;

    if let Ok(entries) = fs::read_dir(&app_data_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                let user_id = entry.file_name().to_string_lossy().to_string();
                let credentials_path = entry.path().join(format!("{}.json", user_id));

                if credentials_path.exists() {
                    if let Ok(metadata) = credentials_path.metadata() {
                        if let Ok(modified) = metadata.modified() {
                            if modified > latest_time {
                                if let Ok(content) = fs::read_to_string(&credentials_path) {
                                    if let Ok(credentials) = serde_json::from_str::<SavedCredentials>(&content) {
                                        latest_credentials = Some(credentials);
                                        latest_time = modified;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(ref creds) = latest_credentials { println!("✅ Loaded credentials for user: {}", creds.user_id); }
    Ok(latest_credentials)
}

#[tauri::command]
pub async fn clear_credentials(user_id: String, app_handle: AppHandle) -> Result<(), String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let user_dir = app_data_dir.join(&user_id);

    if user_dir.exists() {
        std::fs::remove_dir_all(&user_dir).map_err(|e| format!("Failed to remove user directory: {}", e))?;
        println!("✅ User credentials cleared for: {}", user_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn list_saved_users(app_handle: AppHandle) -> Result<Vec<SavedCredentials>, String> {
    use std::fs;

    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let mut users = Vec::new();

    if !app_data_dir.exists() { return Ok(users); }

    if let Ok(entries) = fs::read_dir(&app_data_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                let user_id = entry.file_name().to_string_lossy().to_string();
                let credentials_path = entry.path().join(format!("{}.json", user_id));
                if credentials_path.exists() {
                    if let Ok(content) = fs::read_to_string(&credentials_path) {
                        if let Ok(credentials) = serde_json::from_str::<SavedCredentials>(&content) {
                            users.push(credentials);
                        }
                    }
                }
            }
        }
    }

    users.sort_by(|a, b| {
        let a_name = a.username.as_deref().unwrap_or(&a.user_id);
        let b_name = b.username.as_deref().unwrap_or(&b.user_id);
        a_name.cmp(b_name)
    });

    Ok(users)
}

#[tauri::command]
pub async fn refresh_token(_config: State<'_, ApiConfigState>, app_handle: AppHandle) -> Result<String, String> {
    use reqwest::Client;

    let credentials_opt = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?;
    let mut credentials = credentials_opt.ok_or("No saved credentials found")?;
    let api_config = ApiConfig::default();
    let client = Client::new();

    ensure_valid_token(&client, &api_config, &mut credentials, &app_handle).await?;
    Ok("Token refreshed successfully".to_string())
}

// =============================================================================================================
// ============================================== WALLET/TOKEN ENDPOINTS =======================================
// =============================================================================================================

#[tauri::command]
pub async fn get_tier_pricing(_app_handle: AppHandle) -> Result<serde_json::Value, String> {
    let api_config = ApiConfig::default();
    let url = if let Some(endpoint) = &api_config.get_tier_pricing {
        format!("{}{}", api_config.api_base_url, endpoint)
    } else {
        return Err("Tier pricing endpoint not configured".to_string());
    };
    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Invalid JSON: {}", e))?;
    if status.is_success() { Ok(json) } else { Err(format!("HTTP {}: {}", status, json)) }
}

#[tauri::command]
 #[allow(dead_code)]
 pub async fn check_wallet(app_handle: AppHandle) -> Result<serde_json::Value, String> {
    let credentials_opt = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?;
    let credentials = credentials_opt.ok_or("No saved credentials found")?;
    let api_config = ApiConfig::default();
    let url = format!("{}{}", api_config.api_base_url, api_config.check_wallet);
    let client = reqwest::Client::new();
    let mut req = client.post(&url);
    if let Some(tokens) = credentials.auth_tokens {
        req = req.header("Authorization", format!("Bearer {}", tokens.access_token));
    } else {
        req = req.header("X-User-Id", &credentials.user_id).header("X-User-App-Key", &credentials.user_app_key);
    }
    let body = serde_json::json!({ "user_id": credentials.user_id, "user_app_key": credentials.user_app_key });
    let resp = req.json(&body).send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Invalid JSON: {}", e))?;
    if status.is_success() { Ok(json) } else { Err(format!("HTTP {}: {}", status, json)) }
}

#[tauri::command]
 #[allow(dead_code)]
 pub async fn check_custom_token(app_handle: AppHandle, token: String) -> Result<serde_json::Value, String> {
    let credentials_opt = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?;
    let credentials = credentials_opt.ok_or("No saved credentials found")?;
    let api_config = ApiConfig::default();
    let url = format!("{}{}", api_config.api_base_url, api_config.check_custom_token);
    let client = reqwest::Client::new();
    let mut req = client.post(&url);
    if let Some(tokens) = credentials.auth_tokens {
        req = req.header("Authorization", format!("Bearer {}", tokens.access_token));
    } else {
        req = req.header("X-User-Id", &credentials.user_id).header("X-User-App-Key", &credentials.user_app_key);
    }
    let body = serde_json::json!({ "user_id": credentials.user_id, "user_app_key": credentials.user_app_key, "token": token });
    let resp = req.json(&body).send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Invalid JSON: {}", e))?;
    if status.is_success() { Ok(json) } else { Err(format!("HTTP {}: {}", status, json)) }
}

#[tauri::command]
 #[allow(dead_code)]
 pub async fn exchange_sol_for_tokens(app_handle: AppHandle, amount: f64) -> Result<serde_json::Value, String> {
    let credentials_opt = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?;
    let credentials = credentials_opt.ok_or("No saved credentials found")?;
    let api_config = ApiConfig::default();
    let url = format!("{}{}", api_config.api_base_url, api_config.exchange_sol_for_tokens);
    let client = reqwest::Client::new();
    let mut req = client.post(&url);
    if let Some(tokens) = credentials.auth_tokens {
        req = req.header("Authorization", format!("Bearer {}", tokens.access_token));
    } else {
        req = req.header("X-User-Id", &credentials.user_id).header("X-User-App-Key", &credentials.user_app_key);
    }
    let body = serde_json::json!({ "user_id": credentials.user_id, "user_app_key": credentials.user_app_key, "amount": amount });
    let resp = req.json(&body).send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Invalid JSON: {}", e))?;
    if status.is_success() { Ok(json) } else { Err(format!("HTTP {}: {}", status, json)) }
}

#[tauri::command]
 #[allow(dead_code)]
 pub async fn withdraw_sol(app_handle: AppHandle, to_address: String, amount: f64) -> Result<serde_json::Value, String> {
    let credentials_opt = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?;
    let credentials = credentials_opt.ok_or("No saved credentials found")?;
    let api_config = ApiConfig::default();
    let url = format!("{}{}", api_config.api_base_url, api_config.withdraw_sol);
    let client = reqwest::Client::new();
    let mut req = client.post(&url);
    if let Some(tokens) = credentials.auth_tokens {
        req = req.header("Authorization", format!("Bearer {}", tokens.access_token));
    } else {
        req = req.header("X-User-Id", &credentials.user_id).header("X-User-App-Key", &credentials.user_app_key);
    }
    let body = serde_json::json!({ "user_id": credentials.user_id, "user_app_key": credentials.user_app_key, "to_address": to_address, "amount": amount });
    let resp = req.json(&body).send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Invalid JSON: {}", e))?;
    if status.is_success() { Ok(json) } else { Err(format!("HTTP {}: {}", status, json)) }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PublicLinkEntry {
    pub remote_path: String,
    pub link_hash: String,
    pub created_at: String,
    pub custom_title: Option<String>,
    pub custom_description: Option<String>,
}

fn get_link_file_path(user_id: &str, app_handle: &AppHandle) -> Result<PathBuf, String> {
    let user_dir = get_user_data_dir(user_id, app_handle)?;
    Ok(user_dir.join(format!("link-{}.json", user_id)))
}

fn read_public_links(user_id: &str, app_handle: &AppHandle) -> Result<Vec<PublicLinkEntry>, String> {
    let path = get_link_file_path(user_id, app_handle)?;
    if !path.exists() { return Ok(vec![]); }
    let content = std::fs::read_to_string(&path).map_err(|e| format!("Failed to read link file: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse link file: {}", e))
}

fn write_public_links(user_id: &str, links: &[PublicLinkEntry], app_handle: &AppHandle) -> Result<(), String> {
    use std::fs;
    let path = get_link_file_path(user_id, app_handle)?;
    if let Some(dir) = path.parent() { if !dir.exists() { fs::create_dir_all(dir).map_err(|e| format!("Failed to create user dir: {}", e))?; } }
    let json = serde_json::to_string_pretty(links).map_err(|e| format!("Failed to serialize links: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write link file: {}", e))
}

#[tauri::command]
pub async fn create_public_link(
    user_id: String,
    remote_path: String,
    custom_title: Option<String>,
    custom_description: Option<String>,
    app_handle: AppHandle,
) -> Result<PublicLinkEntry, String> {
    use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};

    let mut credentials = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?
        .ok_or("No saved credentials found")?;
    let api_config = ApiConfig::default();
    let client = reqwest::Client::new();
    ensure_valid_token(&client, &api_config, &mut credentials, &app_handle).await?;

    let tokens = credentials.auth_tokens.as_ref().ok_or("No valid auth tokens")?;

    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", tokens.access_token)).unwrap());
    if let Some(csrf) = &tokens.csrf_token { headers.insert("X-Csrf-Token", HeaderValue::from_str(csrf).unwrap()); }

    let mut body = serde_json::json!({ "file_name": remote_path });
    if let Some(title) = &custom_title { body["custom_title"] = serde_json::Value::String(title.clone()); }
    if let Some(desc) = &custom_description { body["custom_description"] = serde_json::Value::String(desc.clone()); }

    let url = format!("{}{}", api_config.api_base_url, api_config.create_public_link);
    let resp = client.post(&url).headers(headers).json(&body).send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    if !status.is_success() { return Err(format!("HTTP {}: {}", status, text)); }

    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {}", e))?;
    let link_hash = json.get("link_hash").and_then(|v| v.as_str()).ok_or("No link_hash in response")?.to_string();

    let entry = PublicLinkEntry {
        remote_path: remote_path.clone(),
        link_hash: link_hash.clone(),
        created_at: Utc::now().to_rfc3339(),
        custom_title,
        custom_description,
    };

    let mut links = read_public_links(&user_id, &app_handle).unwrap_or_default();
    links.push(entry.clone());
    let _ = write_public_links(&user_id, &links, &app_handle);

    Ok(entry)
}

#[tauri::command]
pub async fn delete_public_link(
    user_id: String,
    link_hash: String,
    app_handle: AppHandle,
) -> Result<String, String> {
    use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};

    let mut credentials = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?
        .ok_or("No saved credentials found")?;
    let api_config = ApiConfig::default();
    let client = reqwest::Client::new();
    ensure_valid_token(&client, &api_config, &mut credentials, &app_handle).await?;

    let tokens = credentials.auth_tokens.as_ref().ok_or("No valid auth tokens")?;

    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", tokens.access_token)).unwrap());
    if let Some(csrf) = &tokens.csrf_token { headers.insert("X-Csrf-Token", HeaderValue::from_str(csrf).unwrap()); }

    let body = serde_json::json!({ "link_hash": link_hash });
    let url = format!("{}{}", api_config.api_base_url, api_config.delete_public_link);

    let resp = client.post(&url).headers(headers).json(&body).send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    if !status.is_success() { return Err(format!("HTTP {}: {}", status, text)); }

    let mut links = read_public_links(&user_id, &app_handle)?;
    let before = links.len();
    links.retain(|l| l.link_hash != link_hash);
    write_public_links(&user_id, &links, &app_handle)?;
    Ok(format!("Deleted {} ({} -> {})", link_hash, before, links.len()))
}

#[tauri::command]
pub async fn list_public_links(
    user_id: String,
    app_handle: AppHandle,
) -> Result<Vec<PublicLinkEntry>, String> {
    read_public_links(&user_id, &app_handle)
}
