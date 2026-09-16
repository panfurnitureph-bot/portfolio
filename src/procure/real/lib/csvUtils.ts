// CSV Import/Export Utility Functions

/**
 * Parse CSV string into array of objects
 */
export function parseCSV<T extends Record<string, any>>(
  csvString: string,
  columnMapping?: Record<string, string>
): T[] {
  const lines = csvString.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  // Parse headers - handle BOM and quotes
  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = parseCSVLine(headerLine).map(h => 
    columnMapping?.[h.trim()] || toSnakeCase(h.trim())
  );

  const results: T[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;

    const obj: Record<string, any> = {};
    headers.forEach((header, index) => {
      const value = values[index]?.trim() || '';
      obj[header] = parseValue(value);
    });
    results.push(obj as T);
  }

  return results;
}

/**
 * Parse a single CSV line handling quotes
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  
  return result;
}

/**
 * Convert header to snake_case
 */
function toSnakeCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

/**
 * Parse value to appropriate type
 */
function parseValue(value: string): any {
  if (value === '' || value.toLowerCase() === 'null' || value.toLowerCase() === 'n/a') {
    return null;
  }
  
  // Check for date formats (MM/DD/YYYY or YYYY-MM-DD)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) {
    const [month, day, year] = value.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Check for numbers
  if (/^-?\d+\.?\d*$/.test(value.replace(/,/g, ''))) {
    const num = parseFloat(value.replace(/,/g, ''));
    return isNaN(num) ? value : num;
  }
  
  // Check for currency
  if (/^\$[\d,]+\.?\d*$/.test(value)) {
    const num = parseFloat(value.replace(/[$,]/g, ''));
    return isNaN(num) ? value : num;
  }
  
  // Check for percentages
  if (/^\d+\.?\d*%$/.test(value)) {
    const num = parseFloat(value.replace('%', ''));
    return isNaN(num) ? value : num;
  }
  
  return value;
}

/**
 * Export data to CSV string
 */
export function exportToCSV<T extends Record<string, any>>(
  data: T[],
  columns: { key: keyof T; header: string }[],
  filename?: string
): void {
  if (data.length === 0) return;

  // Headers
  const headers = columns.map(col => `"${col.header}"`).join(',');
  
  // Rows
  const rows = data.map(item => 
    columns.map(col => {
      const value = item[col.key];
      if (value === null || value === undefined) return '';
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return String(value);
    }).join(',')
  );

  const csvContent = [headers, ...rows].join('\n');
  downloadCSV(csvContent, filename || 'export');
}

/**
 * Download CSV file
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Read file as text
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
