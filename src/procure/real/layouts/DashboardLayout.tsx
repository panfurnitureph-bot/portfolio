import { Outlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { EmailAutoSendProvider } from '@/providers/EmailAutoSendProvider';
import { ShopifyEmailAutoSendProvider } from '@/providers/ShopifyEmailAutoSendProvider';

export function DashboardLayout() {
  return (
    <EmailAutoSendProvider>
      <ShopifyEmailAutoSendProvider>
        <SidebarProvider>
          <div className="min-h-screen flex w-full bg-background">
            <DashboardSidebar />
            <SidebarInset className="flex-1 flex flex-col min-w-0">
              <Outlet />
            </SidebarInset>
            <ChatPanel />
          </div>
        </SidebarProvider>
      </ShopifyEmailAutoSendProvider>
    </EmailAutoSendProvider>
  );
}
