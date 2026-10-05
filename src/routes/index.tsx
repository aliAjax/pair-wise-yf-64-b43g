import { $, component$, useSignal, useStore, useVisibleTask$ } from '@builder.io/qwik';
import { Progress } from '@qwik-ui/headless';
import { QueryClient } from '@tanstack/query-core';
import { useForm, zodForm$ } from '@modular-forms/qwik';
import { useSpeakLocale } from 'qwik-speak';
import { z } from 'zod';
import type { DocumentHead } from '@builder.io/qwik-city';

type SpeechStatus = 'queued' | 'speaking' | 'done' | 'skipped';
type InterpreterStatus = 'active' | 'handoff' | 'standby' | 'closed';
type ListenerStatus = 'listening' | 'waiting' | 'suspended';
type Room = { id: string; name: string; topic: string; simultaneousChannels: number; listeningCapacity: number; capacityVersion: number };
type Speech = { id: string; roomId: string; speaker: string; delegation: string; language: string; topic: string; plannedSeconds: number; remainingSeconds: number; status: SpeechStatus; updatedAt: string };
type Channel = { id: string; roomId: string; language: string; interpreter: string; status: InterpreterStatus; health: number };
type Term = { id: string; phrase: string; translation: string; language: string; approved: boolean };
type Caption = { id: string; speechId: string; roomId: string; language: string; interpreter: string; text: string; revision: number; at: string };
type Audit = { id: string; at: string; roomId: string; message: string };
type Listener = { id: string; roomId: string; delegate: string; language: string; status: ListenerStatus; order: number };

interface ConferenceState {
  rooms: Room[];
  activeRoomId: string;
  speechQueue: Speech[];
  channels: Channel[];
  terms: Term[];
  captions: Caption[];
  audits: Audit[];
  listeners: Listener[];
  lowLatency: boolean;
}

const now = new Date().toISOString();
const seed: ConferenceState = {
  rooms: [
    { id: 'hall-a', name: 'A厅 · 全体会议', topic: '全球气候融资', simultaneousChannels: 6, listeningCapacity: 6, capacityVersion: 1 },
    { id: 'hall-b', name: 'B厅 · 技术分会', topic: '人工智能基础设施', simultaneousChannels: 4, listeningCapacity: 5, capacityVersion: 1 }
  ],
  activeRoomId: 'hall-a',
  speechQueue: [
    { id: 'speech-1', roomId: 'hall-a', speaker: 'Amina Diallo', delegation: '塞内加尔', language: '英语', topic: '适应性融资缺口', plannedSeconds: 600, remainingSeconds: 214, status: 'speaking', updatedAt: now },
    { id: 'speech-2', roomId: 'hall-a', speaker: '李明远', delegation: '中国', language: '中文', topic: '绿色基础设施机制', plannedSeconds: 600, remainingSeconds: 600, status: 'queued', updatedAt: now },
    { id: 'speech-3', roomId: 'hall-b', speaker: 'Maria Silva', delegation: '巴西', language: '葡萄牙语', topic: '边缘算力与能源', plannedSeconds: 420, remainingSeconds: 420, status: 'queued', updatedAt: now }
  ],
  channels: [
    { id: 'ch-a-zh', roomId: 'hall-a', language: '中文', interpreter: '周雨', status: 'active', health: 96 },
    { id: 'ch-a-es', roomId: 'hall-a', language: '西班牙语', interpreter: 'Lucía M.', status: 'active', health: 91 },
    { id: 'ch-a-fr', roomId: 'hall-a', language: '法语', interpreter: 'Noah B.', status: 'standby', health: 88 },
    { id: 'ch-a-ar', roomId: 'hall-a', language: '阿拉伯语', interpreter: '替补译员', status: 'closed', health: 80 },
    { id: 'ch-b-zh', roomId: 'hall-b', language: '中文', interpreter: '何佳', status: 'active', health: 94 }
  ],
  terms: [
    { id: 'term-1', phrase: 'loss and damage', translation: '损失与损害', language: '中文', approved: true },
    { id: 'term-2', phrase: 'edge inference', translation: '边缘推理', language: '中文', approved: true },
    { id: 'term-3', phrase: 'just transition', translation: '公正转型', language: '中文', approved: false }
  ],
  captions: [
    { id: 'caption-1', speechId: 'speech-1', roomId: 'hall-a', language: '中文', interpreter: '周雨', text: '我们需要把适应资金与可衡量的社区韧性目标绑定。', revision: 2, at: now }
  ],
  audits: [
    { id: 'audit-1', at: now, roomId: 'hall-a', message: 'Amina Diallo 开始发言，中文频道由周雨接续' },
    { id: 'audit-2', at: new Date(Date.now() - 90000).toISOString(), roomId: 'hall-a', message: '临时插话申请已插入队列第2位' }
  ],
  listeners: [
    { id: 'lis-1', roomId: 'hall-a', delegate: '王代表', language: '中文', status: 'listening', order: 1 },
    { id: 'lis-2', roomId: 'hall-a', delegate: 'Rep. Müller', language: '西班牙语', status: 'listening', order: 2 },
    { id: 'lis-3', roomId: 'hall-a', delegate: 'Delegate Khan', language: '中文', status: 'listening', order: 3 },
    { id: 'lis-4', roomId: 'hall-a', delegate: '李代表', language: '西班牙语', status: 'listening', order: 4 },
    { id: 'lis-5', roomId: 'hall-a', delegate: 'Rep. Silva', language: '中文', status: 'listening', order: 5 },
    { id: 'lis-s1', roomId: 'hall-a', delegate: 'Rep. Okafor', language: '中文', status: 'suspended', order: 6 },
    { id: 'lis-w1', roomId: 'hall-a', delegate: 'Delegate Dubois', language: '阿拉伯语', status: 'waiting', order: 7 },
    { id: 'lis-6', roomId: 'hall-b', delegate: '张代表', language: '中文', status: 'listening', order: 8 },
    { id: 'lis-7', roomId: 'hall-b', delegate: 'Rep. Smith', language: '中文', status: 'listening', order: 9 },
    { id: 'lis-8', roomId: 'hall-b', delegate: '田中代表', language: '中文', status: 'listening', order: 10 }
  ],
  lowLatency: false
};

const captionSchema = z.object({ text: z.string().min(1, '字幕不能为空') });
const queueSchema = z.object({
  speaker: z.string().min(2, '请输入发言人'),
  delegation: z.string().min(2, '请输入代表团'),
  language: z.string().min(2),
  topic: z.string().min(3, '请输入议题'),
  plannedSeconds: z.coerce.number().min(60).max(3600)
});
type QueueForm = z.infer<typeof queueSchema>;

function readState(): ConferenceState {
  if (typeof localStorage === 'undefined') return structuredClone(seed);
  try {
    const parsed = JSON.parse(localStorage.getItem('conference-interpretation-v1') ?? 'null') as Partial<ConferenceState> | null;
    if (!parsed) return structuredClone(seed);
    return {
      ...structuredClone(seed),
      ...parsed,
      rooms: (parsed.rooms ?? seed.rooms).map((room) => ({ ...room, listeningCapacity: room.listeningCapacity ?? 8, capacityVersion: room.capacityVersion ?? 1 })),
      listeners: parsed.listeners ?? []
    };
  } catch {
    return structuredClone(seed);
  }
}

// 厅级收听容量重算：占用与候补一起重算。
// 按全局顺位先后填容量；语种频道已关闭的不占收听位（留在候补）；挂起的不参与，等发言结束再放回。
const recomputeRoom$ = $((state: ConferenceState, roomId: string) => {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return;
  const cap = room.listeningCapacity;
  const availableLanguages = new Set(
    state.channels.filter((channel) => channel.roomId === roomId && channel.status !== 'closed').map((channel) => channel.language)
  );
  const pool = state.listeners
    .filter((listener) => listener.roomId === roomId && (listener.status === 'listening' || listener.status === 'waiting'))
    .sort((a, b) => a.order - b.order);
  let occupied = 0;
  for (const listener of pool) {
    if (occupied < cap && availableLanguages.has(listener.language)) {
      listener.status = 'listening';
      occupied += 1;
    } else {
      listener.status = 'waiting';
    }
  }
});

const advanceSpeech$ = $(async (state: ConferenceState, id: string, status: SpeechStatus) => {
  const speech = state.speechQueue.find((item) => item.id === id);
  state.speechQueue = state.speechQueue.map((item) => item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item);
  if (status === 'speaking') {
    state.speechQueue = state.speechQueue.map((item) => item.id !== id && item.roomId === speech?.roomId && item.status === 'speaking' ? { ...item, status: 'done' } : item);
  }
  state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId: speech?.roomId ?? state.activeRoomId, message: `发言 ${speech?.speaker ?? id} 状态更新为 ${status}` });
  // 本段发言结束：挂起的收听请求保留语种与顺位，转回候补，再统一重算占用与候补
  if ((status === 'done' || status === 'skipped') && speech) {
    state.listeners = state.listeners.map((listener) => listener.roomId === speech.roomId && listener.status === 'suspended' ? { ...listener, status: 'waiting' } : listener);
    await recomputeRoom$(state, speech.roomId);
  }
});

const addCaption$ = $((state: ConferenceState, speechId: string, text: string) => {
  const speech = state.speechQueue.find((item) => item.id === speechId);
  const channel = state.channels.find((item) => item.roomId === speech?.roomId && item.language === '中文');
  if (!speech || !channel || !text.trim()) return;
  const existing = state.captions.find((item) => item.speechId === speechId && item.language === channel.language);
  if (existing) {
    state.captions = state.captions.map((item) => item.id === existing.id ? { ...item, text, revision: item.revision + 1, interpreter: channel.interpreter, at: new Date().toISOString() } : item);
  } else {
    state.captions.unshift({ id: crypto.randomUUID(), speechId, roomId: speech.roomId, language: channel.language, interpreter: channel.interpreter, text, revision: 1, at: new Date().toISOString() });
  }
});

// 一位代表同一时间只挂一个厅：加入新厅前掐掉其它厅的旧收听
const joinHall$ = $(async (state: ConferenceState, delegate: string, roomId: string, language: string) => {
  const name = delegate.trim();
  if (!name) return;
  const previous = state.listeners.find((listener) => listener.delegate === name);
  state.listeners = state.listeners.filter((listener) => listener.delegate !== name);
  const maxOrder = state.listeners.reduce((max, listener) => Math.max(max, listener.order), 0);
  state.listeners.push({ id: crypto.randomUUID(), roomId, delegate: name, language, status: 'waiting', order: maxOrder + 1 });
  const room = state.rooms.find((item) => item.id === roomId);
  state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId, message: `${name} 选择收听 ${language}，进入 ${room?.name ?? roomId}` });
  await recomputeRoom$(state, roomId);
  // 若代表从其它厅切来，旧厅释放的席位也要按顺位补上候补
  if (previous && previous.roomId !== roomId) {
    state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId: previous.roomId, message: `${name} 切到其它厅，释放一个收听位` });
    await recomputeRoom$(state, previous.roomId);
  }
});

const leaveHall$ = $(async (state: ConferenceState, listenerId: string) => {
  const listener = state.listeners.find((item) => item.id === listenerId);
  if (!listener) return;
  const roomId = listener.roomId;
  state.listeners = state.listeners.filter((item) => item.id !== listenerId);
  state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId, message: `${listener.delegate} 切走/离开，释放一个收听位` });
  await recomputeRoom$(state, roomId);
});

const switchLanguage$ = $(async (state: ConferenceState, listenerId: string, language: string) => {
  const listener = state.listeners.find((item) => item.id === listenerId);
  if (!listener) return;
  listener.language = language;
  state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId: listener.roomId, message: `${listener.delegate} 切换语种为 ${language}` });
  await recomputeRoom$(state, listener.roomId);
});

type CapacityResult = { ok: boolean; version: number; capacity: number };

// 主持人调整厅级收听容量：乐观并发，比对 capacityVersion；降容时超出的正在收听者挂起（不掐断、保留语种顺位）
const setHallCapacity$ = $(async (state: ConferenceState, roomId: string, nextCap: number, expectedVersion: number): Promise<CapacityResult> => {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return { ok: false, version: 0, capacity: 0 };
  if (room.capacityVersion !== expectedVersion) {
    return { ok: false, version: room.capacityVersion, capacity: room.listeningCapacity };
  }
  const prev = room.listeningCapacity;
  room.listeningCapacity = Math.max(1, Math.floor(nextCap));
  room.capacityVersion += 1;
  if (room.listeningCapacity < prev) {
    const listening = state.listeners
      .filter((listener) => listener.roomId === roomId && listener.status === 'listening')
      .sort((a, b) => b.order - a.order);
    const excess = listening.length - room.listeningCapacity;
    for (let i = 0; i < excess && i < listening.length; i += 1) {
      listening[i].status = 'suspended';
    }
  }
  state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId, message: `收听容量调整为 ${room.listeningCapacity}（v${room.capacityVersion}），占用与候补已重算` });
  await recomputeRoom$(state, roomId);
  return { ok: true, version: room.capacityVersion, capacity: room.listeningCapacity };
});

// 译员关掉某语种：挂上的收听请求转进候补队列；已播出的字幕不动，仍归属原发言人与译员
const closeChannel$ = $(async (state: ConferenceState, channelId: string) => {
  const channel = state.channels.find((item) => item.id === channelId);
  if (!channel) return;
  channel.status = 'closed';
  state.listeners = state.listeners.map((listener) => listener.roomId === channel.roomId && listener.language === channel.language && listener.status === 'listening'
    ? { ...listener, status: 'waiting' }
    : listener);
  state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId: channel.roomId, message: `${channel.language} 频道已关闭，收听请求转入候补；已播出字幕仍归属原发言人与译员` });
  await recomputeRoom$(state, channel.roomId);
});

const reopenChannel$ = $(async (state: ConferenceState, channelId: string) => {
  const channel = state.channels.find((item) => item.id === channelId);
  if (!channel) return;
  channel.status = 'active';
  state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId: channel.roomId, message: `${channel.language} 频道已重开` });
  await recomputeRoom$(state, channel.roomId);
});

export default component$(() => {
  const locale = useSpeakLocale();
  const state = useStore<ConferenceState>(readState());
  const captionLoader = useSignal({ text: '' });
  const [captionForm, { Form: CaptionForm, Field: CaptionField }] = useForm<z.infer<typeof captionSchema>>({
    loader: captionLoader,
    validate: zodForm$(captionSchema)
  });
  const queueLoader = useSignal<QueueForm>({ speaker: '', delegation: '', language: '英语', topic: '', plannedSeconds: 300 });
  const [queueForm, { Form: QueueForm, Field: QueueField }] = useForm<QueueForm>({
    loader: queueLoader,
    validate: zodForm$(queueSchema)
  });

  const capDraft = useSignal(6);
  const expectedVersion = useSignal(1);
  const conflict = useSignal('');
  const joinName = useSignal('');
  const joinLang = useSignal('中文');

  useVisibleTask$(({ track }) => {
    track(() => state);
    localStorage.setItem('conference-interpretation-v1', JSON.stringify(state));
  });

  useVisibleTask$(({ track }) => {
    track(() => state.activeRoomId);
    const room = state.rooms.find((item) => item.id === state.activeRoomId);
    if (room) {
      capDraft.value = room.listeningCapacity;
      expectedVersion.value = room.capacityVersion;
      conflict.value = '';
    }
  });

  const activeRoom = () => state.rooms.find((room) => room.id === state.activeRoomId) ?? state.rooms[0];
  const roomQueue = () => state.speechQueue.filter((item) => item.roomId === state.activeRoomId);
  const roomChannels = () => state.channels.filter((item) => item.roomId === state.activeRoomId);
  const roomListeners = () => state.listeners.filter((listener) => listener.roomId === state.activeRoomId);
  const currentSpeech = () => roomQueue().find((item) => item.status === 'speaking');
  const listeningCount = () => roomListeners().filter((listener) => listener.status === 'listening').length;
  const waitingCount = () => roomListeners().filter((listener) => listener.status === 'waiting').length;
  const suspendedCount = () => roomListeners().filter((listener) => listener.status === 'suspended').length;

  const selectRoom$ = $((roomId: string) => {
    state.activeRoomId = roomId;
    state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId, message: `切换到 ${state.rooms.find((room) => room.id === roomId)?.name}` });
  });

  const addSpeech$ = $((values: QueueForm) => {
    state.speechQueue.push({ id: crypto.randomUUID(), roomId: state.activeRoomId, ...values, remainingSeconds: values.plannedSeconds, status: 'queued', updatedAt: new Date().toISOString() });
    state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId: state.activeRoomId, message: `${values.speaker} 已加入发言队列` });
  });

  const handoff$ = $((channelId: string) => {
    state.channels = state.channels.map((channel) => channel.id === channelId ? { ...channel, status: 'handoff' } : channel);
    state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId: state.activeRoomId, message: `${channelId} 启动译员交接，原译文版本已冻结` });
  });

  const completeHandoff$ = $((channelId: string, interpreter: string) => {
    state.channels = state.channels.map((channel) => channel.id === channelId ? { ...channel, interpreter, status: 'active', health: Math.min(100, channel.health + 2) } : channel);
    state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId: state.activeRoomId, message: `${interpreter} 接续 ${channelId}，后续字幕归属新译员` });
  });

  const publishCaption$ = $(async (values: z.infer<typeof captionSchema>) => {
    const speech = state.speechQueue.find((item) => item.roomId === state.activeRoomId && item.status === 'speaking');
    if (!speech) return;
    const queryClient = new QueryClient();
    const confirmed = await queryClient.fetchQuery({
      queryKey: ['caption-publish', speech.id, values.text],
      queryFn: async () => values.text === values.text.trim(),
      staleTime: 0
    });
    if (confirmed) await addCaption$(state, speech.id, values.text);
  });

  const approveTerm$ = $((id: string) => {
    state.terms = state.terms.map((term) => term.id === id ? { ...term, approved: true } : term);
    state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId: state.activeRoomId, message: `术语已批准：${state.terms.find((term) => term.id === id)?.phrase}` });
  });

  const submitCapacity$ = $(async () => {
    const room = state.rooms.find((item) => item.id === state.activeRoomId) ?? state.rooms[0];
    const result = await setHallCapacity$(state, room.id, capDraft.value, expectedVersion.value);
    if (result.ok) {
      expectedVersion.value = result.version;
      conflict.value = '';
    } else {
      conflict.value = `容量已被其他主持人修改为 ${result.capacity}（v${result.version}），占用与候补已按最新值重算，请确认后重试`;
      expectedVersion.value = result.version;
      capDraft.value = result.capacity;
    }
  });

  // 演示用：模拟另一位主持人在另一终端同时修改了本厅容量（版本号自增）
  const simulateConcurrentHost$ = $(() => {
    const room = state.rooms.find((item) => item.id === state.activeRoomId) ?? state.rooms[0];
    room.capacityVersion += 1;
    state.audits.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), roomId: room.id, message: `另一主持人同时修改了 ${room.name} 容量（版本冲突演示）` });
  });

  const submitJoin$ = $(async () => {
    if (!joinName.value.trim()) return;
    await joinHall$(state, joinName.value, state.activeRoomId, joinLang.value);
    joinName.value = '';
  });

  const statusLabel = (status: ListenerStatus) => status === 'listening' ? '收听中' : status === 'waiting' ? '候补' : '挂起';

  return (
    <main class={`conference-shell ${state.lowLatency ? 'low-latency' : ''}`}>
      <header class="hero">
        <div><span class="pill">{locale.lang}</span><h1>同声传译与发言队列</h1><p>{activeRoom().name} · {activeRoom().topic}</p></div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <select value={state.activeRoomId} onChange$={(event) => selectRoom$((event.target as HTMLSelectElement).value)}>{state.rooms.map((room) => <option value={room.id}>{room.name}</option>)}</select>
          <button class="secondary" onClick$={() => state.lowLatency = !state.lowLatency}>{state.lowLatency ? '退出低延迟' : '低延迟模式'}</button>
        </div>
      </header>

      <section class="grid">
        <article class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center"><h2>发言队列</h2><span class="pill">{roomQueue().length} 条 · {activeRoom().simultaneousChannels} 个同传频道</span></div>
          {roomQueue().map((speech, index) => (
            <div class={`queue-row ${speech.status === 'speaking' ? 'active' : ''}`} key={speech.id}>
              <strong>#{index + 1}</strong>
              <div><b>{speech.speaker}</b><div style="color:#638087;font-size:13px">{speech.delegation} · {speech.language} · {speech.topic}</div></div>
              <span class="pill">{speech.status}</span>
              <div style="display:flex;gap:6px">
                {speech.status === 'queued' && <button onClick$={() => advanceSpeech$(state, speech.id, 'speaking')}>开始</button>}
                {speech.status === 'speaking' && <><button onClick$={() => advanceSpeech$(state, speech.id, 'done')}>结束</button><button class="secondary" onClick$={() => speech.remainingSeconds = Math.max(0, speech.remainingSeconds - 60)}>减1分钟</button></>}
                {speech.status === 'queued' && <button class="danger" onClick$={() => advanceSpeech$(state, speech.id, 'skipped')}>跳过</button>}
              </div>
            </div>
          ))}
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:18px">
            <QueueForm onSubmit$={addSpeech$}>
              <QueueField name="speaker">{(field, props) => <input {...props} value={field.value} onInput$={(event) => field.value = (event.target as HTMLInputElement).value} placeholder="发言人" />}</QueueField>
              <QueueField name="delegation">{(field, props) => <input {...props} value={field.value} onInput$={(event) => field.value = (event.target as HTMLInputElement).value} placeholder="代表团" />}</QueueField>
              <QueueField name="topic">{(field, props) => <input {...props} value={field.value} onInput$={(event) => field.value = (event.target as HTMLInputElement).value} placeholder="议题" />}</QueueField>
              <QueueField name="plannedSeconds" type="number">{(field, props) => <input {...props} type="number" value={field.value} onInput$={(event) => field.value = Number((event.target as HTMLInputElement).value)} placeholder="计划秒数" />}</QueueField>
              <button type="submit">加入队列</button>
            </QueueForm>
          </div>
        </article>

        <aside class="panel">
          <h2>频道与译员</h2>
          {roomChannels().map((channel) => (
            <div style="padding:12px 0;border-bottom:1px solid #e6efee" key={channel.id}>
              <div style="display:flex;justify-content:space-between"><b>{channel.language} · {channel.interpreter}</b><span class="pill">{channel.status}</span></div>
              <div class="decorative" style="margin:8px 0"><Progress.Root value={channel.health} max={100} /></div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                {channel.status !== 'closed' && <button class="secondary" onClick$={() => handoff$(channel.id)}>开始交接</button>}
                {channel.status === 'handoff' && <button onClick$={() => completeHandoff$(channel.id, `替补译员-${channel.language}`)}>完成交接</button>}
                {channel.status !== 'closed'
                  ? <button class="danger" onClick$={() => closeChannel$(state, channel.id)}>关闭语种</button>
                  : <button onClick$={() => reopenChannel$(state, channel.id)}>重开语种</button>}
              </div>
            </div>
          ))}
          <h3>实时字幕修正</h3>
          {currentSpeech() ? <CaptionForm onSubmit$={publishCaption$}><CaptionField name="text">{(field, props) => <textarea {...props} rows={3} value={field.value} onInput$={(event) => field.value = (event.target as HTMLTextAreaElement).value} placeholder="输入或修正当前字幕" />}</CaptionField><button type="submit">提交新版字幕</button></CaptionForm> : <p>当前没有发言中的代表。</p>}
          {state.captions.filter((caption) => caption.roomId === state.activeRoomId).map((caption) => <div style="margin-top:10px;padding:10px;background:#f1f8f7;border-radius:10px" key={caption.id}><b>{caption.interpreter} · v{caption.revision}</b><p>{caption.text}</p></div>)}
        </aside>
      </section>

      <section class="grid" style="margin-top:18px">
        <article class="panel">
          <h2>厅级收听容量</h2>
          <p style="color:#59747b;margin:2px 0 10px">{activeRoom().name} · 容量版本 v{activeRoom().capacityVersion}</p>
          <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px">
            <span class="pill">收听中 {listeningCount()} / {activeRoom().listeningCapacity}</span>
            <span class="pill">候补 {waitingCount()}</span>
            <span class="pill">挂起 {suspendedCount()}</span>
          </div>
          <div class="decorative" style="margin:8px 0"><Progress.Root value={listeningCount()} max={activeRoom().listeningCapacity} /></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <input type="number" min={1} max={99} value={capDraft.value} onInput$={(event) => capDraft.value = Number((event.target as HTMLInputElement).value)} style="max-width:120px" />
            <button onClick$={submitCapacity$}>调整容量</button>
            <button class="secondary" onClick$={simulateConcurrentHost$}>模拟另一主持人同时修改</button>
          </div>
          {conflict.value && <div style="margin-top:10px;padding:10px;background:#fdeceb;color:#9a2f2b;border-radius:10px;font-size:13px">{conflict.value}</div>}
          <p style="color:#638087;font-size:13px;margin-top:10px">降容时正在收听的人不会被直接掐断：超出部分先挂起并保留所选语种，等本段发言结束后再按顺位放回；容量修改后占用与候补一起重算。</p>
        </article>

        <article class="panel">
          <h2>代表收听与候补</h2>
          <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:12px">
            <input placeholder="代表姓名" value={joinName.value} onInput$={(event) => joinName.value = (event.target as HTMLInputElement).value} />
            <select value={joinLang.value} onChange$={(event) => joinLang.value = (event.target as HTMLSelectElement).value}>
              {roomChannels().map((channel) => {
                const label = channel.language + (channel.status === 'closed' ? '（已关闭）' : '');
                return <option value={channel.language}>{label}</option>;
              })}
            </select>
            <button onClick$={submitJoin$}>加入收听</button>
          </div>
          {roomListeners().slice().sort((a, b) => a.order - b.order).map((listener) => (
            <div class="queue-row" key={listener.id}>
              <strong>#{listener.order}</strong>
              <div><b>{listener.delegate}</b><div style="color:#638087;font-size:13px">{listener.language}{listener.status === 'suspended' ? ' · 保留语种，等待发言结束' : ''}</div></div>
              <span class="pill">{statusLabel(listener.status)}</span>
              <div style="display:flex;gap:6px">
                <select value={listener.language} onChange$={(event) => switchLanguage$(state, listener.id, (event.target as HTMLSelectElement).value)} style="max-width:110px">
                  {roomChannels().map((channel) => <option value={channel.language}>{channel.language}</option>)}
                </select>
                <button class="danger" onClick$={() => leaveHall$(state, listener.id)}>切走</button>
              </div>
            </div>
          ))}
          {roomListeners().length === 0 && <p style="color:#638087">本厅暂无代表收听。</p>}
        </article>
      </section>

      <section class="grid" style="margin-top:18px">
        <article class="panel">
          <h2>术语库</h2>
          {state.terms.map((term) => <div class="queue-row" key={term.id}><span/><div><b>{term.phrase}</b><div>{term.translation} · {term.language}</div></div><span class="pill">{term.approved ? '已批准' : '待审'}</span><button disabled={term.approved} onClick$={() => approveTerm$(term.id)}>批准</button></div>)}
        </article>
        <article class="panel">
          <h2>操作与交接时间线</h2>
          {state.audits.filter((audit) => audit.roomId === state.activeRoomId).slice(0, 10).map((audit) => <div style="padding:10px 0;border-bottom:1px solid #e6efee" key={audit.id}><small>{new Date(audit.at).toLocaleTimeString()}</small><div>{audit.message}</div></div>)}
        </article>
      </section>
    </main>
  );
});

export const head: DocumentHead = {
  title: '国际会议同声传译控制台',
  meta: [{ name: 'description', content: '发言队列、多语种频道、术语、译员交接、收听容量与候补、挂起保留与字幕归属' }]
};
