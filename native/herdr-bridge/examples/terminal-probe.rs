//! Disposable E2E terminal program, never bundled into MCW. Unlike Node's Win32
//! TTY adapter, it enables native VT input for mouse and bracketed paste checks.
use std::{
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::PathBuf,
    thread,
    time::Duration,
};

#[cfg(windows)]
fn raw() -> io::Result<()> {
    use windows_sys::Win32::System::Console::{
        GetConsoleMode, GetStdHandle, SetConsoleMode, ENABLE_VIRTUAL_TERMINAL_INPUT,
        ENABLE_VIRTUAL_TERMINAL_PROCESSING, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
    };
    unsafe {
        let input = GetStdHandle(STD_INPUT_HANDLE);
        let output = GetStdHandle(STD_OUTPUT_HANDLE);
        let mut mode = 0;
        if GetConsoleMode(output, &mut mode) == 0
            || SetConsoleMode(output, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING) == 0
            || SetConsoleMode(input, ENABLE_VIRTUAL_TERMINAL_INPUT) == 0
        {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}
#[cfg(unix)]
fn raw() -> io::Result<()> {
    let status = std::process::Command::new("stty")
        .args(["raw", "-echo"])
        .stdin(std::process::Stdio::inherit())
        .status()?;
    if !status.success() {
        return Err(io::Error::other("stty refused raw mode"));
    }
    Ok(())
}
fn output(text: &str) -> io::Result<()> {
    let mut out = io::stdout().lock();
    out.write_all(text.as_bytes())?;
    out.flush()
}
fn main() -> io::Result<()> {
    let root = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .ok_or_else(|| io::Error::other("fixture directory required"))?,
    );
    if !root.is_absolute() || !root.is_dir() {
        return Err(io::Error::other(
            "absolute existing fixture directory required",
        ));
    }
    raw()?;
    let input_root = root.clone();
    thread::spawn(move || -> io::Result<()> {
        let mut input = io::stdin().lock();
        let mut data = [0u8; 4096];
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(input_root.join("input.jsonl"))?;
        loop {
            let n = input.read(&mut data)?;
            if n == 0 {
                return Ok(());
            }
            serde_json::to_writer(&mut file, &data[..n])?;
            file.write_all(b"\n")?;
            file.flush()?;
        }
    });
    output("\x1b[?2004h\x1b[2J\x1b[HMCW 한글 터미널\r\nREADY> ")?;
    fs::write(root.join("ready"), "ready")?;
    let mut previous = 0;
    loop {
        if let Ok(raw) = fs::read(root.join("emit.json")) {
            if let Ok(next) = serde_json::from_slice::<serde_json::Value>(&raw) {
                if let (Some(id), Some(content)) = (next["id"].as_u64(), next["content"].as_str()) {
                    if id > previous {
                        output(content)?;
                        previous = id;
                        fs::write(root.join("emitted"), id.to_string())?;
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(50));
    }
}
