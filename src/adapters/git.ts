import path from "node:path";
import { execa } from "execa";
import { error, InlayError } from "../diagnostics.js";

export class GitAdapter {
  constructor(readonly cwd: string) {}

  async run(args: string[], options: { reject?: boolean } = {}): Promise<string> {
    try {
      const result = await execa("git", args, { cwd: this.cwd, reject: options.reject ?? true });
      return result.stdout.trim();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new InlayError(error("git-failed", `git ${args.join(" ")} failed.`, { detail }));
    }
  }

  async isRepository(): Promise<boolean> {
    try {
      return (await this.run(["rev-parse", "--is-inside-work-tree"])) === "true";
    } catch {
      return false;
    }
  }

  async root(): Promise<string> {
    return path.resolve(await this.run(["rev-parse", "--show-toplevel"]));
  }

  async head(): Promise<string | undefined> {
    try {
      return await this.run(["rev-parse", "HEAD"]);
    } catch {
      return undefined;
    }
  }

  async remoteUrl(): Promise<string | undefined> {
    try {
      return await this.run(["remote", "get-url", "origin"]);
    } catch {
      return undefined;
    }
  }

  async isTracked(relativePath: string): Promise<boolean> {
    try {
      await this.run(["ls-files", "--error-unmatch", "--", relativePath]);
      return true;
    } catch {
      return false;
    }
  }

  async untracked(): Promise<string[]> {
    const output = await this.run(["ls-files", "--others", "--exclude-standard"]);
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  }

  async tracked(): Promise<string[]> {
    const output = await this.run(["ls-files", "--cached"]);
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  }

  async staged(): Promise<string[]> {
    const output = await this.run(["diff", "--cached", "--name-only"]);
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  }

  async stage(paths: string[], force = false): Promise<void> {
    if (paths.length > 0) await this.run(["add", ...(force ? ["--force"] : []), "--", ...paths]);
  }

  async readAtHead(repositoryRelativePath: string): Promise<Uint8Array> {
    try {
      const result = await execa("git", ["show", `HEAD:${repositoryRelativePath.replaceAll("\\", "/")}`], {
        cwd: this.cwd,
        encoding: "buffer",
      });
      return new Uint8Array(result.stdout);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new InlayError(
        error("git-head-read", `Cannot restore ${repositoryRelativePath} from HEAD.`, { detail }),
      );
    }
  }
}
