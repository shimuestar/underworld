// 이벤트 버스. 시스템 간 통신은 World 상태 공유와 이 버스만 허용된다.
// 이벤트명은 snake_case 문자열 (예: parry_perfect, ammo_spent).

export type EventHandler = (payload?: unknown) => void;

export class Events {
  private handlers = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload?: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) handler(payload);
  }
}
