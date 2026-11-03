"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "./kit";
type Modules = {
  social: { enabled: boolean };
  email: { configured: boolean };
  payments: { configured: boolean; test_mode: boolean };
  studio: { bundled: boolean };
};
export default function OptionalModules() {
  const [data, setData] = useState<Modules | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    api<Modules>("/api/settings/modules", { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  return (
    <section className="border border-minimal-border rounded-xl p-5 space-y-3">
      <h2 className="text-lg font-medium">Optional connections</h2>
      <p>
        Your Home works without these extras. Ask Simon to set up the ones you
        need using your own accounts.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p>Checking connections…</p>
      ) : (
        <ul className="space-y-2">
          <li>
            Email delivery:{" "}
            {data.email.configured
              ? "key configured; verify sender and safe mode before sending"
              : "not configured"}
          </li>
          <li>
            Social calendar:{" "}
            {data.social.enabled ? (
              <Link className="underline" href="/social/accounts">
                enabled — manage connected accounts
              </Link>
            ) : (
              "off — ask Simon to activate it"
            )}
          </li>
          <li>
            Payment connection:{" "}
            {data.payments.configured
              ? data.payments.test_mode
                ? "test keys configured"
                : "live keys configured"
              : "not configured"}
            . Key presence does not verify a working checkout or webhook.
          </li>
          <li>
            Content Studio: a separate optional upgrade. It is not included in
            the starter.
          </li>
        </ul>
      )}
    </section>
  );
}
