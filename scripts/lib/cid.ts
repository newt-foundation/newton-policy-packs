// Local CIDv1 calc to cross-check Pinata's response. newton-cli emits raw
// codec (`bafkrei...`) for small files and dag-pb (`bafybei...`) for chunked
// ones. We only verify the raw case here — anything that lands as `bafybei`
// (e.g. WASM binaries) gets logged but not asserted, since dag-pb depends on
// chunk size.
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';

export async function rawCidV1(bytes: Uint8Array): Promise<string> {
  const hash = await sha256.digest(bytes);
  return CID.createV1(raw.code, hash).toString();
}

export function isRawCid(cid: string): boolean {
  return cid.startsWith('bafkrei');
}
