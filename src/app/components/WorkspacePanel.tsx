import { useEffect, useState, useRef } from "react";
import { Agent } from "../App";
import type { DeliveryBehavior } from "../lib/api";
import type { AgentCommandAttachment, ApprovalDecision } from "../lib/agentSocket";
import type { PendingApproval } from "../hooks/useAgents";
import {
  Terminal,
  Activity,
  GitBranch,
  Send,
  PlayCircle,
  PauseCircle,
  RotateCcw,
  XCircle,
  DollarSign,
  Zap,
  TrendingUp,
  Database,
  Clock,
  AlertCircle,
  Mic,
  Paperclip,
  Image as ImageIcon,
  X,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Wrench,
  User,
  Sparkles,
  History,
  Copy,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";

interface WorkspacePanelProps {
  agent: Agent;
  onBack: () => void;
  onSendCommand: (
    agentId: string,
    command: string,
    attachments?: AgentCommandAttachment[],
    delivery?: DeliveryBehavior,
  ) => string[] | Promise<string[]>;
  onStartAgent?: (agentId: string) => void;
  onPauseAgent?: (agentId: string) => void;
  onRestartAgent?: (agentId: string) => void;
  onStopAgent?: (agentId: string) => void;
  onAbortAgent?: (agentId: string) => void;
  allAgents?: Agent[];
  pendingApprovals?: PendingApproval[];
  onRespondToApproval?: (
    agentId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ) => void;
  onTranscribeAudio?: (audio: Blob) => Promise<string>;
}

const AUDIO_MIME_PREFERENCES = [
  "audio/wav",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm;codecs=opus",
];
const MAX_ATTACHMENT_BYTES = 262_144;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([".txt", ".json", ".log", ".md", ".csv", ".tsv"]);

async function readAttachment(file: File): Promise<AgentCommandAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB`);
  }
  const mimeType = file.type || "application/octet-stream";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isText =
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    TEXT_ATTACHMENT_EXTENSIONS.has(file.name.slice(file.name.lastIndexOf(".")).toLowerCase());

  if (isText) {
    return {
      name: file.name,
      size: file.size,
      mimeType,
      encoding: "text",
      content: new TextDecoder().decode(bytes),
    };
  }

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    name: file.name,
    size: file.size,
    mimeType,
    encoding: "base64",
    content: btoa(binary),
  };
}

export function chooseAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return undefined;
  }
  return AUDIO_MIME_PREFERENCES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );
}

export function WorkspacePanel({
  agent,
  onBack,
  onSendCommand,
  onStartAgent,
  onPauseAgent,
  onRestartAgent,
  onStopAgent,
  onAbortAgent,
  allAgents = [],
  pendingApprovals = [],
  onRespondToApproval,
  onTranscribeAudio,
}: WorkspacePanelProps) {
  const [command, setCommand] = useState("");
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    "$ Connection established",
  ]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [delivery, setDelivery] = useState<DeliveryBehavior>("auto");
  const [logsCollapsed, setLogsCollapsed] = useState(true);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);
  const activeAgentRef = useRef(agent.id);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const scrollToLatest = (behavior: ScrollBehavior = "auto") => {
    const element = chatScrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    autoFollowRef.current = true;
    setShowJumpToLatest(false);
  };

  useEffect(() => {
    if (activeAgentRef.current !== agent.id) {
      activeAgentRef.current = agent.id;
      autoFollowRef.current = true;
    }
    const frame = requestAnimationFrame(() => {
      if (autoFollowRef.current) scrollToLatest();
      else setShowJumpToLatest(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [agent.id, agent.messages]);

  const SLASH_COMMANDS = [
    { name: "/clear", hint: "Clear local logs panel", description: "Clears the collapsible logs view (does not delete server history)." },
    { name: "/resume", hint: "/resume <sessionId>", description: "Ask the runtime to resume a previous CLI session id." },
    { name: "/model", hint: "/model <name>", description: "Switch the model used by the agent for the next turn." },
    { name: "/dir", hint: "/dir <path>", description: "Change the working directory the runtime operates in." },
    { name: "/new-session", hint: "Clear saved session id", description: "Start a fresh runtime session on the next start/restart." },
  ] as const;

  const paletteSuggestions = command.startsWith("/")
    ? SLASH_COMMANDS.filter((c) => c.name.startsWith(command.split(" ")[0]))
    : [];
  const paletteOpen = paletteSuggestions.length > 0;

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const handleSendCommand = async (commandOverride?: string) => {
    const commandText = commandOverride ?? command;
    if (!commandText.trim() && attachedFiles.length === 0) return;

    // /clear is a local-only slash command: wipes the logs panel without
    // touching the server-side message history.
    if (commandText.trim() === "/clear") {
      setTerminalHistory(["$ logs cleared"]);
      setCommand("");
      return;
    }

    const fileInfo = attachedFiles.length > 0
      ? ` [${attachedFiles.length} file(s) attached]`
      : '';
    let attachments: AgentCommandAttachment[];
    try {
      attachments = await Promise.all(attachedFiles.map(readAttachment));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTerminalHistory((currentHistory) => [
        ...currentHistory,
        `$ ${commandText || "attachments"}${fileInfo}`,
        `> Attachment error: ${message}`,
      ]);
      return;
    }
    const responseLines = await onSendCommand(agent.id, commandText, attachments, delivery);

    setTerminalHistory((currentHistory) => [
      ...currentHistory,
      `$ ${commandText || "attachments"}${fileInfo}`,
      ...(responseLines.length > 0
        ? responseLines
        : [`> Command sent to ${agent.name}`]),
    ]);
    setCommand("");
    setAttachedFiles([]);
  };

  const handleQuickAction = (action: string) => {
    if (action === "start" && onStartAgent) {
      onStartAgent(agent.id);
      setTerminalHistory((currentHistory) => [
        ...currentHistory,
        "$ start",
        `> Starting ${agent.name}`,
      ]);
      return;
    }

    if (action === "stop" && onStopAgent) {
      onStopAgent(agent.id);
      setTerminalHistory((currentHistory) => [
        ...currentHistory,
        "$ stop",
        `> Stopping ${agent.name}`,
      ]);
      return;
    }

    if (action === "pause" && onPauseAgent) {
      onPauseAgent(agent.id);
      setTerminalHistory((currentHistory) => [
        ...currentHistory,
        "$ pause",
        `> Pausing ${agent.name}`,
      ]);
      return;
    }

    if (action === "restart" && onRestartAgent) {
      onRestartAgent(agent.id);
      setTerminalHistory((currentHistory) => [
        ...currentHistory,
        "$ restart",
        `> Restarting ${agent.name}`,
      ]);
      return;
    }

    if (action === "abort" && onAbortAgent) {
      onAbortAgent(agent.id);
      setTerminalHistory((currentHistory) => [
        ...currentHistory,
        "$ abort",
        `> Aborting ${agent.name}`,
      ]);
      return;
    }

    handleSendCommand(action);
  };

  const stopVoiceTracks = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const transcribeRecording = async (recorder: MediaRecorder) => {
    setIsRecording(false);
    stopVoiceTracks();

    const blob = new Blob(audioChunksRef.current, {
      type: recorder.mimeType || chooseAudioMimeType() || "audio/webm",
    });
    audioChunksRef.current = [];
    mediaRecorderRef.current = null;

    if (!onTranscribeAudio) {
      setVoiceStatus("Voice transcription is unavailable without a server connection.");
      return;
    }
    if (blob.size === 0) {
      setVoiceStatus("No voice audio was captured.");
      return;
    }

    setIsTranscribing(true);
    setVoiceStatus("Transcribing voice input...");
    setTerminalHistory((currentHistory) => [
      ...currentHistory,
      "> Transcribing voice input on the server...",
    ]);
    try {
      const text = (await onTranscribeAudio(blob)).trim();
      if (!text) {
        setVoiceStatus("No speech was detected.");
        return;
      }
      setCommand((currentCommand) =>
        currentCommand.trim() ? `${currentCommand.trim()} ${text}` : text,
      );
      setVoiceStatus("Voice transcript added.");
      setTerminalHistory((currentHistory) => [
        ...currentHistory,
        `> Voice transcript: ${text}`,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceStatus(`Voice transcription failed: ${message}`);
      setTerminalHistory((currentHistory) => [
        ...currentHistory,
        `> Voice transcription failed: ${message}`,
      ]);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleVoiceInput = async () => {
    if (isTranscribing) return;

    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setVoiceStatus("Stopping recording...");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceStatus("Voice input is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = chooseAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        void transcribeRecording(recorder);
      };
      recorder.start();
      setIsRecording(true);
      setVoiceStatus("Recording... click the mic again to stop.");
      setTerminalHistory((currentHistory) => [
        ...currentHistory,
        "> Voice recording started",
      ]);
    } catch (error) {
      stopVoiceTracks();
      const message = error instanceof Error ? error.message : String(error);
      setVoiceStatus(`Could not start recording: ${message}`);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachedFiles((currentFiles) => [...currentFiles, ...files]);
    e.target.value = "";
  };

  const handleRemoveFile = (index: number) => {
    setAttachedFiles(attachedFiles.filter((_, i) => i !== index));
  };

  const getStatusColor = (status: Agent["status"]) => {
    switch (status) {
      case "running":
        return "bg-status-running";
      case "busy":
        return "bg-status-busy";
      case "paused":
        return "bg-status-paused";
      case "error":
        return "bg-status-error";
      case "idle":
        return "bg-status-idle";
      default:
        return "bg-status-stopped";
    }
  };

  const quickActions = agent.controlMode === "attached"
    ? agent.capabilities?.abort === false
      ? []
      : [{ icon: XCircle, label: "Abort", cmd: "abort" }]
    : [
        { icon: PlayCircle, label: "Start", cmd: "start" },
        { icon: PauseCircle, label: "Pause", cmd: "pause" },
        { icon: RotateCcw, label: "Restart", cmd: "restart" },
        { icon: XCircle, label: "Stop", cmd: "stop" },
      ];

  const totalTokens = agent.tokenUsage.input + agent.tokenUsage.output;
  const totalCacheTokens = agent.tokenUsage.cacheRead + agent.tokenUsage.cacheCreation;
  const apiSuccessRate =
    agent.apiCalls.total > 0
      ? (agent.apiCalls.success / agent.apiCalls.total) * 100
      : 0;

  return (
    <div className="size-full flex flex-col lg:flex-row bg-background overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Agent Header */}
        <div className="border-b border-border bg-card p-3 lg:p-4">
          <div className="flex items-center justify-between mb-3 lg:mb-4">
            <div className="flex items-center gap-2 lg:gap-3">
              <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)}`} />
              <span className="text-card-foreground text-sm lg:text-base">{agent.name}</span>
              {agent.branch && (
                <>
                  <div className="w-px h-4 bg-border hidden lg:block" />
                  <div className="flex items-center gap-1.5 text-muted-foreground hidden lg:flex">
                    <GitBranch className="w-3.5 h-3.5" />
                    <span className="text-sm">{agent.branch}</span>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setSessionDrawerOpen(true)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs lg:text-sm text-muted-foreground hover:text-card-foreground hover:bg-accent/40 rounded transition-colors border border-transparent hover:border-border"
                title="Sessions"
              >
                <History className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Sessions</span>
              </button>
              <span className="text-muted-foreground text-xs lg:text-sm">{agent.model}</span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2 overflow-x-auto">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.cmd}
                  onClick={() => handleQuickAction(action.cmd)}
                  className="flex items-center gap-2 px-2 lg:px-3 py-1.5 bg-secondary hover:bg-accent rounded-md transition-colors text-secondary-foreground border border-border whitespace-nowrap"
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Model Metrics - Compact version */}
        <div className="border-b border-border bg-background px-3 py-2 lg:px-4 lg:py-2">
          {/* Mobile: 2 rows, Desktop: 1 row */}
          <div className="flex flex-wrap lg:flex-nowrap items-center gap-x-3 gap-y-1.5 lg:gap-4">
            {/* Tokens */}
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Tokens:</span>
              <span className="text-sm text-card-foreground">{formatNumber(totalTokens)}</span>
            </div>

            <div className="hidden lg:block w-px h-4 bg-border" />

            {/* Cache */}
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Cache:</span>
              <span className="text-sm text-success">{agent.cacheHitRate}%</span>
            </div>

            <div className="hidden lg:block w-px h-4 bg-border" />

            {/* Cost */}
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Cost:</span>
              <span className="text-sm text-card-foreground">${agent.costUSD.toFixed(2)}</span>
            </div>

            <div className="hidden lg:block w-px h-4 bg-border" />

            {/* API */}
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">API:</span>
              <span className="text-sm text-card-foreground">{agent.apiCalls.total}</span>
              <span className="text-xs text-success">
                ({apiSuccessRate.toFixed(0)}%)
              </span>
            </div>

            <div className="hidden lg:block w-px h-4 bg-border" />

            {/* Context */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Context:</span>
              <span className="text-sm text-card-foreground">{agent.contextUsage}%</span>
              <div className="w-12 lg:w-16 bg-secondary rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    agent.contextUsage >= 95
                      ? "bg-status-error"
                      : agent.contextUsage >= 80
                      ? "bg-status-idle"
                      : "bg-primary"
                  }`}
                  style={{ width: `${agent.contextUsage}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Chat Stream + collapsible Logs */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="h-10 border-b border-border bg-card flex items-center px-3 gap-2 text-muted-foreground">
            <MessageSquare className="w-4 h-4" />
            <span className="text-sm">Chat</span>
            <span className="text-xs text-muted-foreground/70 ml-2">
              {agent.messages?.length ?? 0} messages
            </span>
          </div>

          <div className="relative flex-1 min-h-0">
            <div
              ref={chatScrollRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                const distanceFromBottom =
                  element.scrollHeight - element.scrollTop - element.clientHeight;
                const following = distanceFromBottom < 80;
                autoFollowRef.current = following;
                if (following) setShowJumpToLatest(false);
              }}
              className="h-full bg-background overflow-y-auto p-3 lg:p-4 space-y-3"
            >
            {(!agent.messages || agent.messages.length === 0) ? (
              <div className="text-muted-foreground text-sm italic">
                No messages yet. Send a command below to start a conversation.
              </div>
            ) : (
              agent.messages.map((msg) => {
                const isUser = msg.role === "user";
                const isAssistant = msg.role === "assistant";
                const isSystem = msg.role === "system";
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    {!isUser && (
                      <div className="shrink-0 w-7 h-7 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground">
                        {isAssistant ? (
                          <Sparkles className="w-3.5 h-3.5" />
                        ) : (
                          <Terminal className="w-3.5 h-3.5" />
                        )}
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                        isUser
                          ? "bg-primary text-primary-foreground border-primary/30"
                          : isSystem
                          ? "bg-secondary/60 text-muted-foreground border-border italic"
                          : "bg-card text-card-foreground border-border"
                      }`}
                    >
                      <div>
                        {msg.content}
                        {msg.streaming && (
                          <span className="inline-block w-2 h-4 ml-0.5 bg-current align-middle animate-pulse" />
                        )}
                      </div>
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {msg.toolCalls.map((tc) => (
                            <div
                              key={tc.id}
                              className="rounded border border-border bg-background/60 text-xs"
                            >
                              <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border">
                                <Wrench className="w-3 h-3 text-muted-foreground" />
                                <span className="text-card-foreground font-mono">
                                  {tc.name}
                                </span>
                                <span
                                  className={`ml-auto px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${
                                    tc.status === "success"
                                      ? "bg-success/15 text-success"
                                      : tc.status === "error"
                                      ? "bg-destructive/15 text-destructive"
                                      : "bg-status-idle/15 text-status-idle"
                                  }`}
                                >
                                  {tc.status}
                                </span>
                              </div>
                              {tc.input && (
                                <pre className="px-2 py-1 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-words border-b border-border/60">
                                  {tc.input}
                                </pre>
                              )}
                              {tc.output && (
                                <pre className="px-2 py-1 font-mono text-[11px] text-card-foreground whitespace-pre-wrap break-words">
                                  {tc.output}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {isUser && (
                      <div className="shrink-0 w-7 h-7 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
                        <User className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </div>
                );
              })
              )}
            </div>
            {showJumpToLatest && (
              <button
                type="button"
                onClick={() => scrollToLatest("smooth")}
                className="absolute bottom-3 right-4 z-10 rounded-full border border-border bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg hover:opacity-90"
              >
                Jump to latest
              </button>
            )}
          </div>

          {/* Collapsible Logs */}
          <div className="border-t border-border bg-card">
            <button
              onClick={() => setLogsCollapsed((v) => !v)}
              className="w-full h-9 flex items-center px-3 gap-2 text-muted-foreground hover:bg-accent/40 transition-colors"
            >
              {logsCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              <Terminal className="w-4 h-4" />
              <span className="text-sm">Logs</span>
              <span className="text-xs text-muted-foreground/70 ml-2">
                {agent.logs.length + terminalHistory.length} lines
              </span>
            </button>
            {!logsCollapsed && (
              <div className="max-h-48 bg-background text-success p-3 overflow-y-auto font-mono text-xs border-t border-border">
                {agent.logs.map((log, idx) => (
                  <div key={idx} className="mb-1">
                    {log}
                  </div>
                ))}
                {terminalHistory.map((line, idx) => (
                  <div key={`history-${idx}`} className="mb-1">
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Approvals */}
          {pendingApprovals.length > 0 && (
            <div className="border-t border-border bg-card px-3 py-2 space-y-2">
              {pendingApprovals.map((approval) => (
                <div
                  key={approval.approvalId}
                  className="flex items-start gap-2.5 rounded-md border border-status-idle/40 bg-status-idle/10 px-3 py-2"
                >
                  <ShieldAlert className="w-4 h-4 text-status-idle shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Approval required · {approval.kind}
                    </div>
                    <div className="text-sm text-card-foreground break-words">
                      {approval.summary}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() =>
                        onRespondToApproval?.(agent.id, approval.approvalId, "allow")
                      }
                      className="px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity"
                    >
                      Allow
                    </button>
                    <button
                      onClick={() =>
                        onRespondToApproval?.(agent.id, approval.approvalId, "deny")
                      }
                      className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground border border-border rounded hover:bg-accent transition-colors"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Command Input */}
          <div className="border-t border-border bg-card p-3 relative">
            {/* Slash Command Palette */}
            {paletteOpen && !isRecording && (
              <div className="absolute left-3 right-3 bottom-[calc(100%-0.25rem)] mb-2 z-10 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border bg-card">
                 Slash commands · Tab to complete · Enter to send
                </div>
                {paletteSuggestions.map((sc, idx) => (
                  <button
                    key={sc.name}
                    onMouseEnter={() => setPaletteIndex(idx)}
                    onClick={() => {
                      setCommand(sc.name + " ");
                      setPaletteIndex(0);
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                      idx === paletteIndex
                        ? "bg-accent text-accent-foreground"
                        : "bg-popover text-popover-foreground hover:bg-accent/40"
                    }`}
                  >
                    <span className="font-mono text-sm shrink-0">{sc.hint}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {sc.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {/* Attached Files Preview */}
            {attachedFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-2 py-1 bg-secondary rounded-md border border-border"
                  >
                    {file.type.startsWith('image/') ? (
                      <ImageIcon className="w-3 h-3 text-muted-foreground" />
                    ) : (
                      <Paperclip className="w-3 h-3 text-muted-foreground" />
                    )}
                    <span className="text-xs text-card-foreground truncate max-w-[120px]">
                      {file.name}
                    </span>
                    <button
                      onClick={() => handleRemoveFile(index)}
                      className="p-0.5 hover:bg-accent rounded transition-colors"
                    >
                      <X className="w-3 h-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {voiceStatus && (
              <div className="mb-2 text-xs text-muted-foreground">
                {voiceStatus}
              </div>
            )}

            {/* Input Row */}
            <div className="flex gap-2">
              {/* File Upload */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.json,.log"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2 bg-secondary hover:bg-accent rounded-md transition-colors border border-border text-muted-foreground"
                title="Attach file"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Voice Input */}
              <button
                onClick={handleVoiceInput}
                disabled={isTranscribing}
                className={`p-2 rounded-md transition-all border ${
                  isRecording
                    ? "bg-status-error text-white border-status-error animate-pulse"
                    : isTranscribing
                    ? "bg-status-idle text-white border-status-idle animate-pulse"
                    : "bg-secondary hover:bg-accent border-border text-muted-foreground"
                } disabled:opacity-70 disabled:cursor-not-allowed`}
                title={
                  isTranscribing
                    ? "Transcribing voice input"
                    : isRecording
                    ? "Stop recording"
                    : "Voice input"
                }
              >
                <Mic className="w-4 h-4" />
              </button>

              {agent.controlMode === "attached" &&
                (agent.capabilities?.steer !== false ||
                  agent.capabilities?.followUp !== false) && (
                <select
                  value={delivery}
                  onChange={(event) => setDelivery(event.target.value as DeliveryBehavior)}
                  className="px-2 py-2 bg-input-background text-foreground rounded-md border border-border text-xs"
                  title="Delivery while Pi is busy"
                >
                  <option value="auto">Auto</option>
                  {agent.capabilities?.steer !== false && (
                    <option value="steer">Steer</option>
                  )}
                  {agent.capabilities?.followUp !== false && (
                    <option value="followUp">Follow-up</option>
                  )}
                </select>
              )}

              {/* Text Input */}
              <input
                type="text"
                value={command}
                onChange={(e) => {
                  setCommand(e.target.value);
                  setPaletteIndex(0);
                }}
                onKeyDown={(e) => {
                  if (paletteOpen) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setPaletteIndex((i) => (i + 1) % paletteSuggestions.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setPaletteIndex(
                        (i) => (i - 1 + paletteSuggestions.length) % paletteSuggestions.length,
                      );
                      return;
                    }
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const picked = paletteSuggestions[paletteIndex];
                      if (picked) setCommand(picked.name + " ");
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setCommand("");
                      return;
                    }
                    // Enter without trailing space → autocomplete first.
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !command.includes(" ")
                    ) {
                      e.preventDefault();
                      const picked = paletteSuggestions[paletteIndex];
                      if (picked) setCommand(picked.name + " ");
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendCommand();
                  }
                }}
                placeholder={isRecording ? "Recording..." : "Enter command, / for slash menu..."}
                disabled={isRecording}
                className="flex-1 px-3 py-2 bg-input-background text-foreground rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm disabled:opacity-50 bg-[#000000]"
              />

              {/* Send Button */}
              <button
                onClick={() => handleSendCommand()}
                disabled={!command.trim() && attachedFiles.length === 0}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            {/* Helper Text */}
            <div className="mt-2 text-xs text-muted-foreground">
              {isRecording ? (
                <span className="text-status-error">Recording... Click mic to stop</span>
              ) : (
                <span>Press Enter to send, Shift+Enter for new line</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right: Detailed Stats - Hidden on mobile, shown as sidebar on desktop */}
      <div className="hidden lg:flex lg:w-80 flex-col bg-background overflow-y-auto border-l border-border">
        <div className="h-10 border-b border-border bg-card flex items-center px-3 gap-2 text-muted-foreground">
          <Database className="w-4 h-4" />
          <span>Detailed Stats</span>
        </div>

        <div className="p-4 space-y-4">
          {/* Status */}
          <div>
            <div className="text-muted-foreground mb-2">Status</div>
            <div className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border">
              <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)}`} />
              <span className="capitalize text-card-foreground">{agent.status}</span>
            </div>
          </div>

          {/* Current Task */}
          {agent.currentTask && (
            <div>
              <div className="text-muted-foreground mb-2">Current Task</div>
              <div className="p-3 bg-card rounded-lg border border-border text-card-foreground">
                {agent.currentTask}
              </div>
            </div>
          )}

          {/* Token Breakdown */}
          <div>
            <div className="text-muted-foreground mb-2">Token Breakdown</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Input</span>
                <span className="text-primary">{formatNumber(agent.tokenUsage.input)}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Output</span>
                <span className="text-accent-foreground">{formatNumber(agent.tokenUsage.output)}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Cache Read</span>
                <span className="text-success">{formatNumber(agent.tokenUsage.cacheRead)}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Cache Creation</span>
                <span className="text-muted-foreground">{formatNumber(agent.tokenUsage.cacheCreation)}</span>
              </div>
            </div>
          </div>

          {/* API Stats */}
          <div>
            <div className="text-muted-foreground mb-2">API Statistics</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Success</span>
                <span className="text-success">{agent.apiCalls.success}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Errors</span>
                <span className="text-destructive">{agent.apiCalls.errors}</span>
              </div>
              <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                <span className="text-card-foreground">Success Rate</span>
                <span className="text-card-foreground">
                  {apiSuccessRate.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* General Info */}
          <div>
            <div className="text-muted-foreground mb-2">General Info</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-card rounded-lg border border-border">
                <div className="text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Uptime
                </div>
                <div className="text-card-foreground mt-1">{agent.uptime}</div>
              </div>
              <div className="p-3 bg-card rounded-lg border border-border">
                <div className="text-muted-foreground">Tasks</div>
                <div className="text-card-foreground mt-1">{agent.tasksCompleted}</div>
              </div>
            </div>
          </div>

          {/* Last Active */}
          <div>
            <div className="text-muted-foreground mb-2">Last Active</div>
            <div className="p-3 bg-card rounded-lg border border-border text-card-foreground">
              {agent.lastActive}
            </div>
          </div>

          {/* Error Warning */}
          {agent.status === "error" && (
            <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
              <div className="flex items-center gap-2 text-destructive mb-1">
                <AlertCircle className="w-4 h-4" />
                <span>Agent Error</span>
              </div>
              <div className="text-destructive-foreground">
                {agent.currentTask || "Agent encountered an error"}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Session Drawer */}
      {sessionDrawerOpen && (
        <div className="fixed inset-0 z-30 flex">
          <div
            className="flex-1 bg-black/40"
            onClick={() => setSessionDrawerOpen(false)}
          />
          <div className="w-full sm:w-96 h-full bg-card border-l border-border flex flex-col shadow-xl">
            <div className="h-12 border-b border-border flex items-center justify-between px-3">
              <div className="flex items-center gap-2 text-card-foreground">
                <History className="w-4 h-4" />
                <span className="text-sm">Sessions</span>
              </div>
              <button
                onClick={() => setSessionDrawerOpen(false)}
                className="p-1.5 hover:bg-accent/40 rounded transition-colors text-muted-foreground"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Current
                </div>
                <div className="rounded border border-border bg-background p-3 text-sm space-y-2">
                  <div className="text-card-foreground">{agent.name}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">session id:</span>
                    <code className="text-xs font-mono text-card-foreground truncate flex-1">
                      {agent.sessionId ?? "(none)"}
                    </code>
                    {agent.sessionId && (
                      <button
                        onClick={() => navigator.clipboard?.writeText(agent.sessionId!)}
                        className="p-1 hover:bg-accent/40 rounded text-muted-foreground"
                        title="Copy"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    workspace: <code className="font-mono">{agent.workspacePath}</code>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Other agents in same workspace
                </div>
                {(() => {
                  const peers = allAgents.filter(
                    (a) =>
                      a.id !== agent.id &&
                      !!a.sessionId &&
                      a.workspacePath === agent.workspacePath,
                  );
                  if (peers.length === 0) {
                    return (
                      <div className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground italic">
                        No other agents share this workspace path.
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {peers.map((peer) => (
                        <div
                          key={peer.id}
                          className="rounded border border-border bg-background p-2 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-card-foreground">{peer.name}</span>
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {peer.runtimeKind}
                            </span>
                          </div>
                          <code className="block font-mono text-muted-foreground truncate">
                            {peer.sessionId}
                          </code>
                          <button
                            onClick={() => {
                              if (!peer.sessionId) return;
                              onSendCommand(agent.id, `/resume ${peer.sessionId}`);
                              setSessionDrawerOpen(false);
                            }}
                            className="w-full mt-1 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity"
                          >
                            <ArrowRight className="w-3 h-3" />
                            <span>Resume in this agent</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="text-[10px] text-muted-foreground italic">
                Tip: you can also type <code className="font-mono">/resume &lt;sessionId&gt;</code> directly in the command box.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
