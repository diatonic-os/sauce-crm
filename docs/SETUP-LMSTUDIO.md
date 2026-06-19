# SauceOM — Local AI Setup with LM Studio (and Ollama)

**SauceOM** (Sauce Operating Memory) v0.5.0 is local-first by design.
The AI copilot — **SauceBot** — makes zero network calls until you
explicitly configure a cloud provider. The default path is a local
[LM Studio](https://lmstudio.ai/) server running on your own machine,
so your vault data never leaves your computer.

> **Disclosure.** SauceBot makes outbound calls **only to the
> provider you configure.** With LM Studio or Ollama the traffic is
> loopback (localhost) — nothing leaves the machine. Cloud providers
> (Anthropic, OpenAI, NVIDIA NIM) are available but require you to
> supply an API key and are off by default. The optional paid
> **SauceDB** tier syncs Sauce Brain data to a hosted endpoint you
> configure; no other telemetry or phone-home traffic exists.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Install and start LM Studio](#2-install-and-start-lm-studio)
3. [Enable CORS for token streaming](#3-enable-cors-for-token-streaming)
4. [Download a chat model and an embedding model](#4-download-a-chat-model-and-an-embedding-model)
5. [Point SauceOM at LM Studio](#5-point-sauceom-at-lm-studio)
6. [Pick a model in the SauceBot chat panel](#6-pick-a-model-in-the-saucebot-chat-panel)
7. [Ollama (alternative local backend)](#7-ollama-alternative-local-backend)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. What you need

| Requirement | Notes |
|---|---|
| **SauceOM** plugin installed and enabled | See [INSTALL.md](../INSTALL.md) — plugin id `sauce-crm`, desktop-only |
| **Obsidian ≥ 1.5.0** | Desktop (Windows, macOS, Linux) |
| **LM Studio ≥ 0.3.x** | Free download — [lmstudio.ai](https://lmstudio.ai/) |
| A chat model | ~4–8 GB VRAM/RAM recommended (see step 4) |
| An embedding model (recommended) | Used by Sauce Brain's vector index |

LM Studio runs entirely on your hardware. No LM Studio account or
internet access is required after the initial model download.

---

## 2. Install and start LM Studio

1. Download LM Studio from [lmstudio.ai](https://lmstudio.ai/) for
   your OS and install it normally.
2. Open LM Studio and navigate to the **Local Server** tab
   (left sidebar, server icon).
3. Click **Start Server**. By default the server binds to
   `http://localhost:1234`. Leave this port as-is — SauceOM
   auto-detects it.
4. The status bar at the top of the server pane should read
   **Server running**.

---

## 3. Enable CORS for token streaming

> **Important.** This step unlocks true token-by-token streaming in
> SauceBot. Without it, SauceOM falls back to batch mode (waits for
> the full response before displaying it). Everything still works in
> batch mode, but the experience is less responsive.

In LM Studio:

1. Go to **Settings** (gear icon) → **Developer** (or **Server**,
   depending on your version).
2. Find the **CORS** or **Allow Cross-Origin Requests** toggle and
   turn it **on**.
3. Restart the local server (click **Stop Server**, then
   **Start Server**).

With CORS enabled, SauceBot streams tokens as they are generated,
displays a real-time reasoning trace if the model supports it, and
the send button doubles as a live **stop** button mid-stream.

---

## 4. Download a chat model and an embedding model

### Chat model

In the **Discover** tab (or **Model Library**), search for a model
that fits your hardware. Common starting points:

| Model family | Recommended size | Notes |
|---|---|---|
| Llama 3 / 3.1 / 3.2 | 8B Q4 | Good general-purpose, tool-capable |
| Mistral / Mixtral | 7B Q4 | Fast, good instruction following |
| Gemma 3 | 4B–12B Q4 | Efficient on Apple Silicon |
| Qwen 2.5 | 7B–14B Q4 | Strong for structured/CRM tasks |

Click **Download** on your chosen model. Once downloaded, click
**Load** (or it will load on the first chat request).

### Embedding model

Sauce Brain uses an embedding model to build its vector index of
your vault. In LM Studio:

1. Search for an embedding model — look for models tagged
   **embedding** or **text-embedding**. Popular options include
   `nomic-embed-text`, `mxbai-embed-large`, or any
   `all-minilm-*` variant.
2. Download and, if needed, load it.

You will select this embedding model in the SauceBot chat panel
(see step 6).

---

## 5. Point SauceOM at LM Studio

SauceOM auto-detects a running LM Studio server on the default port.
In most cases you do not need to configure the endpoint manually.

**Auto-detect (default):**

1. Open Obsidian → **Settings → SauceOM → Copilot**.
2. In the **Provider** dropdown, select **LM Studio**.
3. SauceOM pings `http://localhost:1234/v1` and populates the
   model list automatically. If detection succeeds, the model
   dropdown fills with your available models.

**Manual endpoint (if using a non-default port or remote host):**

1. In **Settings → SauceOM → Copilot**, set the **Endpoint**
   field to the full base URL, e.g. `http://localhost:1234/v1`.
2. Or go to **Settings → SauceOM → Local LLM providers → LM Studio**
   and set the endpoint there — changes apply to SauceBot immediately
   when LM Studio is your active provider.

---

## 6. Pick a model in the SauceBot chat panel

Open the SauceBot chat view from the ribbon (or command palette →
**Sauce: Open SauceBot**).

The **icon control panel** sits just below the branded header — four
icon buttons that each open a floating dropdown:

| Icon | What it controls |
|---|---|
| Provider icon | Switch between LM Studio, Ollama, Anthropic, OpenAI |
| Model icon | Pick a chat model from the live LM Studio catalog |
| Embeddings provider icon | Pick the embeddings source (LM Studio, Ollama, OpenAI) |
| Embedding model icon | Pick a specific embedding model |

**Reading the model list.** When you open the model dropdown with LM
Studio selected, each entry shows rich metadata pulled from the LM
Studio `/api/v0` catalog:

- **Context size** (e.g. `32k`) — how much text the model can hold
  in a single conversation.
- **Quantization** (e.g. `Q4_K_M`) — the compression level;
  lower = smaller/faster, higher = sharper.
- **●** — a filled dot means the model is currently loaded in LM
  Studio (first reply will be instant instead of waiting for a cold
  load).
- **tools** badge — the model supports tool-use (SauceBot can call
  CRM skills on your behalf).
- **vision** badge — the model can process images.

A **model-load indicator** in the chat header shows `loading…` while
a model warms up after you switch, then transitions to `ready` (or
`failed` if the server can't load it).

**Tip:** toggle the **?** button (top-left of the view header) at
any time — it turns purple and shows inline help text next to each
control.

---

## 7. Ollama (alternative local backend)

[Ollama](https://ollama.com/) is a second local-first provider.
The setup is nearly identical.

1. Install Ollama from [ollama.com](https://ollama.com/) and start
   it (`ollama serve`). Default port: `11434`.
2. Pull models: `ollama pull llama3` (chat) and
   `ollama pull nomic-embed-text` (embeddings).
3. In **Settings → SauceOM → Copilot**, set **Provider** to
   **Ollama**. The endpoint defaults to
   `http://localhost:11434` — change it if your Ollama server uses a
   different port.
4. In the SauceBot chat panel, click the provider icon and choose
   **Ollama**, then pick your model from the dropdown.

Ollama does not require a separate CORS step — its server accepts
requests from Obsidian's renderer by default.

---

## 8. Troubleshooting

### Model list is empty

- Confirm the LM Studio server is running (the server tab shows
  **Server running**).
- Check that at least one model is downloaded in LM Studio. The
  plugin can only list models that LM Studio has on disk.
- Verify the endpoint in Settings matches what LM Studio shows
  (`http://localhost:1234/v1` by default).
- Click the **Refresh** button in the provider dropdown or in
  Settings — the model catalog is cached for 30 seconds; Refresh
  busts it immediately.
- If you changed the default port in LM Studio, update the endpoint
  in **Settings → SauceOM → Local LLM providers → LM Studio**.

### Cold-load latency (slow first reply)

The first message after selecting a new model triggers LM Studio to
load that model into memory. This can take 10–60 seconds depending
on model size and your hardware. The SauceBot header shows
**loading…** during this time, switching to **ready** when the model
is warm. Subsequent messages in the same session reply immediately.
To avoid the wait, pre-load your model in LM Studio before opening
SauceBot (click the model in LM Studio's catalog and press **Load**).

### "Model loading" indicator stays on

If the indicator stays on **loading…** and does not transition to
**ready** within ~90 seconds:

1. Check the LM Studio server log for errors (server tab →
   **Logs**). Common causes: the model file is corrupt, VRAM is
   exhausted, or the model requires more RAM than available.
2. Try a smaller or more quantized variant of the model (e.g. Q4
   instead of Q8, or 7B instead of 13B).
3. Click the model icon in SauceBot and reselect the model to
   trigger a fresh load attempt.

### Responses appear all at once (not streamed)

Batch mode is active — streaming is falling back. Check that CORS is
enabled in LM Studio's developer/server settings (see
[step 3](#3-enable-cors-for-token-streaming)), then restart the LM
Studio server. SauceBot will switch to streaming automatically on the
next message.

### SauceBot cannot reach the local server

Obsidian uses Electron's native `fetch()` for streaming calls. If
you see a network error:

- Make sure LM Studio is running on the same machine as Obsidian
  (not inside a VM without a forwarded port).
- Temporarily disable any firewall rule that blocks loopback
  connections on port 1234.
- Check that no VPN or proxy is intercepting localhost traffic.

---

## Further reading

- [User Guide](./USER-GUIDE.md) — end-to-end workflows and SauceBot usage.
- [Features](./FEATURES.md) — full feature reference for all four sub-features.
- [INSTALL.md](../INSTALL.md) — install options (pre-built release,
  one-line installer, build from source).
- [SECURITY.md](./SECURITY.md) — key storage, audit log, and
  network disclosure details.
