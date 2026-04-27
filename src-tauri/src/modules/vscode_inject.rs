//! CodeBuddy token injection into VS Code state.vscdb.
//!
//! Platform crypto model:
//! - Windows: Local State `os_crypt.encrypted_key` + DPAPI → AES-256-GCM (v10)
//! - macOS: Keychain "CodeBuddy Safe Storage" + PBKDF2-HMAC-SHA1(1003) → AES-128-CBC (v10)
//! - Linux: secret-tool lookup → PBKDF2-HMAC-SHA1(1) → AES-128-CBC (v11); fallback v10 fixed key

use std::path::{Path, PathBuf};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::Command;

#[cfg(not(target_os = "windows"))]
use aes::Aes128;
#[cfg(target_os = "windows")]
use aes_gcm::aead::generic_array::GenericArray;
#[cfg(target_os = "windows")]
use aes_gcm::aead::{Aead, AeadCore, OsRng};
#[cfg(target_os = "windows")]
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
#[cfg(target_os = "windows")]
use base64::{engine::general_purpose, Engine as _};
#[cfg(not(target_os = "windows"))]
use cbc::cipher::block_padding::Pkcs7;
#[cfg(not(target_os = "windows"))]
use cbc::cipher::{BlockEncryptMut, KeyIvInit};
#[cfg(not(target_os = "windows"))]
use pbkdf2::pbkdf2_hmac;
#[cfg(not(target_os = "windows"))]
use sha1::Sha1;

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{LocalFree, HLOCAL};
#[cfg(target_os = "windows")]
use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

#[cfg(not(target_os = "windows"))]
type Aes128CbcEnc = cbc::Encryptor<Aes128>;

const V10_PREFIX: &[u8] = b"v10";
const V11_PREFIX: &[u8] = b"v11";
#[cfg(not(target_os = "windows"))]
const CBC_IV: [u8; 16] = [b' '; 16];
#[cfg(not(target_os = "windows"))]
const SALT: &[u8] = b"saltysalt";

// PBKDF2-HMAC-SHA1(1 iteration, key = "peanuts", salt = "saltysalt")
#[cfg(target_os = "linux")]
const LINUX_V10_KEY: [u8; 16] = [
    0xfd, 0x62, 0x1f, 0xe5, 0xa2, 0xb4, 0x02, 0x53, 0x9d, 0xfa, 0x14, 0x7c, 0xa9, 0x27, 0x27, 0x78,
];

// PBKDF2-HMAC-SHA1(1 iteration, key = "", salt = "saltysalt")
#[cfg(target_os = "linux")]
const LINUX_EMPTY_KEY: [u8; 16] = [
    0xd0, 0xd0, 0xec, 0x9c, 0x7d, 0x77, 0xd4, 0x3a, 0xc5, 0x41, 0x87, 0xfa, 0x48, 0x18, 0xd1, 0x7f,
];

fn detect_prefix(encrypted: &[u8]) -> Option<&'static str> {
    if encrypted.starts_with(V10_PREFIX) {
        Some("v10")
    } else if encrypted.starts_with(V11_PREFIX) {
        Some("v11")
    } else {
        None
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn run_command_get_trimmed(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() { None } else { Some(value) }
}

#[cfg(target_os = "macos")]
fn get_macos_safe_storage_password() -> Result<String, String> {
    let candidates: &[(&str, Option<&str>)] = &[
        ("CodeBuddy Safe Storage", Some("CodeBuddy")),
        ("CodeBuddy Safe Storage", Some("codebuddy")),
        ("CodeBuddy Safe Storage", Some("CodeBuddy Key")),
        ("CodeBuddy Safe Storage", None),
        ("CodeBuddy Safe Storage", Some("CodeBuddy Safe Storage")),
    ];
    for (service, account) in candidates {
        if let Some(acct) = account {
            if let Some(pw) = run_command_get_trimmed(
                "security",
                &["find-generic-password", "-w", "-s", service, "-a", acct],
            ) {
                return Ok(pw);
            }
        }
        if let Some(pw) = run_command_get_trimmed(
            "security",
            &["find-generic-password", "-w", "-s", service],
        ) {
            return Ok(pw);
        }
    }
    Err("Failed to read CodeBuddy Safe Storage password from Keychain".to_string())
}

#[cfg(target_os = "linux")]
fn get_linux_v11_key() -> Option<[u8; 16]> {
    for app in &["CodeBuddy", "codebuddy"] {
        if let Some(password) =
            run_command_get_trimmed("secret-tool", &["lookup", "application", app])
        {
            return Some(pbkdf2_sha1_key(&password, 1));
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn pbkdf2_sha1_key(password: &str, iterations: u32) -> [u8; 16] {
    let mut key = [0u8; 16];
    pbkdf2_hmac::<Sha1>(password.as_bytes(), SALT, iterations, &mut key);
    key
}

#[cfg(not(target_os = "windows"))]
fn encrypt_cbc_prefixed(prefix: &[u8], key: &[u8; 16], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes128CbcEnc::new_from_slices(key, &CBC_IV)
        .map_err(|e| format!("Failed to init AES-CBC encryptor: {}", e))?;
    let mut buf = plaintext.to_vec();
    let msg_len = buf.len();
    let pad_len = 16 - (msg_len % 16);
    buf.resize(msg_len + pad_len, 0);
    let ciphertext = cipher
        .encrypt_padded_mut::<Pkcs7>(&mut buf, msg_len)
        .map_err(|e| format!("AES-CBC encryption failed: {}", e))?
        .to_vec();
    let mut result = Vec::with_capacity(prefix.len() + ciphertext.len());
    result.extend_from_slice(prefix);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

#[cfg(target_os = "windows")]
fn dpapi_decrypt(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: encrypted.len() as u32,
            pbData: encrypted.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        CryptUnprotectData(&mut input, None, None, None, None, 0, &mut output)
            .map_err(|_| "DPAPI CryptUnprotectData call failed".to_string())?;
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(HLOCAL(output.pbData as *mut _));
        Ok(result)
    }
}

#[cfg(target_os = "windows")]
fn get_windows_encryption_key(data_root: &Path) -> Result<Vec<u8>, String> {
    let path = crate::modules::vscode_paths::vscode_local_state_path(data_root);
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read Local State: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Local State JSON: {}", e))?;
    let encrypted_key_b64 = json["os_crypt"]["encrypted_key"]
        .as_str()
        .ok_or("Cannot find os_crypt.encrypted_key in Local State")?;
    let encrypted_key_bytes = general_purpose::STANDARD
        .decode(encrypted_key_b64)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;
    if encrypted_key_bytes.len() < 6 {
        return Err("encrypted_key data too short".to_string());
    }
    if String::from_utf8_lossy(&encrypted_key_bytes[..5]) != "DPAPI" {
        return Err("encrypted_key prefix is not DPAPI".to_string());
    }
    let key = dpapi_decrypt(&encrypted_key_bytes[5..])?;
    if key.len() != 32 {
        return Err(format!("Decrypted AES key has unexpected length: {}", key.len()));
    }
    Ok(key)
}

#[cfg(target_os = "windows")]
fn encrypt_windows_gcm_v10(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(GenericArray::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("AES-GCM encryption failed: {}", e))?;
    let mut result = Vec::with_capacity(3 + 12 + ciphertext.len());
    result.extend_from_slice(V10_PREFIX);
    result.extend_from_slice(nonce.as_slice());
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

fn encrypt_payload(
    plaintext: &[u8],
    preferred_prefix: Option<&str>,
    data_root: &Path,
) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = preferred_prefix;
        let key = get_windows_encryption_key(data_root)?;
        return encrypt_windows_gcm_v10(&key, plaintext);
    }

    #[cfg(target_os = "macos")]
    {
        let _ = (preferred_prefix, data_root);
        let password = get_macos_safe_storage_password()?;
        let key = pbkdf2_sha1_key(&password, 1003);
        return encrypt_cbc_prefixed(V10_PREFIX, &key, plaintext);
    }

    #[cfg(target_os = "linux")]
    {
        let _ = data_root;
        let target_prefix = if let Some(p) = preferred_prefix {
            p
        } else if get_linux_v11_key().is_some() {
            "v11"
        } else {
            "v10"
        };
        if target_prefix == "v11" {
            let key = get_linux_v11_key()
                .ok_or("Cannot load Linux secret storage key (v11)")?;
            return encrypt_cbc_prefixed(V11_PREFIX, &key, plaintext);
        }
        return encrypt_cbc_prefixed(V10_PREFIX, &LINUX_V10_KEY, plaintext);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = (plaintext, preferred_prefix, data_root);
        Err("Unsupported platform".to_string())
    }
}

fn decode_buffer_data(buffer: &serde_json::Value) -> Result<Vec<u8>, String> {
    let data_arr = buffer["data"]
        .as_array()
        .ok_or("Secret data is not in Buffer format")?;
    let mut bytes: Vec<u8> = Vec::with_capacity(data_arr.len());
    for (idx, v) in data_arr.iter().enumerate() {
        let n = v
            .as_u64()
            .ok_or_else(|| format!("Buffer data[{}] is not an integer", idx))?;
        if n > 255 {
            return Err(format!("Buffer data[{}] out of range ({})", idx, n));
        }
        bytes.push(n as u8);
    }
    Ok(bytes)
}

fn resolve_data_root_from_db_path(db_path: &Path) -> Result<&Path, String> {
    db_path
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .ok_or_else(|| format!("Cannot determine data root from: {}", db_path.display()))
}

/// Inject `plaintext` under `db_key` into `db_path` (state.vscdb) using CodeBuddy keychain.
pub fn inject_secret_to_state_db_for_codebuddy(
    db_path: &Path,
    db_key: &str,
    plaintext: &str,
) -> Result<(), String> {
    let data_root = resolve_data_root_from_db_path(db_path)?;

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create state.vscdb parent dir: {}", e))?;
    }

    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open state.vscdb: {}", e))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)",
        [],
    )
    .map_err(|e| format!("Failed to init ItemTable: {}", e))?;

    let existing_prefix: Option<String> = match conn.query_row(
        "SELECT value FROM ItemTable WHERE key = ?",
        [db_key],
        |row| row.get::<_, String>(0),
    ) {
        Ok(val) => {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&val) {
                if let Ok(bytes) = decode_buffer_data(&parsed) {
                    detect_prefix(&bytes).map(|s| s.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        }
        Err(_) => None,
    };

    let encrypted = encrypt_payload(
        plaintext.as_bytes(),
        existing_prefix.as_deref(),
        data_root,
    )?;

    let buffer_json = serde_json::json!({
        "type": "Buffer",
        "data": encrypted
    });
    let buffer_str = serde_json::to_string(&buffer_json)
        .map_err(|e| format!("Failed to serialize Buffer: {}", e))?;

    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        rusqlite::params![db_key, buffer_str],
    )
    .map_err(|e| format!("Failed to write to state.vscdb: {}", e))?;

    Ok(())
}

/// Convenience: build the secret key string for a CodeBuddy extension storage entry.
pub fn codebuddy_secret_key(extension_id: &str, key: &str) -> String {
    format!(r#"secret://{{"extensionId":"{}","key":"{}"}}"#, extension_id, key)
}

/// Inject the CodeBuddy access token into the given instance's state.vscdb.
pub fn inject_codebuddy_access_token(db_path: &Path, access_token: &str) -> Result<(), String> {
    let db_key = codebuddy_secret_key(
        "tencent-cloud.coding-copilot",
        "planning-genie.new.accessToken",
    );
    inject_secret_to_state_db_for_codebuddy(db_path, &db_key, access_token)
}

/// Inject the CodeBuddy CN access token into the given instance's state.vscdb.
pub fn inject_codebuddy_cn_access_token(db_path: &Path, access_token: &str) -> Result<(), String> {
    let db_key = codebuddy_secret_key(
        "tencent-cloud.coding-copilot",
        "planning-genie.new.accessTokencn",
    );
    inject_secret_to_state_db_for_codebuddy(db_path, &db_key, access_token)
}

/// Build the full state.vscdb path from an instance user_data_dir.
pub fn state_db_path_for_user_data_dir(user_data_dir: &Path) -> PathBuf {
    crate::modules::vscode_paths::vscode_state_db_path(user_data_dir)
}
