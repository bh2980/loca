import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type RefObject } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowUp, ImageOff, Plus, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { Box, Button, ComposerInput, ComposerMenu, FilePickButton, Icon, ImageChip, Inline, Stack, Text, Tooltip, TooltipContent, TooltipTrigger } from '@loca/ui';
import { CHAT_IMAGES_MAX, imageDecision, IMAGE_UNSUPPORTED_NOTE, type ChatChip, type PermissionMode, type RunCard } from '@tw/shared';
import { ModelPicker, type ModelValue } from '@/components/model-picker';
import { agentRequests, usePendingAgentRequest } from '@/lib/agent';
import { chatDock } from '@/lib/chat-dock';
import { imageFilesOf, prepareImage, type PendingImage } from '@/lib/chat-image-file';
import { NO_HISTORY, stepHistory, type HistoryState } from '@/lib/chat-input-history';
import { mergeIntoDraft } from '@/lib/chat-queue';
import { makeRunCard } from '@/lib/chat-run-api';
import type { chatFor } from '@/lib/chat-store';
import { keyLabel } from '@/lib/keys';
import { useViewState, type ViewItem } from '@/lib/view-context';
import { AttachChip } from './attach-chip';
import { ContextMeter, type ChatUsage } from './context-meter';
import { PermissionModePicker } from './permission-mode';
import type { RunCardControls } from './run-card';
import { useComposerMenu, type RunMode } from './use-composer-menu';

/** What the conversation asks of the box: text sent back to it, a message to send again, focus. */
export interface ComposerHandle {
  /** Messages that did not reach a reply go back into the draft. */
  mergeDraft: (texts: string[]) => void;
  /** 수정해서 보내기: the message's text and what it pointed at become the draft. */
  reuse: (text: string, chips: ChatChip[]) => void;
  focus: () => void;
}

/** A message for the conversation: its text, the pictures that go with it and what it points at. */
export interface OutgoingMessage {
  text: string;
  files?: { type: 'file'; mediaType: string; url: string; filename: string }[];
  metadata?: { chips: ChatChip[] };
}

/**
 * The box under the conversation: the draft, its attachments, the @ and / lists and the send button. Everything a
 * keystroke changes lives here, so typing draws this and nothing of the conversation above it.
 */
export function ChatComposer({ handle, projectId, sessionId, stored, onSend, onQueue, onPin, onStop, onCard, ready, busy, elsewhere, sent, waitingCard, cardWaiting, usage, model, onModel, mode, onMode }: {
  handle: Ref<ComposerHandle>;
  projectId: string;
  sessionId: string;
  stored: ReturnType<typeof chatFor>;
  onSend: (message: OutgoingMessage) => void;
  /** Sent while the reply runs: it goes in at the reply's next step. */
  onQueue: (text: string) => void;
  onPin: () => void;
  onStop: () => void;
  onCard: (card: RunCard) => void;
  ready: boolean;
  /** A reply is coming in here. */
  busy: boolean;
  /** A reply is being written elsewhere (sent before a reload). */
  elsewhere: boolean;
  /** What was sent in this conversation, for ↑/↓. */
  sent: string[];
  waitingCard: RefObject<RunCardControls | null>;
  /** A 실행 확인 card waits for an answer. */
  cardWaiting: boolean;
  usage: (ChatUsage & { images: 'yes' | 'no' | 'unknown' }) | null;
  model: ModelValue | null;
  onModel: (next: ModelValue) => Promise<void>;
  mode: PermissionMode;
  onMode: (mode: PermissionMode) => void;
}) {
  const view = useViewState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // Chips from the page (reported by useReportView) and ones the person picked with @ for the next message
  // (these stay on the message they were sent with).
  const [picked, setPicked] = useState<ChatChip[]>([]);
  const reported: ViewItem[] = Object.values(view.items).flat();
  const onPage: ViewItem[] = reported.filter((item) => !excluded.has(`${item.kind}:${item.id}`) && !picked.some((other) => other.kind === item.kind && other.id === item.id));
  const attached: ViewItem[] = [...onPage, ...picked.map((chip): ViewItem => ({ kind: chip.kind, id: chip.id, label: chip.label, ...(chip.detail && { detail: chip.detail }), attached: true }))];
  const viewRef = useRef({ page: view.page, path: pathname, items: attached });
  // What the message being sent carries: held for a moment after sending so the chips cleared by it still reach the request.
  const frozenView = useRef<typeof viewRef.current | null>(null);
  // What is on screen now, for the next message (kept after render: rendering itself changes nothing).
  useLayoutEffect(() => {
    viewRef.current = { page: view.page, path: pathname, items: attached };
    stored.setView(frozenView.current ?? viewRef.current);
  });

  const [input, setInput] = useState(() => chatDock.takePrefill(projectId) ?? sessionStorage.getItem(`tw.chat.draft.${sessionId}`) ?? '');
  // A page asked to start a request here (e.g. the graph's AI 간략 보기): it fills the box, the person finishes and sends it.
  useEffect(
    () =>
      chatDock.onPrefill((target, text) => {
        if (target !== projectId) return;
        chatDock.takePrefill(projectId);
        setInput(text);
      }),
    [projectId],
  );
  const [showModelHint, setShowModelHint] = useState(false);
  // Images pasted or dropped for the next message; a model that takes none keeps the chip but they are not sent.
  const [images, setImages] = useState<PendingImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const imageSupport = imageDecision(usage?.images === 'yes' ? true : usage?.images === 'no' ? false : undefined, images.length);
  const addImages = async (files: File[]) => {
    for (const file of files) {
      if (images.length >= CHAT_IMAGES_MAX) return void toast.error(`이미지는 한 메시지에 ${CHAT_IMAGES_MAX}장까지 붙일 수 있습니다.`);
      try {
        const image = await prepareImage(file);
        setImages((list) => (list.length >= CHAT_IMAGES_MAX ? list : [...list, image]));
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : '이미지를 붙이지 못했습니다.');
      }
    }
  };
  const box = useRef<HTMLTextAreaElement>(null);
  // @ (attach) and / (commands) pickers over the box (use-composer-menu.ts): what they show follows the text and the caret.
  const [caret, setCaret] = useState(0);
  // A /workflow waiting for its target and the `{대상}` slot of a saved prompt. The 실행 확인 cards are messages of the conversation (server).
  const [run, setRun] = useState<RunMode | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const makeCard = useMutation({
    mutationFn: ({ workflowId, chips }: { workflowId: string; chips: ChatChip[] }) => makeRunCard(sessionId, workflowId, chips),
    onSuccess: (card) => {
      onCard(card);
      setRun(null);
      putInput('', 0);
    },
    onError: (cause) => toast.error(cause instanceof Error ? cause.message : '실행 확인을 만들지 못했습니다.'),
  });
  // ↑/↓ in the box walks what was sent in this conversation; any edit leaves the walk.
  const [history, setHistory] = useState<HistoryState>(NO_HISTORY);
  const putInput = (value: string, at: number) => {
    setInput(value);
    setHistory(NO_HISTORY);
    setCaret(at);
    const target = box.current;
    requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(at, at);
      // The browser moves the caret to the end when the text is replaced (a select event may report that); the caret we set is the one that counts.
      setCaret(at);
    });
  };
  const menu = useComposerMenu({ projectId, input, caret, put: putInput, box, onPage: reported, picked, setPicked, run, setRun, slot, setSlot });
  // The slot is the @ a prompt's {대상} was opened as: it ends when that @ is no longer there (the caret may jump while the text is replaced, so it is not tied to the list being open).
  useEffect(() => {
    if (slot !== null && input[slot] !== '@') setSlot(null);
  }, [input, slot]);
  // The target is picked: the card asks before anything runs (AI work costs money).
  const confirmRun = () => {
    if (!run || makeCard.isPending) return;
    if (!run.chips.length) return putInput('@', 1);
    makeCard.mutate({ workflowId: run.command.id, chips: run.chips });
  };
  useEffect(() => {
    sessionStorage.setItem(`tw.chat.draft.${sessionId}`, input);
  }, [sessionId, input]);

  useImperativeHandle(handle, () => ({
    mergeDraft: (texts) => setInput((current) => mergeIntoDraft(current, texts)),
    reuse: (text, chips) => {
      setInput(text);
      setPicked(chips);
      setHistory(NO_HISTORY);
      box.current?.focus();
    },
    focus: () => box.current?.focus(),
  }), []);

  // Requests from AI buttons elsewhere in the app.
  const pendingRequest = usePendingAgentRequest();
  // Taken on the next tick, after the freshly mounted chat has settled (a send during its
  // own setup is dropped); the cleanup keeps the request queued if this body unmounts first.
  useEffect(() => {
    if (!pendingRequest || busy) return;
    const timer = setTimeout(() => {
      const request = agentRequests.take();
      if (!request) return;
      if (request.send && ready) {
        onPin();
        onSend({ text: request.text });
      } else setInput(request.text);
    }, 50);
    return () => clearTimeout(timer);
  }, [pendingRequest, busy, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => {
    // A /workflow waiting for its target: Enter makes the confirm card instead of sending a message.
    if (run) return confirmRun();
    const text = input.trim();
    const files = imageSupport.send ? images.map((image) => ({ type: 'file' as const, mediaType: image.mediaType, url: image.url, filename: image.name })) : [];
    if (!text && !files.length) return;
    if (!ready) return;
    // A message that joins a running reply is text: the images wait for the next message.
    if ((busy || elsewhere) && files.length) return void toast.info('이미지는 답이 끝난 뒤에 보낼 수 있습니다.');
    setInput('');
    if (!busy && !elsewhere) {
      frozenView.current = viewRef.current;
      setTimeout(() => (frozenView.current = null), 2000);
      stored.setView(viewRef.current);
      // What the person pointed at with @ is kept on the message, to read (and open) later.
      onSend({ text, ...(files.length && { files }), ...(picked.length && { metadata: { chips: picked } }) });
      setPicked([]);
      setImages([]);
      return;
    }
    onPin();
    onQueue(text);
  };

  return (
    <Box shrink={false} border="top" background="page" padding="condensed">
      {run && (
        <Inline wrap marginBottom="condensed" gap="tight" aria-label="실행 대상">
          <Text variant="caption" weight="medium">/{run.command.name}</Text>
          {run.chips.map((chip) => (
            <AttachChip key={`${chip.kind}:${chip.id}`} projectId={projectId} chip={chip} onRemove={() => { setRun({ ...run, chips: run.chips.filter((other) => !(other.kind === chip.kind && other.id === chip.id)) }); box.current?.focus(); }} />
          ))}
          <Text variant="caption" tone="muted">{run.chips.length ? `${keyLabel('Enter')} 실행 확인 · @ 더 고르기 · ${keyLabel('Esc')} 취소` : '@로 실행할 대상을 고르세요'}</Text>
          <Button type="button" variant="ghost" size="icon-xs" marginLeft="auto" aria-label="실행 그만두기" onClick={() => { setRun(null); putInput('', 0); }}>
            <X />
          </Button>
        </Inline>
      )}
      {/* What goes with the message, led by +: a picture from a file (as pasting or dropping one); lines and screens are @ in the box. */}
      <Stack direction="row" wrap align="center" marginBottom="condensed" gap="tight" aria-label="첨부된 화면 정보">
        <FilePickButton size="icon-xs" variant="outline" accept="image/*" multiple aria-label="이미지 첨부" title="이미지 첨부 (붙여넣기·끌어 놓기도 됩니다)" onFiles={(files) => void addImages(files)}>
          <Plus />
        </FilePickButton>
        {attached.map((item) => (
          <AttachChip
            key={`${item.kind}:${item.id}`}
            projectId={projectId}
            chip={{ kind: item.kind, id: item.id, label: item.label, ...(item.detail && { detail: item.detail }), href: picked.find((chip) => chip.kind === item.kind && chip.id === item.id)?.href }}
            link={Boolean(item.attached)}
            onRemove={() => {
              if (item.attached) setPicked((list) => list.filter((other) => !(other.kind === item.kind && other.id === item.id)));
              else setExcluded((set) => new Set(set).add(`${item.kind}:${item.id}`));
              box.current?.focus();
            }}
          />
        ))}
      </Stack>
      {images.length > 0 && (
        <Inline wrap marginBottom="condensed" gap="condensed" aria-label="붙인 이미지">
          {images.map((image) => (
            <ImageChip key={image.id} src={image.url} alt={image.name} dimmed={imageSupport.support === 'no'} removeLabel={`${image.name} 빼기`} onRemove={() => setImages((list) => list.filter((other) => other.id !== image.id))} />
          ))}
          {imageSupport.support === 'no' && (
            <Inline gap="tight" variant="caption" tone="muted" role="status">
              <Icon icon={ImageOff} size="sm" /> {IMAGE_UNSUPPORTED_NOTE}
            </Inline>
          )}
        </Inline>
      )}
      <Box
        position="relative"
        radius={dragging ? 'md' : undefined}
        ring={dragging ? 'focus' : undefined}
        onDragOver={(event) => {
          if (![...event.dataTransfer.items].some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          setDragging(false);
          const files = imageFilesOf(event.dataTransfer);
          if (!files.length) return;
          event.preventDefault();
          void addImages(files);
        }}
      >
        {menu.menuShown && (
          <ComposerMenu
            id="chat-composer-menu"
            title={menu.title}
            groups={menu.groups}
            activeId={menu.activeId}
            onActive={menu.setActiveId}
            onPick={menu.pickRow}
            loading={menu.loading}
            empty={menu.empty}
            hint={menu.hint}
          />
        )}
        <ComposerInput
          ref={box}
          value={input}
          aria-haspopup="listbox"
          aria-expanded={menu.menuShown}
          aria-controls={menu.menuShown ? 'chat-composer-menu' : undefined}
          onChange={(event) => {
            setInput(event.target.value);
            setCaret(event.target.selectionStart);
            setHistory(NO_HISTORY);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onPaste={(event) => {
            // A pasted picture (a screenshot) becomes a chip; text pastes as usual.
            const files = imageFilesOf(event.clipboardData);
            if (!files.length || event.clipboardData.getData('text/plain')) return;
            event.preventDefault();
            void addImages(files);
          }}
          onKeyDown={(event) => {
            const composing = event.nativeEvent.isComposing || event.keyCode === 229;
            // The @ and / lists take their keys first (arrows, Enter, Tab, Esc, Backspace on an empty search).
            if (menu.onKeyDown(event)) return;
            if (event.key === 'Escape' && !composing && !event.shiftKey) {
              // No list open: Esc backs out of a /workflow's target, then cancels a card that waits, then (in the panel) stops a reply.
              if (run) {
                event.preventDefault();
                setRun(null);
                putInput('', 0);
                return;
              }
              if (!input.trim() && !busy && !elsewhere && waitingCard.current) {
                event.preventDefault();
                waitingCard.current.cancel();
                return;
              }
            }
            if (!composing && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
              const step = stepHistory(sent, history, event.key === 'ArrowUp' ? 'up' : 'down', input, event.currentTarget.selectionStart);
              if (step) {
                event.preventDefault();
                setInput(step.value);
                setHistory(step.state);
                // The caret goes to the end after React has put the text in.
                const target = event.currentTarget;
                requestAnimationFrame(() => target.setSelectionRange(step.value.length, step.value.length));
              }
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              // Nothing typed and a 실행 확인 card waiting: Enter answers it (실행).
              if (!run && !input.trim() && !images.length && waitingCard.current) return waitingCard.current.start();
              if (!ready && !run) {
                setShowModelHint(true);
                return;
              }
              send();
            }
          }}
          placeholder={run ? '@로 실행할 대상을 고르세요' : cardWaiting ? `${keyLabel('Enter')}로 실행 · ${keyLabel('Esc')}로 취소 (또는 메시지)` : ready ? '메시지' : '모델을 먼저 고르세요'}
        />
      </Box>
      {!ready && (input.trim() || showModelHint) && (
        <Text as="p" paddingX="tight" variant="caption" tone="muted">
          아래에서 AI 연결과 모델을 고르세요.{' '}
          <Text asChild underline><Link to="/p/$projectId/settings/connections" params={{ projectId }}>AI 연결 추가</Link></Text>
        </Text>
      )}
      <Inline gap="condensed">
        <Box minWidth={0} grow>
          <ModelPicker compact need={['chat']} value={model} onChange={(next) => void onModel(next)} />
        </Box>
        <PermissionModePicker compact value={mode} onChange={onMode} />
        <Inline marginLeft="auto" gap="tight">
          <ContextMeter usage={usage} />
          {(busy || elsewhere) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="secondary" aria-label="중지" aria-keyshortcuts="Escape" onClick={onStop}>
                  <Icon icon={Square} size="xs" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>중지 ({keyLabel('Esc')})</TooltipContent>
            </Tooltip>
          )}
          {/* While the reply runs, a message goes in at its next step instead of waiting for it to end. */}
          <Button size="icon" aria-label={run ? '실행 확인' : busy || elsewhere ? '진행 중인 답에 끼워 보내기' : '보내기'} disabled={run ? false : (!input.trim() && !imageSupport.send) || !ready} onClick={send}>
            <ArrowUp />
          </Button>
        </Inline>
      </Inline>
    </Box>
  );
}
