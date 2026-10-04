
# Browser-based installer for the ESP32 firmware (no ESP-IDF needed)

## Summary

I built a community web installer for the ESP32 Device SDK: **https://shreyaskarnik.github.io/muse-web/**

Pick your board, paste your SDK token, and flash from Chrome or Edge. You don't need ESP-IDF 6.0.1, a toolchain or `menuconfig`, and it works on **Windows**, which the README doesn't currently support ("macOS or Linux"). After flashing, setup is the usual Muse app flow (orange light → Add Device → press BOOT).

Repo: https://github.com/shreyaskarnik/muse-web. It's the same approach as a web installer I made for zclaw ([tnm/zclaw#14](https://github.com/tnm/zclaw/issues/14)).

## How it works

- CI reads the board matrix from this repo's `.github/workflows/esp32.yml` and builds every board in `espressif/idf:v6.0.1`. New boards show up automatically.
- Parts and offsets come from each build's `flasher_args.json`.
- ESP Web Tools does the flashing (vendored, with a strict CSP so the page can't reach other origins).

### The SDK token

The token is compiled into the firmware (`CONFIG_GADGET_SDK_TOKEN`), so a shared binary can't include it. To get around this, the installer:

1. Builds with a 48-character placeholder that passes `validate_config.cmake`'s token rule.
2. In the browser, replaces it byte-for-byte with the user's token and recomputes the image checksum and SHA-256 appended to the image.

The token never leaves the page. This works because these builds check app signatures only on OTA (`SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT`), not at boot.

Verified so far:
- Patched images pass `esptool image-info` (checksum + validation hash valid) for the C5 devkit and ideaspark builds; CI patches every board on each deploy (16/16 currently).
- A patched ideaspark image boots in ESP-IDF QEMU and logs the substituted token (`link.app: SDK token: mgst_…`). The boot log is otherwise identical to the unpatched build.
- Installed on a real ESP32 from the page, then read back with `esptool read-flash`: the app on the device passes `image-info`, contains the user's token and no placeholder, and differs from the published build only in the token bytes and the checksum/hash trailer.
- **Not yet confirmed end-to-end (boot + Muse app pairing) on a supported board.** My test board is ESP32 rev v1.0, which the SDK's `REV_MIN_3` rejects at boot. Reports welcome.

## Proposal: make the token a runtime setting

Binary patching works, but it's a workaround and depends on implementation details (token length, no boot-time signature check). A cleaner upstream option:

- Read the SDK token from NVS first, falling back to `CONFIG_GADGET_SDK_TOKEN`. Existing builds are unchanged.
- Add a `muse_console` command to set or clear it.

Then one official prebuilt binary per board could be flashed from any web installer, which then sends the token over Web Serial. It would also make offering prebuilt release binaries straightforward.

Open questions for maintainers:
- Is storing the token in NVS acceptable on builds without NVS encryption (`config_store.c`)?
- Would you accept a PR along these lines, or would you rather have an official installer on gadgets.muse.ai?

Happy to send the PR if this direction works for you.
