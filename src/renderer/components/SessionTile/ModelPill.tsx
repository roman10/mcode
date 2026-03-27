import type { SessionType } from '@shared/types';

const familyColors: Record<string, string> = {
  opus: 'bg-purple-900/80 text-purple-300',
  sonnet: 'bg-blue-900/80 text-blue-300',
  haiku: 'bg-green-900/80 text-green-300',
  unknown: 'bg-gray-700/80 text-gray-300',
};

function getFamily(model: string): string {
  if (model.startsWith('opus')) return 'opus';
  if (model.startsWith('sonnet')) return 'sonnet';
  if (model.startsWith('haiku')) return 'haiku';
  return 'unknown';
}

interface ModelPillProps {
  model: string | null;
  sessionType: SessionType;
}

function ModelPill({ model, sessionType }: ModelPillProps): React.JSX.Element | null {
  if (!model || sessionType !== 'claude') return null;
  const family = getFamily(model);
  const color = familyColors[family] ?? familyColors.unknown;
  return (
    <span className={`text-[10px] leading-tight px-1 py-px rounded shrink-0 ml-1 ${color}`}>
      {model}
    </span>
  );
}

export default ModelPill;
