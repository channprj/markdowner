import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { AiSystemPromptSettings } from './AiSystemPromptSettings';
import { DEFAULT_SYSTEM_PROMPTS, type AiSystemPrompts } from './systemPrompts';

it('edits each built-in prompt independently and restores the selected default', () => {
  function Settings() {
    const [prompts, setPrompts] = useState<AiSystemPrompts>({ summary: 'Keep summaries brief.' });
    return <AiSystemPromptSettings prompts={prompts} onChange={setPrompts} />;
  }
  render(<Settings />);
  expect(screen.getByLabelText('System prompt')).toHaveValue(DEFAULT_SYSTEM_PROMPTS.prd);
  fireEvent.change(screen.getByLabelText('System prompt'), { target: { value: 'Review accessibility first.' } });
  fireEvent.change(screen.getByLabelText('System prompt task'), { target: { value: 'summary' } });
  expect(screen.getByLabelText('System prompt')).toHaveValue('Keep summaries brief.');
  fireEvent.change(screen.getByLabelText('System prompt task'), { target: { value: 'prd' } });
  expect(screen.getByLabelText('System prompt')).toHaveValue('Review accessibility first.');
  fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
  expect(screen.getByLabelText('System prompt')).toHaveValue(DEFAULT_SYSTEM_PROMPTS.prd);
  fireEvent.change(screen.getByLabelText('System prompt task'), { target: { value: 'summary' } });
  expect(screen.getByLabelText('System prompt')).toHaveValue('Keep summaries brief.');
});
