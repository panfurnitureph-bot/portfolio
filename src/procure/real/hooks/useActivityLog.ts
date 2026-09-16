import { externalSupabase as supabase } from '@/integrations/supabase/externalClient';
import { useAuth } from '@/contexts/AuthContext';
import { useCallback } from 'react';
import { DEFAULT_TENANT_ID } from '@/lib/constants';

interface LogActivityParams {
  action: string;
  entityType: string;
  entityId?: string;
  entityName?: string;
  fieldChanged?: string;
  oldValue?: string | number | boolean | null;
  newValue?: string | number | boolean | null;
  details?: Record<string, any>;
}

export function useActivityLog() {
  const { profile } = useAuth();

  const logActivity = useCallback(async ({
    action,
    entityType,
    entityId,
    entityName,
    fieldChanged,
    oldValue,
    newValue,
    details,
  }: LogActivityParams) => {
    if (!profile?.id) return;

    try {
      const userName = profile.full_name || profile.email?.split('@')[0] || 'Unknown User';

      await supabase.from('activity_logs').insert({
        tenant_id: DEFAULT_TENANT_ID,
        user_id: profile.id,
        user_name: userName,
        action,
        entity_type: entityType,
        entity_id: entityId,
        entity_name: entityName,
        field_changed: fieldChanged,
        old_value: oldValue !== undefined && oldValue !== null ? String(oldValue) : null,
        new_value: newValue !== undefined && newValue !== null ? String(newValue) : null,
        details,
      } as any);
    } catch (error) {
    }
  }, [profile?.id, profile?.full_name, profile?.email]);

  const logFieldChange = useCallback(async (
    entityType: string,
    entityId: string,
    entityName: string,
    fieldName: string,
    oldValue: any,
    newValue: any
  ) => {
    await logActivity({
      action: `Updated ${fieldName}`,
      entityType,
      entityId,
      entityName,
      fieldChanged: fieldName,
      oldValue,
      newValue,
      details: { field: fieldName, from: oldValue, to: newValue },
    });
  }, [logActivity]);

  return { logActivity, logFieldChange };
}
