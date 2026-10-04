// Patch the Muse SDK token into a prebuilt ESP-IDF app image, in the browser.
//
// CI builds the firmware with PLACEHOLDER_TOKEN as CONFIG_GADGET_SDK_TOKEN.
// Real tokens are the same length (48 chars, enforced by the SDK's
// cmake/validate_config.cmake), so the token is swapped byte-for-byte and
// nothing else in the image moves. Afterwards the image's XOR checksum and
// appended SHA-256 are recomputed so the bootloader accepts it.
//
// Image layout (ESP-IDF esp_image_format.h):
//   24-byte header: magic 0xE9 @0, segment count @1, hash_appended @23
//   segments: { u32 load_addr, u32 data_len, data[data_len] } x count
//   zero padding so the checksum byte lands at offset % 16 == 15
//   1-byte checksum: 0xEF XOR every segment data byte
//   32-byte SHA-256 of everything before it (only if hash_appended == 1)
//   [signed apps only: a signature block, which we leave untouched; see README]

export const TOKEN_LENGTH = 48;
// Same rule as the SDK: mgst_ + 43 canonical base64url chars (32 bytes).
export const TOKEN_RE = /^mgst_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
export const PLACEHOLDER_TOKEN = "mgst_" + "MUSEWEBPLACEHOLDER".padEnd(42, "0") + "A";

const IMAGE_MAGIC = 0xe9;
const CHECKSUM_SEED = 0xef;
const HEADER_LEN = 24;
const SEGMENT_HEADER_LEN = 8;

export function parseImage(bytes) {
  if (bytes.length < HEADER_LEN || bytes[0] !== IMAGE_MAGIC) {
    throw new Error("Not an ESP app image (bad magic byte)");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const segmentCount = bytes[1];
  const hashAppended = bytes[23] === 1;

  const segments = [];
  let pos = HEADER_LEN;
  for (let i = 0; i < segmentCount; i++) {
    if (pos + SEGMENT_HEADER_LEN > bytes.length) throw new Error("Truncated segment header");
    const length = view.getUint32(pos + 4, true);
    const dataStart = pos + SEGMENT_HEADER_LEN;
    if (dataStart + length > bytes.length) throw new Error("Truncated segment data");
    segments.push({ start: dataStart, end: dataStart + length });
    pos = dataStart + length;
  }

  const checksumOffset = pos + (15 - (pos % 16));
  const hashOffset = hashAppended ? checksumOffset + 1 : null;
  const imageEnd = hashAppended ? hashOffset + 32 : checksumOffset + 1;
  if (imageEnd > bytes.length) throw new Error("Truncated image trailer");

  return { segments, checksumOffset, hashOffset, imageEnd };
}

function computeChecksum(bytes, segments) {
  let sum = CHECKSUM_SEED;
  for (const { start, end } of segments) {
    for (let i = start; i < end; i++) sum ^= bytes[i];
  }
  return sum;
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

// Throws unless the image's checksum and (if present) hash are correct.
export async function verifyImage(bytes) {
  const info = parseImage(bytes);
  if (computeChecksum(bytes, info.segments) !== bytes[info.checksumOffset]) {
    throw new Error("Image checksum mismatch");
  }
  if (info.hashOffset !== null) {
    const expected = await sha256(bytes.subarray(0, info.hashOffset));
    const actual = bytes.subarray(info.hashOffset, info.hashOffset + 32);
    if (!expected.every((b, i) => b === actual[i])) throw new Error("Image SHA-256 mismatch");
  }
  return info;
}

function findAll(haystack, needle) {
  const hits = [];
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    hits.push(i);
  }
  return hits;
}

// Returns a new Uint8Array with every copy of the placeholder replaced by
// `token`, plus how many copies were replaced. The input is not modified.
export async function patchToken(original, token) {
  if (!TOKEN_RE.test(token)) {
    throw new Error("That doesn't look like an SDK token. Copy it again from gadgets.muse.ai.");
  }
  const info = await verifyImage(original);
  const bytes = new Uint8Array(original);
  const encoder = new TextEncoder();
  const needle = encoder.encode(PLACEHOLDER_TOKEN);
  const replacement = encoder.encode(token);

  const hits = findAll(bytes.subarray(0, info.imageEnd), needle);
  if (hits.length === 0) {
    throw new Error("This firmware has no token placeholder. Was it built by muse-web CI?");
  }
  for (const at of hits) {
    const inSegment = info.segments.some((s) => at >= s.start && at + needle.length <= s.end);
    if (!inSegment) throw new Error(`Placeholder at 0x${at.toString(16)} is outside segment data`);
    bytes.set(replacement, at);
  }

  bytes[info.checksumOffset] = computeChecksum(bytes, info.segments);
  if (info.hashOffset !== null) {
    bytes.set(await sha256(bytes.subarray(0, info.hashOffset)), info.hashOffset);
  }
  return { image: bytes, replaced: hits.length };
}
