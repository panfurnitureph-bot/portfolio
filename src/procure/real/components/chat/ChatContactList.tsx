import { Search } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { ChatContact } from '@/hooks/useChat';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface ChatContactListProps {
  contacts: ChatContact[];
  loading: boolean;
  onSelect: (contact: ChatContact) => void;
  activeContactId?: string;
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

function getInitials(name: string) {
  return name.split(' ').map(n => n?.[0] || '').join('').toUpperCase().slice(0, 2) || '?';
}

function formatUnread(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return '(1 Unread Message)';
  if (count > 99) return '(99+ Unread Messages)';
  return `(${count} Unread Messages)`;
}

export function ChatContactList({ contacts, loading, onSelect, activeContactId }: ChatContactListProps) {
  const [search, setSearch] = useState('');

  const sortedAndFiltered = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const filtered = contacts.filter(c =>
      c.full_name.toLowerCase().includes(lowerSearch) ||
      c.email.toLowerCase().includes(lowerSearch)
    );

    const sorted = filtered.slice().sort((a, b) => {
      // Priority 1: unread DESC
      if (a.unread_count !== b.unread_count) return b.unread_count - a.unread_count;
      // Priority 2: last_message_at DESC
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      // Priority 3: full_name ASC
      return a.full_name.localeCompare(b.full_name);
    });
    return sorted;
  }, [contacts, search]);

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-2">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-muted/50 border-0 h-9 text-sm"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {sortedAndFiltered.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {contacts.length === 0 ? 'No contacts available' : 'No contacts match your search'}
          </div>
        ) : (
          <div className="flex flex-col">
            {sortedAndFiltered.map(contact => {
              const unreadLabel = formatUnread(contact.unread_count);
              return (
                <button
                  key={contact.id}
                  onClick={() => onSelect(contact)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 w-full',
                    activeContactId === contact.id && 'bg-muted'
                  )}
                >
                  <div className="relative shrink-0">
                    <Avatar className="h-10 w-10">
                      {contact.avatar_url && <AvatarImage src={contact.avatar_url} alt={contact.full_name} />}
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                        {getInitials(contact.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className={cn('absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card', contact.is_online ? 'bg-green-500' : 'bg-muted-foreground/40')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium truncate text-foreground">{contact.full_name}</span>
                      {unreadLabel && (
                        <span className="text-[10px] font-semibold text-destructive shrink-0">{unreadLabel}</span>
                      )}
                      <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 h-4 font-medium shrink-0', roleColors[contact.role] || roleColors.pending)}>
                        {formatRole(contact.role)}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground truncate">
                        {contact.last_message || contact.email}
                      </span>
                      {contact.last_message_at && (
                        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                          {formatDistanceToNow(new Date(contact.last_message_at), { addSuffix: false })}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
