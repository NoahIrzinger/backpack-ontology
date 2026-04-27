# Backpack Sync Protocol — v0.1 (Draft)

The Backpack Sync Protocol defines how a single user's backpack is mirrored across multiple devices using a relay (backpack-app or self-hosted). Both the OSS tooling and backpack-app implement against this spec.

**Status:** Draft — not yet implemented. Versioned semantically. Breaking changes require a major version bump.

**Scope of v0.1:** one user, multiple devices, sequential editing. Bidirectional last-write-wins replication of artifacts inside a backpack. Conflict handling is best-effort with a manual reconciliation escape hatch.

---

## 1. Goals

- The same backpack stays consistent across a user's laptop (filesystem-backed) and a relay (cloud database) so the user can work on either side and pick up where they left off.
- Knowledge accumulates inside artifacts over time. A graph enriched on device A is the starting point for further enrichment on device B.
- The user only has to think about sync at registration. After that, sync runs on natural triggers (MCP startup, save, viewer load) and the user can also force it manually.
- Local files remain the user's source of truth for the OSS path. Cloud is a mirror for cross-device access.

---

## 2. Non-Goals

- **Multi-user concurrent editing of the same artifact.** Forking at the user boundary is a future extension (see §10).
- **Encryption.** Sync v0.1 transports plaintext. Encrypted sync is a future extension layered on top of the same protocol.
- **Real-time / sub-second sync.** This is a poll-and-replicate protocol. Real-time is a future extension.
- **Branch-aware merge.** Branches inside a graph sync as part of the artifact's bytes; the protocol does not reason about branch semantics.
- **Cross-mount KB document migration.** Each KB mount is independently scoped (see §4.4).

---

## 3. Concepts

### 3.1 Backpack Identity

Every backpack has a stable **backpack ID** (UUID v4) generated at first sync registration and never changed. The ID is the join key between local and relay state.

The backpack's human-readable **name** is mutable metadata and is not the identifier. Two devices with the same backpack name pointed at different IDs are different backpacks.

### 3.2 Artifact

An **artifact** is a syncable unit inside a backpack. Three kinds exist in v0.1:

| Kind | Local representation | Notes |
|---|---|---|
| `graph` | One learning graph (snapshot + events) | Synced as one bundle keyed by graph name |
| `kb_doc` | One markdown document in a synced KB mount | Synced per file |
| `metadata` | Backpack-level config (name, color, tags) | Synced as one record |

Each artifact has:

- `artifact_id` — stable string within the backpack (`graph:<graph-name>` or `kb_doc:<doc-id>` or `metadata`)
- `version` — monotonic integer, incremented on every local save
- `content_hash` — SHA-256 of the artifact's serialized bytes
- `modified_at` — ISO 8601 timestamp of the last local save
- `last_synced_version` — the version both sides agreed on at the last successful sync (tracked client-side)

### 3.3 Manifest

A **manifest** is a list of `(artifact_id, version, content_hash, modified_at)` tuples for one backpack. Both the local client and the relay can produce a manifest. Diffing the two manifests is the entire sync algorithm.

### 3.4 Relay

The **relay** is the server side of sync. backpack-app is the default relay. Anyone can implement a self-hosted relay against this spec.

---

## 4. Data Model

### 4.1 Backpack metadata (local)

Stored alongside the backpack on disk in `backpack.json`:

```json
{
  "backpack_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "delgate",
  "color": "#7c3aed",
  "tags": ["client", "consulting"],
  "sync": {
    "relay_url": "https://app.backpackontology.com",
    "registered_at": "2026-04-27T10:00:00Z",
    "last_sync_at": "2026-04-27T15:30:00Z"
  }
}
```

### 4.2 Per-artifact sync state (local)

Stored in `<backpack>/.sync/state.json`:

```json
{
  "artifacts": {
    "graph:delgate-architecture": {
      "version": 12,
      "content_hash": "sha256:...",
      "last_synced_version": 12,
      "modified_at": "2026-04-27T15:25:00Z"
    },
    "kb_doc:billing-summary": {
      "version": 4,
      "content_hash": "sha256:...",
      "last_synced_version": 4,
      "modified_at": "2026-04-27T15:00:00Z"
    }
  }
}
```

### 4.3 Backpack record (relay)

The relay stores per backpack:

- `backpack_id`, `owner_user_id`, `name`, `color`, `tags`
- A row per artifact: `(backpack_id, artifact_id, version, content_hash, modified_at, content_blob)`

### 4.4 KB Mount Sync Policy

Each KB mount in a backpack has a `sync` boolean (default `true` for the writable default mount, `false` for external mounts like Obsidian vaults). Only documents in mounts with `sync: true` participate in sync.

The mount config itself is local-only metadata. It does not sync, because mount paths are device-specific.

---

## 5. Sync Algorithm

### 5.1 The Diff

For each `artifact_id` in `union(local_manifest, relay_manifest)`:

| Local present? | Relay present? | local.hash == relay.hash? | local.v vs relay.v vs last_synced.v | Action |
|---|---|---|---|---|
| yes | no | n/a | n/a | **Push:** PUT artifact to relay |
| no | yes | n/a | n/a | **Pull:** GET artifact, write locally |
| yes | yes | yes | n/a | **Skip:** already in sync |
| yes | yes | no | local.v > relay.v AND last_synced.v == relay.v | **Push:** local is ahead |
| yes | yes | no | relay.v > local.v AND last_synced.v == local.v | **Pull:** relay is ahead |
| yes | yes | no | both diverged from common ancestor | **Conflict:** see §8 |

### 5.2 Push

```
PUT /api/sync/backpacks/{backpack_id}/artifacts/{artifact_id}
body: { content, version, content_hash, modified_at }
expected: version > server.version AND content_hash != server.content_hash
on success: client sets last_synced_version = pushed version
on 409:     conflict (see §8)
```

### 5.3 Pull

```
GET /api/sync/backpacks/{backpack_id}/artifacts/{artifact_id}
returns: { content, version, content_hash, modified_at }
client writes content to local representation
client sets local.version = relay.version
client sets last_synced_version = relay.version
```

### 5.4 Deletion

A delete is a tombstone artifact: the relay keeps the row with `deleted_at` set and `content_blob: null`. Tombstones still appear in the manifest with `content_hash: null`. Sync algorithm treats a tombstone as "this artifact should not exist locally" and the client deletes the local file. Tombstones can be garbage-collected by the relay after a retention window (default 90 days).

### 5.5 Atomicity

Each artifact PUT/GET is independent. A sync run is *not* atomic across multiple artifacts. Partial sync states are valid intermediate states. The next sync run resumes correctly because the manifest reflects current truth on each side.

---

## 6. Relay API

All endpoints are scoped to an authenticated user. The relay rejects requests for backpacks the user does not own.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/sync/register` | Register a new backpack (idempotent on `backpack_id`) |
| `GET` | `/api/sync/backpacks/{backpack_id}/manifest` | Return the relay's manifest |
| `GET` | `/api/sync/backpacks/{backpack_id}/artifacts/{artifact_id}` | Fetch one artifact |
| `PUT` | `/api/sync/backpacks/{backpack_id}/artifacts/{artifact_id}` | Upload one artifact (with version check) |
| `DELETE` | `/api/sync/backpacks/{backpack_id}/artifacts/{artifact_id}` | Tombstone an artifact |
| `DELETE` | `/api/sync/backpacks/{backpack_id}` | Tombstone the entire backpack |

### 6.1 Register

```
POST /api/sync/register
body: { backpack_id, name, color, tags }
returns: 201 if newly registered, 200 if already known and matches caller, 403 otherwise
```

### 6.2 Manifest

```
GET /api/sync/backpacks/{backpack_id}/manifest
returns: {
  backpack_id, name, color, tags,
  artifacts: [
    { artifact_id, version, content_hash, modified_at }
  ]
}
```

### 6.3 PUT semantics (optimistic concurrency)

The PUT endpoint enforces `version > server.version`. If the client's version is not strictly greater, the server returns `409 Conflict` with the server's current version in the body so the client can detect divergence and trigger conflict handling.

### 6.4 Protocol version header

Every request and response includes `X-Backpack-Sync-Protocol: 1`. Clients refusing to handle a higher version respond with `426 Upgrade Required`.

---

## 7. Client Behavior

### 7.1 Triggers

The OSS client runs sync on these triggers:

| Trigger | Direction | Notes |
|---|---|---|
| `backpack-sync` CLI | Bidirectional | Manual force |
| MCP server startup | Pull then push | Catches phone work before laptop session |
| Graph save | Push (debounced 5s) | Coalesces rapid edits |
| KB doc save | Push (debounced 5s) | Same |
| Viewer load | Pull | So the viewer shows latest cloud state |

### 7.2 CLI Commands

```
backpack-sync register <name>     # one-time, mints UUID, calls POST /register
backpack-sync push <name>         # local → relay
backpack-sync pull <name>         # relay → local
backpack-sync <name>              # bidirectional
backpack-sync status <name>       # show diverging artifacts without changing anything
```

### 7.3 Auto-sync opt-out

A backpack with `sync.relay_url` unset is local-only. No background sync runs. The user must explicitly run `backpack-sync register` to opt in.

---

## 8. Conflict Handling

A conflict occurs when both sides modified the same artifact since the last successful sync (`local.last_synced_version == relay.previous_version` is false on at least one side, and the content hashes differ).

### 8.1 Detection

Detected by the PUT-409 path or by manifest diff before push.

### 8.2 Resolution policy (v0.1)

The relay's version wins for the synced state. The local version is preserved as a conflict file beside the original:

- `delgate/graphs/delgate-architecture.conflict-2026-04-27T15-30-12.json`
- `delgate/_documents/billing-summary.conflict-2026-04-27T15-30-12.md`

After writing the conflict file, the client pulls the relay's version into the canonical location and updates `last_synced_version` accordingly. The user reconciles the conflict file manually and saves the merged result, which then bumps the version and pushes normally.

### 8.3 Why this is OK for v0.1

The single-user-one-device-at-a-time scope means conflicts are rare in practice. When they occur, no data is lost (both versions are on disk). Manual reconciliation is acceptable for the expected frequency.

---

## 9. Cloud MCP Integration

The cloud MCP path (containerized npm `backpack-ontology` MCP running as a sidecar in the relay) is a separate component but uses the same artifact store. When cloud MCP writes to an artifact, it goes through the same relay endpoints internally and bumps the version as a normal write would. The next client sync sees the new version and pulls it down.

This means `backpack_add_node` invoked via cloud MCP and via local MCP both flow through the same conflict-resolution surface defined here. There is no special path for cloud-origin writes in v0.1.

(The cloud MCP container, its auth wiring, and the relay's internal proxy details belong in backpack-app and are intentionally out of scope for this OSS spec.)

---

## 10. Future Extensions

These extensions are deliberately deferred. The v0.1 protocol must not preclude them.

### 10.1 Multi-user (forking at the user boundary)

A backpack gets a `members` list. Each artifact gets an `author_user_id`. Each user owns their own artifacts within the shared backpack. A user's writes never overwrite another user's artifact.

Concretely: when user A and user B are members of the same backpack, they each push their own `graph:delgate-architecture-{user_id}` rather than competing for `graph:delgate-architecture`. The synthesis layer (out of protocol scope) reads across all users' artifacts and produces unified views.

This extension reuses every primitive in v0.1 unchanged. It only adds `author_user_id` and namespacing rules.

### 10.2 Encryption

A backpack with `sync.encrypted: true` uploads ciphertext as the artifact `content_blob` and sets `content_format: "age-v1"` in the manifest entry. The relay cannot read ciphertext content. Sync diff continues to work because the diff is over hashes and versions, not content.

The cloud viewer cannot render encrypted artifacts directly. The cloud MCP cannot operate on encrypted artifacts unless the user explicitly unlocks (graduated consent, see backpack-app docs).

### 10.3 Real-time push

The relay can support a WebSocket or SSE channel (`/api/sync/backpacks/{backpack_id}/stream`) that emits manifest changes as they happen. Clients subscribed to the channel pull immediately rather than polling on triggers.

### 10.4 Version history

The relay can retain prior versions of each artifact (instead of latest-only) to enable per-artifact history viewing in the cloud and time-travel restore. This is purely additive: clients still sync against the latest version.

### 10.5 Selective artifact sync

Per-artifact opt-out (`sync: false` on a specific graph or KB doc) so users can keep some artifacts purely local while syncing others.

---

## 11. Open Questions

- **Tombstone retention window.** 90 days is a guess. Does anyone hit it in practice?
- **Manifest size at scale.** A backpack with 1000 artifacts has a 1000-row manifest. Probably fine for v0.1 but worth measuring.
- **Schema evolution of artifact content.** When the graph format changes, how do older clients handle newer artifacts in the relay? Probably out-of-band schema versioning inside the artifact, not the sync protocol's problem.
- **Quota signaling.** How does the relay tell the client "you're out of storage"? Probably a 507 response, but the client behavior on 507 is unspecified.

---

## 12. Reference Implementations

- **Client (OSS):** `backpack-ontology` provides `SyncClient` and the `backpack-sync` CLI binary.
- **Server (managed):** backpack-app implements the relay endpoints under `/api/sync/*`.
- **Server (self-hosted):** any HTTP service that implements §6 and persists artifacts is conformant.
