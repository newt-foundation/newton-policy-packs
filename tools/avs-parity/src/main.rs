// AVS-parse-path harness for `policy-pack-shared` parity tests.
//
// Reads `policyParams` bytes (hex with optional `0x` prefix) on stdin, runs
// the same two calls the AVS host runs at
// `newton-prover-avs/crates/core/src/common/task.rs:402-408`:
//
//     let s = String::from_utf8(bytes).map_err(...)?;
//     let v: serde_json::Value = serde_json::from_str(&s).map_err(...)?;
//
// then re-serializes `v` back to JSON and prints the resulting bytes as hex
// on stdout. The test asserts that round-trip equals the SDK encoder's output
// — any divergence in numeric formatting, key ordering, or UTF-8 handling
// surfaces as a non-equal hex string.

use std::io::{self, Read, Write};
use std::process::ExitCode;

fn run() -> Result<Vec<u8>, String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|e| format!("read stdin: {e}"))?;
    let trimmed = input.trim();
    let hex_str = trimmed.strip_prefix("0x").unwrap_or(trimmed);

    let bytes = hex_decode(hex_str)?;
    let s = String::from_utf8(bytes).map_err(|e| format!("from_utf8: {e}"))?;
    let v: serde_json::Value = serde_json::from_str(&s).map_err(|e| format!("from_str: {e}"))?;
    let out = serde_json::to_vec(&v).map_err(|e| format!("to_vec: {e}"))?;
    Ok(out)
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err(format!("odd hex length {}", s.len()));
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    for i in (0..bytes.len()).step_by(2) {
        let hi = nibble(bytes[i])?;
        let lo = nibble(bytes[i + 1])?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn nibble(c: u8) -> Result<u8, String> {
    match c {
        b'0'..=b'9' => Ok(c - b'0'),
        b'a'..=b'f' => Ok(c - b'a' + 10),
        b'A'..=b'F' => Ok(c - b'A' + 10),
        _ => Err(format!("invalid hex byte 0x{c:02x}")),
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(2 + bytes.len() * 2);
    s.push_str("0x");
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

fn main() -> ExitCode {
    match run() {
        Ok(out) => {
            let stdout = io::stdout();
            let mut h = stdout.lock();
            let _ = writeln!(h, "{}", hex_encode(&out));
            ExitCode::SUCCESS
        }
        Err(e) => {
            let stderr = io::stderr();
            let mut h = stderr.lock();
            let _ = writeln!(h, "avs-parity: {e}");
            ExitCode::FAILURE
        }
    }
}
