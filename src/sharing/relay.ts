/**
 * Relay client — uploads envelopes to a share relay (backpack-app or self-hosted).
 *
 * The relay stores opaque ciphertext and returns a share token.
 * The decryption key never leaves the client.
 */

export interface ShareResult {
  token: string;
  url: string;
  expiresAt?: string;
  /** Full share link with fragment key (for encrypted shares). */
  shareLink: string;
}

export interface RelayConfig {
  /** Relay base URL (e.g., https://app.backpackontology.com) */
  url: string;
  /** Bearer token for authentication (sender must have an account). */
  token: string | (() => Promise<string>);
}

/**
 * Sync a BPAK envelope to the relay. The relay stores the latest version.
 */
export async function syncToRelay(
  config: RelayConfig,
  name: string,
  envelope: Uint8Array,
): Promise<void> {
  const accessToken =
    typeof config.token === "function"
      ? await config.token()
      : config.token;

  const res = await fetch(`${config.url}/api/graphs/${encodeURIComponent(name)}/sync`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      Authorization: `Bearer ${accessToken}`,
    },
    body: envelope as unknown as BodyInit,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Relay sync failed (${res.status}): ${body}`);
  }
}

/**
 * Create a share link for a synced graph. Returns the share URL and token.
 */
export async function createShareLink(
  config: RelayConfig,
  name: string,
): Promise<{ token: string; url: string; expiresAt?: string }> {
  const accessToken =
    typeof config.token === "function"
      ? await config.token()
      : config.token;

  const res = await fetch(`${config.url}/api/graphs/${encodeURIComponent(name)}/share`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Relay share failed (${res.status}): ${body}`);
  }

  return (await res.json()) as {
    token: string;
    url: string;
    expiresAt?: string;
  };
}

/**
 * @deprecated Use syncToRelay() + createShareLink() instead.
 * Upload an envelope to the relay. Returns the share token and URL.
 * For encrypted envelopes, the caller appends #k={key} to the URL.
 */
export async function uploadToRelay(
  config: RelayConfig,
  envelope: Uint8Array,
  passphrase?: string,
): Promise<{ token: string; url: string; expiresAt?: string }> {
  const accessToken =
    typeof config.token === "function"
      ? await config.token()
      : config.token;

  const uploadUrl = `${config.url}/v1/share`;

  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    Authorization: `Bearer ${accessToken}`,
  };
  if (passphrase) {
    headers["X-Passphrase"] = passphrase;
  }

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers,
    body: envelope as unknown as BodyInit,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Relay upload failed (${res.status}): ${body}`);
  }

  return (await res.json()) as {
    token: string;
    url: string;
    expiresAt?: string;
  };
}

/**
 * Download an envelope from the relay by token.
 * For encrypted shares, the ciphertext is opaque — decryption is client-side.
 */
export async function downloadFromRelay(
  relayUrl: string,
  token: string,
  passphrase?: string,
): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  if (passphrase) {
    headers["X-Passphrase"] = passphrase;
  }

  const res = await fetch(`${relayUrl}/v1/share/${token}`, { headers });

  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.passphrase_required) {
      throw new Error("Passphrase required");
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Relay download failed (${res.status}): ${body}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Get metadata about a share link (non-sensitive, no auth required).
 */
export async function getShareMeta(
  relayUrl: string,
  token: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${relayUrl}/v1/share/${token}/meta`);
  if (!res.ok) {
    throw new Error(`Relay meta failed (${res.status})`);
  }
  return (await res.json()) as Record<string, unknown>;
}
