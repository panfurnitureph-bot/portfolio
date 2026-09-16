import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatContactList } from './ChatContactList';
import { ChatWindow } from './ChatWindow';
import { ChatButton } from './ChatButton';
import { useChat } from '@/hooks/useChat';
import { useAuth } from '@/contexts/AuthContext';

function ChatPanelInner() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    contacts, messages, activeContact, activeThreadId, totalUnread,
    loadingContacts, loadingMessages, typingUserName,
    openChat, closeChat, sendMessage, handleTypingInput, getSeenTimestamp, currentUserId,
  } = useChat();

  if (!currentUserId) return null;

  return (
    <>
      <ChatButton totalUnread={totalUnread} isOpen={isOpen} onClick={() => setIsOpen(prev => !prev)} />

      <div className={cn(
        'fixed bottom-24 right-6 z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl transition-all duration-300',
        isOpen ? 'h-[520px] w-[360px] opacity-100 translate-y-0' : 'h-0 w-[360px] opacity-0 translate-y-4 pointer-events-none'
      )}>
        <div className="flex items-center justify-between border-b border-border bg-primary px-4 py-2.5">
          <h3 className="text-sm font-semibold text-primary-foreground">{activeContact ? 'Chat' : 'Messages'}</h3>
          <button onClick={() => { setIsOpen(false); closeChat(); }} className="flex h-6 w-6 items-center justify-center rounded hover:bg-primary-foreground/10 transition-colors">
            <X className="h-4 w-4 text-primary-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {activeContact ? (
            <ChatWindow
              contact={activeContact}
              messages={messages}
              loading={loadingMessages}
              currentUserId={currentUserId}
              typingUserName={typingUserName}
              threadId={activeThreadId}
              onSend={sendMessage}
              onBack={closeChat}
              onTypingInput={handleTypingInput}
              getSeenTimestamp={getSeenTimestamp}
            />
          ) : (
            <ChatContactList contacts={contacts} loading={loadingContacts} onSelect={openChat} />
          )}
        </div>
      </div>
    </>
  );
}

export function ChatPanel() {
  const { profile } = useAuth();
  if (!profile?.id) return null;
  return <ChatPanelInner />;
}
