// api.js
// Thin client for the SillyTavern-Character-Tools server plugin
// (/api/plugins/character-tools/*). All on-disk work happens server-side; this
// module just posts requests and reads the Server-Sent Events progress stream.

const { getRequestHeaders } = SillyTavern.getContext();

export const PLUGIN_BASE = '/api/plugins/character-tools';

/** Liveness check — true if the server plugin is installed and running. */
export async function probePlugin() {
    try {
        const res = await fetch(`${PLUGIN_BASE}/probe`, {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        return res.ok;
    } catch {
        return false;
    }
}

/** List users (data/ subfolders that contain a settings.json). */
export async function fetchUsers() {
    try {
        const res = await fetch(`${PLUGIN_BASE}/users`, { headers: getRequestHeaders() });
        if (!res.ok) return [];
        const data = await res.json();
        return data.users ?? [];
    } catch {
        return [];
    }
}

/** File counts and byte totals for a user's images/ and characters/ dirs. */
export async function fetchStats(user) {
    const res = await fetch(`${PLUGIN_BASE}/stats`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ user }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
    }
    return res.json();
}

/**
 * Observed character tags for a user, surveyed server-side from
 * data/<user>/characters/ (root PNGs only). Returns `{ avatar, tags }[]` — the
 * shape the dictionary editor's buildBuckets consumes. Unlike SillyTavern's
 * in-browser character list (always the logged-in user), this respects the
 * user picked in the panel.
 */
export async function fetchCharacterTags(user) {
    const res = await fetch(`${PLUGIN_BASE}/character-tags`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ user }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
    }
    const data = await res.json();
    return data.characters ?? [];
}

/**
 * POST a job and consume its SSE stream. Calls `onProgress(event)` for each
 * progress event and resolves with the final CompressionResult (or null if the
 * stream ended without one). Throws on a non-OK response.
 *
 * @param {string} path      endpoint under PLUGIN_BASE, e.g. '/fix-characters'
 * @param {object} body      JSON request body (must include `user`)
 * @param {(e:{current:number,total:number,percent:number})=>void} [onProgress]
 * @returns {Promise<object|null>}
 */
export async function runJob(path, body, onProgress) {
    const res = await fetch(`${PLUGIN_BASE}${path}`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let event;
            try {
                event = JSON.parse(line.slice(6));
            } catch {
                continue; // malformed SSE line, skip
            }
            if (event.type === 'progress') onProgress?.(event);
            else if (event.type === 'complete') result = event.result;
        }
    }

    return result;
}
