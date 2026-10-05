// 厅级收听容量的核心调度规则（纯函数，不依赖 Qwik，便于单测）
//
// 规则汇总：
// - 一位代表同一时间只挂一个厅；跨厅申请视为切走，旧厅空位按候补先后补上
// - 容量用完后新申请进入候补队列，按申请先后补位；语种频道已关闭的候补不阻塞后面的人
// - 主持人压低容量时不掐断正在听的人：超出的先挂起并保留所选语种，本段发言结束后放回
// - 容量修改带版本号（乐观锁），两位主持人同时改同一厅时后提交的一方收到冲突
// - 每次容量修改后，占用（挂起/恢复）与候补一起重算
// - 译员关闭语种后，挂上的收听请求（含挂起中的）转进候补队列；已播出字幕不动

export type ListenStatus = 'listening' | 'suspended' | 'waiting';

export interface ListenRequest {
  id: string;
  roomId: string;
  delegate: string;
  language: string;
  status: ListenStatus;
  requestedAt: string;
  updatedAt: string;
}

export interface CapacityRoom {
  id: string;
  listenCapacity: number;
  capacityVersion: number;
}

export interface ListenChannel {
  roomId: string;
  language: string;
  status: string;
}

export interface ListenState {
  rooms: CapacityRoom[];
  channels: ListenChannel[];
  listenRequests: ListenRequest[];
}

export const byRequestedAt = (a: ListenRequest, b: ListenRequest) => a.requestedAt.localeCompare(b.requestedAt);

export function isLanguageOpen(state: ListenState, roomId: string, language: string) {
  return state.channels.some((channel) => channel.roomId === roomId && channel.language === language && channel.status !== 'closed');
}

// 候补按申请先后补位；语种频道已关闭的请求留在候补中，不阻塞后面的人
export function promoteWaiting(state: ListenState, roomId: string) {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return;
  const reqs = state.listenRequests.filter((item) => item.roomId === roomId);
  let used = reqs.filter((item) => item.status === 'listening').length;
  for (const req of reqs.filter((item) => item.status === 'waiting').sort(byRequestedAt)) {
    if (used >= room.listenCapacity) break;
    if (!isLanguageOpen(state, roomId, req.language)) continue;
    req.status = 'listening';
    req.updatedAt = new Date().toISOString();
    used++;
  }
}

// 容量修改后占用与候补一起重算：
// 1. 超出的正在听不掐断，最新进入的先挂起并保留语种
// 2. 有余量时先恢复挂起的人（他们本来就在听，优先于候补）
// 3. 再按先后从候补补位
export function rebalanceRoom(state: ListenState, roomId: string) {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return;
  const reqs = state.listenRequests.filter((item) => item.roomId === roomId);
  const listening = reqs.filter((item) => item.status === 'listening').sort(byRequestedAt);
  let overflow = listening.length - room.listenCapacity;
  for (const req of [...listening].reverse()) {
    if (overflow <= 0) break;
    req.status = 'suspended';
    req.updatedAt = new Date().toISOString();
    overflow--;
  }
  let used = reqs.filter((item) => item.status === 'listening').length;
  for (const req of reqs.filter((item) => item.status === 'suspended').sort(byRequestedAt)) {
    if (used >= room.listenCapacity) break;
    if (!isLanguageOpen(state, roomId, req.language)) {
      req.status = 'waiting';
      req.updatedAt = new Date().toISOString();
      continue;
    }
    req.status = 'listening';
    req.updatedAt = new Date().toISOString();
    used++;
  }
  promoteWaiting(state, roomId);
}

// 发言段落结束：挂起的收听全部放回（语种已关的转候补），随后按剩余容量补位。
// 放回不看当前容量——压低容量只是为大屏临时腾带宽，段落结束即恢复。
export function restoreSuspended(state: ListenState, roomId: string) {
  for (const req of state.listenRequests.filter((item) => item.roomId === roomId && item.status === 'suspended').sort(byRequestedAt)) {
    req.status = isLanguageOpen(state, roomId, req.language) ? 'listening' : 'waiting';
    req.updatedAt = new Date().toISOString();
  }
  promoteWaiting(state, roomId);
}

export interface RequestListenResult {
  status: ListenStatus;
  switchedFrom: string[];
  changedLanguage: boolean;
}

export function applyRequestListen(
  state: ListenState,
  roomId: string,
  delegate: string,
  language: string,
  makeId: () => string = () => crypto.randomUUID()
): RequestListenResult | null {
  const name = delegate.trim();
  const room = state.rooms.find((item) => item.id === roomId);
  if (!name || !language || !room) return null;
  const mine = state.listenRequests.filter((item) => item.delegate === name);
  const sameRoom = mine.find((item) => item.roomId === roomId);
  if (sameRoom) {
    // 同厅重复申请视为换语种，保留原申请位置
    sameRoom.language = language;
    sameRoom.updatedAt = new Date().toISOString();
    if (sameRoom.status !== 'waiting' && !isLanguageOpen(state, roomId, language)) sameRoom.status = 'waiting';
    promoteWaiting(state, roomId);
    return { status: sameRoom.status, switchedFrom: [], changedLanguage: true };
  }
  // 一位代表同一时间只挂一个厅：从其他厅移除视为切走，旧厅按先后补位
  const fromRooms = [...new Set(mine.map((item) => item.roomId))];
  state.listenRequests = state.listenRequests.filter((item) => item.delegate !== name);
  for (const oldRoomId of fromRooms) promoteWaiting(state, oldRoomId);
  const used = state.listenRequests.filter((item) => item.roomId === roomId && item.status === 'listening').length;
  const status: ListenStatus = used < room.listenCapacity && isLanguageOpen(state, roomId, language) ? 'listening' : 'waiting';
  const now = new Date().toISOString();
  state.listenRequests.push({ id: makeId(), roomId, delegate: name, language, status, requestedAt: now, updatedAt: now });
  return { status, switchedFrom: fromRooms, changedLanguage: false };
}

export function applyLeaveListen(state: ListenState, requestId: string): ListenRequest | null {
  const req = state.listenRequests.find((item) => item.id === requestId);
  if (!req) return null;
  state.listenRequests = state.listenRequests.filter((item) => item.id !== requestId);
  promoteWaiting(state, req.roomId);
  return req;
}

export type SetCapacityResult = 'ok' | 'conflict' | 'missing';

// 容量修改带版本号：两位主持人同时改同一厅时，后提交的一方收到冲突而不是互相覆盖
export function applySetRoomCapacity(state: ListenState, roomId: string, capacity: number, expectedVersion: number): SetCapacityResult {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return 'missing';
  if (room.capacityVersion !== expectedVersion) return 'conflict';
  room.listenCapacity = Math.max(0, Math.min(99, Math.floor(capacity)));
  room.capacityVersion += 1;
  rebalanceRoom(state, roomId);
  return 'ok';
}

// 关闭语种频道：挂上的收听请求（含挂起中的）转进候补队列，保留原申请次序。
// 已播出的字幕挂在原发言人名下，不在此函数职责内，调用方不得改动。
export function applyCloseChannel(state: ListenState, roomId: string, language: string): number {
  let moved = 0;
  for (const req of state.listenRequests) {
    if (req.roomId === roomId && req.language === language && req.status !== 'waiting') {
      req.status = 'waiting';
      req.updatedAt = new Date().toISOString();
      moved++;
    }
  }
  promoteWaiting(state, roomId);
  return moved;
}

export function applyReopenChannel(state: ListenState, roomId: string) {
  promoteWaiting(state, roomId);
}
