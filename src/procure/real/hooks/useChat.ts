import { useState, useEffect, useCallback, useRef } from 'react';
import { externalSupabase as supabase } from '@/integrations/supabase/externalClient';
import { useAuth } from '@/contexts/AuthContext';

export interface ChatContact {
  id: string;
  full_name: string;
  email: string;
  role: string;
  avatar_url?: string | null;
  is_online: boolean;
  last_seen: string | null;
  unread_count: number;
  thread_id: string | null;
  last_message?: string;
  last_message_at?: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

// Notification sound using Web Audio API
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio not available
  }
}

export function useChat() {
  const { profile } = useAuth();
  const currentUserId = profile?.id;
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeContact, setActiveContact] = useState<ChatContact | null>(null);
  const [totalUnread, setTotalUnread] = useState(0);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sendTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoadRef = useRef(true);
  const activeThreadIdRef = useRef<string | null>(null);

  // Keep ref in sync
  useEffect(() => { activeThreadIdRef.current = activeThreadId; }, [activeThreadId]);

  // ── Presence heartbeat ──
  useEffect(() => {
    if (!currentUserId) return;
    const upsertPresence = async (online: boolean) => {
      try {
        await supabase.from('user_presence').upsert(
          { user_id: currentUserId, is_online: online, last_seen: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      } catch {}
    };
    upsertPresence(true);
    const interval = setInterval(() => upsertPresence(true), 30_000);
    const onVis = () => upsertPresence(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    const onUnload = () => upsertPresence(false);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onUnload);
      upsertPresence(false);
    };
  }, [currentUserId]);

  // ── Load contacts (no loading skeleton on refresh) ──
  const loadContacts = useCallback(async () => {
    if (!currentUserId) { setLoadingContacts(false); return; }
    if (isInitialLoadRef.current) {
      setLoadingContacts(true);
    }
    try {
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, avatar_url')
        .neq('id', currentUserId);
      if (pErr) { setLoadingContacts(false); return; }

      // Presence
      let presenceMap = new Map<string, { is_online: boolean; last_seen: string }>();
      try {
        const { data } = await supabase.from('user_presence').select('user_id, is_online, last_seen');
        presenceMap = new Map((data || []).map((p: any) => [p.user_id, p]));
      } catch (e) { }

      // Thread resolution: find threads current user participates in
      const threadMap = new Map<string, string>(); // otherUserId -> threadId
      try {
        const { data: myParts } = await supabase
          .from('chat_participants')
          .select('thread_id')
          .eq('user_id', currentUserId);
        if (myParts?.length) {
          const tIds = myParts.map((p: any) => p.thread_id);
          const { data: others } = await supabase
            .from('chat_participants')
            .select('thread_id, user_id')
            .in('thread_id', tIds)
            .neq('user_id', currentUserId);
          for (const o of others || []) {
            threadMap.set(o.user_id, o.thread_id);
          }
        }
      } catch (e) { }

      // Batch fetch unread counts and last messages for all threads at once
      // instead of N×2 sequential queries (one pair per contact).
      const allThreadIds = [...new Set(threadMap.values())];
      const unreadCountMap = new Map<string, number>();
      const lastMsgMap = new Map<string, { body: string; created_at: string }>();

      if (allThreadIds.length > 0) {
        try {
          const { data: unreadRows } = await supabase
            .from('chat_messages')
            .select('thread_id')
            .in('thread_id', allThreadIds)
            .neq('sender_id', currentUserId)
            .is('read_at', null);
          for (const row of unreadRows || []) {
            unreadCountMap.set(row.thread_id, (unreadCountMap.get(row.thread_id) || 0) + 1);
          }
        } catch (e) { }

        try {
          const limit = Math.max(50, allThreadIds.length * 5);
          const { data: recentMsgs } = await supabase
            .from('chat_messages')
            .select('thread_id, body, created_at')
            .in('thread_id', allThreadIds)
            .order('created_at', { ascending: false })
            .limit(limit);
          for (const msg of recentMsgs || []) {
            if (!lastMsgMap.has(msg.thread_id)) {
              lastMsgMap.set(msg.thread_id, { body: msg.body, created_at: msg.created_at });
            }
          }
        } catch (e) { }
      }

      const contactList: ChatContact[] = [];
      for (const p of profiles || []) {
        const pres = presenceMap.get(p.id);
        const threadId = threadMap.get(p.id) || null;
        const lastMsg = threadId ? lastMsgMap.get(threadId) : undefined;

        contactList.push({
          id: p.id,
          full_name: p.full_name || p.email || 'Unknown',
          email: p.email || '',
          role: p.role || 'pending',
          avatar_url: p.avatar_url || null,
          is_online: !!pres?.is_online,
          last_seen: pres?.last_seen || null,
          unread_count: threadId ? (unreadCountMap.get(threadId) || 0) : 0,
          thread_id: threadId,
          last_message: lastMsg?.body,
          last_message_at: lastMsg?.created_at,
        });
      }

      setContacts(contactList);
      setTotalUnread(contactList.reduce((s, c) => s + c.unread_count, 0));
    } catch (err) {
    } finally {
      setLoadingContacts(false);
      isInitialLoadRef.current = false;
    }
  }, [currentUserId]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // ── Realtime: presence changes (debounced, no skeleton) ──
  useEffect(() => {
    if (!currentUserId) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase
      .channel('chat-presence-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => loadContacts(), 500);
      })
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(ch);
    };
  }, [currentUserId, loadContacts]);

  // ── Manual thread find/create ──
  async function findOrCreateThread(userId: string, otherUserId: string): Promise<string | null> {
    try {
      const { data: myThreads } = await supabase
        .from('chat_participants').select('thread_id').eq('user_id', userId);
      if (myThreads?.length) {
        const ids = myThreads.map(t => t.thread_id);
        const { data: shared } = await supabase
          .from('chat_participants').select('thread_id').eq('user_id', otherUserId).in('thread_id', ids);
        if (shared?.length) return shared[0].thread_id;
      }
      const { data: newThread, error } = await supabase
        .from('chat_threads')
        .insert({ created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .select('id').single();
      if (error || !newThread) return null;
      await supabase.from('chat_participants').insert([
        { thread_id: newThread.id, user_id: userId },
        { thread_id: newThread.id, user_id: otherUserId },
      ]);
      return newThread.id;
    } catch { return null; }
  }

  // ── Open chat ──
  const openChat = useCallback(async (contact: ChatContact) => {
    if (!currentUserId) return;
    setActiveContact(contact);
    setLoadingMessages(true);
    setTypingUser(null);

    let threadId = contact.thread_id;
    if (!threadId) {
      try {
        const { data, error } = await supabase.rpc('get_or_create_direct_thread', { other_user_id: contact.id });
        if (error) { threadId = await findOrCreateThread(currentUserId, contact.id); }
        else threadId = data as string;
      } catch { threadId = await findOrCreateThread(currentUserId, contact.id); }
      if (!threadId) { setLoadingMessages(false); return; }
      setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, thread_id: threadId } : c));
      setActiveContact(prev => prev ? { ...prev, thread_id: threadId } : null);
    }

    setActiveThreadId(threadId);

    const { data: msgs } = await supabase
      .from('chat_messages').select('*').eq('thread_id', threadId).order('created_at', { ascending: true });
    setMessages(msgs || []);
    setLoadingMessages(false);

    // Mark unread messages as read (set read_at on chat_messages)
    try {
      await supabase
        .from('chat_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .neq('sender_id', currentUserId)
        .is('read_at', null);
    } catch (e) { }

    setContacts(prev => {
      const updated = prev.map(c => c.thread_id === threadId ? { ...c, unread_count: 0 } : c);
      setTotalUnread(updated.reduce((s, c) => s + c.unread_count, 0));
      return updated;
    });
  }, [currentUserId]);

  // ── Send message ──
  const sendMessage = useCallback(async (text: string) => {
    if (!currentUserId || !activeThreadId || !text.trim()) return;
    broadcastTyping(false);
    const { error } = await supabase.from('chat_messages').insert({
      thread_id: activeThreadId,
      sender_id: currentUserId,
      body: text.trim(),
      message_type: 'text',
    });
  }, [currentUserId, activeThreadId]);

  // ── Typing channel management ──
  useEffect(() => {
    if (!activeThreadId || !currentUserId) {
      if (typingChannelRef.current) {
        supabase.removeChannel(typingChannelRef.current);
        typingChannelRef.current = null;
      }
      setTypingUser(null);
      return;
    }

    const ch = supabase.channel(`typing-${activeThreadId}`, {
      config: { presence: { key: currentUserId } },
    });

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState();
      let typer: string | null = null;
      for (const key of Object.keys(state)) {
        if (key !== currentUserId) {
          const entries = state[key] as any[];
          if (entries?.some(e => e.is_typing)) {
            typer = key;
            break;
          }
        }
      }
      setTypingUser(typer);
    });

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ is_typing: false });
      }
    });

    typingChannelRef.current = ch;

    return () => {
      supabase.removeChannel(ch);
      typingChannelRef.current = null;
      setTypingUser(null);
    };
  }, [activeThreadId, currentUserId]);

  // ── Broadcast typing state ──
  const broadcastTyping = useCallback((isTyping: boolean) => {
    typingChannelRef.current?.track({ is_typing: isTyping });
  }, []);

  // ── Handle input change (typing indicator) ──
  const handleTypingInput = useCallback((value: string) => {
    if (value.trim()) {
      broadcastTyping(true);
      if (sendTypingTimeoutRef.current) clearTimeout(sendTypingTimeoutRef.current);
      sendTypingTimeoutRef.current = setTimeout(() => broadcastTyping(false), 3000);
    } else {
      broadcastTyping(false);
      if (sendTypingTimeoutRef.current) clearTimeout(sendTypingTimeoutRef.current);
    }
  }, [broadcastTyping]);

  // ── Realtime: messages in active thread ──
  useEffect(() => {
    if (!activeThreadId) return;
    const ch = supabase
      .channel(`chat-thread-${activeThreadId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `thread_id=eq.${activeThreadId}`,
      }, (payload) => {
        const newMsg = payload.new as ChatMessage;
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        if (newMsg.sender_id !== currentUserId) {
          playNotificationSound();
          // Mark incoming message as read since thread is open
          supabase.from('chat_messages')
            .update({ read_at: new Date().toISOString() })
            .eq('id', newMsg.id)
            .is('read_at', null)
            .then();
        }
        // Refresh contacts to update last_message / unread for other threads
        loadContacts();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeThreadId, currentUserId, loadContacts]);

  // ── Realtime: global new-message notifications ──
  useEffect(() => {
    if (!currentUserId) return;
    const ch = supabase
      .channel('chat-global-notify')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
      }, (payload) => {
        const msg = payload.new as ChatMessage;
        if (msg.sender_id !== currentUserId && msg.thread_id !== activeThreadIdRef.current) {
          playNotificationSound();
          loadContacts();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [currentUserId, loadContacts]);

  // ── Get seen timestamp: find the latest read_at on messages sent by current user ──
  const getSeenTimestamp = useCallback(async (threadId: string): Promise<string | null> => {
    if (!currentUserId || !threadId) return null;
    try {
      const { data } = await supabase
        .from('chat_messages')
        .select('read_at')
        .eq('thread_id', threadId)
        .eq('sender_id', currentUserId)
        .not('read_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      return (data as any)?.read_at || null;
    } catch { return null; }
  }, [currentUserId]);

  const closeChat = useCallback(() => {
    broadcastTyping(false);
    setActiveThreadId(null);
    setActiveContact(null);
    setMessages([]);
    setTypingUser(null);
    loadContacts(); // Refresh on close to pick up any changes
  }, [broadcastTyping, loadContacts]);

  // ── Resolve typing user name ──
  const typingUserName = contacts.find(c => c.id === typingUser)?.full_name || null;

  return {
    contacts,
    messages,
    activeThreadId,
    activeContact,
    totalUnread,
    loadingContacts,
    loadingMessages,
    typingUserName,
    openChat,
    closeChat,
    sendMessage,
    handleTypingInput,
    getSeenTimestamp,
    loadContacts,
    currentUserId,
  };
}
