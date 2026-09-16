import { useRealtimeStatus } from '@/providers/RealtimeProvider';

const labels: Record<string, string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  disconnected: 'Reconnecting…',
};

const dotColors: Record<string, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  disconnected: 'bg-destructive animate-pulse',
};

export function RealtimeStatusIndicator() {
  const status = useRealtimeStatus();

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${dotColors[status]}`} />
      {labels[status]}
    </div>
  );
}
