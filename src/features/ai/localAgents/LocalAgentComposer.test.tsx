import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalAgentComposer } from "./LocalAgentComposer";
import type { LocalAgentTargetSnapshot } from "./targets";
import type {
  LocalAgentRunRequest,
  LocalAgentRunResult,
  LocalAgentStatus,
  LocalAgentStreamEvent,
} from "./types";

afterEach(cleanup);

const statuses: LocalAgentStatus[] = [
  {
    kind: "claude",
    mention: "@claude",
    label: "Claude Code",
    installed: true,
    compatible: true,
    pathLabel: "claude (PATH)",
    version: "2.0.0",
    reason: null,
    source: "automatic",
  },
  {
    kind: "codex",
    mention: "@codex",
    label: "Codex",
    installed: true,
    compatible: true,
    pathLabel: "codex (PATH)",
    version: "1.0.0",
    reason: null,
    source: "automatic",
  },
  {
    kind: "opencode",
    mention: "@opencode",
    label: "OpenCode",
    installed: true,
    compatible: false,
    pathLabel: "opencode (PATH)",
    version: "0.1.0",
    reason: "This version is not supported.",
    source: "automatic",
  },
];

const mixedStatuses: LocalAgentStatus[] = [
  statuses[0],
  {
    ...statuses[1],
    compatible: false,
    reason: "This version is not supported.",
  },
  { ...statuses[2], compatible: true, reason: null },
];

const disabledStatuses: LocalAgentStatus[] = statuses.map((status) => ({
  ...status,
  compatible: false,
  reason: "Unavailable.",
}));

const selectionSnapshot: LocalAgentTargetSnapshot = {
  documentId: "doc-1",
  source: "안녕 world",
  surface: "source",
  kind: "selection",
  characterRange: { start: 3, end: 8 },
  byteRange: { start: 7, end: 12 },
  selectedText: "world",
  proseMirrorRange: null,
};

const insertSnapshot: LocalAgentTargetSnapshot = {
  ...selectionSnapshot,
  kind: "insert",
  characterRange: { start: 3, end: 3 },
  byteRange: { start: 7, end: 7 },
  selectedText: "",
};

const documentSnapshot: LocalAgentTargetSnapshot = {
  ...selectionSnapshot,
  kind: "document",
  characterRange: null,
  byteRange: null,
  selectedText: "",
};

const executablePaths = {
  claude: "/custom/claude",
  codex: "  /custom/codex  ",
  opencode: "",
};

function resultFor(request: LocalAgentRunRequest): LocalAgentRunResult {
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    documentId: request.documentId,
    agent: request.agent,
    target: request.target,
    markdown: "- done",
    summary: "Done",
    warnings: [],
  };
}

function renderComposer(
  options: Partial<React.ComponentProps<typeof LocalAgentComposer>> = {},
) {
  const services = options.services ?? {
    listStatuses: vi.fn().mockResolvedValue(statuses),
    run: vi.fn(),
    cancel: vi.fn(),
  };
  const props = {
    snapshot: selectionSnapshot,
    documentLabel: "meeting-notes.md",
    disclosureAccepted: true,
    preferredAgent: "codex" as const,
    executablePaths,
    onDisclosureAcceptedChange: vi.fn(),
    onClose: vi.fn(),
    onResult: vi.fn(),
    services,
    ...options,
  };
  return { ...render(<LocalAgentComposer {...props} />), props, services };
}

async function chooseAgent(mention: string) {
  const change = screen.queryByRole("button", { name: "Change local agent" });
  if (change) fireEvent.click(change);
  fireEvent.change(screen.getByLabelText("Local agent"), {
    target: { value: mention },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: new RegExp(mention, "i") }),
    ).toBeInTheDocument(),
  );
  fireEvent.click(
    screen.getByRole("option", { name: new RegExp(mention, "i") }),
  );
}

async function waitForStatuses() {
  fireEvent.click(screen.getByRole("button", { name: "Change local agent" }));
  await waitFor(() =>
    expect(screen.getByRole("option", { name: /@codex/i })).toBeEnabled(),
  );
  fireEvent.keyDown(screen.getByLabelText("Local agent"), { key: "Escape" });
}

describe("LocalAgentComposer", () => {
  it("labels and describes each accessible result destination without duplicating a document target", () => {
    renderComposer();

    const selectionTarget = screen.getByRole("combobox", {
      name: "Result destination",
    });
    expect(selectionTarget).toHaveAccessibleDescription(
      "Replaces the selected text in meeting-notes.md only if the captured target is unchanged. The edit is applied automatically and can be undone.",
    );
    expect(
      within(selectionTarget).getByRole("option", {
        name: "Replace selected text in meeting-notes.md",
      }),
    ).toBeInTheDocument();
    expect(
      within(selectionTarget).getByRole("option", {
        name: "Full-document proposal for meeting-notes.md",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run @codex" })).toBeInTheDocument();

    fireEvent.change(selectionTarget, { target: { value: "document" } });
    expect(selectionTarget).toHaveAccessibleDescription(
      "The full-document proposal for meeting-notes.md opens in Review and remains unapplied until you choose Apply.",
    );
    expect(
      screen.getByRole("button", { name: "Generate document proposal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /opens the full-document result in Review and leaves it unapplied until you choose Apply/i,
      ),
    ).toBeInTheDocument();

    cleanup();
    renderComposer({ snapshot: insertSnapshot });
    const insertTarget = screen.getByRole("combobox", {
      name: "Result destination",
    });
    expect(insertTarget).toHaveAccessibleDescription(
      "Inserts at the captured cursor in meeting-notes.md only if the captured target is unchanged. The edit is applied automatically and can be undone.",
    );
    expect(
      within(insertTarget).getByRole("option", {
        name: "Insert at captured cursor in meeting-notes.md",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/inserts the result automatically as an undoable edit/i),
    ).toBeInTheDocument();

    cleanup();
    renderComposer({ snapshot: documentSnapshot, initialTarget: "document" });
    const documentTarget = screen.getByRole("combobox", {
      name: "Result destination",
    });
    expect(within(documentTarget).getAllByRole("option")).toHaveLength(1);
    expect(documentTarget).toHaveValue("document");
    expect(
      within(documentTarget).getByRole("option", {
        name: "Full-document proposal for meeting-notes.md",
      }),
    ).toBeInTheDocument();
  });

  it("restores an explicit rerun instruction and target without changing fresh defaults", () => {
    renderComposer({
      snapshot: selectionSnapshot,
      preferredAgent: "claude",
      initialInstruction: "Keep the same prompt",
      initialTarget: "document",
    });

    expect(screen.getByText("@claude")).toBeInTheDocument();
    expect(screen.getByLabelText("Instruction")).toHaveValue(
      "Keep the same prompt",
    );
    expect(screen.getByLabelText("Instruction")).toHaveFocus();
    expect(screen.getByLabelText("Result destination")).toHaveValue("document");

    cleanup();
    renderComposer({ snapshot: selectionSnapshot });
    expect(screen.getByLabelText("Instruction")).toHaveValue("");
    expect(screen.getByLabelText("Result destination")).toHaveValue("selection");
  });

  it("focuses the request after choosing an initial agent mention", async () => {
    renderComposer({ preferredAgent: null });
    const mention = screen.getByLabelText("Local agent");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /@codex/i })).toBeEnabled(),
    );

    fireEvent.change(mention, { target: { value: "@codex" } });
    fireEvent.keyDown(mention, { key: "Enter" });

    const instruction = screen.getByLabelText("Instruction");
    expect(screen.getByText("@codex")).toBeInTheDocument();
    expect(instruction).toHaveFocus();
    fireEvent.change(instruction, { target: { value: "Rewrite this clearly" } });
    expect(instruction).toHaveValue("Rewrite this clearly");
  });

  it("shows the fixed mention completion, keyboard selection, and incompatible status reason", async () => {
    renderComposer({ preferredAgent: null });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /@claude/i })).toBeEnabled(),
    );
    expect(
      within(screen.getByRole("listbox")).getAllByRole("option"),
    ).toHaveLength(3);
    expect(screen.getByRole("option", { name: /@opencode/i })).toBeDisabled();
    expect(
      screen.getByRole("option", { name: /@opencode/i }),
    ).toHaveTextContent("This version is not supported.");

    const input = screen.getByLabelText("Local agent");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByText("@claude")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove @claude" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByLabelText("Local agent")).toHaveFocus();
    await chooseAgent("@codex");
    fireEvent.click(screen.getByRole("button", { name: "Change local agent" }));
    fireEvent.keyDown(screen.getByLabelText("Local agent"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("navigates only compatible mention options and prevents Tab from escaping when none are selectable", async () => {
    renderComposer({
      preferredAgent: null,
      services: {
        listStatuses: vi.fn().mockResolvedValue(mixedStatuses),
        run: vi.fn(),
        cancel: vi.fn(),
      },
    });
    const input = screen.getByLabelText("Local agent");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /@claude/i })).toBeEnabled(),
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "local-agent-option-opencode",
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("@opencode")).toBeInTheDocument();

    cleanup();
    renderComposer({
      preferredAgent: null,
      services: {
        listStatuses: vi.fn().mockResolvedValue(disabledStatuses),
        run: vi.fn(),
        cancel: vi.fn(),
      },
    });
    const disabledInput = screen.getByLabelText("Local agent");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /@claude/i })).toBeDisabled(),
    );
    fireEvent.keyDown(disabledInput, { key: "ArrowDown" });
    expect(disabledInput).not.toHaveAttribute("aria-activedescendant");
    const tab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    disabledInput.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(disabledInput).toHaveFocus();
    fireEvent.keyDown(disabledInput, { key: "Enter" });
    expect(
      screen.queryByRole("button", { name: "Change local agent" }),
    ).not.toBeInTheDocument();
  });

  it("returns focus to Change when the replacement picker closes with Escape", async () => {
    renderComposer();
    await waitForStatuses();
    const change = screen.getByRole("button", { name: "Change local agent" });
    change.focus();
    fireEvent.click(change);
    expect(screen.getByLabelText("Local agent")).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText("Local agent"), { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Change local agent" }),
      ).toHaveFocus(),
    );
  });

  it("preserves the instruction and target while replacing a selected agent", async () => {
    renderComposer();
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Turn this into a checklist" },
    });
    fireEvent.change(screen.getByLabelText("Result destination"), {
      target: { value: "document" },
    });
    await chooseAgent("@claude");
    expect(screen.getByLabelText("Instruction")).toHaveValue(
      "Turn this into a checklist",
    );
    expect(screen.getByLabelText("Result destination")).toHaveValue("document");
  });

  it("uses selection and insert defaults, and builds an exact immutable run request only on Run", async () => {
    const run = vi
      .fn()
      .mockImplementation(async (request: LocalAgentRunRequest) =>
        resultFor(request),
      );
    const { props, services } = renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel: vi.fn(),
      },
    });
    await waitForStatuses();
    const original = selectionSnapshot.source;
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "  Turn this into a checklist  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(props.onResult).toHaveBeenCalledTimes(1));
    const request = run.mock.calls[0][0] as LocalAgentRunRequest;
    expect(request).toMatchObject({
      documentId: "doc-1",
      agent: "codex",
      target: "selection",
      source: "안녕 world",
      selection: { start: 7, end: 12 },
      cursor: null,
      instruction: "Turn this into a checklist",
      executablePath: "/custom/codex",
    });
    expect(services.listStatuses).toHaveBeenCalledWith(executablePaths);
    expect(request.requestId).toEqual(expect.any(String));
    expect(selectionSnapshot.source).toBe(original);
    expect(props.onResult).toHaveBeenCalledWith(
      resultFor(request),
      selectionSnapshot,
      request,
    );

    cleanup();
    const documentRun = vi
      .fn()
      .mockImplementation(async (next: LocalAgentRunRequest) =>
        resultFor(next),
      );
    renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run: documentRun,
        cancel: vi.fn(),
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Summarize it" },
    });
    fireEvent.change(screen.getByLabelText("Result destination"), {
      target: { value: "document" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Generate document proposal" }),
    );
    await waitFor(() => expect(documentRun).toHaveBeenCalledTimes(1));
    expect(documentRun.mock.calls[0][0]).toMatchObject({
      documentId: "doc-1",
      target: "document",
      source: "안녕 world",
      selection: null,
      cursor: null,
      instruction: "Summarize it",
    });

    cleanup();
    const insertRun = vi
      .fn()
      .mockImplementation(async (next: LocalAgentRunRequest) =>
        resultFor(next),
      );
    renderComposer({
      snapshot: insertSnapshot,
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run: insertRun,
        cancel: vi.fn(),
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Insert a heading" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(insertRun).toHaveBeenCalledTimes(1));
    expect(insertRun.mock.calls[0][0]).toMatchObject({
      target: "insert",
      selection: null,
      cursor: 7,
    });
  });

  it("requires disclosure, compatibility, prompt, and an idle request before it can run", async () => {
    const { rerender, props } = renderComposer({ disclosureAccepted: false });
    await waitForStatuses();
    expect(
      screen.getByText(/sends the current meeting-notes\.md snapshot without its file path/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/may contact its configured provider and consume/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Markdowner does not store agent credentials or estimate provider cost/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/tools are disabled/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/applies the replacement automatically as an undoable edit/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/OpenCode may retain local session metadata/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run @codex" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("switch", { name: "Allow local agent processing" }),
    );
    expect(props.onDisclosureAcceptedChange).toHaveBeenCalledWith(true);
    rerender(<LocalAgentComposer {...props} disclosureAccepted />);
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    cleanup();
    renderComposer({ preferredAgent: "opencode" });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    expect(
      screen.getByRole("button", { name: "Run @opencode" }),
    ).toBeDisabled();
  });

  it("keeps Close disabled during a run, cancels its exact request, and sanitizes service failures", async () => {
    const pending = deferred<LocalAgentRunResult>();
    const cancel = vi.fn().mockResolvedValue(false);
    const run = vi
      .fn()
      .mockImplementation(
        (
          request: LocalAgentRunRequest,
          onEvent: (event: LocalAgentStreamEvent) => void,
        ) => {
          onEvent({ type: "running", requestId: request.requestId });
          return pending.promise;
        },
      );
    const { props } = renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel,
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Local agent is running…")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close local agent" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel local agent" }));
    expect(cancel).toHaveBeenCalledWith(run.mock.calls[0][0].requestId);
    await act(async () =>
      pending.reject(new Error("token sk-secret at /private/tmp/request")),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not run local agent.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /sk-secret|private\/tmp/i,
    );
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("best-effort cancels an active request exactly once when the composer unmounts", async () => {
    const pending = deferred<LocalAgentRunResult>();
    const cancel = vi
      .fn()
      .mockRejectedValue(new Error("secret cancellation path"));
    const run = vi.fn().mockReturnValue(pending.promise);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { unmount } = renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel,
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const requestId = run.mock.calls[0][0].requestId;

    unmount();
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(requestId));
    expect(cancel).toHaveBeenCalledTimes(1);
    await act(async () => Promise.resolve());
    expect(consoleError).not.toHaveBeenCalled();
    await act(async () => pending.resolve(resultFor(run.mock.calls[0][0])));
    consoleError.mockRestore();
  });

  it("does not cancel an active request a second time after the user already cancelled it", async () => {
    const pending = deferred<LocalAgentRunResult>();
    const cancel = vi.fn().mockResolvedValue(true);
    const run = vi.fn().mockReturnValue(pending.promise);
    const { unmount } = renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel,
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel local agent" }));
    expect(cancel).toHaveBeenCalledTimes(1);

    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(resultFor(run.mock.calls[0][0])));
  });

  it("clears a failed cancellation error while a retry waits for run settlement", async () => {
    const pending = deferred<LocalAgentRunResult>();
    const retryCancel = deferred<boolean>();
    const cancel = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockReturnValueOnce(retryCancel.promise);
    let onEvent: ((event: LocalAgentStreamEvent) => void) | undefined;
    const run = vi
      .fn()
      .mockImplementation(
        (
          _request: LocalAgentRunRequest,
          nextEvent: (event: LocalAgentStreamEvent) => void,
        ) => {
          onEvent = nextEvent;
          return pending.promise;
        },
      );
    const { props } = renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel,
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Cancel local agent" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not cancel local agent.",
    );
    expect(
      screen.getByRole("button", { name: "Cancel local agent" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel local agent" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Cancelling local agent…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Close local agent" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Cancel local agent" }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Run @codex" })).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);

    await act(async () => retryCancel.resolve(true));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Close local agent" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Cancel local agent" }),
    ).toBeDisabled();

    onEvent?.({
      type: "failed",
      requestId: run.mock.calls[0][0].requestId,
      code: "private",
      message: "private failure details",
    });
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => pending.resolve(resultFor(run.mock.calls[0][0])));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Close local agent" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByText("Local agent request cancelled."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run @codex" })).toBeEnabled();
    expect(props.onResult).not.toHaveBeenCalled();
  });

  it("retries a rejected cancellation without leaking its error", async () => {
    const pending = deferred<LocalAgentRunResult>();
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("token sk-secret at /private/tmp/cancel"),
      )
      .mockResolvedValueOnce(true);
    const run = vi.fn().mockReturnValue(pending.promise);
    renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel,
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Cancel local agent" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not cancel local agent.");
    expect(alert).not.toHaveTextContent(/sk-secret|private\/tmp/i);
    fireEvent.click(screen.getByRole("button", { name: "Cancel local agent" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Cancelling local agent…")).toBeInTheDocument();
  });

  it("returns to an idle safe cancellation status when a confirmed cancellation run rejects", async () => {
    const pending = deferred<LocalAgentRunResult>();
    const cancel = vi.fn().mockResolvedValue(true);
    const run = vi.fn().mockReturnValue(pending.promise);
    const { props } = renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel,
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const requestId = run.mock.calls[0][0].requestId;

    fireEvent.click(screen.getByRole("button", { name: "Cancel local agent" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(requestId));
    expect(
      screen.getByRole("button", { name: "Close local agent" }),
    ).toBeDisabled();
    await act(async () =>
      pending.reject(
        new Error("token sk-secret at /private/tmp/cancelled-run"),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Close local agent" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByText("Local agent request cancelled."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(props.onResult).not.toHaveBeenCalled();
  });

  it("keeps a cancellation attempt single-flight until it completes", async () => {
    const pendingRun = deferred<LocalAgentRunResult>();
    const pendingCancel = deferred<boolean>();
    const cancel = vi.fn().mockReturnValue(pendingCancel.promise);
    const run = vi.fn().mockReturnValue(pendingRun.promise);
    renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel,
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    const cancelButton = screen.getByRole("button", {
      name: "Cancel local agent",
    });
    fireEvent.click(cancelButton);
    fireEvent.click(cancelButton);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelButton).toBeDisabled();
    await act(async () => pendingCancel.resolve(false));
    expect(
      screen.getByRole("button", { name: "Cancel local agent" }),
    ).toBeEnabled();
  });

  it("ignores a late failed cancellation after the request has completed and another run starts", async () => {
    const firstRun = deferred<LocalAgentRunResult>();
    const secondRun = deferred<LocalAgentRunResult>();
    const lateCancel = deferred<boolean>();
    const cancel = vi.fn().mockReturnValue(lateCancel.promise);
    const run = vi
      .fn()
      .mockReturnValueOnce(firstRun.promise)
      .mockReturnValueOnce(secondRun.promise);
    const { props } = renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel,
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel local agent" }));

    await act(async () => firstRun.resolve(resultFor(run.mock.calls[0][0])));
    await waitFor(() => expect(props.onResult).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await act(async () =>
      lateCancel.reject(new Error("private cancellation details")),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close local agent" }),
    ).toBeDisabled();
  });

  it("ignores stale status responses after unmount and forwards only content-free lifecycle status", async () => {
    const pendingStatuses = deferred<LocalAgentStatus[]>();
    const { unmount } = renderComposer({
      services: {
        listStatuses: vi.fn().mockReturnValue(pendingStatuses.promise),
        run: vi.fn(),
        cancel: vi.fn(),
      },
    });
    unmount();
    await act(async () => pendingStatuses.resolve(statuses));

    const run = vi.fn().mockImplementation(async (request, onEvent) => {
      onEvent({ type: "running", requestId: request.requestId });
      onEvent({
        type: "failed",
        requestId: request.requestId,
        code: "private-code",
        message: "secret body /tmp/x",
      });
      throw new Error("secret body /tmp/x");
    });
    renderComposer({
      services: {
        listStatuses: vi.fn().mockResolvedValue(statuses),
        run,
        cancel: vi.fn(),
      },
    });
    await waitForStatuses();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Use it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run @codex" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not run local agent.",
    );
    expect(
      screen.queryByText(/secret body|private-code/i),
    ).not.toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
