// Plain-language text for the inference service's stable error codes
// (backend/app/main.py, limits.py, audio.py). Pure, no imports, so it can be
// tested with `node --test`. Unknown codes fall back to the service's own
// message, which is already written for people.

export type FriendlyError = { title: string; message: string; retryable: boolean };

const MESSAGES: Record<string, FriendlyError> = {
  unreachable: {
    title: "Analysis service unavailable",
    message: "Sonovate could not reach the analysis service. Your recording is saved; try again in a moment.",
    retryable: true,
  },
  not_configured: {
    title: "Analysis service not configured",
    message: "This installation has no analysis service set up. Your recording is saved.",
    retryable: false,
  },
  rate_limited: {
    title: "Too many analyses in a short time",
    message: "Please wait a little before running another analysis. Your recording is saved.",
    retryable: true,
  },
  analysis_in_progress: {
    title: "An analysis is already running",
    message: "Wait for the current analysis to finish, then try again.",
    retryable: true,
  },
  model_busy: {
    title: "The analysis service is busy",
    message: "Other analyses are running right now. Your recording is saved; try again in a moment.",
    retryable: true,
  },
  upstream_unavailable: {
    title: "Storage or result could not be reached",
    message: "Something went wrong while reading the recording or saving the result. Try again in a moment.",
    retryable: true,
  },
  unauthenticated: {
    title: "You are signed out",
    message: "Your session has ended. Sign in again, then retry the analysis.",
    retryable: false,
  },
  recording_not_found: {
    title: "Recording not found",
    message: "The recording could not be found. It may have been deleted.",
    retryable: false,
  },
  recording_too_large: {
    title: "Recording too large",
    message: "The recording is larger than 2 MiB. Upload a recording of 60 seconds or less.",
    retryable: false,
  },
  same_as_baseline: {
    title: "Identical to a baseline",
    message: "This recording is identical to one of the machine's baseline recordings, so it cannot be compared.",
    retryable: false,
  },
  baseline_invalid: {
    title: "A baseline recording is not usable",
    message: "One of the machine's baseline recordings could not be used. Check its baseline recordings.",
    retryable: false,
  },
};

const INVALID_AUDIO = new Set([
  "not_wav",
  "malformed_wav",
  "unsupported_encoding",
  "wrong_sample_rate",
  "wrong_channel_count",
  "wrong_duration",
]);

export function friendlyAnalysisError(code: string, serviceMessage: string): FriendlyError {
  const known = MESSAGES[code];
  if (known) {
    // Baseline problems name the recording; keep that detail.
    return code === "baseline_invalid" && serviceMessage ? { ...known, message: serviceMessage } : known;
  }
  if (INVALID_AUDIO.has(code)) {
    return {
      title: "The recording could not be read",
      message: `${serviceMessage || "The audio does not meet the input format."} Upload it again from the machine page.`,
      retryable: false,
    };
  }
  return {
    title: "Analysis did not complete",
    message: serviceMessage || "Something unexpected happened. Try again in a moment.",
    retryable: true,
  };
}
