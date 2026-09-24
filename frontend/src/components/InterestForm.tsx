// Email follow-up for purchase intent and creator demo requests (F05).
//
// The address goes only to the owner's form endpoint (VITE_INTEREST_ENDPOINT,
// set at build time), never to analytics. Without an endpoint there is nowhere
// honest to send it, so the form says sign-ups are not open yet instead.

import { useId, useState, type FormEvent } from "react";
import { track } from "../lib/analytics";

const ENDPOINT = import.meta.env.VITE_INTEREST_ENDPOINT?.trim() || "";

interface Props {
  /** e.g. "plans:fan-annual-49"; sent to analytics and the endpoint. */
  sourceSurface: string;
  kind: "email-interest" | "creator-demo";
  prompt: string;
}

type Status = "idle" | "sending" | "sent" | "failed";

export default function InterestForm({ sourceSurface, kind, prompt }: Props) {
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  if (!ENDPOINT) {
    return <p className="interest-form__note">Sign-ups aren't open yet. Your click has been counted, thank you.</p>;
  }

  if (status === "sent") {
    return (
      <p className="interest-form__note" role="status">
        Thanks. We'll email you when it opens, and for nothing else.
      </p>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, kind, source: sourceSurface }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("sent");
      track(
        kind === "creator-demo"
          ? { name: "creator_demo_requested", sourceSurface }
          : { name: "email_interest_submitted", sourceSurface },
      );
    } catch {
      setStatus("failed");
    }
  };

  return (
    <form className="interest-form" onSubmit={handleSubmit}>
      <label htmlFor={inputId}>{prompt}</label>
      <div className="interest-form__row">
        <input
          id={inputId}
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={status === "sending"}>
          {kind === "creator-demo" ? "Request a demo" : "Notify me"}
        </button>
      </div>
      {status === "failed" && (
        <p className="interest-form__error" role="alert">
          That didn't go through. Please try again.
        </p>
      )}
      <p className="interest-form__fine">Used only to contact you about this. Not shared, not sold.</p>
    </form>
  );
}
