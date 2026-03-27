interface HighlightedTextProps {
  text: string;
  ranges: number[];
}

function HighlightedText({ text, ranges }: HighlightedTextProps): React.JSX.Element {
  if (ranges.length === 0) return <>{text}</>;

  const parts: React.JSX.Element[] = [];
  let cursor = 0;

  for (let i = 0; i < ranges.length; i += 2) {
    const start = ranges[i];
    const end = ranges[i + 1];

    if (cursor < start) {
      parts.push(<span key={`t${cursor}`}>{text.slice(cursor, start)}</span>);
    }
    parts.push(
      <span key={`h${start}`} className="text-accent font-medium">
        {text.slice(start, end + 1)}
      </span>,
    );
    cursor = end + 1;
  }

  if (cursor < text.length) {
    parts.push(<span key={`t${cursor}`}>{text.slice(cursor)}</span>);
  }

  return <>{parts}</>;
}

export default HighlightedText;
