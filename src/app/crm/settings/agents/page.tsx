"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, PageHeader, PrimaryBtn, GhostBtn } from "@/components/crm/kit";
import { SCOPES } from "@/lib/api/scope-vocabulary";
type Key = {
  id: string;
  name: string;
  scopes: string[];
  key_prefix: string;
  revoked_at: string | null;
};
export default function AgentSettings() {
  const [keys, setKeys] = useState<Key[]>([]),
    [name, setName] = useState(""),
    [scopes, setScopes] = useState<string[]>(["settings:read"]),
    [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api<{ keys: Key[] }>("/api/settings/agent-keys");
      setKeys(r.keys);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load keys");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial owner key inventory
    void load();
  }, [load]);
  async function mint() {
    setBusy(true);
    setError("");
    setSecret("");
    try {
      const r = await api<{ key: { plaintext: string } }>(
        "/api/settings/agent-keys",
        { method: "POST", body: JSON.stringify({ name, scopes }) },
      );
      setSecret(r.key.plaintext);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create key");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      await api("/api/settings/agent-keys?id=" + encodeURIComponent(id), {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke key");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="p-6 w-full h-full overflow-y-auto max-w-4xl mx-auto space-y-6">
      <Link href="/crm/settings">← Setup</Link>
      <PageHeader title="Agent access" />
      <p>
        Give each agent its own key and only the access it needs. Your existing
        employees and their training stay in place.
      </p>
      <p>
        For an MCP connection, use your Home address followed by{" "}
        <code>/api/mcp</code>, with the key as its bearer token. Keep keys in
        your client’s secure connection settings.
      </p>
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void mint();
        }}
      >
        <label className="block">
          Agent name
          <input
            required
            pattern="[a-z][a-z0-9_-]{1,39}"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="block p-2 bg-minimal-card border border-minimal-border rounded"
            placeholder="simon"
            autoComplete="off"
          />
        </label>
        <fieldset className="grid sm:grid-cols-2 gap-2">
          <legend className="mb-2">Access</legend>
          {SCOPES.map((s) => (
            <label key={s} className="flex gap-2">
              <input
                type="checkbox"
                checked={scopes.includes(s)}
                onChange={(e) =>
                  setScopes(
                    e.target.checked
                      ? [...scopes, s]
                      : scopes.filter((v) => v !== s),
                  )
                }
              />
              {s}
            </label>
          ))}
        </fieldset>
        <PrimaryBtn type="submit" disabled={busy || !scopes.length}>
          Create key
        </PrimaryBtn>
      </form>
      {secret && (
        <section className="p-4 border border-minimal-border rounded space-y-3">
          <p>
            Save this key now. It is shown only once. Do not paste it into a
            chat.
          </p>
          <input
            aria-label="New agent key"
            readOnly
            type="password"
            value={secret}
            className="w-full p-2 bg-minimal-card"
            autoComplete="off"
          />
          <GhostBtn
            onClick={() => {
              void navigator.clipboard
                .writeText(secret)
                .catch(() =>
                  setError(
                    "Could not copy. Select the key field and copy it manually.",
                  ),
                );
            }}
          >
            Copy key
          </GhostBtn>
          <GhostBtn onClick={() => setSecret("")}>I have saved it</GhostBtn>
        </section>
      )}
      <h2 className="text-xl">Existing keys</h2>
      {keys.map((k) => (
        <div key={k.id} className="border border-minimal-border rounded p-4">
          <strong>{k.name}</strong>
          <p className="text-sm">{k.scopes.join(", ")}</p>
          <p>{k.revoked_at ? "Revoked" : k.key_prefix + "…"}</p>
          {!k.revoked_at && (
            <GhostBtn disabled={busy} onClick={() => void revoke(k.id)}>
              Revoke access
            </GhostBtn>
          )}
        </div>
      ))}
    </div>
  );
}
