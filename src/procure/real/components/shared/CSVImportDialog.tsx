import { useState, useRef } from 'react';
import { Upload, FileText, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { parseCSV, readFileAsText } from '@/lib/csvUtils';

interface CSVImportDialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (data: T[]) => Promise<void>;
  columnMapping?: Record<string, string>;
  expectedColumns: string[];
  title?: string;
}

export function CSVImportDialog<T extends Record<string, any>>({
  open,
  onOpenChange,
  onImport,
  columnMapping,
  expectedColumns,
  title = 'Import CSV',
}: CSVImportDialogProps<T>) {
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setError(null);
    setImportSuccess(false);

    if (!selectedFile.name.endsWith('.csv')) {
      setError('Please select a CSV file');
      return;
    }

    try {
      const content = await readFileAsText(selectedFile);
      const parsed = parseCSV<T>(content, columnMapping);
      
      if (parsed.length === 0) {
        setError('No data found in CSV file');
        return;
      }

      setFile(selectedFile);
      setPreviewData(parsed.slice(0, 5)); // Preview first 5 rows
    } catch (err) {
      setError('Failed to parse CSV file. Please check the format.');
    }
  };

  const handleImport = async () => {
    if (!file || previewData.length === 0) return;

    setIsImporting(true);
    setError(null);

    try {
      const content = await readFileAsText(file);
      const allData = parseCSV<T>(content, columnMapping);
      await onImport(allData);
      setImportSuccess(true);
      setTimeout(() => {
        onOpenChange(false);
        resetState();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to import data');
    } finally {
      setIsImporting(false);
    }
  };

  const resetState = () => {
    setFile(null);
    setPreviewData([]);
    setError(null);
    setImportSuccess(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) resetState();
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import data. Expected columns: {expectedColumns.slice(0, 5).join(', ')}
            {expectedColumns.length > 5 && `, and ${expectedColumns.length - 5} more...`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Upload Area */}
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileText className="h-8 w-8 text-primary" />
                <div className="text-left">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {previewData.length > 0 && `${previewData.length}+ rows detected`}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">
                  Click to upload or drag and drop a CSV file
                </p>
              </>
            )}
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Success Alert */}
          {importSuccess && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <Check className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-600">
                Data imported successfully!
              </AlertDescription>
            </Alert>
          )}

          {/* Preview Table */}
          {previewData.length > 0 && !importSuccess && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Preview (first 5 rows)</p>
                <Badge variant="secondary">{previewData.length}+ rows</Badge>
              </div>
              <ScrollArea className="h-[200px] border rounded-lg">
                <div className="p-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {Object.keys(previewData[0]).slice(0, 6).map((key) => (
                          <th key={key} className="text-left p-2 font-medium">
                            {key}
                          </th>
                        ))}
                        {Object.keys(previewData[0]).length > 6 && (
                          <th className="text-left p-2 font-medium text-muted-foreground">
                            +{Object.keys(previewData[0]).length - 6} more
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          {Object.values(row).slice(0, 6).map((val, j) => (
                            <td key={j} className="p-2 max-w-[150px] truncate">
                              {val === null ? '-' : String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!file || previewData.length === 0 || isImporting || importSuccess}
          >
            {isImporting ? 'Importing...' : importSuccess ? 'Done!' : 'Import Data'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
