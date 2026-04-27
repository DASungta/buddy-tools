use std::process::Command;
use std::thread;
use std::time::Duration;
use sysinfo::System;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Get normalized path of the current running executable
fn get_current_exe_path() -> Option<std::path::PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok())
}

/// Check if Antigravity is running
pub fn is_antigravity_running() -> bool {
    let mut system = System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All);

    let current_exe = get_current_exe_path();
    let current_pid = std::process::id();

    // Recognition ref 1: Load manual config path (moved outside loop for performance)
    let manual_path = crate::modules::config::load_app_config()
        .ok()
        .and_then(|c| c.antigravity_executable)
        .and_then(|p| std::path::PathBuf::from(p).canonicalize().ok());

    for (pid, process) in system.processes() {
        let pid_u32 = pid.as_u32();
        if pid_u32 == current_pid {
            continue;
        }

        let name = process.name().to_string_lossy().to_lowercase();
        let exe_path = process
            .exe()
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_lowercase();

        // Exclude own path (handles case where manager is mistaken for Antigravity on Linux)
        if let (Some(ref my_path), Some(p_exe)) = (&current_exe, process.exe()) {
            if let Ok(p_path) = p_exe.canonicalize() {
                if my_path == &p_path {
                    continue;
                }
            }
        }

        // Recognition ref 2: Priority check for manual path match
        if let (Some(ref m_path), Some(p_exe)) = (&manual_path, process.exe()) {
            if let Ok(p_path) = p_exe.canonicalize() {
                // macOS: Check if within the same .app bundle
                #[cfg(target_os = "macos")]
                {
                    let m_path_str = m_path.to_string_lossy();
                    let p_path_str = p_path.to_string_lossy();
                    if let (Some(m_idx), Some(p_idx)) =
                        (m_path_str.find(".app"), p_path_str.find(".app"))
                    {
                        if m_path_str[..m_idx + 4] == p_path_str[..p_idx + 4] {
                            // Even if path matches, must confirm via name and args that it's not a Helper
                            let args = process.cmd();
                            let is_helper_by_args = args
                                .iter()
                                .any(|arg| arg.to_string_lossy().contains("--type="));
                            let is_helper_by_name = name.contains("helper")
                                || name.contains("plugin")
                                || name.contains("renderer")
                                || name.contains("gpu")
                                || name.contains("crashpad")
                                || name.contains("utility")
                                || name.contains("audio")
                                || name.contains("sandbox");
                            if !is_helper_by_args && !is_helper_by_name {
                                return true;
                            }
                        }
                    }
                }

                #[cfg(not(target_os = "macos"))]
                if m_path == &p_path {
                    return true;
                }
            }
        }

        // Common helper process exclusion logic
        // Common helper process exclusion logic
        let args = process.cmd();
        let args_str = args
            .iter()
            .map(|arg| arg.to_string_lossy().to_lowercase())
            .collect::<Vec<String>>()
            .join(" ");

        let is_helper = args_str.contains("--type=")
            || name.contains("helper")
            || name.contains("plugin")
            || name.contains("renderer")
            || name.contains("gpu")
            || name.contains("crashpad")
            || name.contains("utility")
            || name.contains("audio")
            || name.contains("sandbox")
            || exe_path.contains("crashpad");

        #[cfg(target_os = "macos")]
        {
            if exe_path.contains("antigravity.app") && !is_helper {
                return true;
            }
        }

        #[cfg(target_os = "windows")]
        {
            if name == "antigravity.exe" && !is_helper {
                return true;
            }
        }

        #[cfg(target_os = "linux")]
        {
            if (name.contains("antigravity") || exe_path.contains("/antigravity"))
                && !name.contains("tools")
                && !is_helper
            {
                return true;
            }
        }
    }

    false
}

#[cfg(target_os = "linux")]
/// Get PID set of current process and all direct relatives (ancestors + descendants)
fn get_self_family_pids(system: &sysinfo::System) -> std::collections::HashSet<u32> {
    let current_pid = std::process::id();
    let mut family_pids = std::collections::HashSet::new();
    family_pids.insert(current_pid);

    // 1. Look up all ancestors (Ancestors) - prevent killing the launcher
    let mut next_pid = current_pid;
    // Prevent infinite loop, max depth 10
    for _ in 0..10 {
        let pid_val = sysinfo::Pid::from_u32(next_pid);
        if let Some(process) = system.process(pid_val) {
            if let Some(parent) = process.parent() {
                let parent_id = parent.as_u32();
                // Avoid cycles or duplicates
                if !family_pids.insert(parent_id) {
                    break;
                }
                next_pid = parent_id;
            } else {
                break;
            }
        } else {
            break;
        }
    }

    // 2. Look down all descendants (Descendants)
    // Build parent-child relationship map (Parent -> Children)
    let mut adj: std::collections::HashMap<u32, Vec<u32>> = std::collections::HashMap::new();
    for (pid, process) in system.processes() {
        if let Some(parent) = process.parent() {
            adj.entry(parent.as_u32()).or_default().push(pid.as_u32());
        }
    }

    // BFS traversal to find all descendants
    let mut queue = std::collections::VecDeque::new();
    queue.push_back(current_pid);

    while let Some(pid) = queue.pop_front() {
        if let Some(children) = adj.get(&pid) {
            for &child in children {
                if family_pids.insert(child) {
                    queue.push_back(child);
                }
            }
        }
    }

    family_pids
}

/// Get PIDs of all Antigravity processes (including main and helper processes)
fn get_antigravity_pids() -> Vec<u32> {
    let mut system = System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All);

    // Linux: Enable family process tree exclusion
    #[cfg(target_os = "linux")]
    let family_pids = get_self_family_pids(&system);

    let mut pids = Vec::new();
    let current_pid = std::process::id();
    let current_exe = get_current_exe_path();

    // Load manual config path as auxiliary reference
    let manual_path = crate::modules::config::load_app_config()
        .ok()
        .and_then(|c| c.antigravity_executable)
        .and_then(|p| std::path::PathBuf::from(p).canonicalize().ok());

    for (pid, process) in system.processes() {
        let pid_u32 = pid.as_u32();

        // Exclude own PID
        if pid_u32 == current_pid {
            continue;
        }

        // Exclude own executable path (hardened against broad name matching)
        if let (Some(ref my_path), Some(p_exe)) = (&current_exe, process.exe()) {
            if let Ok(p_path) = p_exe.canonicalize() {
                if my_path == &p_path {
                    continue;
                }
            }
        }

        let _name = process.name().to_string_lossy().to_lowercase();

        #[cfg(target_os = "linux")]
        {
            // 1. Exclude family processes (self, children, parents)
            if family_pids.contains(&pid_u32) {
                continue;
            }
            // 2. Extra protection: match "tools" likely manager if not a child
            if _name.contains("tools") {
                continue;
            }
        }

        #[cfg(not(target_os = "linux"))]
        {
            // Other platforms: exclude only self
            if pid_u32 == current_pid {
                continue;
            }
        }

        // Recognition ref 3: Check manual config path match
        if let (Some(ref m_path), Some(p_exe)) = (&manual_path, process.exe()) {
            if let Ok(p_path) = p_exe.canonicalize() {
                #[cfg(target_os = "macos")]
                {
                    let m_path_str = m_path.to_string_lossy();
                    let p_path_str = p_path.to_string_lossy();
                    if let (Some(m_idx), Some(p_idx)) =
                        (m_path_str.find(".app"), p_path_str.find(".app"))
                    {
                        if m_path_str[..m_idx + 4] == p_path_str[..p_idx + 4] {
                            let args = process.cmd();
                            let is_helper_by_args = args
                                .iter()
                                .any(|arg| arg.to_string_lossy().contains("--type="));
                            let is_helper_by_name = _name.contains("helper")
                                || _name.contains("plugin")
                                || _name.contains("renderer")
                                || _name.contains("gpu")
                                || _name.contains("crashpad")
                                || _name.contains("utility")
                                || _name.contains("audio")
                                || _name.contains("sandbox");
                            if !is_helper_by_args && !is_helper_by_name {
                                pids.push(pid_u32);
                                continue;
                            }
                        }
                    }
                }

                #[cfg(not(target_os = "macos"))]
                if m_path == &p_path {
                    pids.push(pid_u32);
                    continue;
                }
            }
        }

        // Get executable path
        let exe_path = process
            .exe()
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_lowercase();

        // Common helper process exclusion logic
        let args = process.cmd();
        let args_str = args
            .iter()
            .map(|arg| arg.to_string_lossy().to_lowercase())
            .collect::<Vec<String>>()
            .join(" ");

        let is_helper = args_str.contains("--type=")
            || _name.contains("helper")
            || _name.contains("plugin")
            || _name.contains("renderer")
            || _name.contains("gpu")
            || _name.contains("crashpad")
            || _name.contains("utility")
            || _name.contains("audio")
            || _name.contains("sandbox")
            || exe_path.contains("crashpad");

        #[cfg(target_os = "macos")]
        {
            // Match processes within Antigravity main app bundle, excluding Helper/Plugin/Renderer etc.
            if exe_path.contains("antigravity.app") && !is_helper {
                pids.push(pid_u32);
            }
        }

        #[cfg(target_os = "windows")]
        {
            let name = process.name().to_string_lossy().to_lowercase();
            if name == "antigravity.exe" && !is_helper {
                pids.push(pid_u32);
            }
        }

        #[cfg(target_os = "linux")]
        {
            let name = process.name().to_string_lossy().to_lowercase();
            if (name == "antigravity" || exe_path.contains("/antigravity"))
                && !name.contains("tools")
                && !is_helper
            {
                pids.push(pid_u32);
            }
        }
    }

    if !pids.is_empty() {
        crate::modules::logger::log_info(&format!(
            "Found {} Antigravity processes: {:?}",
            pids.len(),
            pids
        ));
    }

    pids
}

/// Close Antigravity processes
pub fn close_antigravity(#[allow(unused_variables)] timeout_secs: u64) -> Result<(), String> {
    crate::modules::logger::log_info("Closing Antigravity...");

    #[cfg(target_os = "windows")]
    {
        // Windows: Precise kill by PID to support multiple versions or custom filenames
        let pids = get_antigravity_pids();
        if !pids.is_empty() {
            crate::modules::logger::log_info(&format!(
                "Precisely closing {} identified processes on Windows...",
                pids.len()
            ));
            for pid in pids {
                let _ = Command::new("taskkill")
                    .args(["/F", "/PID", &pid.to_string()])
                    .creation_flags(0x08000000) // CREATE_NO_WINDOW
                    .output();
            }
            // Give some time for system to clean up PIDs
            thread::sleep(Duration::from_millis(200));
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: Optimize closing strategy to avoid "Window terminated unexpectedly" popups
        // Strategy: SEND SIGTERM to main process only, let it coordinate closing children

        let pids = get_antigravity_pids();
        if !pids.is_empty() {
            // 1. Identify main process (PID)
            // Strategy: Principal processes of Electron/Tauri do not have the `--type` parameter, while Helper processes have `--type=renderer/gpu/utility`, etc.
            let mut system = System::new();
            system.refresh_processes(sysinfo::ProcessesToUpdate::All);

            let mut main_pid = None;

            // Load manual configuration path as highest priority reference
            let manual_path = crate::modules::config::load_app_config()
                .ok()
                .and_then(|c| c.antigravity_executable)
                .and_then(|p| std::path::PathBuf::from(p).canonicalize().ok());

            crate::modules::logger::log_info("Analyzing process list to identify main process:");
            for pid_u32 in &pids {
                let pid = sysinfo::Pid::from_u32(*pid_u32);
                if let Some(process) = system.process(pid) {
                    let name = process.name().to_string_lossy();
                    let args = process.cmd();
                    let args_str = args
                        .iter()
                        .map(|arg| arg.to_string_lossy().into_owned())
                        .collect::<Vec<String>>()
                        .join(" ");

                    crate::modules::logger::log_info(&format!(
                        " - PID: {} | Name: {} | Args: {}",
                        pid_u32, name, args_str
                    ));

                    // 1. Priority to manual path matching
                    if let (Some(ref m_path), Some(p_exe)) = (&manual_path, process.exe()) {
                        if let Ok(p_path) = p_exe.canonicalize() {
                            let m_path_str = m_path.to_string_lossy();
                            let p_path_str = p_path.to_string_lossy();
                            if let (Some(m_idx), Some(p_idx)) =
                                (m_path_str.find(".app"), p_path_str.find(".app"))
                            {
                                if m_path_str[..m_idx + 4] == p_path_str[..p_idx + 4] {
                                    // Deep validation: even if path matches, must exclude Helper keywords and arguments
                                    let is_helper_by_args = args_str.contains("--type=");
                                    let is_helper_by_name = name.to_lowercase().contains("helper")
                                        || name.to_lowercase().contains("plugin")
                                        || name.to_lowercase().contains("renderer")
                                        || name.to_lowercase().contains("gpu")
                                        || name.to_lowercase().contains("crashpad")
                                        || name.to_lowercase().contains("utility")
                                        || name.to_lowercase().contains("audio")
                                        || name.to_lowercase().contains("sandbox")
                                        || name.to_lowercase().contains("language_server");

                                    if !is_helper_by_args && !is_helper_by_name {
                                        main_pid = Some(pid_u32);
                                        crate::modules::logger::log_info(&format!(
                                            "   => Identified as main process (manual path match)"
                                        ));
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // 2. Feature analysis matching (fallback)
                    let is_helper_by_name = name.to_lowercase().contains("helper")
                        || name.to_lowercase().contains("crashpad")
                        || name.to_lowercase().contains("utility")
                        || name.to_lowercase().contains("audio")
                        || name.to_lowercase().contains("sandbox")
                        || name.to_lowercase().contains("language_server")
                        || name.to_lowercase().contains("plugin")
                        || name.to_lowercase().contains("renderer");

                    let is_helper_by_args = args_str.contains("--type=");

                    if !is_helper_by_name && !is_helper_by_args {
                        if main_pid.is_none() {
                            main_pid = Some(pid_u32);
                            crate::modules::logger::log_info(&format!(
                                "   => Identified as main process (Name/Args analysis)"
                            ));
                        }
                    } else {
                        crate::modules::logger::log_info(&format!(
                            "   => Identified as helper process (Helper/Args)"
                        ));
                    }
                }
            }

            // Phase 1: Graceful exit (SIGTERM)
            if let Some(pid) = main_pid {
                crate::modules::logger::log_info(&format!(
                    "Sending SIGTERM to main process PID: {}",
                    pid
                ));
                let output = Command::new("kill")
                    .args(["-15", &pid.to_string()])
                    .output();

                if let Ok(result) = output {
                    if !result.status.success() {
                        let error = String::from_utf8_lossy(&result.stderr);
                        crate::modules::logger::log_warn(&format!(
                            "Main process SIGTERM failed: {}",
                            error
                        ));
                    }
                }
            } else {
                crate::modules::logger::log_warn(
                    "No clear main process identified, attempting SIGTERM for all processes (may cause popups)",
                );
                for pid in &pids {
                    let _ = Command::new("kill")
                        .args(["-15", &pid.to_string()])
                        .output();
                }
            }

            // Wait for graceful exit (max 70% of timeout_secs)
            let graceful_timeout = (timeout_secs * 7) / 10;
            let start = std::time::Instant::now();
            while start.elapsed() < Duration::from_secs(graceful_timeout) {
                if !is_antigravity_running() {
                    crate::modules::logger::log_info("All Antigravity processes gracefully closed");
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(500));
            }

            // Phase 2: Force kill (SIGKILL) - targeting all remaining processes (Helpers)
            if is_antigravity_running() {
                let remaining_pids = get_antigravity_pids();
                if !remaining_pids.is_empty() {
                    crate::modules::logger::log_warn(&format!(
                        "Graceful exit timeout, force killing {} remaining processes (SIGKILL)",
                        remaining_pids.len()
                    ));
                    for pid in &remaining_pids {
                        let output = Command::new("kill").args(["-9", &pid.to_string()]).output();

                        if let Ok(result) = output {
                            if !result.status.success() {
                                let error = String::from_utf8_lossy(&result.stderr);
                                if !error.contains("No such process") {
                                    // "No matching processes" for killall, "No such process" for kill
                                    crate::modules::logger::log_error(&format!(
                                        "SIGKILL process {} failed: {}",
                                        pid, error
                                    ));
                                }
                            }
                        }
                    }
                    thread::sleep(Duration::from_secs(1));
                }

                // Final check
                if !is_antigravity_running() {
                    crate::modules::logger::log_info("All processes exited after forced cleanup");
                    return Ok(());
                }
            } else {
                crate::modules::logger::log_info("All processes exited after SIGTERM");
                return Ok(());
            }
        } else {
            // Only consider not running when pids is empty, don't error here as it might already be closed
            crate::modules::logger::log_info("Antigravity not running, no need to close");
            return Ok(());
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: Also attempt to identify main process and delegate exit
        let pids = get_antigravity_pids();
        if !pids.is_empty() {
            let mut system = System::new();
            system.refresh_processes(sysinfo::ProcessesToUpdate::All);

            let mut main_pid = None;

            // Load manual configuration path as highest priority reference
            let manual_path = crate::modules::config::load_app_config()
                .ok()
                .and_then(|c| c.antigravity_executable)
                .and_then(|p| std::path::PathBuf::from(p).canonicalize().ok());

            crate::modules::logger::log_info("Analyzing Linux process list to identify main process:");
            for pid_u32 in &pids {
                let pid = sysinfo::Pid::from_u32(*pid_u32);
                if let Some(process) = system.process(pid) {
                    let name = process.name().to_string_lossy().to_lowercase();
                    let args = process.cmd();
                    let args_str = args
                        .iter()
                        .map(|arg| arg.to_string_lossy().into_owned())
                        .collect::<Vec<String>>()
                        .join(" ");

                    crate::modules::logger::log_info(&format!(
                        " - PID: {} | Name: {} | Args: {}",
                        pid_u32, name, args_str
                    ));

                    // 1. Priority to manual path matching
                    if let (Some(ref m_path), Some(p_exe)) = (&manual_path, process.exe()) {
                        if let Ok(p_path) = p_exe.canonicalize() {
                            if &p_path == m_path {
                                // Confirm not a Helper
                                let is_helper_by_args = args_str.contains("--type=");
                                let is_helper_by_name = name.contains("helper")
                                    || name.contains("renderer")
                                    || name.contains("gpu")
                                    || name.contains("crashpad")
                                    || name.contains("utility")
                                    || name.contains("audio")
                                    || name.contains("sandbox");
                                if !is_helper_by_args && !is_helper_by_name {
                                    main_pid = Some(pid_u32);
                                    crate::modules::logger::log_info(&format!(
                                        "   => Identified as main process (manual path match)"
                                    ));
                                    break;
                                }
                            }
                        }
                    }

                    // 2. Feature analysis matching
                    let is_helper_by_args = args_str.contains("--type=");
                    let is_helper_by_name = name.contains("helper")
                        || name.contains("renderer")
                        || name.contains("gpu")
                        || name.contains("crashpad")
                        || name.contains("utility")
                        || name.contains("audio")
                        || name.contains("sandbox")
                        || name.contains("plugin")
                        || name.contains("language_server");

                    if !is_helper_by_args && !is_helper_by_name {
                        if main_pid.is_none() {
                            main_pid = Some(pid_u32);
                            crate::modules::logger::log_info(&format!(
                                "   => Identified as main process (Feature analysis)"
                            ));
                        }
                    } else {
                        crate::modules::logger::log_info(&format!(
                            "   => Identified as helper process (Helper/Args)"
                        ));
                    }
                }
            }

            // Phase 1: Graceful exit (SIGTERM)
            if let Some(pid) = main_pid {
                crate::modules::logger::log_info(&format!("Attempting to gracefully close main process {} (SIGTERM)", pid));
                let _ = Command::new("kill")
                    .args(["-15", &pid.to_string()])
                    .output();
            } else {
                crate::modules::logger::log_warn(
                    "No clear Linux main process identified, sending SIGTERM to all associated processes",
                );
                for pid in &pids {
                    let _ = Command::new("kill")
                        .args(["-15", &pid.to_string()])
                        .output();
                }
            }

            // Wait for graceful exit
            let graceful_timeout = (timeout_secs * 7) / 10;
            let start = std::time::Instant::now();
            while start.elapsed() < Duration::from_secs(graceful_timeout) {
                if !is_antigravity_running() {
                    crate::modules::logger::log_info("Antigravity gracefully closed");
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(500));
            }

            // Phase 2: Force kill (SIGKILL) - targeting all remaining processes
            if is_antigravity_running() {
                let remaining_pids = get_antigravity_pids();
                if !remaining_pids.is_empty() {
                    crate::modules::logger::log_warn(&format!(
                        "Graceful exit timeout, force killing {} remaining processes (SIGKILL)",
                        remaining_pids.len()
                    ));
                    for pid in &remaining_pids {
                        let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
                    }
                    thread::sleep(Duration::from_secs(1));
                }
            }
        } else {
            // pids is empty, meaning no process detected or all excluded by logic
            crate::modules::logger::log_info(
                "No Antigravity processes found to close (possibly filtered or not running)",
            );
        }
    }

    // Final check
    if is_antigravity_running() {
        return Err("Unable to close Antigravity process, please close manually and retry".to_string());
    }

    crate::modules::logger::log_info("Antigravity closed successfully");
    Ok(())
}

/// Start Antigravity
#[allow(unused_mut)]
pub fn start_antigravity() -> Result<(), String> {
    crate::modules::logger::log_info("Starting Antigravity...");

    // Prefer manually specified path and args from configuration
    let config = crate::modules::config::load_app_config().ok();
    let manual_path = config
        .as_ref()
        .and_then(|c| c.antigravity_executable.clone());
    let args = config.and_then(|c| c.antigravity_args.clone());

    if let Some(mut path_str) = manual_path {
        let mut path = std::path::PathBuf::from(&path_str);

        #[cfg(target_os = "macos")]
        {
            // Fault tolerance: If path is inside .app bundle (e.g. misselected Helper), auto-correct to .app directory
            if let Some(app_idx) = path_str.find(".app") {
                let corrected_app = &path_str[..app_idx + 4];
                if corrected_app != path_str {
                    crate::modules::logger::log_info(&format!(
                        "Detected macOS path inside .app bundle, auto-correcting to: {}",
                        corrected_app
                    ));
                    path_str = corrected_app.to_string();
                    path = std::path::PathBuf::from(&path_str);
                }
            }
        }

        if path.exists() {
            crate::modules::logger::log_info(&format!("Starting with manual configuration path: {}", path_str));

            #[cfg(target_os = "macos")]
            {
                // macOS: if .app directory, use open
                if path_str.ends_with(".app") || path.is_dir() {
                    let mut cmd = Command::new("open");
                    cmd.arg("-a").arg(&path_str);

                    // Add startup arguments
                    if let Some(ref args) = args {
                        for arg in args {
                            cmd.arg(arg);
                        }
                    }

                    cmd.spawn().map_err(|e| format!("Startup failed (open): {}", e))?;
                } else {
                    let mut cmd = Command::new(&path_str);

                    // Add startup arguments
                    if let Some(ref args) = args {
                        for arg in args {
                            cmd.arg(arg);
                        }
                    }

                    cmd.spawn()
                        .map_err(|e| format!("Startup failed (direct): {}", e))?;
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                let mut cmd = Command::new(&path_str);

                // Add startup arguments
                if let Some(ref args) = args {
                    for arg in args {
                        cmd.arg(arg);
                    }
                }

                cmd.spawn().map_err(|e| format!("Startup failed: {}", e))?;
            }

            crate::modules::logger::log_info(&format!(
                "Antigravity startup command sent (manual path: {}, args: {:?})",
                path_str, args
            ));
            return Ok(());
        } else {
            crate::modules::logger::log_warn(&format!(
                "Manual configuration path does not exist: {}, falling back to auto-detection",
                path_str
            ));
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Improvement: Use output() to wait for open command completion and capture "app not found" error
        let mut cmd = Command::new("open");
        cmd.args(["-a", "Antigravity"]);

        // Add startup arguments
        if let Some(ref args) = args {
            for arg in args {
                cmd.arg(arg);
            }
        }

        let output = cmd
            .output()
            .map_err(|e| format!("Unable to execute open command: {}", e))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Startup failed (open exited with {}): {}",
                output.status, error
            ));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let has_args = args.as_ref().map_or(false, |a| !a.is_empty());
        
        if has_args {
            if let Some(detected_path) = get_antigravity_executable_path() {
                let path_str = detected_path.to_string_lossy().to_string();
                crate::modules::logger::log_info(&format!(
                    "Starting with auto-detected path (has args): {}",
                    path_str
                ));
                
                use crate::utils::command::CommandExtWrapper;
                let mut cmd = Command::new(&path_str);
                cmd.creation_flags_windows();
                if let Some(ref args) = args {
                    for arg in args {
                        cmd.arg(arg);
                    }
                }
                
                cmd.spawn().map_err(|e| format!("Startup failed: {}", e))?;
            } else {
                return Err("Startup arguments configured but cannot find Antigravity executable path. Please set the executable path manually in Settings.".to_string());
            }
        } else {
            use crate::utils::command::CommandExtWrapper;
            let mut cmd = Command::new("cmd");
            cmd.creation_flags_windows();
            cmd.args(["/C", "start", "antigravity://"]);
            
            let result = cmd.spawn();
            if result.is_err() {
                return Err("Startup failed, please open Antigravity manually".to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let mut cmd = Command::new("antigravity");

        // Add startup arguments
        if let Some(ref args) = args {
            for arg in args {
                cmd.arg(arg);
            }
        }

        cmd.spawn().map_err(|e| format!("Startup failed: {}", e))?;
    }

    crate::modules::logger::log_info(&format!(
        "Antigravity startup command sent (default detection, args: {:?})",
        args
    ));
    Ok(())
}

/// Get Antigravity executable path and startup arguments from running processes
///
/// This is the most reliable method to find installations and startup args anywhere
fn get_process_info() -> (Option<std::path::PathBuf>, Option<Vec<String>>) {
    let mut system = System::new_all();
    system.refresh_all();

    let current_exe = get_current_exe_path();
    let current_pid = std::process::id();

    for (pid, process) in system.processes() {
        let pid_u32 = pid.as_u32();
        if pid_u32 == current_pid {
            continue;
        }

        // Exclude manager process itself
        if let (Some(ref my_path), Some(p_exe)) = (&current_exe, process.exe()) {
            if let Ok(p_path) = p_exe.canonicalize() {
                if my_path == &p_path {
                    continue;
                }
            }
        }

        let name = process.name().to_string_lossy().to_lowercase();

        // Get executable path and command line arguments
        if let Some(exe) = process.exe() {
            let mut args = process.cmd().iter();
            let exe_path = args
                .next()
                .map_or(exe.to_string_lossy(), |arg| arg.to_string_lossy())
                .to_lowercase();

            // Extract actual arguments from command line (skipping exe path)
            let args = args
                .map(|arg| arg.to_string_lossy().to_lowercase())
                .collect::<Vec<String>>();

            let args_str = args.join(" ");

            // Common helper process exclusion logic
            let is_helper = args_str.contains("--type=")
                || args_str.contains("node-ipc")
                || args_str.contains("nodeipc")
                || args_str.contains("max-old-space-size")
                || args_str.contains("node_modules")
                || name.contains("helper")
                || name.contains("plugin")
                || name.contains("renderer")
                || name.contains("gpu")
                || name.contains("crashpad")
                || name.contains("utility")
                || name.contains("audio")
                || name.contains("sandbox")
                || exe_path.contains("crashpad");

            let path = Some(exe.to_path_buf());
            let args = Some(args);
            #[cfg(target_os = "macos")]
            {
                // macOS: Exclude helper processes, match main app only, and check Frameworks
                if exe_path.contains("antigravity.app")
                    && !is_helper
                    && !exe_path.contains("frameworks")
                {
                    // Try to extract .app path for better open command support
                    if let Some(app_idx) = exe_path.find(".app") {
                        let app_path_str = &exe.to_string_lossy()[..app_idx + 4];
                        let path = Some(std::path::PathBuf::from(app_path_str));
                        return (path, args);
                    }
                    return (path, args);
                }
            }

            #[cfg(target_os = "windows")]
            {
                // Windows: Strictly match process name and exclude helpers
                if name == "antigravity.exe" && !is_helper {
                    return (path, args);
                }
            }

            #[cfg(target_os = "linux")]
            {
                // Linux: Check process name or path for antigravity, excluding helpers and manager
                if (name == "antigravity" || exe_path.contains("/antigravity"))
                    && !name.contains("tools")
                    && !is_helper
                {
                    return (path, args);
                }
            }
        }
    }
    (None, None)
}

/// Get Antigravity executable path from running processes
///
/// Most reliable method to find installation anywhere
pub fn get_path_from_running_process() -> Option<std::path::PathBuf> {
    let (path, _) = get_process_info();
    path
}

/// Get Antigravity startup arguments from running processes
pub fn get_args_from_running_process() -> Option<Vec<String>> {
    let (_, args) = get_process_info();
    args
}

/// Get --user-data-dir argument value (if exists)
pub fn get_user_data_dir_from_process() -> Option<std::path::PathBuf> {
    // Prefer getting startup arguments from config
    if let Ok(config) = crate::modules::config::load_app_config() {
        if let Some(args) = config.antigravity_args {
            // Check arguments in config
            for i in 0..args.len() {
                if args[i] == "--user-data-dir" && i + 1 < args.len() {
                    // Next argument is the path
                    let path = std::path::PathBuf::from(&args[i + 1]);
                    if path.exists() {
                        return Some(path);
                    }
                } else if args[i].starts_with("--user-data-dir=") {
                    // Argument and value in same string, e.g. --user-data-dir=/path/to/data
                    let parts: Vec<&str> = args[i].splitn(2, '=').collect();
                    if parts.len() == 2 {
                        let path_str = parts[1];
                        let path = std::path::PathBuf::from(path_str);
                        if path.exists() {
                            return Some(path);
                        }
                    }
                }
            }
        }
    }

    // If not in config, get arguments from running process
    if let Some(args) = get_args_from_running_process() {
        for i in 0..args.len() {
            if args[i] == "--user-data-dir" && i + 1 < args.len() {
                // Next argument is the path
                let path = std::path::PathBuf::from(&args[i + 1]);
                if path.exists() {
                    return Some(path);
                }
            } else if args[i].starts_with("--user-data-dir=") {
                // Argument and value in same string, e.g. --user-data-dir=/path/to/data
                let parts: Vec<&str> = args[i].splitn(2, '=').collect();
                if parts.len() == 2 {
                    let path_str = parts[1];
                    let path = std::path::PathBuf::from(path_str);
                    if path.exists() {
                        return Some(path);
                    }
                }
            }
        }
    }

    None
}

/// Get Antigravity executable path (cross-platform)
///
/// Search strategy (highest to lowest priority):
/// 1. Get path from running process (most reliable, supports any location)
/// 2. Iterate standard installation locations
/// 3. Return None
pub fn get_antigravity_executable_path() -> Option<std::path::PathBuf> {
    // Strategy 1: Get from running process (supports any location)
    if let Some(path) = get_path_from_running_process() {
        return Some(path);
    }

    // Strategy 2: Check standard installation locations
    check_standard_locations()
}

/// Check standard installation locations
fn check_standard_locations() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let path = std::path::PathBuf::from("/Applications/Antigravity.app");
        if path.exists() {
            return Some(path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::env;

        // Get environment variables
        let local_appdata = env::var("LOCALAPPDATA").ok();
        let program_files =
            env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let program_files_x86 =
            env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());

        let mut possible_paths = Vec::new();

        // User installation location (preferred)
        if let Some(local) = local_appdata {
            possible_paths.push(
                std::path::PathBuf::from(&local)
                    .join("Programs")
                    .join("Antigravity")
                    .join("Antigravity.exe"),
            );
        }

        // System installation location
        possible_paths.push(
            std::path::PathBuf::from(&program_files)
                .join("Antigravity")
                .join("Antigravity.exe"),
        );

        // 32-bit compatibility location
        possible_paths.push(
            std::path::PathBuf::from(&program_files_x86)
                .join("Antigravity")
                .join("Antigravity.exe"),
        );

        // Return the first existing path
        for path in possible_paths {
            if path.exists() {
                return Some(path);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let possible_paths = vec![
            std::path::PathBuf::from("/usr/bin/antigravity"),
            std::path::PathBuf::from("/opt/Antigravity/antigravity"),
            std::path::PathBuf::from("/usr/share/antigravity/antigravity"),
        ];

        // User local installation
        if let Some(home) = dirs::home_dir() {
            let user_local = home.join(".local/bin/antigravity");
            if user_local.exists() {
                return Some(user_local);
            }
        }

        for path in possible_paths {
            if path.exists() {
                return Some(path);
            }
        }
    }

    None
}

// ============================================================
// CodeBuddy process management helpers
// ============================================================

use std::time::Instant;

static APP_PATH_NOT_FOUND_PREFIX: &str = "未找到应用路径: ";

fn app_path_missing_error(app: &str) -> String {
    format!("{}{}", APP_PATH_NOT_FOUND_PREFIX, app)
}

#[cfg(target_os = "macos")]
fn normalize_macos_app_root(path: &std::path::Path) -> Option<String> {
    let path_str = path.to_string_lossy();
    if let Some(app_idx) = path_str.find(".app") {
        return Some(path_str[..app_idx + 4].to_string());
    }
    None
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn spawn_detached_unix(cmd: &mut std::process::Command) -> Result<std::process::Child, String> {
    use std::os::unix::process::CommandExt;
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    unsafe {
        cmd.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    cmd.spawn().map_err(|e| format!("启动失败: {}", e))
}


#[cfg(target_os = "macos")]
fn spawn_open_app_with_options(
    app_root: &str,
    args: &[String],
    force_new_instance: bool,
) -> Result<u32, String> {
    let mut cmd = std::process::Command::new("open");
    if force_new_instance {
        cmd.arg("-n");
    }
    cmd.arg("-a").arg(app_root);
    if !args.is_empty() {
        cmd.arg("--args");
        for arg in args {
            if !arg.trim().is_empty() {
                cmd.arg(arg);
            }
        }
    }
    let child = spawn_detached_unix(&mut cmd).map_err(|e| format!("启动失败: {}", e))?;
    Ok(child.id())
}

#[cfg(target_os = "macos")]
fn resolve_macos_app_root_from_launch_path(launch_path: &std::path::Path) -> Option<String> {
    let app_root = normalize_macos_app_root(launch_path)?;
    if std::path::Path::new(&app_root).exists() {
        Some(app_root)
    } else {
        None
    }
}

fn resolve_codebuddy_app_path_from_config() -> Option<String> {
    crate::modules::config::load_app_config()
        .ok()
        .and_then(|c| c.codebuddy_app_path)
        .and_then(|p| {
            let trimmed = p.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        })
}


pub fn detect_codebuddy_exec_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let candidates = vec![
            "/Applications/CodeBuddy.app/Contents/MacOS/CodeBuddy".to_string(),
            "/Applications/CodeBuddy.app/Contents/MacOS/Electron".to_string(),
        ];
        for p in &candidates {
            let pb = std::path::PathBuf::from(p);
            if pb.exists() {
                return Some(pb);
            }
        }
        // Scan .app in Applications
        for app_name in &["CodeBuddy.app"] {
            let app_path = std::path::PathBuf::from("/Applications").join(app_name);
            if app_path.exists() {
                if let Some(exec) = resolve_codebuddy_macos_exec_path(&app_path) {
                    return Some(exec);
                }
            }
        }
        None
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let p = std::path::PathBuf::from(local)
                .join("Programs")
                .join("CodeBuddy")
                .join("CodeBuddy.exe");
            if p.exists() {
                return Some(p);
            }
        }
        None
    }

    #[cfg(target_os = "linux")]
    {
        let candidates = ["/usr/bin/codebuddy", "/usr/local/bin/codebuddy", "/opt/codebuddy/codebuddy"];
        for p in &candidates {
            let pb = std::path::PathBuf::from(p);
            if pb.exists() {
                return Some(pb);
            }
        }
        if let Some(home) = dirs::home_dir() {
            let user_local = home.join(".local/bin/codebuddy");
            if user_local.exists() {
                return Some(user_local);
            }
        }
        None
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    { None }
}


#[cfg(target_os = "macos")]
fn resolve_codebuddy_macos_exec_path(app_path: &std::path::Path) -> Option<std::path::PathBuf> {
    let macos_dir = app_path.join("Contents").join("MacOS");
    // Try known binary names first
    for name in &["CodeBuddy", "Electron"] {
        let p = macos_dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    // Scan directory, skip helpers
    if let Ok(entries) = std::fs::read_dir(&macos_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_lowercase();
            if fname.contains("crashpad") || fname.contains("helper") {
                continue;
            }
            let meta = entry.metadata().ok()?;
            if meta.is_file() {
                return Some(entry.path());
            }
        }
    }
    None
}

pub fn resolve_codebuddy_launch_path() -> Result<std::path::PathBuf, String> {
    // Config override takes priority
    if let Some(config_path) = resolve_codebuddy_app_path_from_config() {
        #[cfg(target_os = "macos")]
        {
            let p = std::path::Path::new(&config_path);
            if let Some(app_root) = normalize_macos_app_root(p) {
                let app_pb = std::path::PathBuf::from(&app_root);
                if let Some(exec) = resolve_codebuddy_macos_exec_path(&app_pb) {
                    return Ok(exec);
                }
            }
            let direct = std::path::PathBuf::from(&config_path);
            if direct.exists() {
                return Ok(direct);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let p = std::path::PathBuf::from(&config_path);
            if p.exists() {
                return Ok(p);
            }
        }
    }
    detect_codebuddy_exec_path().ok_or_else(|| "未找到 CodeBuddy 可执行文件，请在设置中手动指定路径".to_string())
}


pub fn is_pid_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "stat="])
            .output();
        match output {
            Ok(out) => {
                let stat = String::from_utf8_lossy(&out.stdout);
                let s = stat.trim();
                !s.is_empty() && !s.starts_with('Z')
            }
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        use sysinfo::{Pid, System};
        let mut sys = System::new();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        sys.process(Pid::from_u32(pid)).is_some()
    }
}

fn split_command_tokens(cmdline: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let chars: Vec<char> = cmdline.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '\'' if !in_double => { in_single = !in_single; }
            '"' if !in_single => { in_double = !in_double; }
            ' ' | '\t' if !in_single && !in_double => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            _ => { current.push(c); }
        }
        i += 1;
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn is_env_token(token: &str) -> bool {
    if let Some(eq_pos) = token.find('=') {
        let key = &token[..eq_pos];
        !key.is_empty() && key.chars().all(|c| c.is_alphanumeric() || c == '_')
    } else {
        false
    }
}

pub fn extract_user_data_dir_from_command_line(cmdline: &str) -> Option<String> {
    let tokens = split_command_tokens(cmdline);
    // Skip leading env tokens
    let mut start = 0;
    while start < tokens.len() && is_env_token(&tokens[start]) {
        start += 1;
    }
    let tokens = &tokens[start..];
    let mut i = 0;
    while i < tokens.len() {
        let t = &tokens[i];
        if let Some(val) = t.strip_prefix("--user-data-dir=") {
            let v = val.trim();
            if !v.is_empty() { return Some(v.to_string()); }
        } else if t == "--user-data-dir" {
            if let Some(next) = tokens.get(i + 1) {
                let v = next.trim();
                if !v.is_empty() { return Some(v.to_string()); }
            }
        }
        i += 1;
    }
    None
}


pub fn normalize_path_for_compare(path: &str) -> Option<String> {
    let p = std::path::Path::new(path);
    let canonical = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let s = canonical.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        let stripped = s.strip_prefix("\\\\?\\").unwrap_or(&s);
        return Some(stripped.to_lowercase());
    }
    #[cfg(not(target_os = "windows"))]
    {
        Some(s)
    }
}

fn normalize_non_empty_path_for_compare(path: &str) -> Option<String> {
    if path.trim().is_empty() { return None; }
    normalize_path_for_compare(path)
}

pub fn is_helper_command_line(cmdline: &str) -> bool {
    let lower = cmdline.to_lowercase();
    // Filter helper processes
    if lower.contains("--type=") { return true; }
    let helper_keywords = [
        " helper", "/helper", "\\helper",
        "crashpad", "renderer", "gpu-process", "utility",
        "audio service", "sandbox", "--node-ipc",
        "--clientprocessid=",
    ];
    for kw in &helper_keywords {
        if lower.contains(kw) { return true; }
    }
    // Filter extension host
    if lower.contains("extensionhost") || lower.contains("extension-host") { return true; }
    false
}


/// ProcessEntry holds PID and command line for a running CodeBuddy process
#[derive(Debug, Clone)]
pub struct CodeBuddyProcessEntry {
    pub pid: u32,
    pub cmdline: String,
    pub user_data_dir: Option<String>,
}

pub fn collect_codebuddy_process_entries() -> Vec<CodeBuddyProcessEntry> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("ps")
            .args(["-axo", "pid,command"])
            .output();
        let output = match output {
            Ok(o) => o,
            Err(_) => return vec![],
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut entries = Vec::new();
        for line in stdout.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let mut parts = line.splitn(2, |c: char| c.is_whitespace());
            let pid_str = parts.next().unwrap_or("").trim();
            let cmdline = parts.next().unwrap_or("").trim();
            let lower = cmdline.to_lowercase();
            if !lower.contains("codebuddy.app/contents/macos/") { continue; }
            if is_helper_command_line(cmdline) { continue; }
            let pid: u32 = match pid_str.parse() { Ok(p) => p, Err(_) => continue };
            let user_data_dir = extract_user_data_dir_from_command_line(cmdline);
            entries.push(CodeBuddyProcessEntry { pid, cmdline: cmdline.to_string(), user_data_dir });
        }
        entries
    }

    #[cfg(target_os = "linux")]
    {
        let mut entries = Vec::new();
        let proc_dir = std::path::Path::new("/proc");
        let dir_iter = match std::fs::read_dir(proc_dir) { Ok(d) => d, Err(_) => return vec![] };
        for entry in dir_iter.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let pid: u32 = match name.parse() { Ok(p) => p, Err(_) => continue };
            let cmdline_path = proc_dir.join(&name).join("cmdline");
            let data = match std::fs::read(&cmdline_path) { Ok(d) => d, Err(_) => continue };
            let cmdline = data.split(|&b| b == 0).map(|s| String::from_utf8_lossy(s).to_string()).collect::<Vec<_>>().join(" ");
            let lower = cmdline.to_lowercase();
            if !lower.contains("codebuddy") { continue; }
            if is_helper_command_line(&cmdline) { continue; }
            let user_data_dir = extract_user_data_dir_from_command_line(&cmdline);
            entries.push(CodeBuddyProcessEntry { pid, cmdline, user_data_dir });
        }
        entries
    }

    #[cfg(target_os = "windows")]
    {
        let ps_script = r#"Get-Process | Where-Object { $_.Name -like '*codebuddy*' } | ForEach-Object { $id = $_.Id; try { $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$id").CommandLine; "$id|$cmd" } catch { "$id|" } }"#;
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", ps_script])
            .output();
        let output = match output { Ok(o) => o, Err(_) => return vec![] };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut entries = Vec::new();
        for line in stdout.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let mut parts = line.splitn(2, '|');
            let pid_str = parts.next().unwrap_or("").trim();
            let cmdline = parts.next().unwrap_or("").trim();
            let pid: u32 = match pid_str.parse() { Ok(p) => p, Err(_) => continue };
            if is_helper_command_line(cmdline) { continue; }
            let user_data_dir = extract_user_data_dir_from_command_line(cmdline);
            entries.push(CodeBuddyProcessEntry { pid, cmdline: cmdline.to_string(), user_data_dir });
        }
        entries
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    { vec![] }
}


fn pick_preferred_pid(mut pids: Vec<u32>) -> Option<u32> {
    pids.sort_unstable();
    pids.dedup();
    pids.into_iter().next()
}

fn build_user_data_dir_match_target(
    requested_dir: Option<&str>,
) -> (Option<String>, bool) {
    let get_default = || -> Option<String> {
        crate::modules::codebuddy_cn_instance::get_default_codebuddy_cn_user_data_dir()
            .ok()
            .and_then(|p| p.to_str().map(|s| s.to_string()))
            .and_then(|s| normalize_non_empty_path_for_compare(&s))
    };
    match requested_dir {
        Some(dir) => {
            let trimmed = dir.trim();
            if trimmed.is_empty() {
                (get_default(), true)
            } else {
                (normalize_non_empty_path_for_compare(trimmed), false)
            }
        }
        None => (get_default(), true),
    }
}

fn collect_matching_pids_by_user_data_dir(
    entries: &[CodeBuddyProcessEntry],
    target: &Option<String>,
    allow_none_for_target: bool,
) -> Vec<u32> {
    entries.iter().filter_map(|e| {
        match &e.user_data_dir {
            Some(dir) => {
                let norm = normalize_non_empty_path_for_compare(dir);
                if norm.as_ref() == target.as_ref() { Some(e.pid) } else { None }
            }
            None => {
                if allow_none_for_target { Some(e.pid) } else { None }
            }
        }
    }).collect()
}

fn resolve_pid_from_entries_by_user_data_dir(
    entries: &[CodeBuddyProcessEntry],
    target: &Option<String>,
    allow_none_for_target: bool,
    last_pid: Option<u32>,
) -> Option<u32> {
    // Check last_pid first
    if let Some(lp) = last_pid {
        if lp != 0 && is_pid_running(lp) {
            // Verify it matches
            if let Some(entry) = entries.iter().find(|e| e.pid == lp) {
                let norm = entry.user_data_dir.as_deref()
                    .and_then(|d| normalize_non_empty_path_for_compare(d));
                if norm.as_ref() == target.as_ref() || (allow_none_for_target && entry.user_data_dir.is_none()) {
                    return Some(lp);
                }
            }
        }
    }
    let matching = collect_matching_pids_by_user_data_dir(entries, target, allow_none_for_target);
    pick_preferred_pid(matching)
}

pub fn resolve_codebuddy_pid(last_pid: Option<u32>, user_data_dir: Option<&str>) -> Option<u32> {
    let entries = collect_codebuddy_process_entries();
    if entries.is_empty() { return None; }
    let (target, allow_none) = build_user_data_dir_match_target(user_data_dir);
    resolve_pid_from_entries_by_user_data_dir(&entries, &target, allow_none, last_pid)
}


fn focus_window_by_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            r#"tell application "System Events" to set frontmost of (first process whose unix id is {}) to true"#,
            pid
        );
        let status = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .status()
            .map_err(|e| format!("osascript failed: {}", e))?;
        if status.success() { Ok(()) } else { Err(format!("osascript exited with {:?}", status.code())) }
    }

    #[cfg(target_os = "windows")]
    {
        let script = format!(
            r#"Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W {{ [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }}'; $p = Get-Process -Id {}; [W]::SetForegroundWindow($p.MainWindowHandle)"#,
            pid
        );
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()
            .map_err(|e| format!("powershell failed: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        // Try wmctrl first
        let result = std::process::Command::new("wmctrl")
            .args(["-ip", &(pid as i64).to_string()])
            .status();
        if result.map(|s| s.success()).unwrap_or(false) {
            return Ok(());
        }
        // Fallback to xdotool
        let result = std::process::Command::new("xdotool")
            .args(["search", "--pid", &pid.to_string(), "windowactivate", "--sync"])
            .status();
        if result.map(|s| s.success()).unwrap_or(false) {
            return Ok(());
        }
        Err("无法聚焦窗口（未安装 wmctrl 或 xdotool）".to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = pid;
        Err("不支持的平台".to_string())
    }
}

pub fn focus_process_pid(pid: u32) -> Result<u32, String> {
    if pid == 0 || !is_pid_running(pid) {
        return Err("实例未运行，无法定位窗口".to_string());
    }
    focus_window_by_pid(pid)?;
    Ok(pid)
}

fn send_close_signal(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-15", &pid.to_string()])
            .status();
    }
}

fn wait_pids_exit(pids: &[u32], timeout_secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    loop {
        if pids.iter().all(|&p| !is_pid_running(p)) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(350));
    }
}

pub fn close_pid(pid: u32, timeout_secs: u64) -> Result<(), String> {
    if pid == 0 { return Err("PID 无效，无法关闭进程".to_string()); }
    if !is_pid_running(pid) { return Ok(()); }
    send_close_signal(pid);
    if wait_pids_exit(&[pid], timeout_secs) {
        Ok(())
    } else {
        Err("无法关闭实例进程，请手动关闭后重试".to_string())
    }
}


pub fn start_codebuddy_with_args_with_new_window(
    user_data_dir: &str,
    extra_args: &[String],
    use_new_window: bool,
) -> Result<u32, String> {
    #[cfg(target_os = "macos")]
    {
        let target = user_data_dir.trim();
        if target.is_empty() {
            return Err("实例目录为空，无法启动".to_string());
        }
        let app_root = resolve_codebuddy_app_path_from_config()
            .and_then(|p| {
                let pb = std::path::PathBuf::from(&p);
                resolve_macos_app_root_from_launch_path(&pb)
            })
            .or_else(|| {
                resolve_codebuddy_launch_path()
                    .ok()
                    .and_then(|p| resolve_macos_app_root_from_launch_path(&p))
            });
        let app_root = app_root.ok_or_else(|| app_path_missing_error("codebuddy"))?;

        let mut args: Vec<String> = vec![
            "--user-data-dir".to_string(),
            target.to_string(),
        ];
        args.push(if use_new_window { "--new-window".to_string() } else { "--reuse-window".to_string() });
        for arg in extra_args {
            let trimmed = arg.trim();
            if !trimmed.is_empty() { args.push(trimmed.to_string()); }
        }

        let open_pid = spawn_open_app_with_options(&app_root, &args, true)
            .map_err(|e| format!("启动 CodeBuddy 失败: {}", e))?;
        // Poll for real PID
        let started = Instant::now();
        let timeout = Duration::from_secs(6);
        while started.elapsed() < timeout {
            if let Some(resolved_pid) = resolve_codebuddy_pid(None, Some(target)) {
                return Ok(resolved_pid);
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        Ok(open_pid)
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        const DETACHED_PROCESS: u32 = 0x00000008;

        let target = user_data_dir.trim();
        if target.is_empty() {
            return Err("实例目录为空，无法启动".to_string());
        }
        let launch_path = resolve_codebuddy_launch_path()?;
        let mut cmd = std::process::Command::new(&launch_path);
        cmd.creation_flags(0x08000000 | CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        cmd.arg("--user-data-dir").arg(target);
        cmd.arg(if use_new_window { "--new-window" } else { "--reuse-window" });
        for arg in extra_args {
            let trimmed = arg.trim();
            if !trimmed.is_empty() { cmd.arg(trimmed); }
        }
        let child = cmd.spawn().map_err(|e| format!("启动 CodeBuddy 失败: {}", e))?;
        Ok(child.id())
    }

    #[cfg(target_os = "linux")]
    {
        let target = user_data_dir.trim();
        if target.is_empty() {
            return Err("实例目录为空，无法启动".to_string());
        }
        let launch_path = resolve_codebuddy_launch_path()?;
        let mut cmd = std::process::Command::new(&launch_path);
        cmd.arg("--user-data-dir").arg(target);
        cmd.arg(if use_new_window { "--new-window" } else { "--reuse-window" });
        for arg in extra_args {
            let trimmed = arg.trim();
            if !trimmed.is_empty() { cmd.arg(trimmed); }
        }
        let child = spawn_detached_unix(&mut cmd).map_err(|e| format!("启动 CodeBuddy 失败: {}", e))?;
        Ok(child.id())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (user_data_dir, extra_args, use_new_window);
        Err("CodeBuddy 多开实例仅支持 macOS、Windows 和 Linux".to_string())
    }
}

