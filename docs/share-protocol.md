# Backpack Share Protocol — v0.1 (Draft)

The Backpack Share Protocol defines how encrypted and unencrypted backpacks are packaged, uploaded, shared, and decrypted. Both the OSS tooling and backpack-app implement against this spec.

**Status:** Draft — not yet implemented. Versioned semantically. Breaking changes require a major version bump.

---

## 1. Overview

A **backpack** is a named container of learning graphs. The Share Protocol defines how to:

1. Package a backpack into a **shareable envelope** (encrypted or plaintext)
2. Upload the envelope to a **relay** (backpack-app or self-hosted)
3. Mint a **share link** that a recipient can open in any viewer
4. **Decrypt** (if encrypted) client-side in the browser using a key embedded in the URL fragment

The protocol is relay-agnostic: any server implementing the Relay API is interchangeable with backpack-app from the client's perspective.

---

## 2. Envelope Format

A shareable backpack is packaged into an envelope — a single binary blob with a header and payload.

### Structure

```
[magic: 4 bytes] [version: 1 byte] [header_len: 4 bytes (big-endian)] [header: JSON] [payload: bytes]
```

- **Magic:** `0x42 0x50 0x41 0x4B` (`BPAK`)
- **Version:** `0x01` for this spec
- **Header:** UTF-8 JSON, structure defined below
- **Payload:** Raw graph data (plaintext envelope) or ciphertext (encrypted envelope)

### Header Fields

```json
{
  "format": "plaintext" | "age-v1",
  "created_at": "2026-04-11T12:00:00Z",
  "backpack_name": "my-graph",
  "graph_count": 3,
  "checksum": "sha256:<hex>",
  "metadata": {}
}
```

| Field | Required | Description |
|---|---|---|
| `format` | yes | `"plaintext"` or an encryption algorithm identifier (e.g., `"age-v1"`) |
| `created_at` | yes | ISO 8601 timestamp |
| `backpack_name` | yes | Human-readable name of the backpack |
| `graph_count` | no | Number of graphs in the payload |
| `checksum` | yes | SHA-256 of the payload bytes (before encryption for plaintext, after encryption for encrypted) |
| `metadata` | no | Arbitrary key-value pairs for extensions |

For encrypted envelopes, the header is **not encrypted** — it contains only non-sensitive metadata. The payload is the ciphertext. The header must never contain graph content, node data, or anything that reveals what's inside.

---

## 3. Crypto Primitives

### Default: age v1

The default encryption primitive is [age](https://age-encryption.org/) (v1).

- **Key type:** X25519 (recipient-based) or scrypt (passphrase-based)
- **Envelope `format` value:** `"age-v1"`
- **Payload:** Standard age ciphertext (the output of `age -e`)
- **Key encoding in share links:** The X25519 private key or scrypt passphrase, base64url-encoded, placed in the URL fragment

### Pluggable Primitives

Alternative crypto primitives can be registered via the plugin interface. Each must:

1. Define a unique `format` string for the envelope header
2. Provide an `encrypt(plaintext: Uint8Array, key: Uint8Array): Uint8Array` function
3. Provide a `decrypt(ciphertext: Uint8Array, key: Uint8Array): Uint8Array` function
4. Provide a JS-compatible implementation for in-browser decrypt

The envelope `format` field is the negotiation mechanism — clients that don't recognize the format can report "unsupported encryption" to the user.

---

## 4. Share Link Format

```
{base_url}/share/{token}#k={key}
```

| Component | Description |
|---|---|
| `base_url` | Relay base URL (e.g., `https://app.backpackontology.com`) |
| `token` | Opaque server-generated identifier for the envelope |
| `#k={key}` | URL fragment containing the decryption key, base64url-encoded. **Browsers never transmit fragments to servers.** |

### Plaintext Links

For unencrypted backpacks, the fragment is omitted:

```
{base_url}/share/{token}
```

### Fragment Security

The `#k=` fragment is the sole carrier of the decryption key. It is:
- Never transmitted over HTTP (per URL spec, fragments stay client-side)
- Never logged by the relay server
- Never stored anywhere except the share link itself
- The relay is genuinely zero-knowledge for the content of encrypted envelopes

**Consequence:** Anyone who has the link has access. Link leakage = key leakage. This is an intentional tradeoff for zero-coordination sharing (same model as Mega, Bitwarden Send, Cryptpad). Mitigation options (paid tier): optional passphrase layer on top of the fragment key, link expiry, view-count limits, revocation.

---

## 5. Relay API

Any server implementing these endpoints is a valid relay. backpack-app is the default; self-hosted relays are interchangeable.

### Authentication

- **Upload, delete, list, metadata-update:** Require sender authentication (bearer token or session cookie)
- **Download:** No authentication required — access is controlled by knowledge of the token (and optionally the fragment key for encrypted envelopes)

### Endpoints

#### `POST /v1/share`

Upload an envelope. Returns a share link.

**Request:**
- `Content-Type: application/octet-stream`
- Body: envelope bytes (header + payload)
- Headers: `Authorization: Bearer {token}`
- Optional query params: `expires_at`, `passphrase` (hashed server-side, checked on download)

**Response:**
```json
{
  "token": "abc123def456",
  "url": "https://app.backpackontology.com/share/abc123def456",
  "expires_at": "2026-04-18T12:00:00Z"
}
```

The client appends `#k={key}` to produce the full share link. The server never sees the key.

#### `GET /v1/share/{token}`

Download an envelope.

**Request:**
- No auth required
- Optional header: `X-Passphrase: {passphrase}` (if the share has a passphrase)

**Response:**
- `Content-Type: application/octet-stream`
- Body: envelope bytes
- `404` if token is invalid, expired, or revoked

#### `DELETE /v1/share/{token}`

Revoke a share. Requires sender auth.

**Response:** `204 No Content`

#### `GET /v1/share/{token}/meta`

Non-sensitive metadata about the share (does NOT return envelope content).

**Response:**
```json
{
  "token": "abc123def456",
  "format": "age-v1",
  "backpack_name": "my-graph",
  "created_at": "2026-04-11T12:00:00Z",
  "expires_at": "2026-04-18T12:00:00Z",
  "view_count": 3,
  "revoked": false
}
```

#### `GET /v1/shares`

List the authenticated user's shares.

**Response:**
```json
{
  "shares": [
    {
      "token": "abc123def456",
      "backpack_name": "my-graph",
      "format": "age-v1",
      "created_at": "2026-04-11T12:00:00Z",
      "expires_at": "2026-04-18T12:00:00Z",
      "view_count": 3,
      "revoked": false
    }
  ]
}
```

---

## 6. Client Decrypt Flow

When a viewer loads a share link with a `#k=` fragment:

1. **Parse** the URL: extract `token` from the path and `key` from the fragment
2. **Fetch** the envelope: `GET /v1/share/{token}`
3. **Validate** the envelope: check magic bytes, version, parse header
4. **Read** the `format` field from the header
5. **Decrypt** the payload using the key and the appropriate crypto primitive
6. **Verify** the checksum (SHA-256 of ciphertext matches `header.checksum`)
7. **Parse** the decrypted payload as graph data
8. **Render** in the viewer

If decryption fails (wrong key, corrupted data), the viewer shows a clear error: "This backpack could not be decrypted. Check that the link is complete."

If the `format` is unrecognized, the viewer shows: "This backpack uses an unsupported encryption format."

---

## 7. Local File Mode

For fully offline sharing (no relay), the OSS CLI can output the envelope as a local file:

```
backpack share --out my-graph.bpak [--encrypt]
```

The recipient opens it in the local viewer or CLI:

```
backpack open my-graph.bpak --key {key}
```

Or imports it into their local backpack:

```
backpack import my-graph.bpak --key {key}
```

The `.bpak` extension is the conventional file extension for backpack envelopes.

---

## 8. Versioning

- The spec version is encoded in the envelope's version byte
- Current version: `0x01`
- Backward compatibility: clients MUST be able to read envelopes with version <= their supported version
- Forward compatibility: clients SHOULD reject envelopes with version > their supported version with a clear error
- The spec version and the `format` field are independent: a new crypto primitive doesn't require a new spec version (just a new `format` value), and a new spec version doesn't require new crypto primitives

---

## 9. Security Considerations

- **Key-in-URL-fragment** means link leakage = content leakage. Users should treat share links like passwords. Mitigation: expiry, view-count limits, passphrase layer (all paid-tier features).
- **The relay is a blob store, not a trusted party.** A compromised relay can withhold envelopes (denial of service) but cannot decrypt them.
- **Header metadata is not encrypted.** Do not put sensitive information in the header. The `backpack_name` field is visible to the relay. If even the name is sensitive, clients can set it to a generic value.
- **No forward secrecy.** If a key is compromised after sharing, all past recipients of that key can still decrypt. Mitigation: rotate by re-encrypting with a new key and re-sharing.
- **Passphrase layer** (optional, on top of fragment key): protects against link leakage by requiring an out-of-band secret. The passphrase hash is stored server-side; the passphrase itself is not.
