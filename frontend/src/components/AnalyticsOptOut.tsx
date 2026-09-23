import { useState } from "react";
import { hasBrowserPrivacySignal, isAnalyticsOptedOut, setAnalyticsOptOut } from "../lib/analytics";

/** Lets a visitor turn off analytics events for this browser (F05). */
export default function AnalyticsOptOut() {
  const [optedOut, setOptedOut] = useState(isAnalyticsOptedOut);

  const toggle = () => {
    setAnalyticsOptOut(!optedOut);
    setOptedOut(isAnalyticsOptedOut());
  };

  if (hasBrowserPrivacySignal()) {
    return (
      <p className="analytics-opt-out" role="status">
        Your browser sends a privacy signal (Global Privacy Control or Do Not Track), so analytics events are off.
      </p>
    );
  }

  return (
    <p className="analytics-opt-out">
      <span role="status">
        {optedOut ? "Analytics events are off in this browser." : "Analytics events are on in this browser."}
      </span>{" "}
      <button type="button" className="btn btn--small" onClick={toggle} aria-pressed={optedOut}>
        {optedOut ? "Turn analytics back on" : "Turn off analytics"}
      </button>
    </p>
  );
}
