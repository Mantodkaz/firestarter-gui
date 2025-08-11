/// Tauri command: get_upload_history
/// Read file log upload (list-upload-<user_id>.json)
#[tauri::command]
pub async fn get_upload_history(user_id: String, app_handle: AppHandle) -> Result<Vec<UploadLogEntry>, String> {
    use std::fs::File;
    use std::io::{BufRead, BufReader};
    // find log file path
    let user_dir = get_user_data_dir(&user_id, &app_handle)?;
    let log_path = user_dir.join(format!("list-upload-{}.json", user_id));
    if !log_path.exists() {
        return Ok(vec![]); // No log found
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
use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;
use std::fs::{OpenOptions, create_dir_all};
use chrono::Utc;
use serde::{Serialize, Deserialize};



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
    println!("[LOG] append_upload_log: user_id={}", user_id);
    let user_dir = match get_user_data_dir(user_id, app_handle) {
        Ok(dir) => dir,
        Err(e) => {
            println!("[LOG][ERROR] get_user_data_dir failed: {}", e);
            return Err(e);
        }
    };
    if !user_dir.exists() {
        match create_dir_all(&user_dir) {
            Ok(_) => println!("[LOG] Created user_dir: {:?}", user_dir),
            Err(e) => {
                println!("[LOG][ERROR] Failed to create user dir: {}", e);
                return Err(format!("Failed to create user dir: {}", e));
            }
        }
    }
    let log_path = user_dir.join(format!("list-upload-{}.json", user_id));
    println!("[LOG] Log path: {:?}", log_path);
    let mut file = match OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path) {
        Ok(f) => f,
        Err(e) => {
            println!("[LOG][ERROR] Failed to open log file: {}", e);
            return Err(format!("Failed to open log file: {}", e));
        }
    };
    let json = match serde_json::to_string(entry) {
        Ok(j) => j,
        Err(e) => {
            println!("[LOG][ERROR] Failed to serialize log entry: {}", e);
            return Err(format!("Failed to serialize log entry: {}", e));
        }
    };
    use std::io::Write;
    if let Err(e) = file.write_all(json.as_bytes()) {
        println!("[LOG][ERROR] Failed to write log: {}", e);
        return Err(format!("Failed to write log: {}", e));
    }
    if let Err(e) = file.write_all(b"\n") {
        println!("[LOG][ERROR] Failed to write newline: {}", e);
        return Err(format!("Failed to write newline: {}", e));
    }
    println!("[LOG] append_upload_log: SUCCESS");
    Ok(())
}

// reference: https://github.com/PipeNetwork/pipe/blob/main/src/lib.rs#L44
use percent_encoding::{AsciiSet, CONTROLS};
const QUERY_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')     // Space
    .add(b'"')     // Quote
    .add(b'#')     // Hash (fragment identifier)
    .add(b'<')     // Less than
    .add(b'>')     // Greater than
    .add(b'?')     // Question mark (query separator)
    .add(b'`')     // Backtick
    .add(b'{')     // Left brace
    .add(b'}')     // Right brace
    .add(b'|')     // Pipe
    .add(b'\\')    // Backslash
    .add(b'^')     // Caret
    .add(b'[')     // Left bracket
    .add(b']')     // Right bracket
    .add(b'%');    // Percent (to avoid double encoding)
// Generic API proxy commands for Wallet (GET/POST, endpoint/path always from frontend)
#[tauri::command]
pub async fn proxy_api_get(url: String, headers: Option<serde_json::Map<String, serde_json::Value>>) -> Result<serde_json::Value, String> {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
    let client = reqwest::Client::new();
    // If url is relative, prepend api_base_url
    let full_url = if url.starts_with("http") {
        url.clone()
    } else {
        let api_config = ApiConfig::default();
        format!("{}{}", api_config.api_base_url, url)
    };
    let mut req = client.get(&full_url);
    if let Some(hdrs) = headers {
        let mut header_map = HeaderMap::new();
        for (k, v) in hdrs.iter() {
            if let Some(val) = v.as_str() {
                if let Ok(hn) = HeaderName::from_bytes(k.as_bytes()) {
                    if let Ok(hv) = HeaderValue::from_str(val) {
                        header_map.insert(hn, hv);
                    }
                }
            }
        }
        req = req.headers(header_map);
    }
    let resp = req.send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let json_result = serde_json::from_str::<serde_json::Value>(&text);
    if status.is_success() {
        match json_result {
            Ok(json) => Ok(json),
            Err(_) => Err(format!("Success but response is not valid JSON: {}", text)),
        }
    } else {
        Err(format!("HTTP {}: {}", status, text))
    }
}

#[tauri::command]
pub async fn proxy_api_post(url: String, headers: Option<serde_json::Map<String, serde_json::Value>>, body: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
    let client = reqwest::Client::new();
    // If url is relative, prepend api_base_url
    let full_url = if url.starts_with("http") {
        url.clone()
    } else {
        let api_config = ApiConfig::default();
        format!("{}{}", api_config.api_base_url, url)
    };
    let mut req = client.post(&full_url);
    if let Some(hdrs) = headers {
        let mut header_map = HeaderMap::new();
        for (k, v) in hdrs.iter() {
            if let Some(val) = v.as_str() {
                if let Ok(hn) = HeaderName::from_bytes(k.as_bytes()) {
                    if let Ok(hv) = HeaderValue::from_str(val) {
                        header_map.insert(hn, hv);
                    }
                }
            }
        }
        req = req.headers(header_map);
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let json_result = serde_json::from_str::<serde_json::Value>(&text);
    if status.is_success() {
        match json_result {
            Ok(json) => Ok(json),
            Err(_) => Err(format!("Success but response is not valid JSON: {}", text)),
        }
    } else {
        Err(format!("HTTP {}: {}", status, text))
    }
}
// Token usage fetcher
#[tauri::command]
pub async fn get_token_usage(period: String, credentials: Option<SavedCredentials>) -> Result<serde_json::Value, String> {
// loaded from api_endpoints.json
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
let client = reqwest::Client::new();
let user_id = credentials.as_ref().ok_or("user_id parameter is required")?.user_id.clone();
// Build URL for token usage using ApiConfig fields
let api_config = ApiConfig::default();
    let url = format!(
        "{}{}?user_id={}&period={}&detailed=false",
        api_config.api_base_url,
        api_config.token_usage,
        user_id,
        period
    );
let mut req = client.get(&url);
if let Some(creds) = credentials {
    if let Some(tokens) = creds.auth_tokens {
        req = req.header(AUTHORIZATION, format!("Bearer {}", tokens.access_token));
    }
}
req = req.header(CONTENT_TYPE, "application/json");
let resp = req.send().await.map_err(|e| format!("HTTP error: {}", e))?;
let status = resp.status();
let json: serde_json::Value = resp.json().await.map_err(|e| format!("Invalid JSON: {}", e))?;
if status.is_success() {
    Ok(json)
} else {
    Err(format!("HTTP {}: {}", status, json))
}
}

use tauri::{State, Manager};
use chrono::DateTime;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// JWT Authentication structures
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>, // Store as ISO string
    #[serde(skip_serializing_if = "Option::is_none")]
    pub csrf_token: Option<String>,
}

#[tauri::command]
pub async fn register_user(username: String, _password: String) -> Result<String, String> {
    println!("🔄 Register user: {}", username);
    Ok(format!("User {} registered successfully", username))
}

#[tauri::command]
pub async fn login_user(username: String, _password: String) -> Result<String, String> {
    println!("🔄 Login user: {}", username);
    Ok(format!("User {} logged in successfully", username))
}

// Extended JWT token information
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtendedAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>, // Store as ISO string
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

// Request/Response structures
#[derive(Serialize, Debug)]
pub struct CreateUserRequest {
    pub username: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CreateUserResponse {
    pub user_id: String,
    pub user_app_key: String,
    pub solana_pubkey: String,
}

#[derive(Serialize, Debug)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize, Debug)]
pub struct SetPasswordRequest {
    pub user_id: String,
    pub user_app_key: String,
    pub new_password: String,
}

#[derive(Serialize, Debug)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
}

#[derive(Deserialize, Debug)]
pub struct RefreshTokenResponse {
    pub access_token: String,
    pub expires_in: i64,
    // Note: refresh token endpoint doesn't return new refresh_token, only new access_token
}


#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiConfig {
    pub api_base_url: String,
    pub auth_login: String,
    pub auth_refresh: String,
    pub auth_register: String,
    pub auth_reset_password: String,
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

impl Default for ApiConfig {
    fn default() -> Self {
        // Use compile-time include_str! to always embed config
    const JSON: &str = include_str!("../../../src/api_endpoints.json");
        serde_json::from_str(JSON).expect("Failed to parse api_endpoints.json")
    }
}

/// test
fn is_token_expired(auth_tokens: &AuthTokens) -> bool {
    if let Some(expires_at_str) = &auth_tokens.expires_at {
        if let Ok(expires_at) = DateTime::parse_from_rfc3339(expires_at_str) {
            let now = chrono::Utc::now();
            // Add 5 minute buffer before expiration
            let buffer = chrono::Duration::minutes(5);
            now + buffer >= expires_at.with_timezone(&chrono::Utc)
        } else {
            println!("⚠️ Failed to parse expires_at: {}", expires_at_str);
            true // Assume expired if we can't parse
        }
    } else {
        true
    }
}

/// Refresh JWT token if needed
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
            let req_body = RefreshTokenRequest {
                refresh_token: auth_tokens.refresh_token.clone(),
            };

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

                // Calculate new expires_at timestamp as ISO string
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|e| format!("System time error: {}", e))?
                    .as_secs() as i64;
                let expires_at = DateTime::<Utc>::from_timestamp(now + refresh_response.expires_in, 0)
                    .ok_or_else(|| "Invalid expiration timestamp".to_string())?;

                // Update auth tokens (keep existing refresh_token, only update access_token)
                if let Some(ref mut auth_tokens) = credentials.auth_tokens {
                    auth_tokens.access_token = refresh_response.access_token;
                    auth_tokens.expires_in = refresh_response.expires_in;
                    auth_tokens.expires_at = Some(expires_at.to_rfc3339());
                    // Keep existing refresh_token and csrf_token
                }

                // Save updated credentials
                save_credentials(credentials.clone(), app_handle.clone()).await
                    .map_err(|e| format!("Failed to save refreshed credentials: {}", e))?;
                    
                println!("✅ Token refreshed successfully!");
            } else {
                let error_text = response.text().await.unwrap_or_default();
                println!("❌ Token refresh failed: {}", error_text);
                
                // Token refresh failed, clear auth tokens
                credentials.auth_tokens = None;
                save_credentials(credentials.clone(), app_handle.clone()).await
                    .map_err(|e| format!("Failed to clear invalid credentials: {}", e))?;
                    
                return Err("Token refresh failed, please login again".to_string());
            }
        }
    }
    Ok(())
}

// Global state for API configuration
pub type ApiConfigState = Mutex<ApiConfig>;
pub fn new_api_config_state(config: ApiConfig) -> ApiConfigState {
    Mutex::new(config)
}

#[tauri::command]
pub async fn get_api_config() -> Result<ApiConfig, String> {
    Ok(ApiConfig::default())
}

// All per-user config commands removed: config is now static from api_endpoints.json
#[tauri::command]
pub async fn get_config_path() -> Result<String, String> {
    Ok("src/api_endpoints.json".to_string())
}

// =============================================================================================================
// ============================================== FILE OPERATIONS ==============================================
// ============================================== FILE OPERATIONS ==============================================
// ============================================== FILE OPERATIONS ==============================================
// =============================================================================================================
#[tauri::command]
pub async fn upload_file(
    file_path: String,
    tier: Option<String>,
    epochs: Option<u32>,
    remote_file_name: Option<String>,
    _config: State<'_, ApiConfigState>,
    app_handle: AppHandle
) -> Result<String, String> {
    use reqwest::Client;
    use std::path::Path;
    use percent_encoding::utf8_percent_encode;
    use tokio_util::io::ReaderStream;
    use futures_util::TryStreamExt;
    use tauri::Emitter;

    // Load credentials
    let credentials_opt = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?;
    let mut credentials = credentials_opt.ok_or("No saved credentials found")?;
    // Get API config
    let api_config = ApiConfig::default();
    // Create HTTP client
    let client = Client::new();
    // Ensure token is valid before making the upload request
    ensure_valid_token(&client, &api_config, &mut credentials, &app_handle).await?;
    // Validate file exists
    let path = Path::new(&file_path);
    if !path.exists() {
        let _ = {
            let user_id = credentials.user_id.clone();
            let now = chrono::Utc::now().to_rfc3339();
            let entry = UploadLogEntry {
                local_path: file_path.clone(),
                remote_path: "".to_string(),
                status: "failed".to_string(),
                message: format!("File not found: {}", file_path),
                blake3_hash: "".to_string(),
                file_size: 0,
                timestamp: now,
            };
            append_upload_log(&user_id, &entry, &app_handle)
        };
        return Err(format!("File not found: {}", file_path));
    }
    // Debug log 
    println!("[UPLOAD] remote_file_name param: {:?}", remote_file_name);
    let file_name = if let Some(ref custom) = remote_file_name {
        if !custom.trim().is_empty() {
            println!("[UPLOAD] Using custom remote_file_name: {}", custom);
            custom.as_str()
        } else {
            let fallback = path.file_name().and_then(|n| n.to_str()).ok_or("Invalid file name")?;
            println!("[UPLOAD] remote_file_name empty, fallback to local file name: {}", fallback);
            fallback
        }
    } else {
        let fallback = path.file_name().and_then(|n| n.to_str()).ok_or("Invalid file name")?;
        println!("[UPLOAD] remote_file_name not provided, fallback to local file name: {}", fallback);
        fallback
    };
    println!("[UPLOAD] Final file_name used for upload: {}", file_name);
    let encoded_name = utf8_percent_encode(file_name, QUERY_ENCODE_SET);
    let upload_url = format!("{}{}", api_config.api_base_url, api_config.upload);
    // Build query params
    let mut params = vec![format!("file_name={}", encoded_name)];
    if let Some(t) = &tier {
        params.push(format!("tier={}", utf8_percent_encode(t, QUERY_ENCODE_SET)));
    }
    if let Some(e) = epochs {
        params.push(format!("epochs={}", e));
    }
    let full_url = format!("{}?{}", upload_url, params.join("&"));
    println!("[UPLOAD] Uploading '{}' to {}", file_name, full_url);

    // Open file for reading in chunks
    let file = match tokio::fs::File::open(&file_path).await {
        Ok(f) => f,
        Err(e) => {
            let _ = {
                let user_id = credentials.user_id.clone();
                let now = chrono::Utc::now().to_rfc3339();
                let entry = UploadLogEntry {
                    local_path: file_path.clone(),
                    remote_path: "".to_string(),
                    status: "failed".to_string(),
                    message: format!("Failed to open file: {}", e),
                    blake3_hash: "".to_string(),
                    file_size: 0,
                    timestamp: now,
                };
                append_upload_log(&user_id, &entry, &app_handle)
            };
            return Err(format!("Failed to open file: {}", e));
        }
    };
    let file_size = std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);
    let uploaded: u64 = 0;
    let chunk_size: usize = 1024 * 128; // 128 KB
    let _buffer = vec![0u8; chunk_size];
    let user_id = credentials.user_id.clone();
    let now = chrono::Utc::now().to_rfc3339();
    let hasher = Arc::new(Mutex::new(blake3::Hasher::new()));

    // Prepare streaming body using ReaderStream and inspect for progress
    let app_handle_clone = app_handle.clone();
    let uploaded_arc = Arc::new(Mutex::new(uploaded));
    let hasher_clone = hasher.clone();
    let uploaded_clone = uploaded_arc.clone();
    let stream = ReaderStream::new(file).inspect_ok(move |chunk| {
        if let Ok(mut h) = hasher_clone.lock() {
            h.update(&chunk);
        }
        if let Ok(mut up) = uploaded_clone.lock() {
            *up += chunk.len() as u64;
            let percent = if file_size > 0 {
                (*up as f64 / file_size as f64 * 100.0).min(100.0)
            } else {
                0.0
            };
            let _ = app_handle_clone.emit("upload_progress", serde_json::json!({
                "percent": percent as u32,
                "uploaded": *up,
                "total": file_size
            }));
        }
    });
    // Prepare request
    let mut request = client.post(&full_url);
    if let Some(ref auth_tokens) = credentials.auth_tokens {
        request = request.header("Authorization", format!("Bearer {}", auth_tokens.access_token));
    } else {
        request = request
            .header("X-User-Id", &credentials.user_id)
            .header("X-User-App-Key", &credentials.user_app_key);
    }
    // Send request with streaming body
    let response = request.body(reqwest::Body::wrap_stream(stream)).send().await.map_err(|e| format!("Upload request failed: {}", e))?;
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
        timestamp: now.clone(),
    };
    let _ = append_upload_log(&user_id, &entry, &app_handle);
    if status.is_success() {
        let _ = app_handle.emit("upload_progress", serde_json::json!({
            "percent": 100,
            "uploaded": file_size,
            "total": file_size
        })); // 100% at end
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
    app_handle: AppHandle
) -> Result<String, String> {
    use reqwest::Client;
    use std::path::Path;
    use percent_encoding::utf8_percent_encode;

    // Load credentials
    let credentials_opt = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?;
    let mut credentials = credentials_opt.ok_or("No saved credentials found")?;
    
    // Get API config
    let api_config = ApiConfig::default();
    
    // Create HTTP client
    let client = Client::new();
    
    // Ensure token is valid before making the download request
    ensure_valid_token(&client, &api_config, &mut credentials, &app_handle).await?;
    
    // Build download URL
    let encoded_name = utf8_percent_encode(&file_name, QUERY_ENCODE_SET);
    let download_url = format!("{}{}", api_config.api_base_url, api_config.download);
    let full_url = format!("{}?file_name={}", download_url, encoded_name);
    
    println!("📥 Downloading {} from {}", file_name, download_url);
    
    // Prepare request
    let mut request = client.get(&full_url);
    
    // Add authentication headers
    if let Some(ref auth_tokens) = credentials.auth_tokens {
        // JWT authentication
        request = request.header(
            "Authorization",
            format!("Bearer {}", auth_tokens.access_token),
        );
    } else {
        // Legacy authentication
        request = request
            .header("X-User-Id", &credentials.user_id)
            .header("X-User-App-Key", &credentials.user_app_key);
    }
    
    // Send request
    let response = request
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;
    
    let status = response.status();
    
    // Handle response or retry on 401
    let file_data = if status.is_success() {
        response.bytes().await
            .map_err(|e| format!("Failed to read response data: {}", e))?
    } else if status == reqwest::StatusCode::UNAUTHORIZED && credentials.auth_tokens.is_some() {
        println!("Got 401, attempting token refresh............................................");
        
        // Force refresh token
        ensure_valid_token(&client, &api_config, &mut credentials, &app_handle).await?;
        
        // Retry request with refreshed token
        let mut retry_request = client.get(&full_url);
        
        if let Some(ref auth_tokens) = credentials.auth_tokens {
            retry_request = retry_request.header(
                "Authorization",
                format!("Bearer {}", auth_tokens.access_token),
            );
        } else {
            retry_request = retry_request
                .header("X-User-Id", &credentials.user_id)
                .header("X-User-App-Key", &credentials.user_app_key);
        }
        
        let retry_response = retry_request
            .send()
            .await
            .map_err(|e| format!("Retry download request failed: {}", e))?;
        
        let retry_status = retry_response.status();
        
        if retry_status.is_success() {
            retry_response.bytes().await
                .map_err(|e| format!("Failed to read retry response data: {}", e))?
        } else {
            let error_text = retry_response.text().await.unwrap_or_default();
            return Err(format!("Download failed after retry - Status: {}, Response: {}", retry_status, error_text));
        }
    } else {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Download failed - Status: {}, Response: {}", status, error_text));
    };
    
    // Process successful download
    if !file_data.is_empty() {
        
        // Determine output path
        let final_path = if output_path.is_empty() {
            // Use current directory with original filename
            file_name.clone()
        } else {
            let path = Path::new(&output_path);
            if path.is_dir() || output_path.ends_with('/') || output_path.ends_with('\\') {
                // output_path is a directory, append filename
                format!("{}/{}", output_path.trim_end_matches('/').trim_end_matches('\\'), file_name)
            } else {
                // output_path is a complete file path
                output_path
            }
        };
        
        // Ensure parent directory exists
        if let Some(parent) = Path::new(&final_path).parent() {
            tokio::fs::create_dir_all(parent).await
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        
        // Write file
        tokio::fs::write(&final_path, &file_data).await
            .map_err(|e| format!("Failed to write file: {}", e))?;
        
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
    app_handle: AppHandle
) -> Result<String, String> {
    // Try to find user by username to get their config
    let _users = list_saved_users(app_handle.clone()).await?;
    let api_config = ApiConfig::default();
    let url = format!("{}{}", api_config.api_base_url, api_config.auth_login);
    
    println!("🔄 Attempting login for user: {} to URL: {}", username, url);
    
    let client = reqwest::Client::new();
    let request_body = LoginRequest { username: username.clone(), password };
    
    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    println!("📡 Login response status: {}", response.status());
    
    if response.status().is_success() {
        let mut auth_tokens: AuthTokens = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;
        
        // Calculate expires_at as ISO string
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| format!("System time error: {}", e))?
            .as_secs() as i64;
        
        let expires_at = DateTime::<Utc>::from_timestamp(now + auth_tokens.expires_in, 0)
            .ok_or_else(|| "Invalid expiration timestamp".to_string())?;
        
        // Store as ISO string format to match JSON
        auth_tokens.expires_at = Some(expires_at.to_rfc3339());
        
        println!("✅ Login successful, token expires in: {} seconds ({})", 
                 auth_tokens.expires_in, expires_at);
        
        // Return as JSON string
        serde_json::to_string(&auth_tokens)
            .map_err(|e| format!("Failed to serialize auth tokens: {}", e))
    } else {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
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
                    Err(_) => {
                        Ok(format!("✅ Connection successful! Server responded with status {}", status))
                    }
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
    user_id: String,
    user_app_key: String,
    new_password: String,
    _config: State<'_, ApiConfigState>,
    _app_handle: AppHandle
) -> Result<String, String> {
    // Get user-specific API config
    let api_config = ApiConfig::default();
    let url = format!("{}{}", api_config.api_base_url, api_config.auth_reset_password);
    
    let client = reqwest::Client::new();
    let request_body = SetPasswordRequest {
        user_id,
        user_app_key,
        new_password,
    };
    
    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    if response.status().is_success() {
        let mut auth_tokens: AuthTokens = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;
        
        // Calculate expires_at as ISO string
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| format!("System time error: {}", e))?
            .as_secs() as i64;
        
        let expires_at = DateTime::<Utc>::from_timestamp(now + auth_tokens.expires_in, 0)
            .ok_or_else(|| "Invalid expiration timestamp".to_string())?;
        
        // Store as ISO string format to match reference JSON
        auth_tokens.expires_at = Some(expires_at.to_rfc3339());
        
        println!("✅ Password set successfully, JWT tokens received (expires: {})", expires_at);
        
        // Return as JSON string
        serde_json::to_string(&auth_tokens)
            .map_err(|e| format!("Failed to serialize auth tokens: {}", e))
    } else {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        Err(format!("Set password failed. Status: {}, Error: {}", status, error_text))
    }
}

// === CREDENTIALS MANAGEMENT ===

#[tauri::command]
pub async fn save_credentials(
    credentials: SavedCredentials,
    app_handle: AppHandle
) -> Result<(), String> {
    println!("🔄 Saving credentials for user: {}", credentials.user_id);
    
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    
    println!("📁 App data directory: {:?}", app_data_dir);
    
    // Create user-specific directory structure <app_data>/<user_id>/
    let user_dir = app_data_dir.join(&credentials.user_id);
    std::fs::create_dir_all(&user_dir)
        .map_err(|e| format!("Failed to create user directory: {}", e))?;
    
    // Save credentials to <user_id>/<user_id>.json
    let credentials_path = user_dir.join(format!("{}.json", credentials.user_id));
    
    let json_content = serde_json::to_string_pretty(&credentials)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;
    
    std::fs::write(&credentials_path, json_content)
        .map_err(|e| format!("Failed to write credentials file: {}", e))?;

        // C:\Users\<username>\AppData\Roaming\com.pipenetwork.firestarter\<user_id>\
        println!("✅ Credentials saved to: {:?}", credentials_path);
    Ok(())
}

#[tauri::command]
pub async fn load_credentials(app_handle: AppHandle) -> Result<Option<SavedCredentials>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    
    // Look for any user directories and load the most recent one
    // In the future, implement user selection
    if !app_data_dir.exists() {
        return Ok(None);
    }
    
    let mut latest_credentials: Option<SavedCredentials> = None;
    let mut latest_time = std::time::SystemTime::UNIX_EPOCH;
    
    // Scan for user directories
    if let Ok(entries) = std::fs::read_dir(&app_data_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                let user_id = entry.file_name().to_string_lossy().to_string();
                let credentials_path = entry.path().join(format!("{}.json", user_id));
                
                if credentials_path.exists() {
                    if let Ok(metadata) = credentials_path.metadata() {
                        if let Ok(modified) = metadata.modified() {
                            if modified > latest_time {
                                if let Ok(content) = std::fs::read_to_string(&credentials_path) {
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
    
    if let Some(ref creds) = latest_credentials {
        println!("✅ Loaded credentials for user: {}", creds.user_id);
    }
    
    Ok(latest_credentials)
}

#[tauri::command]
pub async fn clear_credentials(
    user_id: String,
    app_handle: AppHandle
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    
    let user_dir = app_data_dir.join(&user_id);
    
    if user_dir.exists() {
        std::fs::remove_dir_all(&user_dir)
            .map_err(|e| format!("Failed to remove user directory: {}", e))?;
        println!("✅ User credentials cleared for: {}", user_id);
    }
    
    Ok(())
}

// New command to list all saved users
#[tauri::command]
pub async fn list_saved_users(app_handle: AppHandle) -> Result<Vec<SavedCredentials>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    
    let mut users = Vec::new();
    
    if !app_data_dir.exists() {
        return Ok(users);
    }
    
    if let Ok(entries) = std::fs::read_dir(&app_data_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                let user_id = entry.file_name().to_string_lossy().to_string();
                let credentials_path = entry.path().join(format!("{}.json", user_id));
                
                if credentials_path.exists() {
                    if let Ok(content) = std::fs::read_to_string(&credentials_path) {
                        if let Ok(credentials) = serde_json::from_str::<SavedCredentials>(&content) {
                            users.push(credentials);
                        }
                    }
                }
            }
        }
    }
    
    // Sort by username or user_id
    users.sort_by(|a, b| {
        let a_name = a.username.as_deref().unwrap_or(&a.user_id);
        let b_name = b.username.as_deref().unwrap_or(&b.user_id);
        a_name.cmp(b_name)
    });
    
    Ok(users)
}

#[tauri::command]
pub async fn refresh_token(
    _config: State<'_, ApiConfigState>,
    app_handle: AppHandle
) -> Result<String, String> {
    use reqwest::Client;
    
    // Load credentials
    let credentials_opt = load_credentials(app_handle.clone()).await.map_err(|e| format!("No credentials found: {}", e))?;
    let mut credentials = credentials_opt.ok_or("No saved credentials found")?;
    
    // Get API config
    let api_config = ApiConfig::default();
    
    // Create HTTP client
    let client = Client::new();
    
    // Force refresh token
    ensure_valid_token(&client, &api_config, &mut credentials, &app_handle).await?;
    
    Ok("Token refreshed successfully".to_string())
}

// ==========================================================================================
// ================================= LINKS MANAGEMENT =======================================
// ================================= LINKS MANAGEMENT =======================================
// ================================= LINKS MANAGEMENT =======================================
// ==========================================================================================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PublicLinkEntry {
    pub remote_path: String,
    pub link_hash: String,
    pub created_at: String, // ISO8601
    pub custom_title: Option<String>,
    pub custom_description: Option<String>,
}

fn get_link_file_path(user_id: &str, app_handle: &AppHandle) -> Result<PathBuf, String> {
    let user_dir = get_user_data_dir(user_id, app_handle)?;
    Ok(user_dir.join(format!("link-{}.json", user_id)))
}

fn read_public_links(user_id: &str, app_handle: &AppHandle) -> Result<Vec<PublicLinkEntry>, String> {
    let path = get_link_file_path(user_id, app_handle)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| format!("Failed to read link file: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse link file: {}", e))
}

fn write_public_links(user_id: &str, links: &[PublicLinkEntry], app_handle: &AppHandle) -> Result<(), String> {
    let path = get_link_file_path(user_id, app_handle)?;
    let user_dir = path.parent().ok_or("Invalid user dir")?;
    if !user_dir.exists() {
        create_dir_all(user_dir).map_err(|e| format!("Failed to create user dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(links).map_err(|e| format!("Failed to serialize links: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write link file: {}", e))
}

#[tauri::command]
pub async fn create_public_link(
    user_id: String,
    remote_path: String,
    custom_title: Option<String>,
    custom_description: Option<String>,
    app_handle: AppHandle
) -> Result<PublicLinkEntry, String> {
    use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
    println!("[create_public_link] user_id={:?} remote_path={:?} title={:?} desc={:?}", user_id, remote_path, custom_title, custom_description);
    let mut credentials = match load_credentials(app_handle.clone()).await {
        Ok(Some(c)) => c,
        Ok(None) => {
            println!("[create_public_link][ERROR] No saved credentials found");
            return Err("No saved credentials found".to_string());
        },
        Err(e) => {
            println!("[create_public_link][ERROR] No credentials found: {}", e);
            return Err(format!("No credentials found: {}", e));
        }
    };
    let api_config = ApiConfig::default();
    let client = reqwest::Client::new();
    if let Err(e) = ensure_valid_token(&client, &api_config, &mut credentials, &app_handle).await {
        println!("[create_public_link][ERROR] ensure_valid_token: {}", e);
        return Err(format!("Token error: {}", e));
    }
    let tokens = match credentials.auth_tokens.as_ref() {
        Some(t) => t,
        None => {
            println!("[create_public_link][ERROR] No valid auth tokens");
            return Err("No valid auth tokens".to_string());
        }
    };
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", tokens.access_token)).unwrap());
    if let Some(csrf) = &tokens.csrf_token {
        headers.insert("X-Csrf-Token", HeaderValue::from_str(csrf).unwrap());
    }
    let mut body = serde_json::json!({"file_name": remote_path});
    if let Some(title) = &custom_title {
        body["custom_title"] = serde_json::Value::String(title.clone());
    }
    if let Some(desc) = &custom_description {
        body["custom_description"] = serde_json::Value::String(desc.clone());
    }
    let url = format!("{}{}", api_config.api_base_url, api_config.create_public_link);
    println!("[create_public_link] POST {} body={}", url, body);
    let resp = match client.post(&url)
        .headers(headers)
        .json(&body)
        .send().await {
        Ok(r) => r,
        Err(e) => {
            println!("[create_public_link][ERROR] HTTP error: {}", e);
            return Err(format!("HTTP error: {}", e));
        }
    };
    let status = resp.status();
    let text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            println!("[create_public_link][ERROR] Failed to read response: {}", e);
            return Err(format!("Failed to read response: {}", e));
        }
    };
    println!("[create_public_link] status={} response={}", status, text);
    if !status.is_success() {
        println!("[create_public_link][ERROR] HTTP {}: {}", status, text);
        return Err(format!("HTTP {}: {}", status, text));
    }
    let json: serde_json::Value = match serde_json::from_str(&text) {
        Ok(j) => j,
        Err(e) => {
            println!("[create_public_link][ERROR] Invalid JSON: {}", e);
            return Err(format!("Invalid JSON: {}", e));
        }
    };
    let link_hash = match json.get("link_hash").and_then(|v| v.as_str()) {
        Some(lh) => lh.to_string(),
        None => {
            println!("[create_public_link][ERROR] No link_hash in response");
            return Err("No link_hash in response".to_string());
        }
    };
    let entry = PublicLinkEntry {
        remote_path: remote_path.clone(),
        link_hash: link_hash.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        custom_title,
        custom_description,
    };
    // save
    let mut links = match read_public_links(&user_id, &app_handle) {
        Ok(l) => l,
        Err(e) => {
            println!("[create_public_link][ERROR] read_public_links: {}", e);
            vec![]
        }
    };
    links.push(entry.clone());
    if let Err(e) = write_public_links(&user_id, &links, &app_handle) {
        println!("[create_public_link][ERROR] write_public_links: {}", e);
    }
    Ok(entry)
}

#[tauri::command]
pub async fn delete_public_link(
    user_id: String,
    link_hash: String,
    app_handle: AppHandle
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
    if let Some(csrf) = &tokens.csrf_token {
        headers.insert("X-Csrf-Token", HeaderValue::from_str(csrf).unwrap());
    }
    let body = serde_json::json!({"link_hash": link_hash});
    let url = format!("{}{}", api_config.api_base_url, api_config.delete_public_link);
    let resp = client.post(&url)
        .headers(headers)
        .json(&body)
        .send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }
    // delete 
    let mut links = read_public_links(&user_id, &app_handle)?;
    let before = links.len();
    links.retain(|l| l.link_hash != link_hash);
    write_public_links(&user_id, &links, &app_handle)?;
    Ok(format!("Deleted {} ({} -> {})", link_hash, before, links.len()))
}

#[tauri::command]
pub async fn list_public_links(
    user_id: String,
    app_handle: AppHandle
) -> Result<Vec<PublicLinkEntry>, String> {
    read_public_links(&user_id, &app_handle)
}
