import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionsContext';
import { toast } from 'sonner';

export function usePagePermission(tableName: string) {
  const { isAdmin } = useAuth();
  const { checkCanView, checkCanEdit, loading } = usePermissions();

  const canView = isAdmin || checkCanView(tableName);
  const canEdit = isAdmin || checkCanEdit(tableName);

  const guardEdit = useCallback(
    (fn: () => void) => {
      if (isAdmin || checkCanEdit(tableName)) {
        fn();
      } else {
        toast.error('You have view access only. Editing is not allowed for this table.');
      }
    },
    [isAdmin, checkCanEdit, tableName]
  );

  const guardDelete = useCallback(
    (fn: () => void) => {
      if (isAdmin || checkCanEdit(tableName)) {
        fn();
      } else {
        toast.error("You don't have permission to delete this data.");
      }
    },
    [isAdmin, checkCanEdit, tableName]
  );

  const guardSave = useCallback(
    (fn: () => void) => {
      if (isAdmin || checkCanEdit(tableName)) {
        fn();
      } else {
        toast.error('Edit access denied. You don\'t have permission to modify this data.');
      }
    },
    [isAdmin, checkCanEdit, tableName]
  );

  return { canView, canEdit, guardEdit, guardDelete, guardSave, loading };
}
