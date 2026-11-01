import { createStore, type StoreApi } from 'zustand/vanilla';

export type ResourceStrategy<T, TEventData = void> =
  | { kind: 'demand' }
  | {
      kind: 'poll';
      intervalMs: number;
      pauseWhenHidden?: boolean;
      demandGated?: boolean;
    }
  | {
      kind: 'event';
      subscribe: (handler: (event: TEventData) => void) => () => void;
      onEvent: 'reload' | ((event: TEventData, ctx: ResourceContext<T>) => void);
      debounceMs?: number;
    };

export interface ResourceContext<T> {
  readonly data: T | null;
  reload(): void;
  set(newData: T): void;
  mutate(updater: (data: T) => void): void;
}

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | undefined;
  lastUpdatedAt: number;
}

export class Resource<T, TEventData = void> {
  readonly store: StoreApi<ResourceState<T>>;

  private readonly _fetch: (() => Promise<T>) | null;
  private readonly _strategies: ResourceStrategy<T, TEventData>[];
  private _inFlight: Promise<void> | null = null;
  private _stopFns: Array<() => void> = [];
  private readonly _ctx: ResourceContext<T>;
  private _demandLoaded = false;
  private _observerCount = 0;
  private _demandGatedTimerStop: (() => void) | null = null;

  constructor(
    fetch: (() => Promise<T>) | null,
    strategies: ResourceStrategy<T, TEventData>[],
    options?: { init?: T }
  ) {
    this._fetch = fetch;
    this._strategies = strategies;

    this.store = createStore<ResourceState<T>>(() => ({
      data: options?.init ?? null,
      loading: false,
      error: undefined,
      lastUpdatedAt: 0,
    }));

    this._ctx = {
      get data(): T | null {
        return null; // overridden below
      },
      reload: () => this.invalidate(),
      set: (newData: T) => {
        this.store.setState({ data: newData, lastUpdatedAt: Date.now() });
      },
      mutate: (updater: (data: T) => void) => {
        const current = this.store.getState().data;
        if (current !== null) {
          updater(current);
          this.store.setState({ data: { ...current }, lastUpdatedAt: Date.now() });
        }
      },
    };
    Object.defineProperty(this._ctx, 'data', {
      get: () => this.store.getState().data,
      enumerable: true,
      configurable: true,
    });
  }

  get data(): T | null {
    return this.store.getState().data;
  }

  get loading(): boolean {
    return this.store.getState().loading;
  }

  get error(): string | undefined {
    return this.store.getState().error;
  }

  get lastUpdatedAt(): number {
    return this.store.getState().lastUpdatedAt;
  }

  async load(): Promise<void> {
    if (!this._fetch) return;
    if (this._inFlight) return this._inFlight;

    this.store.setState({ loading: true });

    this._inFlight = this._fetch()
      .then((data) => {
        this.store.setState({
          data,
          loading: false,
          error: undefined,
          lastUpdatedAt: Date.now(),
        });
      })
      .catch((e: unknown) => {
        this.store.setState({
          error: e instanceof Error ? e.message : String(e),
          loading: false,
        });
      })
      .finally(() => {
        this._inFlight = null;
      });

    return this._inFlight;
  }

  invalidate(): void {
    void this.load();
  }

  setValue(data: T): void {
    this.store.setState({ data, lastUpdatedAt: Date.now() });
  }

  start(): void {
    for (const strategy of this._strategies) {
      if (strategy.kind === 'poll' && !strategy.demandGated) {
        this._startPoll(strategy);
        void this.load();
      } else if (strategy.kind === 'event') {
        this._startEvent(strategy);
        if (this._fetch) void this.load();
      }
    }
  }

  dispose(): void {
    for (const stop of this._stopFns) stop();
    this._stopFns = [];
    this._demandGatedTimerStop?.();
    this._demandGatedTimerStop = null;
  }

  observerAttach(): () => void {
    this._observerCount += 1;

    if (this._observerCount === 1) {
      for (const strategy of this._strategies) {
        if (strategy.kind === 'demand' && !this._demandLoaded) {
          this._demandLoaded = true;
          void this.load();
        } else if (strategy.kind === 'poll' && strategy.demandGated) {
          this._startDemandGatedPoll(strategy);
        }
      }
    }

    return () => {
      this._observerCount = Math.max(0, this._observerCount - 1);
      if (this._observerCount === 0) {
        this._demandGatedTimerStop?.();
        this._demandGatedTimerStop = null;
      }
    };
  }

  private _startDemandGatedPoll(
    strategy: Extract<ResourceStrategy<T, TEventData>, { kind: 'poll' }>
  ): void {
    if (this._demandGatedTimerStop) return;

    if (!this._demandLoaded) {
      this._demandLoaded = true;
      void this.load();
    }

    let timer: ReturnType<typeof setInterval> | null = null;
    let visibilityHandler: (() => void) | null = null;

    const startTimer = () => {
      if (timer) return;
      timer = setInterval(() => void this.load(), strategy.intervalMs);
    };

    const stopTimer = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    if (strategy.pauseWhenHidden) {
      if (!document.hidden) startTimer();
      visibilityHandler = () => {
        if (document.hidden) stopTimer();
        else startTimer();
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    } else {
      startTimer();
    }

    this._demandGatedTimerStop = () => {
      stopTimer();
      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
      }
    };
  }

  private _startPoll(strategy: Extract<ResourceStrategy<T, TEventData>, { kind: 'poll' }>): void {
    let timer: ReturnType<typeof setInterval> | null = null;

    const startTimer = () => {
      if (timer) return;
      timer = setInterval(() => void this.load(), strategy.intervalMs);
    };

    const stopTimer = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    if (strategy.pauseWhenHidden) {
      if (!document.hidden) startTimer();
      const handleVisibility = () => {
        if (document.hidden) stopTimer();
        else startTimer();
      };
      document.addEventListener('visibilitychange', handleVisibility);
      this._stopFns.push(() => {
        stopTimer();
        document.removeEventListener('visibilitychange', handleVisibility);
      });
    } else {
      startTimer();
      this._stopFns.push(stopTimer);
    }
  }

  private _startEvent(strategy: Extract<ResourceStrategy<T, TEventData>, { kind: 'event' }>): void {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const rawHandler = (event: TEventData) => {
      if (strategy.onEvent === 'reload') {
        if (strategy.debounceMs) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => void this.load(), strategy.debounceMs);
        } else {
          void this.load();
        }
      } else {
        (strategy.onEvent as (event: TEventData, ctx: ResourceContext<T>) => void)(
          event,
          this._ctx
        );
      }
    };

    const unsubscribe = strategy.subscribe(rawHandler);

    this._stopFns.push(() => {
      unsubscribe();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    });
  }
}
