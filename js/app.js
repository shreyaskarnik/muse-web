import { TOKEN_LENGTH, TOKEN_RE, patchToken } from "./esp-image.js";

const $ = (id) => document.getElementById(id);
const boardSelect = $("board");
const boardInfo = $("board-info");
const tokenInput = $("token");
const tokenStatus = $("token-status");
const installButton = $("install");
const installWaiting = $("install-waiting");

const LAST_BOARD_KEY = "muse-web:board"; // the token itself is never stored

let boards = [];
let blobUrls = [];
let generation = 0; // drops results from an older board/token combination

function setStatus(text, kind = "") {
  tokenStatus.textContent = text;
  tokenStatus.className = `status ${kind}`;
}

function setReady(manifestUrl) {
  installButton.hidden = !manifestUrl;
  installWaiting.hidden = Boolean(manifestUrl);
  if (manifestUrl) installButton.manifest = manifestUrl;
}

function revokeBlobs() {
  blobUrls.forEach(URL.revokeObjectURL);
  blobUrls = [];
}

function blobUrl(data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  blobUrls.push(url);
  return url;
}

function partUrl(board, part) {
  return new URL(`firmware/${board.board}/${part.path}`, location.href).href;
}

async function fetchBytes(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Couldn't download ${url} (${resp.status})`);
  return new Uint8Array(await resp.arrayBuffer());
}

// ESP Web Tools reads a manifest from a URL. We hand it a blob: manifest whose
// app part is the token-patched image and whose other parts are the hosted files.
function buildManifest(board, patchedAppUrl) {
  return {
    name: `Muse Gadget (${board.board})`,
    version: board.version,
    new_install_prompt_erase: true,
    // The firmware doesn't speak Improv; Wi-Fi is set up from the Muse app over BLE.
    new_install_improv_wait_time: 0,
    builds: [{
      chipFamily: board.chipFamily,
      parts: board.parts.map((part) => ({
        path: part.app ? patchedAppUrl : partUrl(board, part),
        offset: part.offset,
      })),
    }],
  };
}

async function update() {
  const thisGeneration = ++generation;
  revokeBlobs();
  setReady(null);

  const board = boards.find((b) => b.board === boardSelect.value);
  const token = tokenInput.value.trim();
  if (!board) return;

  if (!token) return setStatus("");
  if (token.length < TOKEN_LENGTH) return setStatus(`${token.length}/${TOKEN_LENGTH} characters`);
  if (!TOKEN_RE.test(token)) {
    return setStatus("That doesn't look like an SDK token. Copy it again from gadgets.muse.ai.", "error");
  }

  setStatus("Preparing firmware…");
  try {
    const appPart = board.parts.find((p) => p.app);
    const original = await fetchBytes(partUrl(board, appPart));
    const { image } = await patchToken(original, token);
    if (thisGeneration !== generation) return;

    const appUrl = blobUrl(image, "application/octet-stream");
    const manifest = buildManifest(board, appUrl);
    setReady(blobUrl(JSON.stringify(manifest), "application/json"));
    setStatus(`Firmware ${board.version} for ${board.chipFamily} is ready, with your token in it.`, "ok");
  } catch (err) {
    if (thisGeneration !== generation) return;
    setStatus(err.message, "error");
  }
}

function describeBoard() {
  const board = boards.find((b) => b.board === boardSelect.value);
  boardInfo.textContent = board
    ? `${board.chipFamily} · firmware ${board.version} · SDK ${board.sdkRef.slice(0, 7)}`
    : "";
}

async function loadBoards() {
  try {
    const resp = await fetch("firmware/boards.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error(resp.status);
    boards = (await resp.json()).boards;
  } catch {
    boardSelect.replaceChildren(new Option("No firmware published yet"));
    return;
  }

  // Group the options by chip so S3 boards don't drown out the rest.
  boardSelect.replaceChildren();
  const byChip = Map.groupBy(boards, (b) => b.chipFamily);
  for (const [chip, chipBoards] of [...byChip].sort(([a], [b]) => a.localeCompare(b))) {
    const group = document.createElement("optgroup");
    group.label = chip;
    for (const b of chipBoards) group.append(new Option(b.board, b.board));
    boardSelect.append(group);
  }

  let last = null;
  try { last = localStorage.getItem(LAST_BOARD_KEY); } catch {}
  if (last && boards.some((b) => b.board === last)) boardSelect.value = last;
  boardSelect.disabled = false;

  const sdkRef = boards[0]?.sdkRef;
  if (sdkRef) {
    const link = document.createElement("a");
    link.href = `https://github.com/facebookincubator/muse-gadget-sdk/commit/${encodeURIComponent(sdkRef)}`;
    link.append(Object.assign(document.createElement("code"), { textContent: sdkRef.slice(0, 7) }));
    $("sdk-ref").replaceChildren("at ", link);
  }
  describeBoard();
}

boardSelect.addEventListener("change", () => {
  try { localStorage.setItem(LAST_BOARD_KEY, boardSelect.value); } catch {}
  describeBoard();
  update();
});
tokenInput.addEventListener("input", update);
$("show-token").addEventListener("click", (e) => {
  const show = tokenInput.type === "password";
  tokenInput.type = show ? "text" : "password";
  e.currentTarget.textContent = show ? "Hide" : "Show";
  e.currentTarget.setAttribute("aria-pressed", String(show));
});

await loadBoards();
update();
