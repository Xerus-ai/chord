import { useMemo, useState } from 'react';

interface Column {
  key: string;
  label: string;
}

interface InteractiveTableProps {
  columns: Column[];
  data: Record<string, unknown>[];
  caption?: string;
}

/** Sortable, filterable table. Styled through `components.css`. */
export function InteractiveTable({ columns, data, caption }: InteractiveTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return data;
    const lower = filter.toLowerCase();
    return data.filter((row) =>
      columns.some((col) =>
        String(row[col.key] ?? '')
          .toLowerCase()
          .includes(lower)
      )
    );
  }, [data, columns, filter]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const cmp = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''), undefined, {
        numeric: true,
      });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: string): void {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div className="chord-table">
      <div className="chord-table-toolbar">
        {caption && <span className="chord-table-caption">{caption}</span>}
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="chord-table-filter"
        />
      </div>
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                aria-sort={
                  sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="chord-table-sort">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col.key}>{String(row[col.key] ?? '')}</td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="chord-table-empty">
                No matching rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="chord-table-footer">
        {sorted.length} of {data.length} rows
      </div>
    </div>
  );
}
