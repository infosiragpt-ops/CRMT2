const onlineUsers = new Map<number, number>();

export function markUserOnline(userId: number) {
  onlineUsers.set(userId, (onlineUsers.get(userId) ?? 0) + 1);
}

export function markUserOffline(userId: number) {
  const next = (onlineUsers.get(userId) ?? 0) - 1;
  if (next > 0) {
    onlineUsers.set(userId, next);
  } else {
    onlineUsers.delete(userId);
  }
}

export function isUserOnline(userId: number) {
  return (onlineUsers.get(userId) ?? 0) > 0;
}
