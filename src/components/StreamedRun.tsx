import { Action, ActionPanel, Color, Detail, Icon, Keyboard, showToast, Toast } from "@raycast/api";
import type { ChildProcess } from "node:child_process";
import { useCallback, useEffect, useRef, useState } from "react";
import { spawnMise, stopProcess } from "../lib/mise";
import { projectLabel } from "../lib/projects";

const MAX_OUTPUT = 200_000;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;

type Status = "running" | "succeeded" | "failed" | "stopped";

export interface StreamedRunProps {
  /** shown as the navigation title and in toasts, e.g. "mise run build" */
  title: string;
  args: string[];
  /** folder mise runs in; undefined for the global context */
  cwd?: string;
  /** project id, for the metadata panel */
  project: string;
  /** extra environment variables for the command */
  env?: Record<string, string>;
  /** called once when the command exits successfully */
  onSuccess?: () => void;
}

function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function commandLine(args: string[]): string {
  return ["mise", ...args].map(shellQuote).join(" ");
}

/**
 * Runs a mise command in the background and streams its output.
 * Closing the view stops the command (this is how watch mode ends).
 */
export function StreamedRun({ title, args, cwd, env, project, onSuccess }: StreamedRunProps) {
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<Status>("running");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [runId, setRunId] = useState(0);
  const child = useRef<ChildProcess | undefined>(undefined);
  const buffer = useRef("");
  const stoppedByUser = useRef(false);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    let cancelled = false;
    buffer.current = "";
    stoppedByUser.current = false;
    setOutput("");
    setStatus("running");
    setExitCode(null);

    const flush = setInterval(() => {
      if (!cancelled) setOutput(buffer.current);
    }, 150);

    const toastPromise = showToast({ style: Toast.Style.Animated, title: `Running ${title}…` });

    spawnMise(
      args,
      { cwd, env },
      {
        onData: (chunk) => {
          const next = buffer.current + chunk.replace(ANSI, "").replace(/\r(?!\n)/g, "\n");
          buffer.current = next.length > MAX_OUTPUT ? next.slice(next.length - MAX_OUTPUT) : next;
        },
        onError: async (error) => {
          if (cancelled) return;
          buffer.current += `\n${error.message}\n`;
          setOutput(buffer.current);
          setStatus("failed");
          const toast = await toastPromise;
          toast.style = Toast.Style.Failure;
          toast.title = `${title} failed`;
          toast.message = error.message;
        },
        onExit: async (code) => {
          clearInterval(flush);
          if (cancelled) return;
          setOutput(buffer.current);
          setExitCode(code);
          const toast = await toastPromise;
          if (stoppedByUser.current) {
            setStatus("stopped");
            toast.style = Toast.Style.Success;
            toast.title = `Stopped ${title}`;
          } else if (code === 0) {
            setStatus("succeeded");
            toast.style = Toast.Style.Success;
            toast.title = `Finished ${title}`;
            onSuccessRef.current?.();
          } else {
            setStatus("failed");
            toast.style = Toast.Style.Failure;
            toast.title = `${title} failed`;
            toast.message = code === null ? "Terminated" : `Exit code ${code}`;
          }
        },
      },
    )
      .then((proc) => {
        if (cancelled) stopProcess(proc);
        else child.current = proc;
      })
      .catch(async (error: Error) => {
        clearInterval(flush);
        if (cancelled) return;
        buffer.current = error.message;
        setOutput(error.message);
        setStatus("failed");
        const toast = await toastPromise;
        toast.style = Toast.Style.Failure;
        toast.title = `${title} failed`;
        toast.message = error.message;
      });

    return () => {
      cancelled = true;
      // closing the view stops the command; finish its toast so it does not spin forever
      const running = child.current && child.current.exitCode === null && child.current.signalCode === null;
      if (running) {
        toastPromise.then((toast) => {
          toast.style = Toast.Style.Success;
          toast.title = `Stopped ${title}`;
        });
      }
      clearInterval(flush);
      if (child.current) stopProcess(child.current);
      child.current = undefined;
    };
    // args are compared by value so a parent re-render does not restart the command
  }, [JSON.stringify(args), cwd, JSON.stringify(env), runId]);

  const stop = useCallback(() => {
    if (!child.current) return;
    stoppedByUser.current = true;
    stopProcess(child.current);
  }, []);

  const fenced = output.replace(/```/g, "ʼʼʼ");
  const markdown =
    fenced.trim().length > 0
      ? "```\n" + fenced + "\n```"
      : status === "running"
        ? "_Waiting for output…_"
        : "_No output._";

  const statusTag = {
    running: { text: "Running", color: Color.Blue },
    succeeded: { text: "Succeeded", color: Color.Green },
    failed: { text: "Failed", color: Color.Red },
    stopped: { text: "Stopped", color: Color.Orange },
  }[status];

  return (
    <Detail
      navigationTitle={title}
      isLoading={status === "running"}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Status">
            <Detail.Metadata.TagList.Item text={statusTag.text} color={statusTag.color} />
          </Detail.Metadata.TagList>
          {exitCode !== null ? <Detail.Metadata.Label title="Exit Code" text={String(exitCode)} /> : null}
          <Detail.Metadata.Label title="Command" text={commandLine(args)} />
          <Detail.Metadata.Label title="Project" text={projectLabel(project)} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {status === "running" ? (
            <Action title="Stop" icon={Icon.Stop} style={Action.Style.Destructive} onAction={stop} />
          ) : (
            <Action
              title="Run Again"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={() => setRunId((n) => n + 1)}
            />
          )}
          <Action.CopyToClipboard title="Copy Output" content={output} />
          <Action.CopyToClipboard
            title="Copy Command"
            content={commandLine(args)}
            shortcut={Keyboard.Shortcut.Common.CopyName}
          />
        </ActionPanel>
      }
    />
  );
}
