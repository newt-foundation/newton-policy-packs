// Pinata REST helpers. Matches ../newton-dashboard/src/app/api/ipfs-upload/route.ts
// for JSON + text uploads, and adds a binary multipart upload for WASM (the
// dashboard never pins WASM).

const PIN_JSON_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
const PIN_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';

interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

async function checkOk(label: string, response: Response): Promise<void> {
  if (response.ok) return;
  const text = await response.text();
  throw new Error(`Pinata ${label} failed: ${response.status} ${response.statusText} — ${text}`);
}

export async function pinJSON(jwt: string, content: unknown, name: string): Promise<string> {
  const response = await fetch(PIN_JSON_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      pinataContent: content,
      pinataMetadata: { name },
      pinataOptions: { cidVersion: 1 },
    }),
  });
  await checkOk('pinJSON', response);
  const data = (await response.json()) as PinataResponse;
  return data.IpfsHash;
}

// Text uploads use pinFileToIPFS so newlines / formatting are preserved
// byte-for-byte (matches CLI behaviour and the dashboard's text helper).
export async function pinText(jwt: string, content: string, filename: string): Promise<string> {
  const blob = new Blob([content], { type: 'text/plain' });
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('pinataMetadata', JSON.stringify({ name: filename }));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

  const response = await fetch(PIN_FILE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  await checkOk('pinText', response);
  const data = (await response.json()) as PinataResponse;
  return data.IpfsHash;
}

export async function pinBinary(
  jwt: string,
  bytes: Uint8Array,
  filename: string,
): Promise<string> {
  // Wrap in Blob so FormData treats it as a file upload (Pinata requires the
  // multipart `file` field to be a file, not a string).
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('pinataMetadata', JSON.stringify({ name: filename }));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

  const response = await fetch(PIN_FILE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  await checkOk('pinBinary', response);
  const data = (await response.json()) as PinataResponse;
  return data.IpfsHash;
}
