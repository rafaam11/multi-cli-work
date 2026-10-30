//! Read-only process identities for host shutdown verification. Never signals a process.
use serde::Serialize;
use std::io;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Process {
    pid: u32,
    parent_pid: u32,
    start_id: Option<String>,
    name: String,
    executable: Option<String>,
}

#[cfg(target_os = "linux")]
pub fn snapshot() -> io::Result<Vec<Process>> {
    use std::fs;
    let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id")?;
    let mut result = Vec::new();
    for entry in fs::read_dir("/proc")? {
        let entry = entry?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<u32>().ok())
        else {
            continue;
        };
        if pid == 0 {
            continue;
        }
        let stat = match fs::read(entry.path().join("stat")) {
            Ok(value) => String::from_utf8_lossy(&value).into_owned(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        // Zombies have no executable work left; their kernel record can remain
        // until the parent reaps it. Keep their live descendants independently.
        if stat
            .rsplit_once(')')
            .is_some_and(|(_, rest)| matches!(rest.split_whitespace().next(), Some("Z" | "X")))
        {
            continue;
        }
        let (name, parent_pid, start) = parse_stat(&stat)?;
        result.push(Process {
            pid,
            parent_pid,
            name,
            start_id: Some(format!("{}:{start}", boot.trim())),
            executable: fs::read_link(entry.path().join("exe"))
                .ok()
                .map(|p| p.to_string_lossy().into_owned()),
        });
    }
    Ok(result)
}

#[cfg(any(target_os = "linux", test))]
fn parse_stat(stat: &str) -> io::Result<(String, u32, String)> {
    let invalid = || io::Error::new(io::ErrorKind::InvalidData, "invalid process stat");
    let open = stat.find('(').ok_or_else(invalid)?;
    let close = stat.rfind(')').ok_or_else(invalid)?;
    if close <= open {
        return Err(invalid());
    }
    let fields: Vec<_> = stat[close + 1..].split_whitespace().collect();
    let parent = fields
        .get(1)
        .and_then(|v| v.parse::<u32>().ok())
        .ok_or_else(invalid)?;
    let start = fields
        .get(19)
        .filter(|v| v.parse::<u64>().is_ok())
        .ok_or_else(invalid)?;
    Ok((stat[open + 1..close].to_string(), parent, start.to_string()))
}

#[cfg(windows)]
pub fn snapshot() -> io::Result<Vec<Process>> {
    use windows_sys::Win32::{
        Foundation::{
            CloseHandle, GetLastError, ERROR_NO_MORE_FILES, FILETIME, INVALID_HANDLE_VALUE,
            STILL_ACTIVE,
        },
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            Threading::{
                GetExitCodeProcess, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
    };
    struct Handle(windows_sys::Win32::Foundation::HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    unsafe {
        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if handle == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let handle = Handle(handle);
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut available = Process32FirstW(handle.0, &mut entry);
        let mut result = Vec::new();
        while available != 0 {
            if entry.th32ProcessID != 0 {
                let mut start_id = None;
                let mut executable = None;
                let process =
                    OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID);
                if !process.is_null() {
                    let process = Handle(process);
                    let mut exit_code = 0;
                    if GetExitCodeProcess(process.0, &mut exit_code) != 0
                        && exit_code != STILL_ACTIVE as u32
                    {
                        available = Process32NextW(handle.0, &mut entry);
                        continue;
                    }
                    let mut times: [FILETIME; 4] = std::mem::zeroed();
                    let ptr = times.as_mut_ptr();
                    if GetProcessTimes(process.0, ptr, ptr.add(1), ptr.add(2), ptr.add(3)) != 0 {
                        start_id = Some(format!(
                            "windows:{:08x}{:08x}",
                            times[0].dwHighDateTime, times[0].dwLowDateTime
                        ));
                    }
                    let mut buffer = vec![0u16; 32768];
                    let mut length = buffer.len() as u32;
                    if QueryFullProcessImageNameW(process.0, 0, buffer.as_mut_ptr(), &mut length)
                        != 0
                    {
                        executable = Some(String::from_utf16_lossy(&buffer[..length as usize]));
                    }
                }
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|c| *c == 0)
                    .unwrap_or(entry.szExeFile.len());
                result.push(Process {
                    pid: entry.th32ProcessID,
                    parent_pid: entry.th32ParentProcessID,
                    start_id,
                    name: String::from_utf16_lossy(&entry.szExeFile[..len]),
                    executable,
                });
            }
            available = Process32NextW(handle.0, &mut entry);
        }
        if GetLastError() != ERROR_NO_MORE_FILES {
            return Err(io::Error::last_os_error());
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifies_current_process_without_reading_arguments() {
        let processes = snapshot().unwrap();
        let own = processes
            .iter()
            .find(|p| p.pid == std::process::id())
            .unwrap();
        assert!(own.start_id.is_some());
        assert!(own.executable.is_some());
    }
    #[cfg(windows)]
    #[test]
    fn excludes_terminated_children_even_when_a_process_handle_is_retained() {
        use std::os::windows::process::CommandExt;
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "exit", "0"])
            .creation_flags(0x08000000)
            .spawn()
            .unwrap();
        child.wait().unwrap();
        assert!(!snapshot().unwrap().iter().any(|p| p.pid == child.id()));
    }
    #[test]
    fn parses_parentheses_in_linux_names_and_kernel_start_token() {
        let line = format!("12 (weird ) shell) S 11 {} 888 0", "0 ".repeat(17));
        let (name, parent, start) = parse_stat(&line).unwrap();
        assert_eq!(
            (name.as_str(), parent, start.as_str()),
            ("weird ) shell", 11, "888")
        );
        assert!(parse_stat("12 malformed").is_err());
    }
}
