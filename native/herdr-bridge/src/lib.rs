//! MCW's bounded, stdio-only adapter for the pinned Herdr stable endpoint v1.
pub mod wire;

use bincode::{Decode, Encode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, BufRead, Read, Write};

pub const MAX_FRAME_SIZE: usize = 2 * 1024 * 1024;
pub const MAX_GRAPHICS_FRAME_SIZE: usize = 32 * 1024 * 1024;
const MAX_CELLS: usize = 1_000_000;
const MAX_DIMENSION: u16 = 4096;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum BridgeCommand {
    #[serde(rename_all = "camelCase")]
    Hello {
        cols: u16,
        rows: u16,
        #[serde(default)]
        cell_width_px: u32,
        #[serde(default)]
        cell_height_px: u32,
        #[serde(default = "yes")]
        surface_active: bool,
        #[serde(default)]
        size_owner: bool,
    },
    #[serde(rename_all = "camelCase")]
    Request {
        boot_id: String,
        request: Value,
    },
    #[serde(rename_all = "camelCase")]
    Input {
        pane_id: String,
        events: Vec<wire::ClientPaneInputEvent>,
    },
    #[serde(rename_all = "camelCase")]
    Resize {
        cols: u16,
        rows: u16,
        #[serde(default)]
        cell_width_px: u32,
        #[serde(default)]
        cell_height_px: u32,
    },
    SurfaceInterest {
        active: bool,
    },
    Detach,
}

fn yes() -> bool {
    true
}
fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

/// Read a single bounded JSONL command, including the final line without LF.
pub fn read_json_line<R: BufRead>(reader: &mut R) -> io::Result<Option<String>> {
    let mut line = Vec::new();
    loop {
        let bytes = reader.fill_buf()?;
        if bytes.is_empty() {
            break;
        }
        let take = bytes
            .iter()
            .position(|&b| b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(bytes.len());
        if line.len().saturating_add(take) > MAX_FRAME_SIZE {
            return Err(invalid("JSONL command exceeds 2 MiB"));
        }
        let done = bytes[take - 1] == b'\n';
        line.extend_from_slice(&bytes[..take]);
        reader.consume(take);
        if done {
            break;
        }
    }
    if line.is_empty() {
        return Ok(None);
    }
    String::from_utf8(line)
        .map(Some)
        .map_err(|_| invalid("command must be UTF-8"))
}

/// The four-byte LE prefix is not bincode's variable-length integer encoding.
pub fn read_frame<R: Read>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut prefix = [0u8; 4];
    loop {
        match reader.read(&mut prefix[..1]) {
            Ok(0) => return Ok(None),
            Ok(_) => break,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    reader.read_exact(&mut prefix[1..])?;
    let length = u32::from_le_bytes(prefix) as usize;
    if length == 0 || length > MAX_GRAPHICS_FRAME_SIZE {
        return Err(invalid("invalid Herdr frame length"));
    }
    let mut tag = [0u8; 1];
    reader.read_exact(&mut tag)?;
    // Only complete semantic surfaces carry negotiated inline graphics assets.
    if length > MAX_FRAME_SIZE && tag[0] != 13 {
        return Err(invalid("non-graphics frame exceeds 2 MiB"));
    }
    let mut payload = vec![0; length];
    payload[0] = tag[0];
    reader.read_exact(&mut payload[1..])?;
    Ok(Some(payload))
}

pub fn write_frame<W: Write>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    if payload.len() > MAX_FRAME_SIZE {
        return Err(invalid("outgoing frame exceeds 2 MiB"));
    }
    writer.write_all(&(payload.len() as u32).to_le_bytes())?;
    writer.write_all(payload)?;
    writer.flush()
}

fn encode<T: Encode>(tag: u32, body: T) -> io::Result<Vec<u8>> {
    let mut bytes = bincode::encode_to_vec(tag, bincode::config::standard())
        .map_err(|e| invalid(e.to_string()))?;
    bincode::encode_into_std_write(body, &mut bytes, bincode::config::standard())
        .map_err(|e| invalid(e.to_string()))?;
    if bytes.len() > MAX_FRAME_SIZE {
        return Err(invalid("outgoing frame exceeds 2 MiB"));
    }
    Ok(bytes)
}

fn geometry(cols: u16, rows: u16, cell_width: u32, cell_height: u32) -> io::Result<()> {
    if cols == 0
        || rows == 0
        || cols > MAX_DIMENSION
        || rows > MAX_DIMENSION
        || cols as usize * rows as usize > MAX_CELLS
        || cell_width > 1024
        || cell_height > 1024
    {
        return Err(invalid("terminal geometry outside supported bounds"));
    }
    Ok(())
}

pub fn encode_client(
    command: &BridgeCommand,
    size_owner: bool,
    current_boot: Option<&str>,
) -> io::Result<Vec<u8>> {
    match command {
        BridgeCommand::Hello {
            cols,
            rows,
            cell_width_px,
            cell_height_px,
            surface_active,
            ..
        } => {
            geometry(*cols, *rows, *cell_width_px, *cell_height_px)?;
            let data = json!({"generation":1,"cell_width_px":cell_width_px,"cell_height_px":cell_height_px,
                "surface_size":{"cols":cols,"rows":rows},"pixel_mouse":false,"direct_graphics":false,
                "endpoint_keybindings":false,"mouse_capture":false,"surface_active":surface_active,
                "surface_reuse":false,"surface_delta":false,"surface_scroll":false,
                "snapshot_codecs":["shell.snapshot.v1"],"surface_codecs":["shell.surface.v1"],
                "input_codecs":["shell.input.semantic.v1"],"blob_codecs":["shell.blob.v1"]});
            encode(20, ("endpoint.hello.v1", data.to_string()))
        }
        BridgeCommand::Request { boot_id, request } => {
            if boot_id.is_empty() || boot_id.len() > 128 {
                return Err(invalid("invalid bootId"));
            }
            if current_boot.is_some_and(|boot| boot != boot_id) {
                return Err(invalid("request targets a stale bootId"));
            }
            let request = if let Value::String(text) = request {
                serde_json::from_str::<Value>(text).map_err(|e| invalid(e.to_string()))?
            } else {
                request.clone()
            };
            if !request.is_object()
                || request["id"].as_str().is_none()
                || request["method"].as_str().is_none()
            {
                return Err(invalid("request requires id and method strings"));
            }
            if request["id"].as_str().is_some_and(|id| id.len() > 128) {
                return Err(invalid("request id exceeds 128 bytes"));
            }
            let text = request.to_string();
            if text.len() > 1024 * 1024 {
                return Err(invalid("endpoint request exceeds 1 MiB"));
            }
            encode(15, (boot_id, text))
        }
        BridgeCommand::Input { pane_id, events } => {
            if pane_id.is_empty() || pane_id.len() > 512 || events.is_empty() || events.len() > 1024
            {
                return Err(invalid("invalid pane input target or event count"));
            }
            for event in events {
                match event {
                    wire::ClientPaneInputEvent::Key {
                        repeat_count,
                        modifiers,
                        generated_text,
                        ..
                    } if *repeat_count == 0
                        || *repeat_count > 1024
                        || *modifiers > 63
                        || generated_text
                            .as_ref()
                            .is_some_and(|s| s.len() > MAX_FRAME_SIZE / 2) =>
                    {
                        return Err(invalid("invalid semantic key event"))
                    }
                    wire::ClientPaneInputEvent::TextCommit(s)
                    | wire::ClientPaneInputEvent::Paste(s)
                        if s.len() > MAX_FRAME_SIZE / 2 =>
                    {
                        return Err(invalid("input text too large"))
                    }
                    wire::ClientPaneInputEvent::Mouse { lines, .. } if *lines > 1024 => {
                        return Err(invalid("mouse scroll count too large"))
                    }
                    _ => {}
                }
            }
            encode(13, (pane_id, events))
        }
        BridgeCommand::Resize {
            cols,
            rows,
            cell_width_px,
            cell_height_px,
        } => {
            if !size_owner {
                return Err(invalid("only the host size owner may resize this endpoint"));
            }
            geometry(*cols, *rows, *cell_width_px, *cell_height_px)?;
            encode(
                12,
                (
                    *cell_width_px,
                    *cell_height_px,
                    wire::ClientSurfaceSize {
                        cols: *cols,
                        rows: *rows,
                    },
                    false,
                ),
            )
        }
        BridgeCommand::SurfaceInterest { active } => {
            let boot = current_boot
                .ok_or_else(|| invalid("surface interest requires a shell snapshot bootId"))?;
            let request = json!({"id":format!("mcw-surface-{}", if *active {"on"} else {"off"}),"method":"client_shell.surface.set","params":{"active":active}});
            encode(15, (boot, request.to_string()))
        }
        BridgeCommand::Detach => encode(4, ()),
    }
}

fn decode<T: Decode<()>>(bytes: &[u8]) -> io::Result<T> {
    let (value, consumed) = bincode::decode_from_slice(
        bytes,
        bincode::config::standard().with_limit::<MAX_GRAPHICS_FRAME_SIZE>(),
    )
    .map_err(|e| invalid(e.to_string()))?;
    if consumed != bytes.len() {
        return Err(invalid("trailing bytes in Herdr message"));
    }
    Ok(value)
}

fn validate_frame(frame: &wire::FrameData) -> io::Result<()> {
    geometry(frame.width, frame.height, 0, 0)?;
    if frame.cells.len() != frame.width as usize * frame.height as usize {
        return Err(invalid("frame cell count differs from geometry"));
    }
    for cell in &frame.cells {
        if cell.symbol.len() > 65536
            || cell
                .hyperlink
                .is_some_and(|id| id as usize >= frame.hyperlinks.len())
        {
            return Err(invalid("invalid frame cell or hyperlink reference"));
        }
    }
    Ok(())
}

fn safe_graphics_keys(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            if let Some(fingerprint) = fields.get_mut("data_fingerprint") {
                if let Some(number) = fingerprint.as_u64() {
                    *fingerprint = Value::String(number.to_string());
                }
            }
            for child in fields.values_mut() {
                safe_graphics_keys(child);
            }
        }
        Value::Array(items) => {
            for item in items {
                safe_graphics_keys(item);
            }
        }
        _ => {}
    }
}

pub fn validate_welcome(value: &Value) -> io::Result<()> {
    let data = &value["data"];
    if value["type"] != "control"
        || value["kind"] != "endpoint.welcome.v1"
        || data["generation"] != 1
        || !data["error"].is_null()
        || data["snapshot_codec"] != "shell.snapshot.v1"
        || data["surface_codec"] != "shell.surface.v1"
        || data["input_codec"] != "shell.input.semantic.v1"
        || data["blob_codec"] != "shell.blob.v1"
    {
        return Err(invalid(format!(
            "Herdr stable endpoint negotiation rejected: {data}"
        )));
    }
    Ok(())
}

/// Decode only stable negotiated messages. Optional unrelated traffic is ignored.
pub fn decode_server(payload: &[u8]) -> io::Result<Value> {
    if payload.is_empty() || payload.len() > MAX_GRAPHICS_FRAME_SIZE {
        return Err(invalid("invalid Herdr payload length"));
    }
    let (tag, offset): (u32, usize) =
        bincode::decode_from_slice(payload, bincode::config::standard())
            .map_err(|e| invalid(e.to_string()))?;
    let body = &payload[offset..];
    match tag {
        13 => {
            let surface: wire::PaneSurfaceFrame = decode(body)?;
            validate_frame(&surface.frame)?;
            if let Some(popup) = &surface.popup {
                validate_frame(&popup.frame)?;
            }
            for asset in &surface.graphics.assets {
                if asset.data.len() as u64 != asset.key.data_len
                    || asset.key.image_width == 0
                    || asset.key.image_height == 0
                    || asset.key.image_width > 32768
                    || asset.key.image_height > 32768
                {
                    return Err(invalid("invalid inline image asset"));
                }
                let channels = match asset.key.format {
                    wire::SurfaceGraphicsFormat::Rgb => Some(3u64),
                    wire::SurfaceGraphicsFormat::Rgba => Some(4u64),
                    wire::SurfaceGraphicsFormat::Png => None,
                };
                if channels.is_some_and(|n| {
                    asset.key.image_width as u64 * asset.key.image_height as u64 * n
                        != asset.key.data_len
                }) {
                    return Err(invalid("raw image length differs from geometry"));
                }
            }
            let mut value = json!({"type":"surface","surface":surface});
            safe_graphics_keys(&mut value);
            Ok(value)
        }
        19 => {
            let patch: wire::PaneSurfacePatch = decode(body)?;
            if patch.rows.len() > MAX_CELLS
                || patch.rows.iter().any(|row| {
                    row.cells.len() > MAX_DIMENSION as usize
                        || row.x as usize + row.cells.len() > MAX_DIMENSION as usize
                        || row.y >= MAX_DIMENSION
                })
            {
                return Err(invalid("patch geometry outside bounds"));
            }
            Ok(json!({"type":"patch","patch":patch}))
        }
        20 => {
            let (kind, data): (String, String) = decode(body)?;
            let data: Value = serde_json::from_str(&data).unwrap_or(Value::String(data));
            Ok(json!({"type":"control","kind":kind,"data":data}))
        }
        18 => {
            let (boot_id, request_id, final_chunk, data): (String, String, bool, Vec<u8>) =
                decode(body)?;
            let text = std::str::from_utf8(&data).ok();
            Ok(
                json!({"type":"response","bootId":boot_id,"requestId":request_id,"finalChunk":final_chunk,"dataBytes":data,"data":text}),
            )
        }
        3 => {
            let reason: Option<String> = decode(body)?;
            Ok(json!({"type":"disconnected","reason":reason}))
        }
        15 => {
            let message: String = decode(body)?;
            Ok(json!({"type":"error","message":message}))
        }
        // Never read GraphicsFile (tag 10) paths or execute raw terminal/clipboard data.
        _ => Ok(json!({"type":"ignored","tag":tag})),
    }
}
