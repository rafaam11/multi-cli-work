// @vitest-environment node
import {crc32} from 'node:zlib';
import {expect,it} from 'vitest';
import {embeddedArchive,parseListing,payloadProblems} from './check-nsis-payload.mjs';

const listing=method=>`Path = C:\\temp\\app.7z
Type = 7z
Method = ARM64 LZMA2:20 LZMA:20 BCJ2

----------
Path = resources\\v2\\herdr\\windows-mcw\\conpty\\arm64
Attributes = D....
Method =

Path = resources\\v2\\herdr\\windows-mcw\\conpty\\arm64\\OpenConsole.exe
Attributes = ....A
Method = ${method}

Path = resources\\v2\\herdr\\windows-mcw\\conpty\\x64\\OpenConsole.exe
Attributes = ....A
Method = BCJ2 LZMA2:20 LZMA:20:lc0:lp2 LZMA:20:lc0:lp2
`;
const required=['resources/v2/herdr/windows-mcw/conpty/arm64/OpenConsole.exe','resources/v2/herdr/windows-mcw/conpty/x64/OpenConsole.exe'];

it('rejects the v2.0.0 payload whose arm64 ConPTY host used a coder the NSIS extractor skips',()=>{
  expect(payloadProblems(parseListing(listing('ARM64 LZMA2:20')),required)).toEqual(['resources/v2/herdr/windows-mcw/conpty/arm64/OpenConsole.exe: ARM64 cannot be extracted by the NSIS installer']);
  expect(payloadProblems(parseListing(listing('BCJ2 LZMA2:20 LZMA:20:lc0:lp2 LZMA:20:lc0:lp2')),required)).toEqual([]);
});
it('reports a required Herdr file that is absent, ignoring archive-level properties and directories',()=>{
  const entries=parseListing(listing('LZMA2:20'));
  expect(entries.map(entry=>entry.path)).not.toContain('C:/temp/app.7z');
  expect(payloadProblems(entries,[...required,'resources/v2/herdr/windows-mcw/conpty/conpty.dll'])).toEqual(['resources/v2/herdr/windows-mcw/conpty/conpty.dll: missing from the installer']);
});
it('finds the embedded archive by its verified start header, not a stray signature',()=>{
  const signature=Buffer.from([0x37,0x7a,0xbc,0xaf,0x27,0x1c,0,4]);
  const header=Buffer.alloc(20);header.writeBigUInt64LE(3n,0);header.writeBigUInt64LE(2n,8);
  const crc=Buffer.alloc(4);crc.writeUInt32LE(crc32(header));
  const archive=Buffer.concat([signature,crc,header,Buffer.from('abcde')]);
  const stray=Buffer.concat([signature,Buffer.alloc(24)]);
  const installer=Buffer.concat([Buffer.from('MZ stub'),stray,archive,Buffer.from('trailing NSIS data')]);
  expect(embeddedArchive(installer).equals(archive)).toBe(true);
  expect(()=>embeddedArchive(Buffer.from('no archive'))).toThrow(/does not contain/);
});
