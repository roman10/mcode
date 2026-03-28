import { useEffect, useMemo, useState } from 'react';
import uFuzzy from '@leeoniya/ufuzzy';
import { useTextareaDropdown } from '../../hooks/useTextareaDropdown';
import { getTokenAtCursor } from '../../utils/autocomplete-utils';
import { getFileIcon } from '../../utils/file-icons';

const uf = new uFuzzy({ intraMode: 1 });

interface FileAutocompleteProps {
  text: string;
  cursorPos: number;
  cwd: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onSelect: (newText: string, newCursorPos: number) => void;
}

function FileAutocomplete({
  text,
  cursorPos,
  cwd,
  textareaRef,
  onSelect,
}: FileAutocompleteProps): React.JSX.Element | null {
  const [files, setFiles] = useState<string[]>([]);

  // Fetch files when cwd changes
  useEffect(() => {
    if (!cwd) return;
    let stale = false;
    window.mcode.files.list(cwd).then((result) => {
      if (!stale) setFiles(result.files);
    });
    return () => { stale = true; };
  }, [cwd]);

  // Detect @ token at cursor
  const token = useMemo(
    () => getTokenAtCursor(text, cursorPos, '@'),
    [text, cursorPos],
  );

  const query = token?.query ?? '';

  // Filter files using uFuzzy for fuzzy path matching
  const filtered = useMemo(() => {
    if (!token) return [];
    if (!query) return files.slice(0, 50);

    const idxs = uf.filter(files, query);
    if (!idxs || idxs.length === 0) return [];

    const info = uf.info(idxs, files, query);
    const order = uf.sort(info, files, query);

    return order.slice(0, 50).map((sortIdx) => files[info.idx[sortIdx]]);
  }, [token, query, files]);

  const handleSelect = (filePath: string): void => {
    if (!token) return;
    const replacement = '@' + filePath + ' ';
    const before = text.slice(0, token.startIndex);
    const after = text.slice(token.endIndex);
    const newText = before + replacement + after;
    const newCursorPos = token.startIndex + replacement.length;
    onSelect(newText, newCursorPos);
  };

  const { selectedIndex, listRef, isOpen } = useTextareaDropdown({
    textareaRef,
    items: filtered,
    visible: !!token,
    query,
    onSelect: handleSelect,
  });

  if (!isOpen) return null;

  return (
    <div
      ref={listRef}
      className="absolute left-0 right-0 top-full mt-1 z-10 max-h-[240px] overflow-y-auto rounded-md border border-border-default bg-bg-elevated shadow-lg"
    >
      {filtered.map((filePath, i) => {
        const lastSlash = filePath.lastIndexOf('/');
        const filename = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
        const directory = lastSlash >= 0 ? filePath.slice(0, lastSlash) : '';

        return (
          <button
            key={filePath}
            type="button"
            data-index={i}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
              i === selectedIndex ? 'bg-accent/15 text-text-primary' : 'text-text-primary hover:bg-bg-secondary'
            }`}
            onPointerDown={(e) => {
              e.preventDefault(); // keep focus on textarea
              handleSelect(filePath);
            }}
          >
            {getFileIcon(filename)}
            <span className="truncate min-w-0">{filename}</span>
            {directory && (
              <span className="truncate text-text-secondary text-xs ml-auto">{directory}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default FileAutocomplete;
