import {
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  Folder,
  type LucideIcon,
} from 'lucide-react';

interface IconDef {
  icon: LucideIcon;
  color: string;
}

const extMap: Record<string, IconDef> = {};

function register(exts: string[], def: IconDef): void {
  for (const ext of exts) extMap[ext] = def;
}

register(['.ts', '.tsx'], { icon: FileCode, color: '#3178c6' });
register(['.js', '.jsx', '.mjs', '.cjs'], { icon: FileCode, color: '#f0db4f' });
register(['.json'], { icon: FileJson, color: '#a5d6a7' });
register(['.css', '.scss', '.less'], { icon: FileType, color: '#56b6c2' });
register(['.html', '.htm', '.xml', '.svg'], { icon: FileCode, color: '#e06c75' });
register(['.md', '.mdx', '.txt', '.rst'], { icon: FileText, color: '#8b949e' });
register(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp'], { icon: FileImage, color: '#c678dd' });
register(['.yml', '.yaml', '.toml'], { icon: FileCog, color: '#8b949e' });
register(['.sh', '.bash', '.zsh', '.fish'], { icon: FileTerminal, color: '#7ee787' });
register(['.sql'], { icon: FileSpreadsheet, color: '#58a6ff' });

const defaultDef: IconDef = { icon: FileText, color: '#484f58' };

export function getFileIcon(filename: string): React.JSX.Element {
  if (filename.endsWith('/')) {
    return <Folder size={16} style={{ color: '#e8a838' }} className="shrink-0" />;
  }
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  const { icon: Icon, color } = extMap[ext] ?? defaultDef;
  return <Icon size={16} style={{ color }} className="shrink-0" />;
}
