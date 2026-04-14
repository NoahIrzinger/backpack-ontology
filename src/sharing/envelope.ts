/**
 * BPAK envelope format — packages a backpack for sharing.
 *
 * Layout:
 *   [magic: 4B] [version: 1B] [header_len: 4B BE] [header: JSON] [payload: bytes]
 *
 * See docs/share-protocol.md for the full spec.
 */

const MAGIC = new Uint8Array([0x42, 0x50, 0x41, 0x4b]); // "BPAK"
const VERSION = 0x01;

export interface EnvelopeHeader {
  format: "plaintext" | "age-v1";
  created_at: string;
  backpack_name: string;
  kind?: "learning_graph" | "knowledge_base";
  graph_count?: number;
  document_count?: number;
  node_count?: number;
  edge_count?: number;
  node_types?: string[];
  checksum: string;
}

export interface Envelope {
  header: EnvelopeHeader;
  payload: Uint8Array;
}

/** SHA-256 hex digest of a Uint8Array. */
async function sha256hex(data: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Create a BPAK envelope from a header and payload. */
export async function createEnvelope(
  backpackName: string,
  payload: Uint8Array,
  format: "plaintext" | "age-v1",
  graphCount?: number,
  stats?: { node_count?: number; edge_count?: number; node_types?: string[]; document_count?: number; kind?: "learning_graph" | "knowledge_base" },
): Promise<Uint8Array> {
  const checksum = await sha256hex(payload);

  const header: EnvelopeHeader = {
    format,
    created_at: new Date().toISOString(),
    backpack_name: backpackName,
    kind: stats?.kind,
    graph_count: graphCount,
    document_count: stats?.document_count,
    node_count: stats?.node_count,
    edge_count: stats?.edge_count,
    node_types: stats?.node_types,
    checksum: `sha256:${checksum}`,
  };

  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const headerLen = new DataView(new ArrayBuffer(4));
  headerLen.setUint32(0, headerBytes.length, false); // big-endian

  const result = new Uint8Array(
    MAGIC.length + 1 + 4 + headerBytes.length + payload.length,
  );
  let offset = 0;
  result.set(MAGIC, offset);
  offset += MAGIC.length;
  result[offset] = VERSION;
  offset += 1;
  result.set(new Uint8Array(headerLen.buffer), offset);
  offset += 4;
  result.set(headerBytes, offset);
  offset += headerBytes.length;
  result.set(payload, offset);

  return result;
}

/** Parse and verify a BPAK envelope. Throws on invalid format or checksum mismatch. */
export async function parseEnvelope(data: Uint8Array): Promise<Envelope> {
  if (data.length < 9) {
    throw new Error("Envelope too small");
  }

  if (
    data[0] !== MAGIC[0] ||
    data[1] !== MAGIC[1] ||
    data[2] !== MAGIC[2] ||
    data[3] !== MAGIC[3]
  ) {
    throw new Error("Invalid envelope: bad magic bytes");
  }

  const version = data[4];
  if (version !== VERSION) {
    throw new Error(`Unsupported envelope version: ${version}`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLen = view.getUint32(5, false); // big-endian

  if (9 + headerLen > data.length) {
    throw new Error("Invalid envelope: header length exceeds data");
  }

  const headerBytes = data.slice(9, 9 + headerLen);
  const header: EnvelopeHeader = JSON.parse(
    new TextDecoder().decode(headerBytes),
  );

  if (!header.format) {
    throw new Error("Invalid envelope: missing format");
  }

  const payload = data.slice(9 + headerLen);

  // Verify checksum
  if (header.checksum) {
    const expected = header.checksum.replace(/^sha256:/, "");
    const actual = await sha256hex(payload);
    if (actual !== expected) {
      throw new Error(
        "Envelope checksum mismatch: data may be corrupted or tampered",
      );
    }
  }

  return { header, payload };
}
