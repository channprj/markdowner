import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DEFAULT_SYSTEM_PROMPTS, type AiPromptTask, type AiSystemPrompts } from './systemPrompts';

const TASK_LABELS: Record<AiPromptTask, string> = {
  prd: 'Improve PRD', summary: 'Summarize', translation: 'Translate',
  custom: 'Custom / inline editing', interview: 'PRD interview',
};

export function AiSystemPromptSettings({ prompts, onChange }: {
  prompts: AiSystemPrompts;
  onChange: (prompts: AiSystemPrompts) => void;
}) {
  const [task, setTask] = useState<AiPromptTask>('prd');
  return (
    <section aria-labelledby="ai-system-prompts-heading" className="grid gap-3 rounded-xl border border-border bg-muted/15 p-4">
      <div>
        <h4 id="ai-system-prompts-heading" className="text-sm font-medium">System Prompts</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Customize each task's behavior for future requests. Saved locally. The output schema and Markdown protection rules remain enforced.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ai-system-prompt-task">System prompt task</Label>
        <select id="ai-system-prompt-task" value={task} onChange={(event) => setTask(event.target.value as AiPromptTask)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm">
          {Object.entries(TASK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ai-system-prompt">System prompt</Label>
        <textarea id="ai-system-prompt" rows={8} value={prompts[task] ?? DEFAULT_SYSTEM_PROMPTS[task]}
          onChange={(event) => onChange({ ...prompts, [task]: event.target.value })}
          className="w-full resize-y rounded-md border border-input bg-background p-2 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <p className="text-xs text-muted-foreground">An empty prompt uses the built-in default. Running requests keep the prompt they started with.</p>
      </div>
      <Button type="button" variant="outline" className="justify-self-start" disabled={prompts[task] === undefined}
        onClick={() => { const next = { ...prompts }; delete next[task]; onChange(next); }}>
        Reset to default
      </Button>
    </section>
  );
}
