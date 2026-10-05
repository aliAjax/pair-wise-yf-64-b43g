import assert from 'node:assert/strict';
import {
  applyCloseChannel,
  applyLeaveListen,
  applyRequestListen,
  applyReopenChannel,
  applySetRoomCapacity,
  byRequestedAt,
  restoreSuspended
} from './listen-capacity.js';

let seq = 0;
const nextId = () => `req-${++seq}`;
const t = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();

function makeState() {
  return {
    rooms: [
      { id: 'hall-a', listenCapacity: 2, capacityVersion: 1 },
      { id: 'hall-b', listenCapacity: 1, capacityVersion: 1 }
    ],
    channels: [
      { roomId: 'hall-a', language: '中文', status: 'active' },
      { roomId: 'hall-a', language: '法语', status: 'active' },
      { roomId: 'hall-b', language: '中文', status: 'active' }
    ],
    listenRequests: []
  };
}
const inRoom = (s, room) => s.listenRequests.filter((r) => r.roomId === room);
const byDelegate = (s, name) => s.listenRequests.find((r) => r.delegate === name);

// 1. 容量用完排队等位，有人离开按先后补位
{
  const s = makeState();
  applyRequestListen(s, 'hall-a', '甲', '中文', nextId);
  applyRequestListen(s, 'hall-a', '乙', '中文', nextId);
  const full = applyRequestListen(s, 'hall-a', '丙', '中文', nextId);
  assert.equal(full.status, 'waiting', '容量满应进候补');
  applyLeaveListen(s, byDelegate(s, '甲').id);
  assert.equal(byDelegate(s, '丙').status, 'listening', '先来先补');
  console.log('✓ 1 容量满排队、离开按先后补位');
}

// 2. 一位代表同一时间只挂一个厅：跨厅申请=切走，旧厅候补补上
{
  const s = makeState();
  applyRequestListen(s, 'hall-a', '甲', '中文', nextId);
  applyRequestListen(s, 'hall-a', '乙', '中文', nextId);
  applyRequestListen(s, 'hall-a', '丙', '中文', nextId); // 候补
  const res = applyRequestListen(s, 'hall-b', '甲', '中文', nextId);
  assert.deepEqual(res.switchedFrom, ['hall-a']);
  assert.equal(inRoom(s, 'hall-a').some((r) => r.delegate === '甲'), false, '甲不应再挂A厅');
  assert.equal(byDelegate(s, '丙').status, 'listening', '甲切走后丙应补上');
  assert.equal(byDelegate(s, '甲').roomId, 'hall-b');
  console.log('✓ 2 一厅一代表，切走后旧厅补位');
}

// 3. 同厅重复申请=换语种，保留原位置
{
  const s = makeState();
  applyRequestListen(s, 'hall-a', '甲', '中文', nextId);
  const first = byDelegate(s, '甲');
  const res = applyRequestListen(s, 'hall-a', '甲', '法语', nextId);
  assert.equal(res.changedLanguage, true);
  assert.equal(inRoom(s, 'hall-a').length, 1, '不应产生第二条请求');
  assert.equal(first.language, '法语');
  assert.equal(first.status, 'listening');
  console.log('✓ 3 同厅重复申请换语种不换位置');
}

// 4. 压低容量不掐断：超出的挂起并保留语种；段落结束放回
{
  const s = makeState();
  applyRequestListen(s, 'hall-a', '甲', '中文', nextId);
  applyRequestListen(s, 'hall-a', '乙', '法语', nextId);
  applyRequestListen(s, 'hall-a', '丙', '中文', nextId); // 候补
  assert.equal(applySetRoomCapacity(s, 'hall-a', 1, 1), 'ok');
  assert.equal(byDelegate(s, '甲').status, 'listening');
  assert.equal(byDelegate(s, '乙').status, 'suspended', '最新进入的先挂起');
  assert.equal(byDelegate(s, '乙').language, '法语', '挂起保留所选语种');
  assert.equal(byDelegate(s, '丙').status, 'waiting', '候补不越位');
  restoreSuspended(s, 'hall-a'); // 发言段落结束
  assert.equal(byDelegate(s, '乙').status, 'listening', '段落结束后放回');
  assert.equal(byDelegate(s, '乙').language, '法语');
  console.log('✓ 4 降容挂起保留语种、段落结束放回');
}

// 5. 容量修改带版本号：并发修改后者冲突；容量修改后占用与候补一起重算
{
  const s = makeState();
  applyRequestListen(s, 'hall-a', '甲', '中文', nextId);
  applyRequestListen(s, 'hall-a', '乙', '中文', nextId);
  assert.equal(applySetRoomCapacity(s, 'hall-a', 1, 1), 'ok'); // 主持人A成功 → v2
  assert.equal(applySetRoomCapacity(s, 'hall-a', 5, 1), 'conflict', '主持人B持旧版本应冲突');
  assert.equal(s.rooms[0].listenCapacity, 1, '冲突不应覆盖');
  assert.equal(applySetRoomCapacity(s, 'hall-a', 3, 2), 'ok'); // 用新版本重试
  assert.equal(s.rooms[0].capacityVersion, 3);
  // 升容后挂起的乙先恢复，候补再补
  applyRequestListen(s, 'hall-a', '丙', '中文', nextId);
  applyRequestListen(s, 'hall-a', '丁', '中文', nextId); // 候补
  applySetRoomCapacity(s, 'hall-a', 2, 3); // 丙被挂起
  assert.equal(byDelegate(s, '丙').status, 'suspended');
  applySetRoomCapacity(s, 'hall-a', 3, 4); // 升回3：挂起的丙优先恢复，丁仍候补
  assert.equal(byDelegate(s, '丙').status, 'listening', '挂起者优先于候补恢复');
  assert.equal(byDelegate(s, '丁').status, 'waiting');
  applySetRoomCapacity(s, 'hall-a', 4, 5);
  assert.equal(byDelegate(s, '丁').status, 'listening', '继续升容后候补补上');
  console.log('✓ 5 版本冲突拒绝、升降容占用候补一起重算');
}

// 6. 译员关掉语种：挂上的转候补（保留原次序），关闭语种的候补不阻塞别人；恢复后按先后补回
{
  const s = makeState();
  applyRequestListen(s, 'hall-a', '甲', '中文', nextId);
  applyRequestListen(s, 'hall-a', '乙', '法语', nextId);
  applyRequestListen(s, 'hall-a', '丙', '中文', nextId); // 候补（中文）
  s.channels.find((c) => c.roomId === 'hall-a' && c.language === '中文').status = 'closed';
  const moved = applyCloseChannel(s, 'hall-a', '中文');
  assert.equal(moved, 1, '只有挂上的甲转候补');
  assert.equal(byDelegate(s, '甲').status, 'waiting');
  assert.equal(byDelegate(s, '乙').status, 'listening', '其他语种不受影响');
  // 甲（中文，关闭）排在前面但不阻塞：再申请一个法语应直接接通
  applyRequestListen(s, 'hall-a', '丁', '法语', nextId);
  assert.equal(byDelegate(s, '丁').status, 'listening', '关闭语种的候补不阻塞队列');
  // 乙离开腾出位置，但甲、丙的语种仍关闭，不能补位
  applyLeaveListen(s, byDelegate(s, '乙').id);
  assert.equal(byDelegate(s, '甲').status, 'waiting', '语种关闭中不补位');
  s.channels.find((c) => c.roomId === 'hall-a' && c.language === '中文').status = 'active';
  applyReopenChannel(s, 'hall-a');
  assert.equal(byDelegate(s, '甲').status, 'listening', '频道恢复后按先后补回');
  assert.equal(byDelegate(s, '丙').status, 'waiting', '容量再次占满，丙继续候补');
  // 原申请次序保留：丙之后再有新候补时，丙仍排在前
  applyRequestListen(s, 'hall-a', '戊', '法语', nextId);
  const waitingOrder = s.listenRequests.filter((r) => r.roomId === 'hall-a' && r.status === 'waiting').sort(byRequestedAt).map((r) => r.delegate);
  assert.deepEqual(waitingOrder, ['丙', '戊'], '候补按申请先后排序');
  console.log('✓ 6 关语种转候补、不阻塞他人、恢复补回');
}

// 7. 挂起期间语种被关 → 段落结束时转候补而不是放回
{
  const s = makeState();
  applyRequestListen(s, 'hall-a', '甲', '中文', nextId);
  applyRequestListen(s, 'hall-a', '乙', '法语', nextId);
  applySetRoomCapacity(s, 'hall-a', 1, 1); // 乙挂起
  assert.equal(byDelegate(s, '乙').status, 'suspended');
  s.channels.find((c) => c.roomId === 'hall-a' && c.language === '法语').status = 'closed';
  applyCloseChannel(s, 'hall-a', '法语');
  assert.equal(byDelegate(s, '乙').status, 'waiting', '挂起中遇关频道应转候补');
  restoreSuspended(s, 'hall-a');
  assert.equal(byDelegate(s, '乙').status, 'waiting', '语种未恢复不放回');
  console.log('✓ 7 挂起中关语种转候补');
}

console.log('\n全部通过');
