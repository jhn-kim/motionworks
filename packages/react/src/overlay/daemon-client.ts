import type {
  CommitRequest,
  JournalEntry,
  SelectRequest,
  StatusResponse,
} from "@motionworks/core";

export type StatusHandler = (status: StatusResponse | null) => void;
export type PendingHandler = (entries: JournalEntry[]) => void;

export const PENDING_POLL_MS = 1500;
export const STATUS_POLL_MS = 5000;
const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 10_000;

const FETCH_OPTIONS: RequestInit = {
  mode: "cors",
  credentials: "omit",
  cache: "no-store",
};

// HTTP client for the motionworks daemon (see docs/plans/bridge-rebuild.md).
// There is no push channel: the overlay polls `/pending` for journal entries
// (fast while the toolkit is active, at the status cadence otherwise) and
// `/status` for the launcher's health dot. Offline, the status poll backs
// off 1 → 10 s and the pending poll skips its fetch until the daemon is
// back. Live manipulation never touches the network — only select, commit
// and ack do.
export class DaemonClient {
  private running = false;
  private connected = false;
  private active = false;
  private failures = 0;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private statusInFlight = false;
  private pendingInFlight = false;
  private lastPendingJson: string | null = null;
  private statusHandlers = new Set<StatusHandler>();
  private pendingHandlers = new Set<PendingHandler>();

  constructor(
    private readonly baseUrl: string,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.pollStatus();
    void this.pollPending();
  }

  stop(): void {
    this.running = false;
    if (this.statusTimer !== null) clearTimeout(this.statusTimer);
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.statusTimer = null;
    this.pendingTimer = null;
    this.connected = false;
    this.failures = 0;
    this.lastPendingJson = null;
  }

  // Pending polls run every PENDING_POLL_MS while active (toolkit open) and
  // fall back to the status cadence otherwise.
  setActive(active: boolean): void {
    this.active = active;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  onPending(handler: PendingHandler): () => void {
    this.pendingHandlers.add(handler);
    return () => {
      this.pendingHandlers.delete(handler);
    };
  }

  // Poll both routes now (after a commit or ack) instead of waiting for the
  // next timer tick.
  async refresh(): Promise<void> {
    await this.pollStatus();
    await this.pollPending();
  }

  async select(req: SelectRequest): Promise<boolean> {
    return (await this.post("/select", req)) !== null;
  }

  async commit(req: CommitRequest): Promise<{ id: string } | null> {
    const entry = await this.post("/commit", req);
    if (entry === null || typeof (entry as { id?: unknown }).id !== "string")
      return null;
    await this.pollPending();
    return { id: (entry as { id: string }).id };
  }

  async ack(id: string): Promise<boolean> {
    const ok = (await this.post("/ack", { id })) !== null;
    if (ok) await this.pollPending();
    return ok;
  }

  // ── Polling ───────────────────────────────────────────────────────────

  private async pollStatus(): Promise<void> {
    if (this.statusInFlight) return;
    this.statusInFlight = true;
    if (this.statusTimer !== null) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    let status: StatusResponse | null = null;
    try {
      const res = await fetch(`${this.baseUrl}/status`, FETCH_OPTIONS);
      if (res.ok) status = (await res.json()) as StatusResponse;
    } catch (err) {
      this.log(`status poll failed: ${String(err)}`);
    }
    this.statusInFlight = false;
    this.setConnected(status !== null, status);
    let delay: number;
    if (status !== null) {
      this.failures = 0;
      delay = STATUS_POLL_MS;
    } else {
      delay = Math.min(BACKOFF_MAX_MS, BACKOFF_INITIAL_MS * 2 ** this.failures);
      this.failures++;
    }
    this.scheduleStatus(delay);
  }

  private async pollPending(): Promise<void> {
    if (this.pendingInFlight) return;
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (!this.connected) {
      // The status loop owns reconnection; just check back later.
      this.schedulePending(PENDING_POLL_MS);
      return;
    }
    this.pendingInFlight = true;
    try {
      const res = await fetch(`${this.baseUrl}/pending`, FETCH_OPTIONS);
      if (res.ok) {
        const entries = (await res.json()) as JournalEntry[];
        const json = JSON.stringify(entries);
        if (json !== this.lastPendingJson) {
          this.lastPendingJson = json;
          for (const h of this.pendingHandlers) h(entries);
        }
      }
    } catch (err) {
      this.log(`pending poll failed: ${String(err)}`);
      this.setConnected(false, null);
    }
    this.pendingInFlight = false;
    this.schedulePending(this.active ? PENDING_POLL_MS : STATUS_POLL_MS);
  }

  private scheduleStatus(delay: number): void {
    if (!this.running || this.statusTimer !== null) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      void this.pollStatus();
    }, delay);
  }

  private schedulePending(delay: number): void {
    if (!this.running || this.pendingTimer !== null) return;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.pollPending();
    }, delay);
  }

  private setConnected(
    connected: boolean,
    status: StatusResponse | null,
  ): void {
    const flipped = connected !== this.connected;
    this.connected = connected;
    // Status handlers always hear a successful poll (the payload may have
    // changed); they hear `null` once per drop, not on every failed retry.
    if (status !== null || flipped) {
      for (const h of this.statusHandlers) h(status);
    }
    if (flipped && !connected) this.lastPendingJson = null;
  }

  private async post(path: string, payload: unknown): Promise<unknown | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...FETCH_OPTIONS,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        this.log(`POST ${path} → ${String(res.status)}`);
        return null;
      }
      return (await res.json()) as unknown;
    } catch (err) {
      this.log(`POST ${path} failed: ${String(err)}`);
      return null;
    }
  }
}
