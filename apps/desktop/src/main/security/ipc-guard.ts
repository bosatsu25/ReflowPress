/**
 * IPC sender validation.
 *
 * Only the top-level frame of the ReflowPress window, showing the bundled
 * renderer, may call privileged handlers. Subframes (the sandboxed book
 * content iframe) and any other WebContents are refused.
 */

export interface IpcSenderLike {
  readonly sender: { readonly id: number };
  readonly senderFrame: {
    readonly url: string;
    readonly parent: unknown;
  } | null;
}

export function isTrustedSender(
  event: IpcSenderLike,
  windowWebContentsId: number,
  isAppUrl: (url: string) => boolean,
): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  if (event.sender.id !== windowWebContentsId) return false;
  if (frame.parent !== null) return false;
  return isAppUrl(frame.url);
}

export class UntrustedSenderError extends Error {
  constructor(channel: string) {
    super(`Rejected IPC call on '${channel}' from an untrusted frame.`);
    this.name = "UntrustedSenderError";
  }
}
