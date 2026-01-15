import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { AssistantView } from '../../views/AssistantView';
import * as aiService from '../../services/aiService';

describe('AssistantView - New Chat Reset', () => {
  test('remounting AssistantView resets chat history (new chat)', async () => {
    // Mock AI draft to avoid network and ensure deterministic response
    vi.spyOn(aiService, 'draftContent').mockResolvedValueOnce('Mocked response');

    let externalHandler: ((msg: string) => Promise<void>) | null = null;

    // Initial render
    const { rerender, unmount } = render(
      <AssistantView
        key={1}
        documentContent="Initial doc"
        selection=""
        onInsert={() => {}}
        onReplace={() => {}}
        setExternalHandler={(handler) => {
          externalHandler = handler;
        }}
        onNavigate={() => {}}
        onLoadingChange={() => {}}
      />
    );

    // Send a message through the exposed handler to populate chat
    await act(async () => {
      await externalHandler?.('Hello');
    });

    // Expect both user message and mocked model response are visible
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Mocked response')).toBeInTheDocument();

    // Remount with a different key to simulate "new chat"
    unmount();
    render(
      <AssistantView
        key={2}
        documentContent="Initial doc"
        selection=""
        onInsert={() => {}}
        onReplace={() => {}}
        setExternalHandler={() => {}}
        onNavigate={() => {}}
        onLoadingChange={() => {}}
      />
    );

    // The default intro view should be displayed (empty chat)
    expect(screen.getByText(/What can I do for you\?/i)).toBeInTheDocument();

    cleanup();
  });
});


