export function tailOnUtf8Boundary(buffer: Buffer, maxBytes: number): Buffer {
  if (maxBytes <= 0) return Buffer.alloc(0);
  if (buffer.length <= maxBytes) return buffer;

  let start = buffer.length - maxBytes;
  for (let advanced = 0; advanced < 3 && start < buffer.length && (buffer[start] & 0xc0) === 0x80; advanced++) {
    start++;
  }
  return buffer.subarray(start);
}
