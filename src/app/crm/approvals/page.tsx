"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  api,
  PageHeader,
  PrimaryBtn,
  GhostBtn,
  Loading,
} from "@/components/crm/kit";
import type { Tables } from "@/types/database";
function Details({ action }: { action: Tables<"agent_actions"> }) {
  const p = (
    action.payload &&
    typeof action.payload === "object" &&
    !Array.isArray(action.payload)
      ? action.payload
      : {}
  ) as Record<string, unknown>;
  const labels: Record<string, string> = {
    proposed_by: "Proposed by",
    reason: "Reason",
    opportunity_name: "Deal",
    from_stage: "Current stage",
    to_stage: "Proposed stage",
    close_as: "Close as",
    lost_reason: "Loss reason",
    title: "Title",
    target_keyword: "Search phrase",
    keyword_cluster: "Topic group",
    pillar_topic: "Content pillar",
    priority: "Priority",
    notes: "Writing notes",
    caption: "Caption",
    platforms: "Platforms",
    media_urls: "Images",
    email: "Recipient",
    subject: "Subject",
    body_md: "Message",
  };
  const result =
    action.result &&
    typeof action.result === "object" &&
    !Array.isArray(action.result)
      ? (action.result as Record<string, unknown>)
      : {};
  return (
    <>
      <dl className="space-y-3">
        {Object.entries(labels).flatMap(([key, label]) => {
          const value = p[key];
          if (
            value === null ||
            value === undefined ||
            value === "" ||
            (Array.isArray(value) && !value.length)
          )
            return [];
          return (
            <div key={key}>
              <dt className="text-xs text-minimal-muted">{label}</dt>
              <dd className="whitespace-pre-wrap break-words">
                {Array.isArray(value) ? value.join("\n") : String(value)}
              </dd>
            </div>
          );
        })}
      </dl>
      {typeof result.error === "string" && (
        <p role="alert" className="text-red-500">
          {result.error}
        </p>
      )}
    </>
  );
}
export default function Approvals() {
  const requestId = useRef(0);
  const [items, setItems] = useState<Tables<"agent_actions">[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [loading, setLoading] = useState(true),
    [status, setStatus] = useState("proposed");
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const r = await api<{ actions: Tables<"agent_actions">[] }>(
        "/api/agent/actions?status=" + status,
      );
      if (id !== requestId.current) return;
      setItems(r.actions);
      setError("");
    } catch (e) {
      if (id === requestId.current)
        setError(e instanceof Error ? e.message : "Could not load approvals");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [status]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch current selection and clear stale results
    void load();
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- this is a request generation counter, not a DOM ref
      requestId.current++;
    };
  }, [load]);
  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    setError("");
    try {
      await api("/api/agent/actions/" + id, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Decision failed";
      await load();
      setError(message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="p-6 w-full h-full overflow-y-auto max-w-4xl mx-auto space-y-6">
      <PageHeader title="Approvals" />
      <p className="text-minimal-muted">
        Review your team’s proposed actions. Approving runs the action described
        below. Deal changes can run your active CRM workflows. Social posts stay
        drafts; articles are added to the calendar.
      </p>
      <label>
        Show{" "}
        <select
          className="max-w-full bg-minimal-card border border-minimal-border p-2 rounded"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {[
            "proposed",
            "executed",
            "rejected",
            "failed",
            "approved",
            "all",
          ].map((s) => (
            <option key={s} value={s}>
              {s === "approved" ? "In progress / needs review" : s}
            </option>
          ))}
        </select>
      </label>
      <GhostBtn onClick={() => void load()}>Refresh</GhostBtn>
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <p>No {status === "all" ? "" : status} actions.</p>
      ) : (
        items.map((a) => (
          <article
            key={a.id}
            className="p-5 border border-minimal-border rounded-xl space-y-3"
          >
            <h2 className="text-lg font-medium">{a.title}</h2>
            <p>{a.summary}</p>
            <p className="text-sm text-minimal-muted">
              {a.status} · {new Date(a.created_at).toLocaleString()}
            </p>
            <Details action={a} />
            {a.status === "proposed" && (
              <div className="flex flex-wrap gap-3">
                <PrimaryBtn
                  disabled={!!busy}
                  onClick={() => void decide(a.id, "approve")}
                >
                  {busy === a.id ? "Working…" : "Approve and run"}
                </PrimaryBtn>
                <GhostBtn
                  disabled={!!busy}
                  onClick={() => void decide(a.id, "reject")}
                >
                  Reject
                </GhostBtn>
              </div>
            )}
            {a.status === "approved" && (
              <p>
                Execution has started. If this status persists, check the
                action’s destination before submitting another proposal.
              </p>
            )}
          </article>
        ))
      )}
    </div>
  );
}
