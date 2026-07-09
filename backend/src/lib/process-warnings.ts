/**
 * process-warnings.ts
 *
 * kafkajs schedules an internal "check pending requests" timer with a negative
 * delay whenever it is not throttled and its request queue is empty: it computes
 * `throttledUntil - Date.now()` (with `throttledUntil` at 0) and passes the
 * result to `setTimeout` without clamping. Node clamps the delay to 1ms, so the
 * behavior is harmless, but it emits a one-time `TimeoutNegativeWarning` that
 * clutters startup logs (see kafkajs `src/network/requestQueue`).
 *
 * This installs a process `warning` filter that drops exactly that warning and
 * re-prints every other warning, so real warnings are never hidden.
 */
export class ProcessWarnings {
  /** Suppress kafkajs's benign TimeoutNegativeWarning; keep all other warnings. */
  public static silenceKafkaTimeoutWarning(): void {
    // Replace Node's default warning printer with one that filters this single
    // benign warning; everything else is printed in Node's usual one-line form.
    process.removeAllListeners("warning");
    process.on("warning", (warning: Error): void => {
      if (warning.name === "TimeoutNegativeWarning") {
        return;
      }
      console.warn(`${warning.name}: ${warning.message}`);
    });
  }
}
