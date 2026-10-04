# muse-web

Browser installer for the [Muse Gadget SDK](https://github.com/facebookincubator/muse-gadget-sdk/tree/main/esp32) ESP32 firmware. Pick a board, paste your SDK token, and flash from Chrome or Edge. No ESP-IDF, no toolchain, and it works on Windows too.

The Muse counterpart of [zclaw-web](https://github.com/shreyaskarnik/zclaw-web). Community project, not affiliated with Meta.

## The token problem, and how this gets around it

The SDK compiles your SDK token into the firmware (`CONFIG_GADGET_SDK_TOKEN`), so a shared prebuilt binary can't include it. Wi-Fi isn't a problem: the Muse app sets that up over BLE after flashing.

So CI builds every board with a **placeholder** token, and the page swaps in your real token **in your browser** before flashing:

1. The SDK only accepts tokens that are exactly 48 characters (`mgst_` + 43 base64url, see its `cmake/validate_config.cmake`). The placeholder `mgst_MUSEWEBPLACEHOLDER000…0A` follows the same rule, so the swap is byte-for-byte and nothing else in the image moves.
2. [`js/esp-image.js`](js/esp-image.js) parses the ESP app image, checks its checksum and SHA-256, replaces the placeholder, and recomputes both so the bootloader accepts the result.
3. The page passes ESP Web Tools a `blob:` manifest. Its app part is the patched image and the other parts are the hosted files.

Your token never leaves the page. The Content-Security-Policy limits network access to this origin and `blob:`, and the token isn't stored (only your board choice is).

### Signed apps

SDK builds sign the app (`CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT`) with the dev key in the repo. Patching makes the signature block stale. That's fine because these builds check signatures only on **OTA updates** (`SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT`), not at boot. The patched app still has the same public key, so it keeps accepting signed OTAs. CI fails the build if a board ever turns on boot-time checking (`CONFIG_SECURE_SIGNED_ON_BOOT`).

## How it's built

[`.github/workflows/build-firmware.yml`](.github/workflows/build-firmware.yml), run on demand, nightly, and on pushes:

- Reads the board matrix from the SDK's own `.github/workflows/esp32.yml` ([`scripts/upstream_matrix.py`](scripts/upstream_matrix.py)), so new upstream boards show up automatically.
- Builds each one in `espressif/idf:v6.0.1` with the placeholder overlay.
- Packages the files `idf.py flash` would write, using `build/flasher_args.json` ([`scripts/package_board.py`](scripts/package_board.py)), so offsets are always right: C5 bootloader at `0x2000`, ESP32 at `0x1000`, partition table at `0x10000`, app at `0x20000`.
- Runs the patcher against every real build (`npm test`), then deploys to GitHub Pages.

To set it up: push this repo to GitHub, set **Settings → Pages → Source** to "GitHub Actions", and run the workflow.

## Develop locally

```sh
npm test                          # patcher unit tests
FIRMWARE_DIR=firmware npm test    # also patch every real build in firmware/
npm run serve                     # http://localhost:8000 (Web Serial works on localhost)
```

To fill `firmware/` locally, run the build step from the workflow in `espressif/idf:v6.0.1`. On macOS, copy the SDK into the container instead of building on a bind mount, because `ar` fails on the shared filesystem.

ESP Web Tools 10.4.0 is vendored in `js/vendor/esp-web-tools/` (Apache-2.0) so the page loads no third-party scripts.

## Status

- Patched images pass ESP-IDF's own image checks for real builds (see tests).
- Port picker, connect and Logs & Console checked on a real ESP32 (CP2102 bridge).
- Installs always erase the board. Leftover data from other firmware (ESPHome etc.) sits where the SDK keeps its NVS, and the SDK won't wipe it on its own.
- **Original ESP32 boards need chip revision v3.0+ and 8 MB+ flash.** Plenty of cheap ESP32 DevKits are v1 with 4 MB. They flash fine but the bootloader refuses to start the app (`chip revision check failed`). Check with `esptool flash-id`.
- **Full flash + pairing not yet confirmed on supported hardware.** If you try it, please open an issue saying which board and whether it reached the orange "ready for setup" light.
