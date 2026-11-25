export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = Math.round(seconds % 60);
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

export function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en")} ${noun}${count === 1 ? "" : "s"}`;
}

// Shortens text longer than max characters by cutting out its middle, since a URL's start (the
// host) and its end (the last part of the path) say the most about it. The end starts at a "/"
// when it can: "https://billing.internal-tools.example.net/webhooks/acme" at 40 →
// "https://billing.internal-…/webhooks/acme".
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  let tail = text.slice(-Math.floor((max - 1) * 0.4));
  const slash = tail.indexOf("/");
  if (slash > 0) {
    tail = tail.slice(slash);
  }
  return `${text.slice(0, max - 1 - tail.length)}…${tail}`;
}
