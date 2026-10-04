// Run: npm test
// With real CI output too: FIRMWARE_DIR=firmware npm test

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PLACEHOLDER_TOKEN, TOKEN_RE, parseImage, patchToken, verifyImage } from "../js/esp-image.js";

// A made-up token in the right shape: mgst_ + 43 base64url chars of 32 bytes.
const TOKEN = "mgst_" + Buffer.alloc(32, 7).toString("base64url");

// Build a minimal app image the way esptool's elf2image does.
function makeImage(segmentPayloads, { hashAppended = true } = {}) {
  const chunks = [];
  const header = Buffer.alloc(24);
  header[0] = 0xe9;
  header[1] = segmentPayloads.length;
  header[23] = hashAppended ? 1 : 0;
  chunks.push(header);
  let checksum = 0xef;
  for (const data of segmentPayloads) {
    const seg = Buffer.alloc(8);
    seg.writeUInt32LE(0x3c000000, 0);
    seg.writeUInt32LE(data.length, 4);
    chunks.push(seg, data);
    for (const b of data) checksum ^= b;
  }
  let body = Buffer.concat(chunks);
  body = Buffer.concat([body, Buffer.alloc(15 - (body.length % 16)), Buffer.from([checksum])]);
  if (hashAppended) body = Buffer.concat([body, createHash("sha256").update(body).digest()]);
  return new Uint8Array(body);
}

test("placeholder obeys the SDK's own token rule", () => {
  assert.equal(PLACEHOLDER_TOKEN.length, 48);
  assert.match(PLACEHOLDER_TOKEN, TOKEN_RE);
  assert.match(TOKEN, TOKEN_RE);
});

test("CI workflow builds with the same placeholder", () => {
  const workflow = readFileSync(new URL("../.github/workflows/build-firmware.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes(`PLACEHOLDER_TOKEN: ${PLACEHOLDER_TOKEN}\n`));
});

test("patches a synthetic image and keeps it valid", async () => {
  const rodata = Buffer.concat([Buffer.from("before\0"), Buffer.from(PLACEHOLDER_TOKEN + "\0"), Buffer.from("after")]);
  const image = makeImage([Buffer.from("code segment"), rodata, Buffer.from("x")]);
  await verifyImage(image);

  const { image: patched, replaced } = await patchToken(image, TOKEN);
  assert.equal(replaced, 1);
  await verifyImage(patched);
  assert.ok(Buffer.from(patched).includes(TOKEN));
  assert.ok(!Buffer.from(patched).includes(PLACEHOLDER_TOKEN));
  assert.ok(Buffer.from(image).includes(PLACEHOLDER_TOKEN), "input must not be mutated");
});

test("works without an appended hash", async () => {
  const image = makeImage([Buffer.from(PLACEHOLDER_TOKEN)], { hashAppended: false });
  const { image: patched } = await patchToken(image, TOKEN);
  await verifyImage(patched);
});

test("rejects bad tokens and images without a placeholder", async () => {
  const image = makeImage([Buffer.from(PLACEHOLDER_TOKEN)]);
  await assert.rejects(patchToken(image, "mgst_short"), /doesn't look like an SDK token/);
  await assert.rejects(patchToken(image, TOKEN.slice(0, -1) + "B"), /doesn't look like/);
  await assert.rejects(patchToken(makeImage([Buffer.from("nothing here")]), TOKEN), /no token placeholder/);
});

test("rejects a corrupted image instead of 'fixing' it", async () => {
  const image = makeImage([Buffer.from(PLACEHOLDER_TOKEN)]);
  image[24 + 8 + 1] ^= 0xff; // a data byte in the first segment
  await assert.rejects(patchToken(image, TOKEN), /checksum mismatch/);
});

const firmwareDir = process.env.FIRMWARE_DIR;
if (firmwareDir && existsSync(firmwareDir)) {
  for (const board of readdirSync(firmwareDir)) {
    const manifestPath = join(firmwareDir, board, "board.json");
    if (!existsSync(manifestPath)) continue;
    test(`real build: ${board}`, async () => {
      const info = JSON.parse(readFileSync(manifestPath, "utf8"));
      const app = info.parts.find((p) => p.app);
      const image = new Uint8Array(readFileSync(join(firmwareDir, board, app.path)));
      const { image: patched, replaced } = await patchToken(image, TOKEN);
      assert.ok(replaced >= 1);
      const { checksumOffset, imageEnd } = await verifyImage(patched);

      // Only the token bytes and the checksum/hash trailer may change.
      const changed = [];
      for (let i = 0; i < image.length; i++) if (image[i] !== patched[i]) changed.push(i);
      const trailer = (i) => i >= checksumOffset && i < imageEnd;
      assert.ok(changed.filter((i) => !trailer(i)).length <= replaced * 48);
      assert.equal(parseImage(patched).segments.length, parseImage(image).segments.length);
    });
  }
}
