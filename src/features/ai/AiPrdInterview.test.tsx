import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiPrdInterview, type AiPrdInterviewServices } from './AiPrdInterview';
import type { AiInterviewSession, AiRunResult } from './types';

const scope = {
  kind: 'document' as const,
  target: { documentId: 'doc-1', path: '/PRD.md', label: 'PRD.md' },
};

function session(
  question: string,
  position = 0,
  recommendedAnswer = 'Choose the narrowest primary user who feels this problem weekly.',
): AiInterviewSession {
  return {
    requestId: 'interview-1',
    documentId: 'doc-1',
    model: 'z-ai/glm-5.2',
    scope,
    sourceHash: 'hash',
    status: 'awaiting_answer',
    turns: [
      {
        id: `interview-1:${position}`,
        position,
        question,
        rationale: 'This decision is missing.',
        recommendedAnswer,
        unresolvedArea: 'primary user',
        answer: null,
        skipped: false,
      },
    ],
  };
}

function services(): AiPrdInterviewServices {
  const generated: AiRunResult = {
    requestId: 'interview-1',
    documentId: 'doc-1',
    task: 'prd',
    model: 'z-ai/glm-5.2',
    generationId: 'generation-1',
    result: null,
    validationIssues: [],
    rawDiagnostic: null,
    usage: null,
    retryAfterSeconds: null,
  };
  return {
    startInterview: vi.fn().mockResolvedValue(session('Who is the primary user?')),
    answerInterview: vi.fn().mockResolvedValue(session('What measurable outcome defines success?', 1)),
    skipInterview: vi.fn().mockResolvedValue(session('Which edge case is riskiest?', 1)),
    updateAnswer: vi.fn(),
    finishInterview: vi.fn().mockResolvedValue({
      ...session('Who is the primary user?'),
      status: 'ready_to_generate',
    }),
    resumeInterview: vi.fn().mockResolvedValue(null),
    run: vi.fn().mockResolvedValue(generated),
  };
}

function renderInterview(
  interviewServices = services(),
  resumeRequestId: string | null = null,
) {
  const onResult = vi.fn();
  render(
    <AiPrdInterview
      documentId="doc-1"
      source="# Draft PRD"
      model="z-ai/glm-5.2"
      maxOutputTokens={65_536}
      instruction={null}
      scope={scope}
      zdrOnly
      recordHistory
      disabled={false}
      resumeRequestId={resumeRequestId}
      services={interviewServices}
      onResult={onResult}
    />,
  );
  return { interviewServices, onResult };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('AiPrdInterview', () => {
  it('offers an editable recommendation and repeats the answer-driven loop', async () => {
    const interviewServices = services();
    vi.mocked(interviewServices.answerInterview)
      .mockResolvedValueOnce(session(
        'What measurable outcome defines success?',
        1,
        'Use weekly successful PRD reviews as the activation metric.',
      ))
      .mockResolvedValueOnce(session(
        'Which failure case must the first release handle?',
        2,
        'Handle a stale document before adding broader recovery paths.',
      ));
    renderInterview(interviewServices);

    fireEvent.click(screen.getByRole('button', { name: 'Start PRD interview' }));
    expect(await screen.findByText(
      'Choose the narrowest primary user who feels this problem weekly.',
    )).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended answer' }));
    expect(screen.getByRole('textbox', { name: 'Your answer' })).toHaveValue(
      'Choose the narrowest primary user who feels this problem weekly.',
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), {
      target: { value: 'Product managers at five-to-fifty-person software teams.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue interview' }));

    expect(await screen.findByText('What measurable outcome defines success?')).toBeVisible();
    expect(interviewServices.answerInterview).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        answer: 'Product managers at five-to-fifty-person software teams.',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue interview' }));

    expect(await screen.findByText(
      'Which failure case must the first release handle?',
    )).toBeVisible();
    expect(interviewServices.answerInterview).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        answer: 'Use weekly successful PRD reviews as the activation metric.',
      }),
    );
    expect(interviewServices.finishInterview).not.toHaveBeenCalled();
  });

  it('asks one question at a time and stops only after user confirmation', async () => {
    const { interviewServices, onResult } = renderInterview();

    fireEvent.click(screen.getByRole('button', { name: 'Start PRD interview' }));
    expect(await screen.findByText('Who is the primary user?')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), {
      target: { value: 'Product managers in Korean startups.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue interview' }));
    await waitFor(() => expect(interviewServices.answerInterview).toHaveBeenCalledWith(
      expect.objectContaining({ answer: 'Product managers in Korean startups.' }),
    ));
    expect(await screen.findByText('What measurable outcome defines success?')).toBeVisible();
    expect(interviewServices.finishInterview).not.toHaveBeenCalled();

    const generateNowButton = screen.getByRole('button', { name: 'Generate Now' });
    expect(generateNowButton).toHaveAttribute('data-variant', 'outline');
    fireEvent.click(generateNowButton);
    expect(screen.getByRole('dialog', { name: 'Finish PRD interview?' })).toBeVisible();
    expect(interviewServices.finishInterview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Generate PRD' }));
    await waitFor(() => expect(interviewServices.finishInterview).toHaveBeenCalledWith('interview-1', null));
    await waitFor(() => expect(interviewServices.run).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'prd',
        maxOutputTokens: 65_536,
      }),
      expect.any(Function),
    ));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
  });

  it('recognizes typed enough intent but still requires the same dialog', async () => {
    const { interviewServices } = renderInterview();
    fireEvent.click(screen.getByRole('button', { name: 'Start PRD interview' }));
    await screen.findByText('Who is the primary user?');
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), {
      target: { value: '충분합니다.' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your answer' }), {
      key: 'Enter',
      metaKey: true,
    });
    expect(screen.getByRole('dialog', { name: 'Finish PRD interview?' })).toBeVisible();
    expect(interviewServices.finishInterview).not.toHaveBeenCalled();
  });

  it('resumes a persisted interview after remount', async () => {
    localStorage.setItem('markdowner.ai.prd-interview.doc-1', 'interview-1');
    const interviewServices = services();
    vi.mocked(interviewServices.resumeInterview).mockResolvedValue(session('Who owns launch approval?'));

    renderInterview(interviewServices);

    expect(await screen.findByText('Who owns launch approval?')).toBeVisible();
    expect(interviewServices.resumeInterview).toHaveBeenCalledWith('interview-1');
  });

  it('resumes the interview selected from History without a prior local marker', async () => {
    const interviewServices = services();
    vi.mocked(interviewServices.resumeInterview).mockResolvedValue(
      session('Which approval is still unresolved?'),
    );

    renderInterview(interviewServices, 'interview-1');

    expect(await screen.findByText('Which approval is still unresolved?')).toBeVisible();
    expect(interviewServices.resumeInterview).toHaveBeenCalledWith('interview-1');
    expect(localStorage.getItem('markdowner.ai.prd-interview.doc-1')).toBe('interview-1');
  });
});
