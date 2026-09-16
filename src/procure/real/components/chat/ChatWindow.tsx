import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowLeft, Send, Check, CheckCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { ChatContact, ChatMessage } from '@/hooks/useChat';

interface ChatWindowProps {
  contact: ChatContact;
  messages: ChatMessage[];
  loading: boolean;
  currentUserId: string;
  typingUserName: string | null;
  threadId: string | null;
  onSend: (body: string) => void;
  onBack: () => void;
  onTypingInput: (value: string) => void;
  getSeenTimestamp: (threadId: string) => Promise<string | null>;
}

const roleColors: Record<string, string> = {
  admin: 'bg-destructive/15 text-destructive border-destructive/20',
  manager: 'bg-primary/15 text-primary border-primary/20',
  purchasing: 'bg-accent/15 text-accent-foreground border-accent/20',
  pending: 'bg-muted text-muted-foreground border-border',
};

function formatRole(r?: string) {
  if (!r) return 'User';
  return r.charAt(0).toUpperCase() + r.slice(1);
}

export function ChatWindow({
  contact, messages, loading, currentUserId, typingUserName,
  threadId, onSend, onBack, onTypingInput, getSeenTimestamp,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const userScrolledUp = useRef(false);

  // Auto scroll
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, []);

  // Scroll on messages change
  useEffect(() => {
    if (!userScrolledUp.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  // Scroll on open
  useEffect(() => {
    scrollToBottom();
    userScrolledUp.current = false;
  }, [contact.id, scrollToBottom]);

  // Detect manual scroll up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    userScrolledUp.current = !atBottom;
  }, []);

  // Focus input on contact change
  useEffect(() => { inputRef.current?.focus(); }, [contact.id]);

  // Load seen state
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    getSeenTimestamp(threadId).then(ts => { if (!cancelled) setSeenAt(ts); });
    return () => { cancelled = true; };
  }, [threadId, messages, getSeenTimestamp]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    onTypingInput(e.target.value);
  };

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input);
    setInput('');
    userScrolledUp.current = false;
    scrollToBottom();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // Determine if a sent message has been seen
  const isMessageSeen = (msg: ChatMessage) => {
    if (msg.sender_id !== currentUserId || !seenAt) return false;
    return new Date(msg.created_at) <= new Date(seenAt);
  };

  // Find last sent message for "seen" display
  const lastSentIdx = messages.reduceRight((acc, m, i) => acc === -1 && m.sender_id === currentUserId ? i : acc, -1);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
        <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="relative">
          <Avatar className="h-8 w-8">
            {contact.avatar_url && <AvatarImage src={contact.avatar_url} alt={contact.full_name} />}
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{getInitials(contact.full_name)}</AvatarFallback>
          </Avatar>
          <span className={cn('absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card', contact.is_online ? 'bg-green-500' : 'bg-muted-foreground/40')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate text-foreground">{contact.full_name}</span>
            <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 h-4 font-medium', roleColors[contact.role] || roleColors.pending)}>
              {formatRole(contact.role)}
            </Badge>
          </div>
          <div className="text-[11px] text-muted-foreground">{contact.is_online ? 'Online' : 'Offline'}</div>
        </div>
      </div>

      {/* Messages */}
      {loading ? (
        <div className="flex-1 p-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
              <Skeleton className="h-10 w-48 rounded-xl" />
            </div>
          ))}
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">No messages yet. Start the conversation. 👋</p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isMine = msg.sender_id === currentUserId;
              const seen = isMine && isMessageSeen(msg);
              const showSeenLabel = isMine && idx === lastSentIdx && seen;
              return (
                <div key={msg.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[75%] rounded-2xl px-3 py-2 text-sm', isMine ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-muted text-foreground rounded-bl-md')}>
                    <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                    <div className={cn('flex items-center gap-1 mt-0.5', isMine ? 'justify-end' : '')}>
                      <span className={cn('text-[10px]', isMine ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
                        {format(new Date(msg.created_at), 'HH:mm')}
                      </span>
                      {isMine && (
                        seen
                          ? <CheckCheck className="h-3 w-3 text-primary-foreground/70" />
                          : <Check className="h-3 w-3 text-primary-foreground/40" />
                      )}
                    </div>
                    {showSeenLabel && (
                      <p className="text-[9px] text-primary-foreground/50 text-right">Seen</p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Typing indicator */}
      {typingUserName && (
        <div className="px-3 pb-1">
          <p className="text-xs text-muted-foreground italic animate-pulse">
            {typingUserName} is typing<span className="tracking-widest">...</span>
          </p>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            placeholder="Type a message..."
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-muted/50 border-0 h-9 text-sm"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
              input.trim() ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
