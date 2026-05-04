import { EventEmitter } from "node:events";

export type InternalMessageEvent = {
  senderUserId: number;
  recipientUserId: number;
  message: unknown;
};

const bus = new EventEmitter();
bus.setMaxListeners(500);

export function emitInternalMessage(event: InternalMessageEvent) {
  bus.emit("internal-message", event);
}

export function onInternalMessage(listener: (event: InternalMessageEvent) => void) {
  bus.on("internal-message", listener);
  return () => bus.off("internal-message", listener);
}
