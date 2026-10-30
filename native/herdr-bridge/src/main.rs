use interprocess::{
    local_socket::{prelude::*, Stream},
    TryClone,
};
mod processes;
use mcw_herdr_bridge::{
    decode_server, encode_client, read_frame, read_json_line, validate_welcome, write_frame,
    BridgeCommand,
};
use serde_json::{json, Value};
use std::{
    io::{self, BufReader, Write},
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::Duration,
};

fn emit(value: &Value) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, value)?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}

fn connect(path: &Path) -> io::Result<Stream> {
    #[cfg(unix)]
    {
        use interprocess::local_socket::GenericFilePath;
        Stream::connect(path.to_fs_name::<GenericFilePath>()?)
    }
    #[cfg(windows)]
    {
        use interprocess::local_socket::GenericNamespaced;
        Stream::connect(
            path.to_string_lossy()
                .to_string()
                .to_ns_name::<GenericNamespaced>()?,
        )
    }
}

enum Event {
    Command(io::Result<Option<String>>),
    Server(io::Result<Option<Value>>),
}

fn run() -> io::Result<()> {
    let mut args = std::env::args_os().skip(1);
    let mode = args.next();
    if mode.as_deref() == Some(std::ffi::OsStr::new("--process-snapshot")) && args.next().is_none()
    {
        return emit(&serde_json::to_value(processes::snapshot()?)?);
    }
    if mode.as_deref() == Some(std::ffi::OsStr::new("--boot-identity")) && args.next().is_none() {
        return emit(&json!({"bootId": processes::boot_identity()?}));
    }
    if mode.as_deref() != Some(std::ffi::OsStr::new("--socket")) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "usage: mcw-herdr-bridge --socket <absolute Herdr endpoint path>",
        ));
    }
    let path = PathBuf::from(
        args.next()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing --socket path"))?,
    );
    if !path.is_absolute() || args.next().is_some() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "--socket must be one absolute endpoint path",
        ));
    }

    // Wait for the host's explicit hello before connecting or affecting any server.
    let mut stdin = BufReader::new(io::stdin());
    let first = read_json_line(&mut stdin)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "expected hello command"))?;
    let command: BridgeCommand = serde_json::from_str(&first)?;
    let size_owner = match &command {
        BridgeCommand::Hello { size_owner, .. } => *size_owner,
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "first command must be hello",
            ))
        }
    };
    let hello = encode_client(&command, size_owner, None)?;
    let mut stream = connect(&path)?;
    stream.set_nonblocking(false)?;
    // Named-pipe read timeouts are unsupported on some Windows versions.
    if let Err(e) = stream.set_recv_timeout(Some(Duration::from_secs(10))) {
        if e.kind() != io::ErrorKind::Unsupported {
            return Err(e);
        }
    }
    write_frame(&mut stream, &hello)?;
    // Enforce a wall-clock deadline even where Windows pipes cannot set a read
    // timeout. This thread owns only our connection, and process exit releases it.
    let mut welcome_reader = stream.try_clone()?;
    let (welcome_tx, welcome_rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let welcome = read_frame(&mut welcome_reader).and_then(|frame| {
            frame
                .ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "Herdr disconnected during handshake",
                    )
                })
                .and_then(|bytes| decode_server(&bytes))
        });
        let _ = welcome_tx.send(welcome);
    });
    let welcome = welcome_rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| {
            io::Error::new(io::ErrorKind::TimedOut, "Herdr endpoint welcome timed out")
        })??;
    validate_welcome(&welcome)?;
    emit(&welcome)?;
    if let Err(e) = stream.set_recv_timeout(None) {
        if e.kind() != io::ErrorKind::Unsupported {
            return Err(e);
        }
    }

    // One bounded queue provides backpressure to both socket and stdin producers.
    let (tx, rx) = mpsc::sync_channel(1);
    let socket_tx = tx.clone();
    let mut reader = stream.try_clone()?;
    thread::spawn(move || loop {
        let value = read_frame(&mut reader)
            .and_then(|payload| payload.map(|bytes| decode_server(&bytes)).transpose());
        let done = !matches!(&value, Ok(Some(_)));
        if socket_tx.send(Event::Server(value)).is_err() || done {
            break;
        }
    });
    thread::spawn(move || loop {
        let line = read_json_line(&mut stdin);
        let done = !matches!(&line, Ok(Some(_)));
        if tx.send(Event::Command(line)).is_err() || done {
            break;
        }
    });

    let mut boot_id: Option<String> = None;
    for event in rx {
        match event {
            Event::Command(Ok(Some(line))) => {
                let command = match serde_json::from_str::<BridgeCommand>(&line) {
                    Ok(BridgeCommand::Hello { .. }) => {
                        emit(
                            &json!({"type":"error","message":"hello is only valid as the first command"}),
                        )?;
                        continue;
                    }
                    Ok(command) => command,
                    Err(e) => {
                        emit(&json!({"type":"error","message":format!("invalid command: {e}")}))?;
                        continue;
                    }
                };
                match encode_client(&command, size_owner, boot_id.as_deref()) {
                    Ok(payload) => write_frame(&mut stream, &payload)?,
                    Err(e) => {
                        emit(&json!({"type":"error","message":e.to_string()}))?;
                        continue;
                    }
                }
                if matches!(command, BridgeCommand::Detach) {
                    emit(&json!({"type":"disconnected","reason":"client detached"}))?;
                    return Ok(());
                }
            }
            Event::Command(Ok(None)) => {
                let _ = write_frame(
                    &mut stream,
                    &encode_client(&BridgeCommand::Detach, size_owner, None)?,
                );
                emit(&json!({"type":"disconnected","reason":"stdin closed"}))?;
                return Ok(());
            }
            Event::Command(Err(e)) => return Err(e),
            Event::Server(Ok(Some(value))) => {
                if let Some(boot) = value["data"]["boot_id"]
                    .as_str()
                    .or_else(|| value["surface"]["boot_id"].as_str())
                {
                    boot_id = Some(boot.to_owned());
                }
                let disconnected = value["type"] == "disconnected";
                emit(&value)?;
                if disconnected {
                    return Ok(());
                }
            }
            Event::Server(Ok(None)) => {
                emit(&json!({"type":"disconnected","reason":"Herdr endpoint closed"}))?;
                return Ok(());
            }
            Event::Server(Err(e)) => return Err(e),
        }
    }
    Ok(())
}

fn main() {
    if let Err(e) = run() {
        let _ = emit(&json!({"type":"error","fatal":true,"message":e.to_string()}));
        let _ = emit(&json!({"type":"disconnected","reason":e.to_string()}));
        std::process::exit(1);
    }
}
