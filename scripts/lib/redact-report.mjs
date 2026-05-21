export function redactReportValue(value) {
  if (typeof value === "string") {
    return value
      .replace(/\b(Bearer|Bot)\s+[A-Za-z0-9._~+/=-]{20,}/g, "$1 [redacted]")
      .replace(
        /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|CLIENT_SECRET|STREAM_KEY)[A-Z0-9_]*)=([^&\s]+)/gi,
        "$1=[redacted]",
      )
      .replace(
        /(token|secret|authorization|password|api[_-]?key|stream_key)=([^&\s]+)/gi,
        "$1=[redacted]",
      );
  }

  if (Array.isArray(value)) {
    return value.map(redactReportValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|authorization|password|api[_-]?key|stream_key/i.test(key)
          ? "[redacted]"
          : redactReportValue(item),
      ]),
    );
  }

  return value;
}
