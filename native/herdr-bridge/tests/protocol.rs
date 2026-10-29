use mcw_herdr_bridge::{
    decode_server, encode_client, read_frame, read_json_line, BridgeCommand, MAX_FRAME_SIZE,
};
use std::io::{self, Cursor, Read};

struct Fragmented(Cursor<Vec<u8>>);
impl Read for Fragmented {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let len = out.len().min(1);
        self.0.read(&mut out[..len])
    }
}

#[test]
fn fragmented_length_and_payload_are_reassembled() {
    let mut stream = Fragmented(Cursor::new(vec![3, 0, 0, 0, 20, 0, 0]));
    assert_eq!(read_frame(&mut stream).unwrap(), Some(vec![20, 0, 0]));
    assert!(read_frame(&mut stream).unwrap().is_none());
}

#[test]
fn truncated_prefix_and_body_are_rejected() {
    for bytes in [vec![1], vec![2, 0, 0], vec![4, 0, 0, 0, 20]] {
        assert!(read_frame(&mut Cursor::new(bytes)).is_err());
    }
}

#[test]
fn oversized_frames_rejected_before_body_allocation() {
    let mut bytes = ((32 * 1024 * 1024 + 1) as u32).to_le_bytes().to_vec();
    bytes.push(0);
    assert!(read_frame(&mut Cursor::new(bytes)).is_err());
}

#[test]
fn unknown_named_controls_are_preserved_but_not_executed() {
    let mut bytes = vec![20];
    bytes.extend(
        bincode::encode_to_vec(
            ("future.control.v1", "{\"safe\":true}"),
            bincode::config::standard(),
        )
        .unwrap(),
    );
    let value = decode_server(&bytes).unwrap();
    assert_eq!(value["type"], "control");
    assert_eq!(value["kind"], "future.control.v1");
    assert_eq!(value["data"]["safe"], true);
    bytes.push(0);
    assert!(decode_server(&bytes).is_err());
}

#[test]
fn forged_container_length_and_truncated_control_rejected() {
    assert!(decode_server(&[20, 255, 255, 255, 255, 255, 255, 255, 255, 255]).is_err());
    assert!(decode_server(&[20, 4, b'a']).is_err());
    assert!(decode_server(&[13, 0]).is_err());
    assert!(decode_server(&[19, 0]).is_err());
}

#[test]
fn bad_or_huge_json_input_is_rejected() {
    assert!(serde_json::from_str::<BridgeCommand>(
        r#"{"type":"input","paneId":"p","events":[{"Key":{"code":"Oops"}}]}"#
    )
    .is_err());
    let mut long = Cursor::new(vec![b' '; MAX_FRAME_SIZE + 1]);
    assert!(read_json_line(&mut long).is_err());
    let invalid: BridgeCommand =
        serde_json::from_str(r#"{"type":"resize","cols":0,"rows":24}"#).unwrap();
    assert!(encode_client(&invalid, false, None).is_err());
    let resize: BridgeCommand =
        serde_json::from_str(r#"{"type":"resize","cols":80,"rows":24}"#).unwrap();
    assert!(encode_client(&resize, false, None).is_err());
}

#[test]
fn semantic_paste_and_connection_scoped_request_use_pinned_tags() {
    let input: BridgeCommand =
        serde_json::from_str(r#"{"type":"input","paneId":"p","events":[{"Paste":"hello"}]}"#)
            .unwrap();
    assert_eq!(encode_client(&input, false, None).unwrap()[0], 13);
    let request: BridgeCommand = serde_json::from_str(r#"{"type":"request","bootId":"boot","request":{"id":"focus","method":"tab.focus","params":{"tab_id":"tab"}}}"#).unwrap();
    assert_eq!(encode_client(&request, false, None).unwrap()[0], 15);
}

fn surface_fixture() -> serde_json::Value {
    serde_json::json!({
        "boot_id":"test-boot", "projection_revision":2, "surface_revision":3,
        "frame":{"width":2,"height":1,"cells":[
            {"symbol":"한","fg":4294967295u32,"bg":0,"modifier":1,"skip":false,"hyperlink":0},
            {"symbol":"","fg":0,"bg":0,"modifier":0,"skip":true,"hyperlink":null}
        ],"cursor":{"x":0,"y":0,"visible":true,"shape":2},"hyperlinks":["https://example.com"],"graphics":[]},
        "panes":[],"splits":[],"popup":null,
        "graphics":{"assets":[{"key":{"source":{"PaneLayer":{"pane_id":"p","layer_id":"l"}},"image_width":1,"image_height":1,"format":"Rgba","data_len":4,"data_fingerprint":18446744073709551615u64},"data":[1,2,3,4]}],"placements":[],"retained_assets":[]}
    })
}

#[test]
fn upstream_serde_full_surface_decodes_losslessly_with_safe_graphics_key() {
    let surface: mcw_herdr_bridge::wire::PaneSurfaceFrame =
        serde_json::from_value(surface_fixture()).unwrap();
    // Upstream writes its ServerMessage using serde bincode. Test against that encoding.
    let mut payload = vec![13];
    payload.extend(bincode::serde::encode_to_vec(&surface, bincode::config::standard()).unwrap());
    let decoded = decode_server(&payload).unwrap();
    assert_eq!(decoded["type"], "surface");
    assert_eq!(decoded["surface"]["frame"]["cells"][0]["symbol"], "한");
    assert_eq!(
        decoded["surface"]["graphics"]["assets"][0]["data"],
        serde_json::json!([1, 2, 3, 4])
    );
    assert_eq!(
        decoded["surface"]["graphics"]["assets"][0]["key"]["data_fingerprint"],
        "18446744073709551615"
    );
    payload.push(0);
    assert!(decode_server(&payload).is_err());
}

#[test]
fn upstream_serde_patch_decode_and_surface_consistency_validation() {
    let patch: mcw_herdr_bridge::wire::PaneSurfacePatch = serde_json::from_value(serde_json::json!({
        "boot_id":"b","projection_revision":1,"base_surface_revision":3,"surface_revision":4,
        "rows":[{"x":0,"y":0,"cells":[{"symbol":"X","fg":0,"bg":0,"modifier":0,"skip":false,"hyperlink":null}]}],"panes":[],"cursor":null
    })).unwrap();
    let mut payload = vec![19];
    payload.extend(bincode::serde::encode_to_vec(&patch, bincode::config::standard()).unwrap());
    let decoded = decode_server(&payload).unwrap();
    assert_eq!(decoded["patch"]["base_surface_revision"], 3);
    assert_eq!(decoded["patch"]["rows"][0]["cells"][0]["symbol"], "X");
    let mut surface: mcw_herdr_bridge::wire::PaneSurfaceFrame =
        serde_json::from_value(surface_fixture()).unwrap();
    surface.frame.cells.pop();
    let mut malformed = vec![13];
    malformed.extend(bincode::serde::encode_to_vec(&surface, bincode::config::standard()).unwrap());
    assert!(decode_server(&malformed).is_err());
}

#[test]
fn response_chunks_preserve_incomplete_utf8_for_later_concatenation() {
    let mut payload = vec![18];
    payload.extend(
        bincode::encode_to_vec(
            ("b", "r", false, vec![0xed_u8, 0x95]),
            bincode::config::standard(),
        )
        .unwrap(),
    );
    let decoded = decode_server(&payload).unwrap();
    assert_eq!(decoded["dataBytes"], serde_json::json!([237, 149]));
    assert!(decoded["data"].is_null());
}

#[test]
fn endpoint_request_bounds_match_server_connection_safety_limits() {
    let command = |boot: String, id: String, payload: String| -> BridgeCommand {
        serde_json::from_value(serde_json::json!({"type":"request","bootId":boot,"request":{"id":id,"method":"tab.rename","params":{"tab_id":"w1:t1","label":payload}}})).unwrap()
    };
    assert!(encode_client(
        &command("b".repeat(129), "r".into(), "x".into()),
        true,
        None
    )
    .is_err());
    assert!(encode_client(
        &command("b".into(), "r".repeat(129), "x".into()),
        true,
        None
    )
    .is_err());
    assert!(encode_client(
        &command("b".into(), "r".into(), "x".repeat(1024 * 1024)),
        true,
        None
    )
    .is_err());
}

#[test]
fn every_truncated_full_surface_prefix_is_rejected() {
    let surface: mcw_herdr_bridge::wire::PaneSurfaceFrame =
        serde_json::from_value(surface_fixture()).unwrap();
    let mut payload = vec![13];
    payload.extend(bincode::serde::encode_to_vec(&surface, bincode::config::standard()).unwrap());
    for length in 0..payload.len() {
        assert!(
            decode_server(&payload[..length]).is_err(),
            "accepted truncated full frame at {length}"
        );
    }
}

#[test]
fn unsupported_generation_and_error_welcome_fail_negotiation() {
    let welcome = serde_json::json!({"type":"control","kind":"endpoint.welcome.v1","data":{
        "generation":1,"server_version":"0.9.5","snapshot_codec":"shell.snapshot.v1","surface_codec":"shell.surface.v1",
        "input_codec":"shell.input.semantic.v1","blob_codec":"shell.blob.v1","methods":[],"capabilities":[]
    }});
    mcw_herdr_bridge::validate_welcome(&welcome).unwrap();
    let mut unsupported = welcome.clone();
    unsupported["data"]["generation"] = serde_json::json!(2);
    assert!(mcw_herdr_bridge::validate_welcome(&unsupported).is_err());
    let mut rejected = welcome.clone();
    rejected["data"]["error"] =
        serde_json::json!({"code":"unsupported_generation","message":"rejected"});
    assert!(mcw_herdr_bridge::validate_welcome(&rejected).is_err());
}
