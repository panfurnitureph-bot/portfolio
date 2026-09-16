import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatButtonProps {
  totalUnread: number;
  isOpen: boolean;
  onClick: () => void;
}

export function ChatButton({ totalUnread, isOpen, onClick }: ChatButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-200 hover:scale-105',
        isOpen
          ? 'bg-muted text-muted-foreground'
          : 'bg-accent text-accent-foreground'
      )}
    >
      <MessageCircle className="h-6 w-6" />
      {totalUnread > 0 && !isOpen && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground">
          {totalUnread > 99 ? '99+' : totalUnread}
        </span>
      )}
    </button>
  );
}
