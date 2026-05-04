import { EventEmitter } from "node:events";

export type InternalMessageEvent = {
  senderUserId: number;
  recipientUserId: number;
  message: unknown;
};

export type InternalReadEvent = {
  readerUserId: number;
  peerUserId: number;
  readAt: string;
};

export type CollaboratorsUpdatedEvent = {
  reason: "internal-message" | "internal-read" | "presence" | "collaborator-change";
  userIds?: number[];
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

export function emitInternalRead(event: InternalReadEvent) {
  bus.emit("internal-read", event);
}

export function onInternalRead(listener: (event: InternalReadEvent) => void) {
  bus.on("internal-read", listener);
  return () => bus.off("internal-read", listener);
}

export function emitCollaboratorsUpdated(event: CollaboratorsUpdatedEvent) {
  bus.emit("collaborators-updated", event);
}

export function onCollaboratorsUpdated(listener: (event: CollaboratorsUpdatedEvent) => void) {
  bus.on("collaborators-updated", listener);
  return () => bus.off("collaborators-updated", listener);
}
