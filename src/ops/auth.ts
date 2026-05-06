export function getRelayUrl(): string {
    return process.env.BACKPACK_APP_URL || "https://app.backpackontology.com";
}

export function assertSafeRelay(url: string): void {
    let parsed: URL;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error(`invalid relay URL: ${url}`);
    }
    if (parsed.protocol === "https:")
        return;
    if (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1"))
        return;
    if (process.env.BACKPACK_INSECURE_RELAY === "1")
        return;
    throw new Error(`refusing to send credentials to ${url} (non-HTTPS). ` +
        `set BACKPACK_INSECURE_RELAY=1 to override (only do this for local dev).`);
}

export async function resolveCloudToken(): Promise<string | null> {
    const token = process.env.BACKPACK_TOKEN;
    return token && token.length > 0 ? token : null;
}
